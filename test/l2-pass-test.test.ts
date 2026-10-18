import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as audio from "../src/audio/preview";
import { generateL2 } from "../src/domain/generateL2";
import { initialProfile, testBpmForLevel, type Profile } from "../src/domain/profile";
import { flattenScore } from "../src/domain/timeline";
import type { Hand, Score } from "../src/domain/types";
import { DURATION_BEATS } from "../src/domain/vocabulary";
import { loadProfile, saveProfile } from "../src/storage/db";
import App from "../src/App.vue";

class FakeInput extends EventTarget {
  type: "input" | "output" = "input";
  state: "connected" | "disconnected" = "connected";
  connection: "open" | "closed" | "pending" = "open";

  open(): Promise<MIDIPort> {
    this.connection = "open";
    return Promise.resolve(this as unknown as MIDIPort);
  }
}

function installAccess(inputs: FakeInput[]) {
  const access = new EventTarget() as EventTarget & {
    inputs: { forEach: (callback: (input: FakeInput) => void) => void };
  };
  access.inputs = {
    forEach: (callback) => {
      for (const input of inputs) callback(input);
    },
  };
  (navigator as unknown as { requestMIDIAccess: () => Promise<unknown> }).requestMIDIAccess = async () => access;
}

function noteOn(midi: number) {
  const event = new Event("midimessage");
  Object.assign(event, { data: Uint8Array.from([0x90, midi, 100]) });
  return event;
}

function lineMs(score: Score, bpm: number): number {
  const hands: readonly Hand[] = ["RH", "LH"];
  const beats = Math.max(
    ...hands.map((hand) =>
      (score.staves[hand]?.measures ?? []).reduce(
        (sum, measure) => sum + measure.notes.reduce((inner, note) => inner + DURATION_BEATS[note.duration], 0),
        0,
      ),
    ),
  );
  return Math.round(beats * (60000 / bpm));
}

async function untilText(
  wrapper: { text: () => string },
  text: string,
  fake = false,
) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (fake) await vi.advanceTimersByTimeAsync(0);
    else await flushPromises();
    if (wrapper.text().includes(text)) return;
  }
  throw new Error(`missing ${text}: ${wrapper.text()}`);
}

function l2TestProfile(partial: Partial<Profile> = {}): Profile {
  return {
    ...initialProfile(),
    assessment: { knowsTreble: true, knowsBass: true, keepsPulse: true },
    lessonId: "L2-test",
    l1RightPassed: true,
    l1LeftPassed: true,
    seenReadingTips: true,
    seenSightTips: true,
    lastSeed: 7,
    ...partial,
  };
}

enableAutoUnmount(afterEach);

afterEach(async () => {
  await flushPromises();
  vi.useRealTimers();
  vi.restoreAllMocks();
  delete (navigator as { requestMIDIAccess?: unknown }).requestMIDIAccess;
});

