import { pitchToMidi } from "../domain/pitch";
import type { Hand, Score } from "../domain/types";
import { DURATION_BEATS } from "../domain/vocabulary";

export type Playback = { stop: () => void };

export type PreviewOptions = {
  /** 每个发声音开始播放时回调，索引与谱面的发声音序列一致（不含休止符）。 */
  onNote?: (index: number, midi: number) => void;
  /** 正常播完时回调（被 stop() 打断时不触发）。 */
  onEnd?: () => void;
};

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

export function previewScore(
  score: Score,
  hand: Hand | "BOTH",
  bpm: number,
  options: PreviewOptions = {},
): Playback {
  const ctx = openContext();
  if (!ctx) return { stop() {} };

  if (!(bpm > 0) || !Number.isFinite(bpm)) {
    void ctx.close();
    return { stop() {} };
  }

  const nodes: OscillatorNode[] = [];
  const timers: ReturnType<typeof setTimeout>[] = [];
  const secondsPerBeat = 60 / bpm;
  const origin = ctx.currentTime + 0.05;
  let endAt = origin;

  // 与 flattenScore 同样的顺序：先按拍点排，同拍先右手后左手。
  // 音高与时长仍按谱面原样取，和弦不会被压成一个音。
  for (const [index, event] of previewEvents(score, hand).entries()) {
    const when = origin + event.beat * secondsPerBeat;
    const duration = Math.max(0.03, event.beats * secondsPerBeat * 0.92);
    endAt = Math.max(endAt, when + duration);
    if (options.onNote) {
      const delay = Math.max(0, Math.round((when - ctx.currentTime) * 1000));
      timers.push(setTimeout(() => options.onNote?.(index, event.midis[0] ?? 0), delay));
    }
    for (const midi of event.midis) {
      nodes.push(tone(ctx, midiToHz(midi), when, duration));
    }
  }

  let stopped = false;
  const clearTimers = () => {
    for (const timer of timers) clearTimeout(timer);
    timers.length = 0;
  };
  const autoClose = setTimeout(() => {
    if (stopped) return;
    stopped = true;
    clearTimers();
    options.onEnd?.();
    halt(nodes, ctx);
  }, Math.max(50, Math.round((endAt - ctx.currentTime) * 1000) + 40));

  return {
    stop() {
      if (stopped) return;
      stopped = true;
      clearTimeout(autoClose);
      clearTimers();
      halt(nodes, ctx);
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
