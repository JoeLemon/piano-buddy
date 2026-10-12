import { pitchToMidi } from "../domain/pitch";
import type { Hand, Score } from "../domain/types";
import { DURATION_BEATS } from "../domain/vocabulary";

type Playback = { stop: () => void };

type AudioContextCtor = typeof AudioContext;

function audioContextConstructor(): AudioContextCtor | null {
  const scope = globalThis as typeof globalThis & { webkitAudioContext?: AudioContextCtor };
  if (typeof scope.AudioContext === "function") return scope.AudioContext;
  if (typeof scope.webkitAudioContext === "function") return scope.webkitAudioContext;
  return null;
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
    osc.disconnect();
    gain.disconnect();
  };
  return osc;
}

function halt(nodes: OscillatorNode[], ctx: AudioContext) {
  const now = ctx.currentTime;
  for (const osc of nodes) {
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

export function previewScore(score: Score, hand: Hand, bpm: number): Playback {
  const ctx = openContext();
  if (!ctx) return { stop() {} };

  if (!(bpm > 0) || !Number.isFinite(bpm)) {
    void ctx.close();
    return { stop() {} };
  }

  const nodes: OscillatorNode[] = [];
  const stave = score.staves[hand];
  const secondsPerBeat = 60 / bpm;
  const origin = ctx.currentTime + 0.05;
  let beat = 0;

  for (const measure of stave?.measures ?? []) {
    for (const note of measure.notes) {
      const beats = DURATION_BEATS[note.duration];
      const sounding = note.pitches.length > 0 && !note.duration.endsWith("r");
      if (sounding) {
        const when = origin + beat * secondsPerBeat;
        const duration = Math.max(0.03, beats * secondsPerBeat * 0.92);
        for (const pitch of note.pitches) {
          nodes.push(tone(ctx, midiToHz(pitchToMidi(pitch)), when, duration));
        }
      }
      beat += beats;
    }
  }

  let stopped = false;
  return {
    stop() {
      if (stopped) return;
      stopped = true;
      halt(nodes, ctx);
    },
  };
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
  let stopped = false;

  const scheduleAhead = () => {
    if (stopped) return;
    const horizon = ctx.currentTime + 0.25;
    while (next < horizon) {
      nodes.push(tone(ctx, 880, next, 0.04));
      next += secondsPerBeat;
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
