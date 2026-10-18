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
}

function noteOn(midi: number) {
  const event = new Event("midimessage");
  Object.assign(event, { data: Uint8Array.from([0x90, midi, 100]) });
  return event;
}

function lineMs(score: Score, hand: Hand | "BOTH", bpm: number): number {
  const hands: readonly Hand[] = hand === "BOTH" ? ["RH", "LH"] : [hand];
  const beats = Math.max(
    ...hands.map((next) =>
      (score.staves[next]?.measures ?? []).reduce(
        (sum, measure) => sum + measure.notes.reduce((inner, note) => inner + DURATION_BEATS[note.duration], 0),
        0,
      ),
    ),
  );
  return Math.round(beats * (60000 / bpm));
}

async function untilText(wrapper: { text: () => string }, text: string, fake = false) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (fake) await vi.advanceTimersByTimeAsync(0);
    else await flushPromises();
    if (wrapper.text().includes(text)) return;
  }
  throw new Error(`missing ${text}: ${wrapper.text()}`);
}

function l2SightProfile(partial: Partial<Profile> = {}): Profile {
  return {
    ...initialProfile(),
    assessment: { knowsTreble: true, knowsBass: true, keepsPulse: true },
    lessonId: "L2-test",
    l1RightPassed: true,
    l1LeftPassed: true,
    l2Passed: true,
    seenReadingTips: true,
    seenSightTips: true,
    lastSeed: 3,
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

describe("L2 two-hand sight reading", () => {
  it("opens a two-hand grand staff with no hand chooser once L2 is passed", async () => {
    const profile = l2SightProfile();
    const wrapper = mount(SightView, {
      props: { profile, midiConnected: true },
    });
    await flushPromises();

    expect(wrapper.get("[data-test=sight-hand]").text()).toBe("双手");
    expect(wrapper.find("[data-test=hand-rh]").exists()).toBe(false);
    expect(wrapper.find("[data-test=keyboard]").exists()).toBe(false);
    const staff = wrapper.get(".staff").element;
    expect(staff.querySelectorAll(".vf-clef").length).toBeGreaterThanOrEqual(2);
    expect(staff.querySelectorAll(".vf-stave").length).toBe(8);
    expect(wrapper.get("[data-score-id]").attributes("data-score-id")).toBe("l2-sight-3");
    expect(wrapper.get("[data-test=score-progress-label]").text()).toBe("第 1/4 小节");
    const slider = wrapper.get("input[type=range]");
    expect((slider.element as HTMLInputElement).value).toBe(String(testBpmForLevel(profile, 2)));
    expect(wrapper.text()).not.toContain("%");
    expect(wrapper.find("[data-test=rewind]").exists()).toBe(false);
  });

  it("still gives a single-hand L1 line when only L1 is unlocked", async () => {
    const wrapper = mount(SightView, {
      props: {
        profile: l2SightProfile({ l2Passed: false, lessonId: "L2-2" }),
        midiConnected: true,
      },
    });
    await flushPromises();

    expect(wrapper.find("[data-test=hand-rh]").exists()).toBe(true);
    expect(wrapper.get("[data-score-id]").attributes("data-score-id")).toBe("l1-RH-3");
  });

  it("previews both hands of the L2 line in one pass", async () => {
    const spy = vi.spyOn(audio, "previewScore").mockReturnValue({ stop() {} });
    const wrapper = mount(SightView, {
      props: { profile: l2SightProfile(), midiConnected: true },
    });
    await flushPromises();
    await wrapper.get("[data-test=preview]").trigger("click");

    expect(spy).toHaveBeenCalledTimes(1);
    const [score, hand, bpm] = spy.mock.calls[0];
    expect(score.mode).toBe("sight");
    expect(score.id).toBe("l2-sight-3");
    expect(hand).toBe("BOTH");
    expect(bpm).toBe(60);
  });

  it("keeps counting both hands while a wrong note does not stop the line", async () => {
    vi.useFakeTimers();
    const input = new FakeInput();
    installAccess([input]);
    vi.spyOn(audio, "startMetronome").mockReturnValue({ stop() {} });
    const profile = l2SightProfile();
    const score = generateL2({ seed: 3, mode: "sight", shape: { kind: "sight" } });
    const notes = flattenScore(score);
    expect(notes.length).toBeGreaterThan(8);

    const wrapper = mount(SightView, {
      props: { profile, midiConnected: true },
    });
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(25000);

    input.dispatchEvent(noteOn(1));
    expect(wrapper.find("[data-wrong]").exists()).toBe(true);
    expect(wrapper.emitted("finished")).toBeFalsy();
    for (const note of notes.slice(1)) input.dispatchEvent(noteOn(note.midi));
    await vi.advanceTimersByTimeAsync(lineMs(score, "BOTH", 60));

    const finished = wrapper.emitted("finished")?.[0]?.[0] as {
      hand: string;
      result: { pitchErrors: number; wrongPitchNoteIds: string[] };
    };
    expect(finished.hand).toBe("BOTH");
    expect(finished.result.pitchErrors).toBe(1);
    expect(finished.result.wrongPitchNoteIds).toEqual([notes[0].id]);
  });

  it("shows the L2 line in the review and stores it in the error book", async () => {
    await saveProfile(l2SightProfile());
    vi.useFakeTimers({ toFake: ["setTimeout", "setInterval", "clearTimeout", "clearInterval"] });
    vi.spyOn(audio, "startMetronome").mockReturnValue({ stop() {} });
    const input = new FakeInput();
    installAccess([input]);
    const wrapper = mount(App);
    await untilText(wrapper, "5 分钟视奏", true);
    await wrapper.get("[data-test=sight]").trigger("click");
    await untilText(wrapper, "先不要动手", true);
    for (let attempt = 0; attempt < 30 && wrapper.get("[data-score-id]").attributes("data-preparing") !== "true"; attempt += 1) {
      await vi.advanceTimersByTimeAsync(0);
    }
    expect(wrapper.get("[data-score-id]").attributes("data-preparing")).toBe("true");
    expect(wrapper.get("[data-score-id]").attributes("data-score-id")).toBe("l2-sight-3");

    const score = generateL2({ seed: 3, mode: "sight", shape: { kind: "sight" } });
    const notes = flattenScore(score);
    await vi.advanceTimersByTimeAsync(25000);
    input.dispatchEvent(noteOn(1));
    for (const note of notes.slice(1)) input.dispatchEvent(noteOn(note.midi));
    await vi.advanceTimersByTimeAsync(lineMs(score, "BOTH", 60));
    await untilText(wrapper, "复盘", true);

    const reviewStaff = wrapper.get("[data-test=review-staff]").element;
    expect(reviewStaff.querySelectorAll(".vf-clef").length).toBeGreaterThanOrEqual(2);
    expect(reviewStaff.querySelector("[data-wrong]")).not.toBeNull();
    const summary = wrapper.get("[data-test=review-summary]").text();
    expect(summary).toContain("共 4 小节");
    expect(summary).toContain("错音 1 处");
    expect(summary).not.toContain("%");
    expect(wrapper.find("[data-test=keyboard]").exists()).toBe(false);

    let saved = await loadProfile();
    for (let attempt = 0; attempt < 30 && saved.errorSnippets.length === 0; attempt += 1) {
      await vi.advanceTimersByTimeAsync(0);
      saved = await loadProfile();
    }
    expect(saved.errorSnippets.map((item) => item.id)).toEqual([score.id]);

    await wrapper.get("[data-test=retry-error]").trigger("click");
    await untilText(wrapper, "先不要动手", true);
    expect(wrapper.get("[data-score-id]").attributes("data-score-id")).toBe(score.id);
    expect(wrapper.get("[data-test=sight-hand]").text()).toBe("双手");
  });
});
