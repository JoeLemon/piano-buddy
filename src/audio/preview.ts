import { pitchToMidi } from "../domain/pitch";
import type { Hand, Score } from "../domain/types";
import { DURATION_BEATS } from "../domain/vocabulary";

export type Playback = { stop: () => void };

export type PreviewOptions = {
  /** 每个发声音开始播放时回调，索引与谱面的发声音序列一致（不含休止符）。 */
  onNote?: (index: number, midi: number) => void;
  /** 播放/暂停/seek 时的当前拍点，供 UI 画进度。 */
  onProgress?: (beat: number) => void;
  /** 正常播完时回调（被 stop()/pause() 打断时不触发）。 */
  onEnd?: () => void;
};

/**
 * 可控制的示范播放器。
 *
 * `previewScore` 保留为一次性播放的兼容入口；曲目页用本接口做
 * 播放/暂停、0.25x–2x 变速、单手切换和按拍 seek。
 */
export interface PreviewPlayer extends Playback {
  play(): void;
  pause(): void;
  seek(beat: number): void;
  setSpeed(speed: number): void;
  setHand(hand: Hand | "BOTH"): void;
  readonly playing: boolean;
  readonly positionBeats: number;
  readonly totalBeats: number;
}

type AudioContextCtor = typeof AudioContext;

function audioContextConstructor(): AudioContextCtor | null {
  const scope = globalThis as typeof globalThis & { webkitAudioContext?: AudioContextCtor };
  if (typeof scope.AudioContext === "function") return scope.AudioContext;
  if (typeof scope.webkitAudioContext === "function") return scope.webkitAudioContext;
  return null;
}

/** 当前环境能否播放声音（浏览器无 AudioContext 时为 false）。 */
export function audioAvailable(): boolean {
  return audioContextConstructor() !== null;
}

function openContext(): AudioContext | null {
  const Ctor = audioContextConstructor();
  if (!Ctor) return null;
  let ctx: AudioContext;
  try {
    ctx = new Ctor();
  } catch {
    return null;
  }
  try {
    void ctx.resume();
  } catch {
    void ctx.close();
    return null;
  }
  return ctx;
}

function midiToHz(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12);
}

function tone(ctx: AudioContext, frequency: number, when: number, duration: number): OscillatorNode {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  const end = when + duration;
  osc.type = "sine";
  osc.frequency.setValueAtTime(frequency, when);
  gain.gain.setValueAtTime(0.0001, when);
  gain.gain.exponentialRampToValueAtTime(0.18, when + Math.min(0.015, duration * 0.25));
  gain.gain.exponentialRampToValueAtTime(0.0001, end);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(when);
  osc.stop(end);
  osc.onended = () => {
    try {
      osc.disconnect();
    } catch {
      // context already closed
    }
    try {
      gain.disconnect();
    } catch {
      // context already closed
    }
  };
  return osc;
}

function halt(nodes: OscillatorNode[], ctx: AudioContext) {
  const now = ctx.currentTime;
  for (const osc of nodes) {
    osc.onended = null;
    try {
      osc.disconnect();
    } catch {
      // already disconnected
    }
    try {
      osc.stop(now);
    } catch {
      // not started yet, or already stopped
    }
  }
  void ctx.close();
}

/** 一次性播放的兼容入口；需要暂停/变速/seek 时用 createPreviewPlayer。 */
export function previewScore(
  score: Score,
  hand: Hand | "BOTH",
  bpm: number,
  options: PreviewOptions = {},
): Playback {
  const player = createPreviewPlayer(score, hand, bpm, options);
  player.play();
  return { stop: () => player.stop() };
}

const PREVIEW_START_DELAY = 0.05;
const PREVIEW_LOOKAHEAD_SECONDS = 0.2;
const PREVIEW_SCHEDULE_MS = 50;
const MIN_PREVIEW_SPEED = 0.25;
const MAX_PREVIEW_SPEED = 2;

const clamp = (value: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, value));

/**
 * 带时钟的示范播放器。
 *
 * Web Audio 已经调度的 oscillator 不能暂停/变速，所以 pause/seek/变速
 * 都采用「停止当前节点 → 从新拍点重新调度」的方式；播放中的进度用
 * wall clock 维护，音频事件仍按 AudioContext 的绝对时间排。
 */
