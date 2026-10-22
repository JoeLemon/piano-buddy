import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import { generateL2 } from "../src/domain/generateL2";
import { parsePitchLabel, pitchToMidi } from "../src/domain/pitch";
import { initialProfile, type Profile } from "../src/domain/profile";
import { flattenScore } from "../src/domain/timeline";
import type { Hand, Score } from "../src/domain/types";
import { fingerFor, pitchesFor } from "../src/domain/vocabulary";
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

function shiftLine(seed: number, hand: Hand): Score {
  return generateL2({ seed, mode: "reading-lesson", shape: { kind: "shift-once", hand } });
}

function l2Profile(partial: Partial<Profile> = {}): Profile {
  return {
    ...initialProfile(),
    lessonId: "L2-6",
    seenReadingTips: true,
    lastSeed: 2,
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

describe("L2-6 five-finger shift", () => {
  it("puts the shift line in one hand only, with both positions inside the line", () => {
    const line = shiftLine(2, "RH");
    expect(line.hands).toEqual(["RH"]);
    const labels = flattenScore(line).map((note) => note.label);
    expect(labels).toContain("C4");
    expect(labels).toContain("A4");
    const left = flattenScore(shiftLine(2, "LH")).map((note) => note.label);
    expect(left).toContain("C3");
    expect(left).toContain("A3");
  });

  it("alternates the shifting hand by seed", async () => {
    const input = new FakeInput();
    installAccess([input]);
    const wrapper = mount(L2ReadingView, {
      props: {
        profile: l2Profile({ lastSeed: 2 }),
        midiConnected: true,
      },
    });
    await flushPromises();

    expect(wrapper.text()).toContain("整段从 C 位挪到 D 位");
    expect(wrapper.get("[data-test=lesson-goal]").text()).toBe("短句 0/2");

    const line = shiftLine(2, "RH");
    const notes = flattenScore(line);
    const cSet = new Set(pitchesFor("C", "RH").map((pitch) => pitchToMidi(pitch)));
    const shiftAt = notes.findIndex(
      (note) => !cSet.has(note.midi) || note.finger !== fingerFor("C", "RH", parsePitchLabel(note.label)),
    );
    expect(shiftAt).toBeGreaterThan(0);

    play(input, notes.slice(0, shiftAt).map((note) => note.midi));
    await flushPromises();

    // 挪位那一下之后，琴键图的目标键跟着推进到下一个音。
    input.dispatchEvent(noteOn(notes[shiftAt]!.midi));
    await flushPromises();
    const target = wrapper.findAll(".white-key, .black-key").find((key) => key.classes().includes("is-target"));
    expect(target?.attributes("data-midi")).toBe(String(notes[shiftAt + 1]!.midi));

    play(input, notes.slice(shiftAt + 1).map((note) => note.midi));
    await flushPromises();
    const after = wrapper.emitted("update-profile")?.at(-1)?.[0] as Profile;
    expect(after.lessonId).toBe("L2-6");
    expect(after.linesCompleted).toBe(1);
    expect(after.lastSeed).toBe(3);
  });

  it("takes the left hand on an odd seed and will not accept the other hand's line", async () => {
    const input = new FakeInput();
    installAccess([input]);
    const wrapper = mount(L2ReadingView, {
      props: {
        profile: l2Profile({ lastSeed: 3 }),
        midiConnected: true,
      },
    });
    await flushPromises();

    const leftMidis = flattenScore(shiftLine(3, "LH")).map((note) => note.midi);
    const rightMidis = flattenScore(shiftLine(3, "RH")).map((note) => note.midi);
    play(input, rightMidis);
    await flushPromises();
    expect(wrapper.emitted("update-profile")).toBeFalsy();
    expect(wrapper.get(".hint").text().length).toBeGreaterThan(0);

    play(input, leftMidis);
    await flushPromises();
    const after = wrapper.emitted("update-profile")?.at(-1)?.[0] as Profile;
    expect(after.lessonId).toBe("L2-6");
    expect(after.linesCompleted).toBe(1);
    expect(after.lastSeed).toBe(4);
  });

  it("opens the L2 pass test after two shift lines", async () => {
    const input = new FakeInput();
    installAccess([input]);
    const wrapper = mount(L2ReadingView, {
      props: {
        profile: l2Profile({ lastSeed: 2, linesCompleted: 1 }),
        midiConnected: true,
      },
    });
    await flushPromises();

    play(input, flattenScore(shiftLine(2, "RH")).map((note) => note.midi));
    await flushPromises();
    const after = wrapper.emitted("update-profile")?.at(-1)?.[0] as Profile;
    expect(after.lessonId).toBe("L2-test");
    expect(after.linesCompleted).toBe(0);
    expect(after.lastSeed).toBe(3);
    expect(wrapper.get("[data-test=advance-banner]").text()).toBe("五指平移过了。准备 L2 过关测试。");
    expect(wrapper.get("[data-active=true]").text()).toBe("过关");
    expect(wrapper.get("[data-test=lesson-goal]").text()).toBe("过关测试");
    expect(wrapper.find(".staff").exists()).toBe(false);
    expect(wrapper.text()).not.toContain("%");
  });
});
