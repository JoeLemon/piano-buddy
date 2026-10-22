import { mount, flushPromises } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as audio from "../src/audio/preview";
import { generateL1 } from "../src/domain/generate";
import { pitchLabel, pitchToMidi } from "../src/domain/pitch";
import { initialProfile, type Profile } from "../src/domain/profile";
import type { Hand, Score } from "../src/domain/types";
import { DEFAULT_ZONE, codeForMidi, setActiveZone, setKeyboardMode } from "../src/midi/keyboard";
import SightView from "../src/ui/SightView.vue";

function keyEvent(type: "keydown" | "keyup", code: string, init: KeyboardEventInit = {}) {
  return new KeyboardEvent(type, { code, bubbles: true, ...init });
}

/** 取某个音在当前音区对应的电脑键。视奏页会把音区跟着谱面走，这里同步一下。 */
function codeFor(midi: number): string {
  const code = codeForMidi(midi);
  if (code) return code;
  for (let zone = 1; zone <= 7; zone += 1) {
    setActiveZone(zone);
    const found = codeForMidi(midi);
    if (found) return found;
  }
  throw new Error(`没有能弹 ${midi} 的电脑键`);
}

function sounding(score: Score, hand: Hand): { id: string; midi: number; label: string }[] {
  const notes: { id: string; midi: number; label: string }[] = [];
  for (const measure of score.staves[hand]?.measures ?? []) {
    for (const note of measure.notes) {
      if (note.duration.endsWith("r") || note.pitches.length === 0) continue;
      notes.push({ id: note.id, midi: pitchToMidi(note.pitches[0]), label: pitchLabel(note.pitches[0]) });
    }
  }
  return notes;
}

function sightProfile(): Profile {
  return { ...initialProfile(), seenSightTips: true, l1RightPassed: true, lastSeed: 1 };
}

afterEach(() => {
  setKeyboardMode(false);
  setActiveZone(DEFAULT_ZONE);
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("SightView with simulated keyboard", () => {
  it("plays notes through the computer keyboard and paints them as correct", async () => {
    vi.useFakeTimers();
    vi.spyOn(audio, "startMetronome").mockReturnValue({ stop() {} });
    setKeyboardMode(true);
    const wrapper = mount(SightView, {
      props: { profile: sightProfile(), midiConnected: true },
    });
    expect(wrapper.find("[data-test=countdown]").exists()).toBe(true);

    await vi.advanceTimersByTimeAsync(25000);
    await flushPromises();

    const score = generateL1({ hand: "RH", seed: 1, mode: "sight" });
    const first = sounding(score, "RH")[0];
    const code = codeFor(first.midi);
    expect(code).toBeTruthy();

    window.dispatchEvent(keyEvent("keydown", code!));
    await flushPromises();

    expect(wrapper.find("[data-correct]").exists()).toBe(true);
    expect(wrapper.get("[data-test=score-progress]").attributes("aria-valuenow")).not.toBe("0");
    wrapper.unmount();
  });

  it("marks a wrong computer-keyboard note and finishes the line after its beats", async () => {
    vi.useFakeTimers();
    vi.spyOn(audio, "startMetronome").mockReturnValue({ stop() {} });
    setKeyboardMode(true);
    const wrapper = mount(SightView, {
      props: { profile: sightProfile(), midiConnected: true },
    });
    await vi.advanceTimersByTimeAsync(25000);
    await flushPromises();

    const score = generateL1({ hand: "RH", seed: 1, mode: "sight" });
    const first = sounding(score, "RH")[0];
    const wrongCode = codeFor(first.midi === 60 ? 61 : 60);
    window.dispatchEvent(keyEvent("keydown", wrongCode!));
    await flushPromises();
    expect(wrapper.find("[data-wrong]").exists()).toBe(true);
    wrapper.unmount();
  });
});