export function createPreviewPlayer(
  score: Score,
  initialHand: Hand | "BOTH",
  bpm: number,
  options: PreviewOptions = {},
): PreviewPlayer {
  const validBpm = bpm > 0 && Number.isFinite(bpm);
  let hand = initialHand;
  let events = previewEvents(score, hand);
  let totalBeats = events.reduce(
    (max, event) => Math.max(max, event.beat + event.beats),
    0,
  );
  let speed = 1;
  let position = 0;
  let playing = false;
  let ctx: AudioContext | null = null;
  let nodes: OscillatorNode[] = [];
  let noteTimers: ReturnType<typeof setTimeout>[] = [];
  let schedulerTimer: ReturnType<typeof setInterval> | null = null;
  let endTimer: ReturnType<typeof setTimeout> | null = null;
  let startPosition = 0;
  let startAtAudio = 0;
  let startAtWall = 0;
  let nextIndex = 0;

  const secondsPerBeat = () => 60 / bpm / speed;

  /** 用 Date.now 而不是 performance：测试里的 fake timers 会推进它。 */
  const wallNow = () => Date.now();
  const positionNow = (): number => {
    if (!playing) return position;
    const elapsedMs = Math.max(0, wallNow() - startAtWall);
    return clamp(startPosition + elapsedMs / 1000 / secondsPerBeat(), 0, totalBeats);
  };

  const clearNoteTimers = () => {
    for (const timer of noteTimers) clearTimeout(timer);
    noteTimers.length = 0;
  };

  const clearSchedule = () => {
    if (schedulerTimer !== null) {
      clearInterval(schedulerTimer);
      schedulerTimer = null;
    }
    if (endTimer !== null) {
      clearTimeout(endTimer);
      endTimer = null;
    }
    clearNoteTimers();
  };

  const stopAudio = () => {
    clearSchedule();
    playing = false;
    if (ctx) {
      halt(nodes, ctx);
      ctx = null;
      nodes = [];
    }
  };

  const finish = () => {
    if (!playing) return;
    position = totalBeats;
    stopAudio();
    options.onProgress?.(position);
    options.onEnd?.();
  };

  /**
   * 只调度未来 0.2 秒内的事件；长曲不会一次性创建几千个 oscillator。
   * 已经开始的音在 seek 后不补奏，避免 UI 游标和声音错位。
   */
  const scheduleWindow = () => {
    if (!playing || !ctx) return;
    const context = ctx;
    const audioNow = context.currentTime;
    const current = positionNow();
    const horizon = current + PREVIEW_LOOKAHEAD_SECONDS / secondsPerBeat();

    while (nextIndex < events.length) {
      const index = nextIndex;
      const event = events[index];
      if (event.beat > horizon + 1e-6) break;
      nextIndex += 1;

      if (event.beat < startPosition - 1e-6) continue;
      if (event.beat + event.beats <= current - 1e-6) continue;

      const when = startAtAudio + (event.beat - startPosition) * secondsPerBeat();
      const start = Math.max(when, audioNow + 0.005);
      const fromBeat = Math.max(event.beat, current);
      const duration = Math.max(
        0.03,
        (event.beat + event.beats - fromBeat) * secondsPerBeat() * 0.92,
      );
      if (options.onNote) {
        // UI 回调跟随 wall clock，而不是 AudioContext.currentTime：
        // 测试里的 fake audio context 不会推进 currentTime，真实环境里
        // 两者可能有几十毫秒的时钟偏差。
        const eventWallMs =
          startAtWall + (event.beat - startPosition) * secondsPerBeat() * 1000;
        const delay = Math.max(0, Math.round(eventWallMs - wallNow()));
        noteTimers.push(
          setTimeout(() => options.onNote?.(index, event.midis[0] ?? 0), delay),
        );
      }
      for (const midi of event.midis) {
        nodes.push(tone(context, midiToHz(midi), start, duration));
      }
    }
    options.onProgress?.(current);
  };

  const startPlayback = () => {
    if (!validBpm || playing) return;
    if (position >= totalBeats - 1e-6) position = 0;

    const context = openContext();
    if (!context) return;

    ctx = context;
    startPosition = position;
    startAtAudio = context.currentTime + PREVIEW_START_DELAY;
    startAtWall = wallNow() + PREVIEW_START_DELAY * 1000;
    nextIndex = events.findIndex((event) => event.beat >= startPosition - 1e-6);
    if (nextIndex < 0) nextIndex = events.length;
    playing = true;
    scheduleWindow();
    schedulerTimer = setInterval(scheduleWindow, PREVIEW_SCHEDULE_MS);
    endTimer = setTimeout(
      finish,
      PREVIEW_START_DELAY * 1000 +
        Math.max(0, totalBeats - startPosition) * secondsPerBeat() * 1000,
    );
    options.onProgress?.(startPosition);
  };

  return {
    play: () => {
      if (!playing) startPlayback();
    },
    pause: () => {
      if (!playing) return;
      position = positionNow();
      stopAudio();
      options.onProgress?.(position);
    },
    stop: () => {
      position = 0;
      stopAudio();
      options.onProgress?.(0);
    },
    seek: (beat: number) => {
      const next = clamp(Number.isFinite(beat) ? beat : 0, 0, totalBeats);
      const wasPlaying = playing;
      if (wasPlaying) stopAudio();
      position = next;
      if (wasPlaying && position < totalBeats - 1e-6) startPlayback();
      else options.onProgress?.(position);
    },
    setSpeed: (nextSpeed: number) => {
      const next = clamp(
        Number.isFinite(nextSpeed) ? nextSpeed : 1,
        MIN_PREVIEW_SPEED,
        MAX_PREVIEW_SPEED,
      );
      if (next === speed) return;
      const wasPlaying = playing;
      const at = wasPlaying ? positionNow() : position;
      if (wasPlaying) stopAudio();
      speed = next;
      position = clamp(at, 0, totalBeats);
      if (wasPlaying && position < totalBeats - 1e-6) startPlayback();
      else options.onProgress?.(position);
    },
    setHand: (nextHand: Hand | "BOTH") => {
      if (nextHand === hand) return;
      const wasPlaying = playing;
      const at = wasPlaying ? positionNow() : position;
      if (wasPlaying) stopAudio();
      hand = nextHand;
      events = previewEvents(score, hand);
      totalBeats = events.reduce(
        (max, event) => Math.max(max, event.beat + event.beats),
        0,
      );
      position = clamp(at, 0, totalBeats);
      if (wasPlaying && position < totalBeats - 1e-6) startPlayback();
      else options.onProgress?.(position);
    },
    get playing() {
      return playing;
    },
    get positionBeats() {
      return positionNow();
    },
    get totalBeats() {
      return totalBeats;
    },
  };
}

