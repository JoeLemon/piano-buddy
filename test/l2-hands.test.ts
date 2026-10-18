import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import { generateL2 } from "../src/domain/generateL2";
import { pitchToMidi } from "../src/domain/pitch";
import { initialProfile, type Profile } from "../src/domain/profile";
import { flattenScore } from "../src/domain/timeline";
import type { Hand, Score } from "../src/domain/types";
import L2ReadingView from "../src/ui/L2ReadingView.vue";

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

function soundingMidis(score: Score, hand: Hand): number[] {
  const midis: number[] = [];
  for (const measure of score.staves[hand]?.measures ?? []) {
    for (const event of measure.notes) {
      const pitch = event.pitches[0];
      if (!pitch || event.duration.endsWith("r")) continue;
      midis.push(pitchToMidi(pitch));
    }
  }
  return midis;
}

function togetherTexture(seed: number): "same" | "hold" {
  return seed % 2 === 0 ? "same" : "hold";
}

function l2Profile(partial: Partial<Profile> = {}): Profile {
  return {
    ...initialProfile(),
    lessonId: "L2-2",
    seenReadingTips: true,
    lastSeed: 1,
    ...partial,
  };
}

function play(input: FakeInput, midis: number[]) {
  for (const midi of midis) input.dispatchEvent(noteOn(midi));
}

enableAutoUnmount(afterEach);

afterEach(() => {
  delete (navigator as { requestMIDIAccess?: unknown }).requestMIDIAccess;
});

describe("L2-2 alternating hands", () => {
  it("shows the alternating card on a grand staff and does not advance without MIDI", async () => {
    const wrapper = mount(L2ReadingView, {
      props: {
        profile: l2Profile(),
        midiConnected: false,
      },
    });
    await flushPromises();

    expect(wrapper.text()).toContain("请连接 MIDI 键盘");
    expect(wrapper.text()).toContain("右手一小节，左手一小节，不同时弹。");
    expect(wrapper.text()).not.toContain("一拍里有两个八分音");
    expect(wrapper.get("[data-active=true]").text()).toBe("双手交替");
    expect(wrapper.get("[data-test=lesson-goal]").text()).toBe("短句 0/2");
    expect(wrapper.get(".staff").element.querySelectorAll(".vf-clef").length).toBeGreaterThanOrEqual(2);
    expect(wrapper.get(".staff").element.querySelectorAll(".vf-stave").length).toBe(8);
    expect(wrapper.emitted("update-profile")).toBeFalsy();
  });

  it("stops on a wrong pitch and advances to L2-3 after two alternating lines in flatten order", async () => {
    const input = new FakeInput();
    installAccess([input]);
    const wrapper = mount(L2ReadingView, {
      props: {
        profile: l2Profile({ lastSeed: 1 }),
        midiConnected: true,
      },
    });
    await flushPromises();

    const first = generateL2({ seed: 1, mode: "reading-lesson", shape: { kind: "alternate" } });
    const firstNotes = flattenScore(first);
    const firstFlat = firstNotes.map((note) => note.midi);
    const firstConcat = [...soundingMidis(first, "RH"), ...soundingMidis(first, "LH")];
    expect(firstFlat.join(",")).not.toBe(firstConcat.join(","));

    input.dispatchEvent(noteOn(1));
    await flushPromises();
    expect(wrapper.emitted("update-profile")).toBeFalsy();
    expect(wrapper.get(".hint").text().length).toBeGreaterThan(0);
    expect(wrapper.get("[data-test=lesson-goal]").text()).toBe("短句 0/2");

    play(input, firstFlat);
    await flushPromises();
    const afterFirst = wrapper.emitted("update-profile")?.at(-1)?.[0] as Profile;
    expect(afterFirst.lessonId).toBe("L2-2");
    expect(afterFirst.linesCompleted).toBe(1);
    expect(afterFirst.lastSeed).toBe(2);

    const second = generateL2({ seed: 2, mode: "reading-lesson", shape: { kind: "alternate" } });
    play(input, flattenScore(second).map((note) => note.midi));
    await flushPromises();
    const afterSecond = wrapper.emitted("update-profile")?.at(-1)?.[0] as Profile;
    expect(afterSecond.lessonId).toBe("L2-3");
    expect(afterSecond.lessonPhase).toBe("notes");
    expect(afterSecond.linesCompleted).toBe(0);
    expect(afterSecond.findCorrect).toBe(0);
    expect(afterSecond.tapStreak).toBe(0);
    expect(afterSecond.lastSeed).toBe(3);
    expect(wrapper.get("[data-test=advance-banner]").text()).toBe("双手交替过了。接下来练双手同拍。");
    expect(wrapper.get("[data-active=true]").text()).toBe("双手同拍");
    expect(wrapper.get("[data-test=lesson-goal]").text()).toBe("短句 0/2");
  });
});

