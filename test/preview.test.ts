import { afterEach, describe, expect, it, vi } from "vitest";
import { createPreviewPlayer, previewScore, startMetronome } from "../src/audio/preview";
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

const lineWithRest: Score = {
  ...oneNote,
  staves: {
    RH: {
      clef: "treble",
      measures: [
        {
          notes: [
            { id: "a", pitches: [{ step: "C", octave: 4, alteration: 0 }], duration: "q" },
            { id: "r", pitches: [], duration: "qr" },
            { id: "b", pitches: [{ step: "E", octave: 4, alteration: 0 }], duration: "q" },
            { id: "c", pitches: [{ step: "G", octave: 4, alteration: 0 }], duration: "q" },
          ],
        },
      ],
    },
  },
};

function installPlainAudioContext() {
  (globalThis as { AudioContext?: unknown }).AudioContext = class {
    destination = {};
    currentTime = 0;
    createOscillator() {
      return {
        type: "sine",
        frequency: { setValueAtTime() {} },
        connect() {},
        start() {},
        stop() {},
        disconnect() {},
        onended: null as (() => void) | null,
      };
    }
    createGain() {
      return {
        gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} },
        connect() {},
        disconnect() {},
      };
    }
    resume() {
      return Promise.resolve();
    }
    close() {
      return Promise.resolve();
    }
  };
}

describe("createPreviewPlayer", () => {
  it("pauses, seeks and resumes without replaying earlier notes", () => {
    vi.useFakeTimers();
    installPlainAudioContext();
    const seen: number[] = [];
    let ended = 0;
    const player = createPreviewPlayer(lineWithRest, "RH", 60, {
      onNote: (index) => seen.push(index),
      onEnd: () => {
        ended += 1;
      },
    });

    try {
      expect(player.totalBeats).toBe(4);
      player.play();
      vi.advanceTimersByTime(60);
      expect(seen).toEqual([0]);

      player.pause();
      expect(player.playing).toBe(false);
      expect(player.positionBeats).toBeGreaterThan(0);
      vi.advanceTimersByTime(20000);
      expect(seen).toEqual([0]);
      expect(ended).toBe(0);

      player.seek(2);
      expect(player.positionBeats).toBe(2);
      player.play();
      vi.advanceTimersByTime(60);
      expect(seen).toEqual([0, 1]);

      vi.advanceTimersByTime(2100);
      expect(ended).toBe(1);
    } finally {
      player.stop();
    }
  });

  it("applies speed before playback and switches hands", () => {
    vi.useFakeTimers();
    installPlainAudioContext();
    const seen: number[] = [];
    const player = createPreviewPlayer(lineWithRest, "RH", 60, {
      onNote: (index) => seen.push(index),
    });

    try {
      player.setSpeed(2);
      player.play();
      vi.advanceTimersByTime(1100);
      expect(seen).toEqual([0, 1]);
    } finally {
      player.stop();
    }

    const twoHands: Score = {
      ...oneNote,
      hands: ["RH", "LH"],
      staves: {
        RH: oneNote.staves.RH!,
        LH: {
          clef: "bass",
          measures: [
            {
              notes: [
                {
                  id: "lh",
                  pitches: [{ step: "C", octave: 3, alteration: 0 }],
                  duration: "w",
                },
              ],
            },
          ],
        },
      },
    };
    const handPlayer = createPreviewPlayer(twoHands, "RH", 60);
    expect(handPlayer.totalBeats).toBe(1);
    handPlayer.setHand("LH");
    expect(handPlayer.totalBeats).toBe(4);
    handPlayer.stop();
  });
});