type PreviewEvent = { midi: number; midis: number[]; beat: number; beats: number };

/** 发声音序列：单手或双手，顺序与谱面上色的序号一致。 */
function previewEvents(score: Score, hand: Hand | "BOTH"): PreviewEvent[] {
  const hands: readonly Hand[] = hand === "BOTH" ? ["RH", "LH"] : [hand];
  const events: PreviewEvent[] = [];
  for (const nextHand of hands) {
    let beat = 0;
    for (const measure of score.staves[nextHand]?.measures ?? []) {
      for (const note of measure.notes) {
        const beats = DURATION_BEATS[note.duration];
        if (note.pitches.length > 0 && !note.duration.endsWith("r")) {
          const midis = note.pitches.map((pitch) => pitchToMidi(pitch));
          events.push({ midi: midis[0] ?? 0, midis, beat, beats });
        }
        beat += beats;
      }
    }
  }
  // 稳定排序：同拍保持「先右手后左手」的插入顺序（右手先入数组）。
  events.sort((a, b) => a.beat - b.beat);
  return events;
}

export function startMetronome(bpm: number): Playback {
  const ctx = openContext();
  if (!ctx) return { stop() {} };

  if (!(bpm > 0) || !Number.isFinite(bpm)) {
    void ctx.close();
    return { stop() {} };
  }

  const nodes: OscillatorNode[] = [];
  const secondsPerBeat = 60 / bpm;
  let next = ctx.currentTime + 0.05;
  let beatIndex = 0;
  let stopped = false;

  const scheduleAhead = () => {
    if (stopped) return;
    const horizon = ctx.currentTime + 0.25;
    while (next < horizon) {
      if (next < ctx.currentTime) {
        next += secondsPerBeat;
        beatIndex += 1;
        continue;
      }
      const frequency = beatIndex % 4 === 0 ? 880 : 660;
      nodes.push(tone(ctx, frequency, next, 0.03));
      next += secondsPerBeat;
      beatIndex += 1;
    }
  };

  scheduleAhead();
  const timer = setInterval(scheduleAhead, 50);

  return {
    stop() {
      if (stopped) return;
      stopped = true;
      clearInterval(timer);
      halt(nodes, ctx);
    },
  };
}
