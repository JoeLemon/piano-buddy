import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as audio from "../src/audio/preview";
import { feedbackText } from "../src/domain/feedback";
import { generateL1 } from "../src/domain/generate";
import { pitchLabel, pitchToMidi } from "../src/domain/pitch";
import { initialProfile, testBpm, type Profile } from "../src/domain/profile";
import type { Hand, Score } from "../src/domain/types";
import { DURATION_BEATS } from "../src/domain/vocabulary";
import { loadProfile, saveProfile } from "../src/storage/db";
import App from "../src/App.vue";
import ReviewView from "../src/ui/ReviewView.vue";
import SightView from "../src/ui/SightView.vue";

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
  return access;
}

function noteOn(midi: number) {
  const event = new Event("midimessage");
  Object.assign(event, { data: Uint8Array.from([0x90, midi, 100]) });
  return event;
}

function sounding(score: Score, hand: Hand): { id: string; midi: number; label: string }[] {
  const notes: { id: string; midi: number; label: string }[] = [];
  for (const measure of score.staves[hand]?.measures ?? []) {
    for (const note of measure.notes) {
      if (note.duration.endsWith("r") || note.pitches.length === 0) continue;
      const pitch = note.pitches[0];
      notes.push({ id: note.id, midi: pitchToMidi(pitch), label: pitchLabel(pitch) });
    }
  }
  return notes;
}

function lineMs(score: Score, hand: Hand, bpm: number): number {
  const beats = (score.staves[hand]?.measures ?? []).reduce(
    (sum, measure) => sum + measure.notes.reduce((inner, note) => inner + DURATION_BEATS[note.duration], 0),
    0,
  );
  return Math.round(beats * (60000 / bpm));
}

async function untilText(wrapper: { text: () => string }, text: string, fake = false) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (fake) await vi.advanceTimersByTimeAsync(0);
    else await flushPromises();
    if (wrapper.text().includes(text)) return;
  }
  throw new Error(`missing ${text}: ${wrapper.text()}`);
}

async function answerPlacement(wrapper: ReturnType<typeof mount>, answers: Record<"knowsTreble" | "knowsBass" | "keepsPulse", boolean>, fake = false) {
  for (const [key, value] of Object.entries(answers)) {
    await wrapper.get(`[data-test=${key}-${value ? "yes" : "no"}]`).trigger("click");
  }
  await wrapper.get("[data-test=submit]").trigger("click");
  if (fake) await vi.advanceTimersByTimeAsync(0);
  else await flushPromises();
}

enableAutoUnmount(afterEach);

afterEach(async () => {
  await flushPromises();
  vi.useRealTimers();
  vi.restoreAllMocks();
  delete (navigator as { requestMIDIAccess?: unknown }).requestMIDIAccess;
});

