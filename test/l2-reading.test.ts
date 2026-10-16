import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import { generateL2 } from "../src/domain/generateL2";
import { pitchToMidi } from "../src/domain/pitch";
import { initialProfile, type Profile } from "../src/domain/profile";
import type { Hand, Score } from "../src/domain/types";
import { saveProfile } from "../src/storage/db";
import App from "../src/App.vue";
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

function l2Profile(partial: Partial<Profile> = {}): Profile {
  return {
    ...initialProfile(),
    lessonId: "L2-1",
    seenReadingTips: true,
    lastSeed: 1,
    ...partial,
  };
}

async function untilText(wrapper: { text: () => string }, text: string) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await flushPromises();
    if (wrapper.text().includes(text)) return;
  }
  throw new Error(`missing ${text}: ${wrapper.text()}`);
}

enableAutoUnmount(afterEach);

afterEach(() => {
  delete (navigator as { requestMIDIAccess?: unknown }).requestMIDIAccess;
});

describe("L2ReadingView", () => {
  it("shows the connect tip and eighth-note progress without advancing when MIDI is absent", () => {
    const wrapper = mount(L2ReadingView, {
      props: {
        profile: l2Profile(),
        midiConnected: false,
      },
    });

    expect(wrapper.text()).toContain("请连接 MIDI 键盘");
    expect(wrapper.text()).toContain("一拍里有两个八分音，仍用这五个白键。");
    expect(wrapper.get("[data-test=lesson-progress]").text()).toContain("八分");
    expect(wrapper.get("[data-test=lesson-goal]").text()).toBe("短句 0/2");
    expect(wrapper.emitted("update-profile")).toBeFalsy();
  });

  it("stops on a wrong pitch and advances to L2-2 after two right-hand lines", async () => {
    const input = new FakeInput();
    installAccess([input]);
    const wrapper = mount(L2ReadingView, {
      props: {
        profile: l2Profile(),
        midiConnected: true,
      },
    });
    await flushPromises();

    const first = generateL2({ seed: 1, mode: "reading-lesson", shape: { kind: "eighths-single", hand: "RH" } });
    input.dispatchEvent(noteOn(1));
    await flushPromises();
    expect(wrapper.emitted("update-profile")).toBeFalsy();
    expect(wrapper.get("[data-test=lesson-goal]").text()).toBe("短句 0/2");

    for (const midi of soundingMidis(first, "RH")) input.dispatchEvent(noteOn(midi));
    await flushPromises();
    const afterFirst = wrapper.emitted("update-profile")?.at(-1)?.[0] as Profile;
    expect(afterFirst.lessonId).toBe("L2-1");
    expect(afterFirst.linesCompleted).toBe(1);
    expect(afterFirst.lastSeed).toBe(2);

    const second = generateL2({ seed: 2, mode: "reading-lesson", shape: { kind: "eighths-single", hand: "RH" } });
    for (const midi of soundingMidis(second, "RH")) input.dispatchEvent(noteOn(midi));
    await flushPromises();
    const afterSecond = wrapper.emitted("update-profile")?.at(-1)?.[0] as Profile;
    expect(afterSecond.lessonId).toBe("L2-2");
    expect(afterSecond.linesCompleted).toBe(0);
    expect(afterSecond.lastSeed).toBe(3);
    expect(wrapper.get("[data-test=lesson-goal]").text()).toBe("短句 0/2");
  });
});

describe("App L2 reading", () => {
  it("mounts the L2 lesson when the lesson id starts with L2", async () => {
    await saveProfile({
      ...initialProfile(),
      assessment: { knowsTreble: true, knowsBass: false, keepsPulse: true },
      lessonId: "L2-1",
      l1RightPassed: true,
    });
    const wrapper = mount(App);
    await untilText(wrapper, "先认谱");
    await wrapper.get("[data-test=reading]").trigger("click");
    await untilText(wrapper, "一拍里有两个八分音，仍用这五个白键。");
    expect(wrapper.get("[data-test=lesson-progress]").text()).toContain("八分");
    expect(wrapper.text()).not.toContain("跟着节拍器");
  });

  it("opens the L2 lesson from 先认谱 after both L1 hands have passed", async () => {
    await saveProfile({
      ...initialProfile(),
      assessment: { knowsTreble: true, knowsBass: true, keepsPulse: true },
      lessonId: "L2-1",
      l1RightPassed: true,
      l1LeftPassed: true,
    });
    const wrapper = mount(App);
    await untilText(wrapper, "先认谱");
    await wrapper.get("[data-test=reading]").trigger("click");
    await untilText(wrapper, "一拍里有两个八分音，仍用这五个白键。");
    expect(wrapper.get("[data-test=lesson-progress]").text()).toContain("八分");
  });
});
