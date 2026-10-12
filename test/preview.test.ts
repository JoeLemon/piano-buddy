import { afterEach, describe, expect, it, vi } from "vitest";
import { previewScore, startMetronome } from "../src/audio/preview";
import { generateL1 } from "../src/domain/generate";
import type { Score } from "../src/domain/types";

describe("previewScore", () => {
  it("returns a stop handle without throwing when audio is unavailable", () => {
    const score = generateL1({ hand: "RH", seed: 5, mode: "sight" });
    const playback = previewScore(score, "RH", 60);
    expect(typeof playback.stop).toBe("function");
    playback.stop();
  });
});

const oneNote: Score = {
  id: "one",
  mode: "sight",
  level: 1,
  meter: { beats: 4, beatValue: 4 },
  keySignature: "C",
  hands: ["RH"],
  bpm: 60,
  staves: {
    RH: {
      clef: "treble",
      measures: [
        {
          notes: [{ id: "n", pitches: [{ step: "C", octave: 4, alteration: 0 }], duration: "q" }],
        },
      ],
    },
  },
};

afterEach(() => {
  delete (globalThis as { AudioContext?: unknown }).AudioContext;
  vi.useRealTimers();
});

describe("startMetronome", () => {
  it("skips beats that fell behind the audio clock and keeps scheduling", () => {
    vi.useFakeTimers();
    let now = 0;
    const scheduled: number[] = [];
    const rejectedTimes: number[] = [];

    class FakeParam {
      setValueAtTime(_value: number, time: number) {
        if (time < now) {
          rejectedTimes.push(time);
          throw new DOMException("InvalidStateError", "InvalidStateError");
        }
      }
      exponentialRampToValueAtTime(_value: number, time: number) {
        if (time < now) throw new DOMException("InvalidStateError", "InvalidStateError");
      }
    }

    (globalThis as { AudioContext?: unknown }).AudioContext = class {
      destination = {};
      get currentTime() {
        return now;
      }
      createOscillator() {
        const frequency = new FakeParam();
        const original = frequency.setValueAtTime.bind(frequency);
        frequency.setValueAtTime = (value: number, time: number) => {
          if (time >= now) scheduled.push(time);
          original(value, time);
        };
        return {
          type: "sine",
          frequency,
          connect() {},
          start() {},
          stop() {},
          disconnect() {},
          onended: null as (() => void) | null,
        };
      }
      createGain() {
        return { gain: new FakeParam(), connect() {}, disconnect() {} };
      }
      resume() {
        return Promise.resolve();
      }
      close() {
        return Promise.resolve();
      }
    };

    const playback = startMetronome(60);
    try {
      expect(scheduled).toEqual([0.05]);
      now = 3;
      let schedulerError: unknown = null;
      try {
        vi.advanceTimersByTime(50);
        vi.advanceTimersByTime(50);
      } catch (error) {
        schedulerError = error;
      }
      expect(schedulerError).toBeNull();
      expect(rejectedTimes).toEqual([]);
      expect(scheduled).toEqual([0.05, 3.05]);
    } finally {
      playback.stop();
    }
  });
});

describe("previewScore stop", () => {
  it("does not disconnect nodes after the context has closed", async () => {
    const disconnectsWhileClosed: string[] = [];
    const endedErrors: unknown[] = [];
    let state = "running";

    class FakeOsc {
      onended: (() => void) | null = null;
      private stopped = false;
      frequency = {
        setValueAtTime() {},
      };
      connect() {}
      start() {}
      stop() {
        if (this.stopped) throw new DOMException("InvalidStateError", "InvalidStateError");
        this.stopped = true;
        queueMicrotask(() => {
          try {
            this.onended?.();
          } catch (error) {
            endedErrors.push(error);
          }
        });
      }
      disconnect() {
        if (state === "closed") {
          disconnectsWhileClosed.push("osc");
          throw new DOMException("InvalidStateError", "InvalidStateError");
        }
      }
    }

    class FakeGain {
      gain = {
        setValueAtTime() {},
        exponentialRampToValueAtTime() {},
      };
      connect() {}
      disconnect() {
        if (state === "closed") {
          disconnectsWhileClosed.push("gain");
          throw new DOMException("InvalidStateError", "InvalidStateError");
        }
      }
    }

    (globalThis as { AudioContext?: unknown }).AudioContext = class {
      destination = {};
      currentTime = 0;
      createOscillator() {
        return new FakeOsc();
      }
      createGain() {
        return new FakeGain();
      }
      resume() {
        return Promise.resolve();
      }
      close() {
        state = "closed";
        return Promise.resolve();
      }
    };

    const playback = previewScore(oneNote, "RH", 60);
    playback.stop();
    await Promise.resolve();
    expect(endedErrors).toEqual([]);
    expect(disconnectsWhileClosed).toEqual([]);
  });
});