describe("SightView", () => {
  it("hides the keyboard map and tells the player to keep looking at the staff", () => {
    const wrapper = mount(SightView, {
      props: {
        profile: { ...initialProfile(), l1RightPassed: true },
        midiConnected: true,
      },
    });
    expect(wrapper.find("[data-test=keyboard]").exists()).toBe(false);
    expect(wrapper.text()).toContain("眼睛尽量保持看谱，不要盯着键盘");
    expect(wrapper.find("[data-test=rewind]").exists()).toBe(false);
  });

  it("shows the prepare copy, fingering switch, and a 40–120 tempo slider", async () => {
    const profile = { ...initialProfile(), l1RightPassed: true };
    const wrapper = mount(SightView, {
      props: { profile, midiConnected: true },
    });
    expect(wrapper.text()).toContain("先不要动手。看看调号、拍号，左右手大概在哪一块，心里数一下节奏。");
    expect(wrapper.get("[data-test=countdown]").text()).toContain("25");
    expect(wrapper.get("[data-test=preview]").text()).toBe("听一遍");
    expect(wrapper.text()).toContain("显示指法");
    expect(wrapper.text()).toContain("隐藏指法（自测模式）");
    expect(wrapper.get("[data-test=show-fingers]").attributes("aria-pressed")).toBe("true");
    const slider = wrapper.get("input[type=range]");
    expect(slider.attributes("min")).toBe("40");
    expect(slider.attributes("max")).toBe("120");
    expect((slider.element as HTMLInputElement).value).toBe(String(testBpm(profile)));
    expect(wrapper.text()).not.toContain("暂停");
    expect(wrapper.text()).not.toContain("重弹");
    expect(wrapper.text()).not.toContain("%");
    await flushPromises();
    for (let attempt = 0; attempt < 10 && !wrapper.find(".vf-annotation").exists(); attempt += 1) {
      await flushPromises();
    }
    expect(wrapper.find(".vf-annotation").exists()).toBe(true);
    await wrapper.get("[data-test=hide-fingers]").trigger("click");
    await flushPromises();
    expect(wrapper.find(".vf-annotation").exists()).toBe(false);
  });

  it("previews the whole line when the player asks to hear it", async () => {
    const spy = vi.spyOn(audio, "previewScore").mockReturnValue({ stop() {} });
    const wrapper = mount(SightView, {
      props: {
        profile: { ...initialProfile(), l1RightPassed: true, lastSeed: 3 },
        midiConnected: true,
      },
    });
    await flushPromises();
    await wrapper.get("[data-test=preview]").trigger("click");
    expect(spy).toHaveBeenCalledTimes(1);
    const [score, hand, bpm] = spy.mock.calls[0];
    expect(score.mode).toBe("sight");
    expect(score.id).toBe("l1-RH-3");
    expect(hand).toBe("RH");
    expect(bpm).toBe(60);
  });

  it("starts the metronome after 25 seconds and does not count prepare notes", async () => {
    vi.useFakeTimers();
    const input = new FakeInput();
    installAccess([input]);
    const metronome = vi.spyOn(audio, "startMetronome");
    const profile = { ...initialProfile(), l1RightPassed: true, lastSeed: 1 };
    const score = generateL1({ hand: "RH", seed: 1, mode: "sight" });
    const notes = sounding(score, "RH");
    const wrapper = mount(SightView, {
      props: { profile, midiConnected: true },
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(wrapper.emitted("update-profile")).toBeFalsy();
    expect(metronome).not.toHaveBeenCalled();
    input.dispatchEvent(noteOn(notes[0].midi));
    await vi.advanceTimersByTimeAsync(25000);
    expect(metronome).toHaveBeenCalledTimes(1);
    expect(metronome.mock.calls[0][0]).toBe(60);
    const started = wrapper.emitted("update-profile")?.[0]?.[0] as Profile;
    expect(started.sightUses[score.id]).toBe(1);
    await vi.advanceTimersByTimeAsync(lineMs(score, "RH", 60));
    const finished = wrapper.emitted("finished")?.[0]?.[0] as { result: { pitchErrors: number } };
    expect(finished.result.pitchErrors).toBe(notes.length);
  });

  it("marks a wrong note and waits until the line's beats are over", async () => {
    vi.useFakeTimers();
    const input = new FakeInput();
    installAccess([input]);
    vi.spyOn(audio, "startMetronome").mockReturnValue({ stop() {} });
    const score = generateL1({ hand: "RH", seed: 1, mode: "sight" });
    const wrapper = mount(SightView, {
      props: {
        profile: { ...initialProfile(), l1RightPassed: true, lastSeed: 1 },
        midiConnected: true,
      },
    });
    await vi.advanceTimersByTimeAsync(25000);
    input.dispatchEvent(noteOn(1));
    expect(wrapper.find("[data-wrong]").exists()).toBe(true);
    expect(wrapper.emitted("finished")).toBeFalsy();
    expect(wrapper.find("[data-test=rewind]").exists()).toBe(false);
    expect(wrapper.text()).not.toContain("暂停");
    await vi.advanceTimersByTimeAsync(lineMs(score, "RH", 60));
    expect(wrapper.emitted("finished")).toHaveLength(1);
  });

  it("does not open a line that has already been started twice", async () => {
    const wrapper = mount(SightView, {
      props: {
        profile: {
          ...initialProfile(),
          l1RightPassed: true,
          lastSeed: 1,
          sightUses: { "l1-RH-1": 2 },
        },
        midiConnected: true,
      },
    });
    await flushPromises();
    expect(wrapper.attributes("data-score-id")).toBe("l1-RH-2");
    const next = wrapper.emitted("update-profile")?.at(-1)?.[0] as Profile;
    expect(next.lastSeed).toBe(2);
    expect(next.sightUses["l1-RH-1"]).toBe(2);
    expect(next.sightUses["l1-RH-2"]).toBeUndefined();
  });
});

describe("ReviewView", () => {
  it("shows one sentence, wrong-note marks, and a new line button", async () => {
    const score = generateL1({ hand: "RH", seed: 2, mode: "sight" });
    const wrongId = sounding(score, "RH")[0].id;
    const feedback = "这些音可以直接认了。接下来的视奏里只会用到它们。";
    const wrapper = mount(ReviewView, {
      props: { feedback, score, hand: "RH", wrongNoteIds: [wrongId] },
    });
    expect(wrapper.get("[data-test=feedback]").text()).toBe(feedback);
    expect(wrapper.get("[data-test=next-line]").text()).toBe("再看一条新的");
    expect(wrapper.find("[data-test=keyboard]").exists()).toBe(false);
    expect(wrapper.find("[data-test=rewind]").exists()).toBe(false);
    expect(wrapper.text()).not.toContain("%");
    await flushPromises();
    expect(wrapper.find("[data-wrong]").exists()).toBe(true);
    await wrapper.get("[data-test=next-line]").trigger("click");
    expect(wrapper.emitted("next")).toHaveLength(1);
  });
});

describe("App", () => {
  it("starts at placement when the profile has no assessment", async () => {
    await saveProfile(initialProfile());
    const wrapper = mount(App);
    await untilText(wrapper, "三道自评");
    expect(wrapper.find("[data-test=keyboard]").exists()).toBe(false);
  });

  it("enters the pulse lesson from three 还不会 answers and does not unlock sight", async () => {
    await saveProfile(initialProfile());
    const wrapper = mount(App);
    await untilText(wrapper, "三道自评");
    await answerPlacement(wrapper, { knowsTreble: false, knowsBass: false, keepsPulse: false });
    await untilText(wrapper, "跟着节拍器敲任何一个键");
    expect(wrapper.find("[data-test=keyboard]").exists()).toBe(true);
    expect(wrapper.text()).not.toContain("%");
    const saved = await loadProfile();
    expect(saved.lessonId).toBe("L1-1");
    expect(saved.l1RightPassed).toBe(false);
    expect(saved.l1LeftPassed).toBe(false);
    await wrapper.get("[data-test=home]").trigger("click");
    await wrapper.get("[data-test=sight]").trigger("click");
    await untilText(wrapper, "跟着节拍器敲任何一个键");
    expect(wrapper.text()).not.toContain("眼睛尽量保持看谱，不要盯着键盘");
  });

  it("opens placement from sight when the profile has no lesson yet", async () => {
    await saveProfile({
      ...initialProfile(),
      assessment: { knowsTreble: false, knowsBass: false, keepsPulse: false },
      lessonId: null,
    });
    const wrapper = mount(App);
    await untilText(wrapper, "5 分钟视奏");
    await wrapper.get("[data-test=sight]").trigger("click");
    await untilText(wrapper, "三道自评");
  });

  it("does not unlock the right hand after three pitch errors, and shows one sentence", async () => {
    await saveProfile(initialProfile());
    vi.useFakeTimers({ toFake: ["setTimeout", "setInterval", "clearTimeout", "clearInterval"] });
    vi.spyOn(audio, "startMetronome").mockReturnValue({ stop() {} });
    const input = new FakeInput();
    installAccess([input]);
    const wrapper = mount(App);
    await untilText(wrapper, "三道自评", true);
    await answerPlacement(wrapper, { knowsTreble: true, knowsBass: false, keepsPulse: true }, true);
    await untilText(wrapper, "过关测试", true);
    expect(wrapper.get("[data-test=pass-test]").attributes("data-hand")).toBe("RH");
    expect(wrapper.get("[data-test=pass-test]").attributes("data-hands")).toBe("RH");
    expect(wrapper.get("[data-test=pass-test]").attributes("data-mode")).toBe("reading-test");
    const score = generateL1({ hand: "RH", seed: 1, mode: "reading-test" });
    const notes = sounding(score, "RH");
    for (let attempt = 0; attempt < 20 && wrapper.get("[data-test=pass-test]").attributes("data-listening") !== "true"; attempt += 1) {
      await vi.advanceTimersByTimeAsync(0);
    }
    expect(wrapper.get("[data-test=pass-test]").attributes("data-listening")).toBe("true");
    notes.forEach((note, index) => {
      input.dispatchEvent(noteOn(index >= 2 && index <= 4 ? 1 : note.midi));
    });
    await vi.advanceTimersByTimeAsync(lineMs(score, "RH", 60));
    await untilText(wrapper, "还要找一下", true);
    const expected = feedbackText({
      pitchErrors: 3,
      rhythmBreaks: 0,
      firstWrongLabel: notes[2].label,
    }, 1, "RH");
    expect(wrapper.get("[data-test=feedback]").text()).toBe(expected);
    expect(wrapper.text()).not.toContain("%");
    let saved = await loadProfile();
    for (let attempt = 0; attempt < 20 && saved.failStreak !== 1; attempt += 1) {
      await vi.advanceTimersByTimeAsync(0);
      saved = await loadProfile();
    }
    expect(saved.l1RightPassed).toBe(false);
    expect(saved.l1LeftPassed).toBe(false);
    expect(saved.failStreak).toBe(1);
    expect(saved.sightUses).toEqual({});
  });

  it("unlocks the right hand when the test has only two pitch errors", async () => {
    await saveProfile(initialProfile());
    vi.useFakeTimers({ toFake: ["setTimeout", "setInterval", "clearTimeout", "clearInterval"] });
    vi.spyOn(audio, "startMetronome").mockReturnValue({ stop() {} });
    const input = new FakeInput();
    installAccess([input]);
    const wrapper = mount(App);
    await untilText(wrapper, "三道自评", true);
    await answerPlacement(wrapper, { knowsTreble: true, knowsBass: false, keepsPulse: true }, true);
    await untilText(wrapper, "过关测试", true);
    const score = generateL1({ hand: "RH", seed: 1, mode: "reading-test" });
    const notes = sounding(score, "RH");
    for (let attempt = 0; attempt < 20 && wrapper.get("[data-test=pass-test]").attributes("data-listening") !== "true"; attempt += 1) {
      await vi.advanceTimersByTimeAsync(0);
    }
    notes.forEach((note, index) => {
      input.dispatchEvent(noteOn(index < 2 ? 1 : note.midi));
    });
    await vi.advanceTimersByTimeAsync(lineMs(score, "RH", 60));
    await untilText(wrapper, "这些音可以直接认了", true);
    expect(wrapper.get("[data-test=feedback]").text()).toBe("这些音可以直接认了。接下来的视奏里只会用到它们。");
    expect(wrapper.text()).not.toContain("%");
    let saved = await loadProfile();
    for (let attempt = 0; attempt < 20 && !saved.l1RightPassed; attempt += 1) {
      await vi.advanceTimersByTimeAsync(0);
      saved = await loadProfile();
    }
    expect(saved.l1RightPassed).toBe(true);
    expect(saved.l1LeftPassed).toBe(false);
    expect(saved.lessonId).toBe("L1-4");
  });

  it("tests both hands when the questionnaire routes there", async () => {
    await saveProfile(initialProfile());
    const wrapper = mount(App);
    await untilText(wrapper, "三道自评");
    await answerPlacement(wrapper, { knowsTreble: true, knowsBass: true, keepsPulse: true });
    await untilText(wrapper, "过关测试");
    const test = wrapper.get("[data-test=pass-test]");
    expect(test.attributes("data-hands")).toBe("RH,LH");
    expect(test.attributes("data-hand")).toBe("RH");
    expect(test.attributes("data-mode")).toBe("reading-test");
    const saved = await loadProfile();
    expect(saved.l1RightPassed).toBe(false);
    expect(saved.l1LeftPassed).toBe(false);
    expect(wrapper.text()).not.toContain("%");
  });

  it("tests only the left hand when L1-4 ends and the right hand has passed", async () => {
    const input = new FakeInput();
    installAccess([input]);
    await saveProfile({
      ...initialProfile(),
      assessment: { knowsTreble: true, knowsBass: true, keepsPulse: true },
      lessonId: "L1-4",
      lessonPhase: "lines",
      linesCompleted: 1,
      l1RightPassed: true,
      lastSeed: 4,
    });
    const wrapper = mount(App);
    await untilText(wrapper, "5 分钟视奏");
    await wrapper.get("[data-test=reading]").trigger("click");
    await untilText(wrapper, "弹出谱上的音");
    for (let attempt = 0; attempt < 20 && wrapper.text().includes("请连接 MIDI 键盘"); attempt += 1) {
      await flushPromises();
    }
    await flushPromises();
    await flushPromises();
    const score = generateL1({ hand: "LH", seed: 4, mode: "reading-lesson" });
    for (const note of sounding(score, "LH")) input.dispatchEvent(noteOn(note.midi));
    await untilText(wrapper, "过关测试");
    const test = wrapper.get("[data-test=pass-test]");
    expect(test.attributes("data-hand")).toBe("LH");
    expect(test.attributes("data-hands")).toBe("LH");
    expect(test.attributes("data-mode")).toBe("reading-test");
    expect(test.attributes("data-score-id")).toContain("l1-LH-");
  });

  it("stores a missed sight line and the next button opens a different line", async () => {
    await saveProfile({
      ...initialProfile(),
      assessment: { knowsTreble: true, knowsBass: false, keepsPulse: true },
      lessonId: "L1-4",
      l1RightPassed: true,
      lastSeed: 1,
    });
    vi.useFakeTimers({ toFake: ["setTimeout", "setInterval", "clearTimeout", "clearInterval"] });
    vi.spyOn(audio, "startMetronome").mockReturnValue({ stop() {} });
    const input = new FakeInput();
    installAccess([input]);
    const wrapper = mount(App);
    await untilText(wrapper, "5 分钟视奏", true);
    await wrapper.get("[data-test=sight]").trigger("click");
    await untilText(wrapper, "先不要动手", true);
    for (let attempt = 0; attempt < 20 && wrapper.get("[data-score-id]").attributes("data-preparing") !== "true"; attempt += 1) {
      await vi.advanceTimersByTimeAsync(0);
    }
    expect(wrapper.get("[data-score-id]").attributes("data-preparing")).toBe("true");
    const playedId = wrapper.get("[data-score-id]").attributes("data-score-id");
    const score = generateL1({ hand: "RH", seed: 1, mode: "sight" });
    await vi.advanceTimersByTimeAsync(25000 + lineMs(score, "RH", 60));
    await untilText(wrapper, "再看一条新的", true);
    expect(wrapper.find("[data-test=keyboard]").exists()).toBe(false);
    expect(wrapper.find("[data-test=rewind]").exists()).toBe(false);
    expect(wrapper.text()).not.toContain("%");
    expect(wrapper.text()).not.toContain("识谱");
    let saved = await loadProfile();
    for (let attempt = 0; attempt < 20 && saved.errorSnippets.length === 0; attempt += 1) {
      await vi.advanceTimersByTimeAsync(0);
      saved = await loadProfile();
    }
    expect(saved.errorSnippets.map((item) => item.id)).toEqual([playedId]);
    expect(saved.lessonId).toBe("L1-4");
    expect(saved.l1RightPassed).toBe(true);
    await wrapper.get("[data-test=next-line]").trigger("click");
    await untilText(wrapper, "先不要动手", true);
    expect(wrapper.get("[data-score-id]").attributes("data-score-id")).not.toBe(playedId);
  });

  it("keeps an unlock after the view is created again", async () => {
    await saveProfile({
      ...initialProfile(),
      assessment: { knowsTreble: true, knowsBass: false, keepsPulse: true },
      lessonId: "L1-4",
      l1RightPassed: true,
    });
    const first = mount(App);
    await untilText(first, "5 分钟视奏");
    first.unmount();
    const second = mount(App);
    await untilText(second, "5 分钟视奏");
    await second.get("[data-test=sight]").trigger("click");
    await untilText(second, "眼睛尽量保持看谱，不要盯着键盘");
    expect(second.find("[data-test=keyboard]").exists()).toBe(false);
  });
});
