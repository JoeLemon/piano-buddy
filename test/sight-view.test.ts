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
import { measureForSounding } from "../src/notation/scorePaint";
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

function noteOff(midi: number) {
  const event = new Event("midimessage");
  Object.assign(event, { data: Uint8Array.from([0x80, midi, 0]) });
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

/** 某个音的时值（拍）；找不到按一拍算。 */
function noteBeats(score: Score, id: string): number {
  for (const measure of score.staves.RH?.measures ?? []) {
    for (const note of measure.notes) {
      if (note.id === id) return DURATION_BEATS[note.duration];
    }
  }
  return 1;
}

/** 最小可用的 AudioContext：只让 audioAvailable()/previewScore 跑起来。 */
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

function sightProfile(partial: Partial<Profile> = {}): Profile {
  return { ...initialProfile(), seenSightTips: true, l1RightPassed: true, ...partial };
}

describe("SightView", () => {
  it("hides the keyboard map and tells the player to keep looking at the staff", () => {
    const wrapper = mount(SightView, {
      props: {
        profile: sightProfile(),
        midiConnected: true,
      },
    });
    expect(wrapper.find("[data-test=keyboard]").exists()).toBe(false);
    expect(wrapper.text()).toContain("眼睛尽量保持看谱，不要盯着键盘");
    expect(wrapper.find("[data-test=rewind]").exists()).toBe(false);
  });

  it("does not start the prepare countdown without MIDI", () => {
    const wrapper = mount(SightView, {
      props: {
        profile: sightProfile(),
        midiConnected: false,
      },
    });
    expect(wrapper.find("[data-test=countdown]").exists()).toBe(false);
    expect(wrapper.text()).toContain("连接后才会开始准备");
  });

  it("shows the prepare copy, fingering switch, and a 40–120 tempo slider", async () => {
    const profile = sightProfile();
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
        profile: sightProfile({ lastSeed: 3 }),
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
    const profile = sightProfile({ lastSeed: 1 });
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
        profile: sightProfile({ lastSeed: 1 }),
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

  it("records how long each note was held and reports too-short holds", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "setInterval", "clearTimeout", "clearInterval"] });
    const input = new FakeInput();
    installAccess([input]);
    vi.spyOn(audio, "startMetronome").mockReturnValue({ stop() {} });
    const profile = sightProfile({ lastSeed: 1 });
    const score = generateL1({ hand: "RH", seed: 1, mode: "sight" });
    const notes = sounding(score, "RH");
    // 时钟自己拨：抬手早晚就是判定依据，不能依赖真实时间。
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => now);

    const wrapper = mount(SightView, { props: { profile, midiConnected: true } });
    await vi.advanceTimersByTimeAsync(25000);
    for (const note of notes) {
      input.dispatchEvent(noteOn(note.midi));
      now += 100; // 每个音只按 100ms（0.1 拍）就抬，远低于六成
      input.dispatchEvent(noteOff(note.midi));
    }
    await vi.advanceTimersByTimeAsync(lineMs(score, "RH", 60));

    const finished = wrapper.emitted("finished")?.[0]?.[0] as {
      result: { pitchErrors: number; shortNoteIds: string[] };
    };
    expect(finished.result.pitchErrors).toBe(0);
    expect(finished.result.shortNoteIds).toHaveLength(notes.length);
  });

  it("says nothing about length when every note is held long enough", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "setInterval", "clearTimeout", "clearInterval"] });
    const input = new FakeInput();
    installAccess([input]);
    vi.spyOn(audio, "startMetronome").mockReturnValue({ stop() {} });
    const profile = sightProfile({ lastSeed: 1 });
    const score = generateL1({ hand: "RH", seed: 1, mode: "sight" });
    const notes = sounding(score, "RH");
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => now);

    const wrapper = mount(SightView, { props: { profile, midiConnected: true } });
    await vi.advanceTimersByTimeAsync(25000);
    for (const note of notes) {
      input.dispatchEvent(noteOn(note.midi));
      now += Math.round(noteBeats(score, note.id) * 1000 * 0.9); // 各自时值的九成
      input.dispatchEvent(noteOff(note.midi));
    }
    await vi.advanceTimersByTimeAsync(lineMs(score, "RH", 60));

    const finished = wrapper.emitted("finished")?.[0]?.[0] as {
      result: { pitchErrors: number; shortNoteIds: string[] };
    };
    expect(finished.result.pitchErrors).toBe(0);
    expect(finished.result.shortNoteIds).toEqual([]);
  });

  it("shows the countdown bar, measure ticks, and how many tries are left", async () => {
    const profile = sightProfile({ lastSeed: 3, sightUses: { "l1-RH-3": 1 } });
    const wrapper = mount(SightView, { props: { profile, midiConnected: true } });
    await flushPromises();
    expect(wrapper.get("[data-score-id]").attributes("data-score-id")).toBe("l1-RH-3");
    expect(wrapper.get("[data-test=sight-remaining]").text()).toBe("这条还能练 1 遍");
    expect(wrapper.find("[data-test=prepare-progress]").exists()).toBe(true);
    expect(wrapper.findAll("[data-test=score-progress] .tick")).toHaveLength(3);
    const score = generateL1({ hand: "RH", seed: 3, mode: "sight" });
    const label = wrapper.get("[data-test=score-progress-label]").text();
    expect(label).toBe(
      `第 ${measureForSounding(score, "RH", 0).current}/${score.staves.RH!.measures.length} 小节`,
    );
    expect(wrapper.get("[data-test=score-progress]").attributes("aria-valuenow")).toBe("0");
  });

  it("follows the playback cursor with the progress bar and the active note", async () => {
    vi.useFakeTimers();
    installPlainAudioContext();
    const wrapper = mount(SightView, {
      props: { profile: sightProfile({ lastSeed: 1 }), midiConnected: true },
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(wrapper.get("[data-test=score-progress]").attributes("aria-valuenow")).toBe("0");
    await wrapper.get("[data-test=preview]").trigger("click");
    // 一开始就把游标停在第一个音上
    expect(wrapper.find("[data-active]").exists()).toBe(true);
    await vi.advanceTimersByTimeAsync(60);
    expect(wrapper.get("[data-test=score-progress]").attributes("aria-valuenow")).not.toBe("0");
    // 播完后收回跟随，进度回到起点
    await vi.advanceTimersByTimeAsync(22000);
    expect(wrapper.find("[data-active]").exists()).toBe(false);
    expect(wrapper.get("[data-test=score-progress]").attributes("aria-valuenow")).toBe("0");
  });

  it("does not open a line that has already been started twice", async () => {
    const wrapper = mount(SightView, {
      props: {
        profile: sightProfile({
          lastSeed: 1,
          sightUses: { "l1-RH-1": 2 },
        }),
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
    const feedback = "完成啦！这条读下来了。可以再看一条新的，或者回首页歇一下。";
    const wrapper = mount(ReviewView, {
      props: {
        feedback,
        score,
        hand: "RH",
        wrongPitchNoteIds: [wrongId],
        lateNoteIds: [],
        hasErrorBook: false,
      },
    });
    expect(wrapper.get("[data-test=feedback]").text()).toBe(feedback);
    expect(wrapper.get("[data-test=next-line]").text()).toBe("再看一条新的");
    expect(wrapper.find("[data-test=keyboard]").exists()).toBe(false);
    expect(wrapper.find("[data-test=rewind]").exists()).toBe(false);
    expect(wrapper.text()).not.toContain("%");
    // 没有按得太短的音时，这一行不出现
    expect(wrapper.find("[data-test=review-length]").exists()).toBe(false);
    await flushPromises();
    expect(wrapper.find("[data-wrong]").exists()).toBe(true);
    await wrapper.get("[data-test=next-line]").trigger("click");
    expect(wrapper.emitted("next")).toHaveLength(1);
  });

  it("points out too-short holds without counting them as errors", () => {
    const score = generateL1({ hand: "RH", seed: 2, mode: "sight" });
    const wrapper = mount(ReviewView, {
      props: {
        feedback: "完成啦！这条读下来了。可以再看一条新的，或者回首页歇一下。",
        score,
        hand: "RH",
        wrongPitchNoteIds: [],
        lateNoteIds: [],
        shortNoteIds: ["1-0", "1-2"],
        hasErrorBook: false,
      },
    });
    expect(wrapper.get("[data-test=review-length]").text()).toBe("2 个音按得太短，长音符要按住不放。");
    // 只观察：统计行里不多一项，图例也不多一种颜色
    const summary = wrapper.get("[data-test=review-summary]").text();
    expect(summary).not.toContain("按得太短");
    expect(wrapper.findAll(".legend .swatch")).toHaveLength(2);
  });

  it("summarizes the measure count and the error counts", () => {
    const score = generateL1({ hand: "RH", seed: 2, mode: "sight" });
    const wrongId = sounding(score, "RH")[0].id;
    const wrapper = mount(ReviewView, {
      props: {
        feedback: "完成啦！",
        score,
        hand: "RH",
        wrongPitchNoteIds: [wrongId],
        lateNoteIds: ["n1", "n2"],
        hasErrorBook: false,
      },
    });
    const summary = wrapper.get("[data-test=review-summary]").text();
    expect(summary).toContain(`共 ${score.staves.RH!.measures.length} 小节`);
    expect(summary).toContain("错音 1 处");
    expect(summary).toContain("节奏偏差 2 处");
    expect(summary).not.toContain("%");
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

  it("returns to the section a lesson was entered from", async () => {
    await saveProfile({
      ...initialProfile(),
      assessment: { knowsTreble: true, knowsBass: true, keepsPulse: true },
      lessonId: "L1-1",
    });
    const wrapper = mount(App);
    await untilText(wrapper, "5 分钟视奏");

    // 从「学习」进入识谱课，返回应落在学习页，而不是被丢回今日。
    await wrapper.get("[data-section=learn]").trigger("click");
    await untilText(wrapper, "识谱主线");
    await wrapper.get("[data-test=learn-reading]").trigger("click");
    await untilText(wrapper, "跟着节拍器敲任何一个键");
    await wrapper.get("[data-test=home]").trigger("click");
    await untilText(wrapper, "识谱主线");
    expect(wrapper.get("[data-section=learn]").attributes("aria-current")).toBe("page");
  });

  it("returns to the section when a pass test was started from there", async () => {
    await saveProfile({
      ...initialProfile(),
      assessment: { knowsTreble: true, knowsBass: true, keepsPulse: true },
      lessonId: "L1-test",
    });
    const wrapper = mount(App);
    await untilText(wrapper, "5 分钟视奏");

    // 课位停在过关节点时，点「识谱主线」会直接进过关测试；返回仍应回到学习页。
    await wrapper.get("[data-section=learn]").trigger("click");
    await untilText(wrapper, "识谱主线");
    await wrapper.get("[data-test=learn-reading]").trigger("click");
    await untilText(wrapper, "过关测试");
    await wrapper.get("[data-test=home]").trigger("click");
    await untilText(wrapper, "识谱主线");
    expect(wrapper.get("[data-section=learn]").attributes("aria-current")).toBe("page");
  });

  it("returns to practice when sight reading was opened from there", async () => {
    await saveProfile({
      ...initialProfile(),
      assessment: { knowsTreble: true, knowsBass: true, keepsPulse: true },
      lessonId: "L1-1",
      l1RightPassed: true,
    });
    const wrapper = mount(App);
    await untilText(wrapper, "5 分钟视奏");

    await wrapper.get("[data-section=practice]").trigger("click");
    await untilText(wrapper, "专项题组");
    await wrapper.get("[data-test=practice-sight]").trigger("click");
    await untilText(wrapper, "请连接 MIDI 键盘");
    await wrapper.get("[data-test=home]").trigger("click");
    await untilText(wrapper, "专项题组");
    expect(wrapper.get("[data-section=practice]").attributes("aria-current")).toBe("page");
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
      wrongPitchNoteIds: [],
      lateNoteIds: [], shortNoteIds: [],
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
      seenReadingTips: true,
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
      seenSightTips: true,
      seenReadingTips: true,
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
    expect(wrapper.find("[data-test=lesson-progress]").exists()).toBe(false);
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

  it("enters the L2 lessons when both hands have passed and 先认谱 is clicked", async () => {
    await saveProfile({
      ...initialProfile(),
      assessment: { knowsTreble: true, knowsBass: true, keepsPulse: true },
      lessonId: "L1-test",
      l1RightPassed: true,
      l1LeftPassed: true,
      seenReadingTips: true,
    });
    const wrapper = mount(App);
    await untilText(wrapper, "5 分钟视奏");
    await wrapper.get("[data-test=reading]").trigger("click");
    await untilText(wrapper, "八分音符");
    expect(wrapper.get("[data-active=true]").text()).toBe("八分音符");
    expect(wrapper.find("[data-test=keyboard]").exists()).toBe(true);
    const saved = await loadProfile();
    expect(saved.lessonId).toBe("L2-1");
  });

  it("keeps an unlock after the view is created again", async () => {
    await saveProfile({
      ...initialProfile(),
      assessment: { knowsTreble: true, knowsBass: false, keepsPulse: true },
      lessonId: "L1-4",
      l1RightPassed: true,
      seenSightTips: true,
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