describe("createPreviewPlayer loop", () => {
  it("replays from the loop start instead of ending", () => {
    vi.useFakeTimers();
    installPlainAudioContext();
    const seen: number[] = [];
    let ended = 0;
    const player = createPreviewPlayer(lineWithRest, "RH", 60, {
      onNote: (index) => seen.push(index),
      onEnd: () => {
        ended += 1;
      },
    });

    try {
      // 循环前三拍：含第一个音（第 0 拍）和第二个音（第 2 拍），
      // 第三个音在第 3 拍，正好压在循环区外，不该响。
      player.setLoop({ start: 0, end: 3 });
      player.play();
      vi.advanceTimersByTime(60);
      expect(seen).toEqual([0]);

      vi.advanceTimersByTime(2000);
      expect(seen).toEqual([0, 1]);
      // 播到循环末端就该重播，不是结束
      expect(ended).toBe(0);

      vi.advanceTimersByTime(1060);
      expect(seen).toEqual([0, 1, 0]);
      // 重播后播放头回到循环起点附近，而不是停在末端
      expect(player.positionBeats).toBeLessThan(0.5);
      vi.advanceTimersByTime(20000);
      expect(ended).toBe(0);
    } finally {
      player.stop();
    }
  });

  it("clears the loop so playback runs to the end", () => {
    vi.useFakeTimers();
    installPlainAudioContext();
    let ended = 0;
    const player = createPreviewPlayer(lineWithRest, "RH", 60, {
      onEnd: () => {
        ended += 1;
      },
    });

    try {
      player.setLoop({ start: 0, end: 2 });
      player.setLoop(null);
      player.play();
      vi.advanceTimersByTime(5000);
      expect(ended).toBe(1);
    } finally {
      player.stop();
    }
  });

  it("treats an empty range as no loop and clamps seek/stop to the range", () => {
    vi.useFakeTimers();
    installPlainAudioContext();
    const player = createPreviewPlayer(lineWithRest, "RH", 60);
    try {
      player.setLoop({ start: 2, end: 2 });
      player.play();
      vi.advanceTimersByTime(5000);
      expect(player.playing).toBe(false);
      expect(player.positionBeats).toBe(4);

      player.setLoop({ start: 0, end: 2 });
      player.seek(3.5);
      expect(player.positionBeats).toBe(2);
      player.stop();
      // 循环时「回到开头」是循环起点，不是整首开头
      expect(player.positionBeats).toBe(0);
    } finally {
      player.stop();
    }
  });

  it("re-clamps the loop when a hand switch changes the length", () => {
    vi.useFakeTimers();
    installPlainAudioContext();
    const twoHands: Score = {
      ...oneNote,
      hands: ["RH", "LH"],
      staves: {
        RH: oneNote.staves.RH!,
        LH: {
          clef: "bass",
          measures: [
            {
              notes: [
                {
                  id: "lh",
                  pitches: [{ step: "C", octave: 3, alteration: 0 }],
                  duration: "w",
                },
              ],
            },
          ],
        },
      },
    };
    const seen: number[] = [];
    const player = createPreviewPlayer(twoHands, "LH", 60, {
      onNote: (index) => seen.push(index),
    });
    try {
      player.setLoop({ start: 0, end: 4 });
      player.setHand("RH");
      // 右手只有 1 拍：循环区被钳回首拍，不会留下一个越界的区间
      player.play();
      vi.advanceTimersByTime(60);
      expect(seen).toEqual([0]);
      vi.advanceTimersByTime(1100);
      // 越过唯一一拍后重播，而不是结束或静默卡住
      expect(seen).toEqual([0, 0]);
      expect(player.playing).toBe(true);

      player.setLoop(null);
      vi.advanceTimersByTime(3000);
      expect(player.playing).toBe(false);
      expect(player.positionBeats).toBe(1);
    } finally {
      player.stop();
    }
  });
});

describe("previewScore progress", () => {
  it("reports every sounding note in order and then the end", () => {
    vi.useFakeTimers();
    installPlainAudioContext();
    const seen: { index: number; midi: number }[] = [];
    let ended = 0;
    const playback = previewScore(lineWithRest, "RH", 60, {
      onNote: (index, midi) => seen.push({ index, midi }),
      onEnd: () => {
        ended += 1;
      },
    });
    try {
      vi.advanceTimersByTime(60);
      expect(seen).toEqual([{ index: 0, midi: 60 }]);
      // 休止符不占用序号，第二个发声音在第二拍才响
      vi.advanceTimersByTime(2000);
      expect(seen).toEqual([
        { index: 0, midi: 60 },
        { index: 1, midi: 64 },
      ]);
      vi.advanceTimersByTime(1000);
      expect(seen).toEqual([
        { index: 0, midi: 60 },
        { index: 1, midi: 64 },
        { index: 2, midi: 67 },
      ]);
      expect(ended).toBe(0);
      vi.advanceTimersByTime(20000);
      expect(ended).toBe(1);
    } finally {
      playback.stop();
    }
  });

  it("drops pending callbacks when stopped early", () => {
    vi.useFakeTimers();
    installPlainAudioContext();
    const seen: number[] = [];
    let ended = 0;
    const playback = previewScore(lineWithRest, "RH", 60, {
      onNote: (index) => seen.push(index),
      onEnd: () => {
        ended += 1;
      },
    });
    playback.stop();
    vi.advanceTimersByTime(30000);
    expect(seen).toEqual([]);
    expect(ended).toBe(0);
  });
});