describe("L2 pass test", () => {
  it("runs one two-hand line and passes with two pitch errors", async () => {
    await saveProfile(l2TestProfile());
    vi.useFakeTimers({ toFake: ["setTimeout", "setInterval", "clearTimeout", "clearInterval"] });
    vi.spyOn(audio, "startMetronome").mockReturnValue({ stop() {} });
    const input = new FakeInput();
    installAccess([input]);
    const wrapper = mount(App);
    await untilText(wrapper, "5 分钟视奏", true);
    await wrapper.get("[data-test=reading]").trigger("click");
    await untilText(wrapper, "过关测试", true);

    const test = wrapper.get("[data-test=pass-test]");
    expect(test.attributes("data-level")).toBe("2");
    expect(test.attributes("data-hand")).toBe("BOTH");
    expect(test.attributes("data-hands")).toBe("RH,LH");
    expect(test.attributes("data-mode")).toBe("reading-test");
    expect(test.attributes("data-score-id")).toBe("l2-test-7");
    expect(wrapper.get("[data-test=test-hand]").text()).toBe("双手");
    expect(wrapper.find("[data-test=lesson-progress]").exists()).toBe(false);

    const score = generateL2({ seed: 7, mode: "reading-test", shape: { kind: "test" } });
    const notes = flattenScore(score);
    expect(score.hands).toEqual(["RH", "LH"]);
    expect(notes.every((note) => note.hand === "RH" || note.hand === "LH")).toBe(true);

    for (let attempt = 0; attempt < 30 && test.attributes("data-listening") !== "true"; attempt += 1) {
      await vi.advanceTimersByTimeAsync(0);
    }
    expect(test.attributes("data-listening")).toBe("true");

    notes.forEach((note, index) => {
      input.dispatchEvent(noteOn(index === 1 || index === 4 ? 1 : note.midi));
    });
    const bpm = testBpmForLevel(l2TestProfile(), 2);
    expect(bpm).toBe(60);
    await vi.advanceTimersByTimeAsync(lineMs(score, bpm));
    await untilText(wrapper, "这些音可以直接认了", true);
    expect(wrapper.get("[data-test=feedback]").text()).toBe(
      "这些音可以直接认了。接下来的视奏里只会用到它们。",
    );
    expect(wrapper.text()).not.toContain("%");

    let saved = await loadProfile();
    for (let attempt = 0; attempt < 30 && !saved.l2Passed; attempt += 1) {
      await vi.advanceTimersByTimeAsync(0);
      saved = await loadProfile();
    }
    expect(saved.l2Passed).toBe(true);
    expect(saved.l2FailStreak).toBe(0);
    expect(saved.lessonId).toBe("L2-test");

    await wrapper.get("[data-test=continue]").trigger("click");
    await untilText(wrapper, "5 分钟视奏", true);
    expect(wrapper.text()).toContain("L2 也过了");
    expect(wrapper.text()).not.toContain("%");
  });

  it("does not pass with three pitch errors and starts a new line", async () => {
    await saveProfile(l2TestProfile({ l2Slowed: false }));
    vi.useFakeTimers({ toFake: ["setTimeout", "setInterval", "clearTimeout", "clearInterval"] });
    vi.spyOn(audio, "startMetronome").mockReturnValue({ stop() {} });
    const input = new FakeInput();
    installAccess([input]);
    const wrapper = mount(App);
    await untilText(wrapper, "5 分钟视奏", true);
    await wrapper.get("[data-test=reading]").trigger("click");
    await untilText(wrapper, "过关测试", true);

    const test = wrapper.get("[data-test=pass-test]");
    for (let attempt = 0; attempt < 30 && test.attributes("data-listening") !== "true"; attempt += 1) {
      await vi.advanceTimersByTimeAsync(0);
    }
    const score = generateL2({ seed: 7, mode: "reading-test", shape: { kind: "test" } });
    const notes = flattenScore(score);
    notes.forEach((note, index) => {
      input.dispatchEvent(noteOn(index < 3 ? 1 : note.midi));
    });
    await vi.advanceTimersByTimeAsync(lineMs(score, 60));
    for (let attempt = 0; attempt < 30 && !wrapper.find("[data-test=feedback]").exists(); attempt += 1) {
      await vi.advanceTimersByTimeAsync(0);
    }
    const feedback = wrapper.get("[data-test=feedback]").text();
    expect(feedback.length).toBeGreaterThan(0);
    expect(feedback).not.toContain("%");

    let saved = await loadProfile();
    for (let attempt = 0; attempt < 30 && saved.l2FailStreak !== 1; attempt += 1) {
      await vi.advanceTimersByTimeAsync(0);
      saved = await loadProfile();
    }
    expect(saved.l2Passed).toBe(false);
    expect(saved.l2FailStreak).toBe(1);
    expect(saved.lessonId).toBe("L2-test");

    await wrapper.get("[data-test=continue]").trigger("click");
    await untilText(wrapper, "过关测试", true);
    expect(test.attributes("data-score-id")).toBe("l2-test-8");
    expect(test.attributes("data-level")).toBe("2");
    expect(wrapper.text()).not.toContain("%");
  });

  it("starts the L2 pass test as soon as the last L2 lesson is cleared", async () => {
    await saveProfile(l2TestProfile({ lessonId: "L2-6", linesCompleted: 1, lastSeed: 2 }));
    const input = new FakeInput();
    installAccess([input]);
    const wrapper = mount(App);
    await untilText(wrapper, "5 分钟视奏");
    await wrapper.get("[data-test=reading]").trigger("click");
    await untilText(wrapper, "整段从 C 位挪到 D 位");
    for (let attempt = 0; attempt < 30; attempt += 1) {
      await flushPromises();
    }
    for (const note of flattenScore(generateL2({
      seed: 2,
      mode: "reading-lesson",
      shape: { kind: "shift-once", hand: "RH" },
    }))) {
      input.dispatchEvent(noteOn(note.midi));
    }
    await untilText(wrapper, "过关测试");
    expect(wrapper.get("[data-test=pass-test]").attributes("data-level")).toBe("2");
    expect(wrapper.get("[data-test=pass-test]").attributes("data-hands")).toBe("RH,LH");
  });
});