describe("L2-3 hands together", () => {
  it("uses a grand staff and alternates same and hold textures by seed", async () => {
    const input = new FakeInput();
    installAccess([input]);
    const wrapper = mount(L2ReadingView, {
      props: {
        profile: l2Profile({ lessonId: "L2-3", lastSeed: 1 }),
        midiConnected: true,
      },
    });
    await flushPromises();

    expect(wrapper.text()).toContain("两手节奏相同，或一只手拉长音、另一只手弹四分或八分。");
    expect(wrapper.get("[data-active=true]").text()).toBe("双手同拍");
    expect(wrapper.get(".staff").element.querySelectorAll(".vf-clef").length).toBeGreaterThanOrEqual(2);
    expect(wrapper.get(".staff").element.querySelectorAll(".vf-stave").length).toBe(8);

    const hold = generateL2({
      seed: 1,
      mode: "reading-lesson",
      shape: { kind: "together", texture: togetherTexture(1) },
    });
    const holdNotes = flattenScore(hold);
    const sameBeat = holdNotes.find((note, index) => {
      const next = holdNotes[index + 1];
      return next && note.beat === next.beat && note.midi !== next.midi && note.hand === "RH" && next.hand === "LH";
    });
    expect(sameBeat).toBeTruthy();

    input.dispatchEvent(noteOn(1));
    await flushPromises();
    expect(wrapper.emitted("update-profile")).toBeFalsy();
    expect(wrapper.get(".hint").text().length).toBeGreaterThan(0);

    play(input, holdNotes.map((note) => note.midi));
    await flushPromises();
    const afterHold = wrapper.emitted("update-profile")?.at(-1)?.[0] as Profile;
    expect(afterHold.lessonId).toBe("L2-3");
    expect(afterHold.linesCompleted).toBe(1);
    expect(afterHold.lastSeed).toBe(2);

    const same = generateL2({
      seed: 2,
      mode: "reading-lesson",
      shape: { kind: "together", texture: togetherTexture(2) },
    });
    play(input, flattenScore(same).map((note) => note.midi));
    await flushPromises();
    const afterSame = wrapper.emitted("update-profile")?.at(-1)?.[0] as Profile;
    expect(afterSame.lessonId).toBe("L2-4");
    expect(afterSame.lessonPhase).toBe("notes");
    expect(afterSame.linesCompleted).toBe(0);
    expect(afterSame.lastSeed).toBe(3);
    expect(wrapper.get("[data-test=advance-banner]").text()).toBe("双手同拍过了。接下来练 F 五指。");
    expect(wrapper.get("[data-active=true]").text()).toBe("F 五指");
    expect(wrapper.get("[data-test=lesson-goal]").text()).toBe("找键 0/16");
  });

  it("picks the together texture from an even seed on the first line", async () => {
    const input = new FakeInput();
    installAccess([input]);
    const wrapper = mount(L2ReadingView, {
      props: {
        profile: l2Profile({ lessonId: "L2-3", lastSeed: 4, linesCompleted: 0 }),
        midiConnected: true,
      },
    });
    await flushPromises();

    const same = generateL2({
      seed: 4,
      mode: "reading-lesson",
      shape: { kind: "together", texture: "same" },
    });
    play(input, flattenScore(same).map((note) => note.midi));
    await flushPromises();
    const after = wrapper.emitted("update-profile")?.at(-1)?.[0] as Profile;
    expect(after.lessonId).toBe("L2-3");
    expect(after.linesCompleted).toBe(1);
    expect(after.lastSeed).toBe(5);
  });
});
