import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import { generateL2 } from "../src/domain/generateL2";
import { pitchToMidi } from "../src/domain/pitch";
import { initialProfile, l2FindHand, recordL2FindKey, type Profile } from "../src/domain/profile";
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

function keyFind(seed: number, key: "F" | "G", hand: Hand): Score {
  return generateL2({ seed, mode: "reading-lesson", shape: { kind: "key-find", key, hand } });
}

function l2Profile(partial: Partial<Profile> = {}): Profile {
  return {
    ...initialProfile(),
    lessonId: "L2-4",
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

describe("L2-4 F and L2-5 G key finding", () => {
  it("keeps the right hand until eight finds, then calls for the left hand", () => {
    let profile: Profile = { ...initialProfile(), lessonId: "L2-4" };
    expect(l2FindHand(profile)).toBe("RH");

    for (let i = 0; i < 7; i += 1) profile = recordL2FindKey(profile, true);
    expect(profile.lessonId).toBe("L2-4");
    expect(profile.findCorrect).toBe(7);
    expect(l2FindHand(profile)).toBe("RH");

    profile = recordL2FindKey(profile, true);
    expect(profile.lessonId).toBe("L2-4");
    expect(profile.findCorrect).toBe(8);
    expect(l2FindHand(profile)).toBe("LH");

    for (let i = 0; i < 8; i += 1) profile = recordL2FindKey(profile, true);
    expect(profile.lessonId).toBe("L2-5");
    expect(profile.findCorrect).toBe(0);
    expect(l2FindHand(profile)).toBe("RH");

    for (let i = 0; i < 16; i += 1) profile = recordL2FindKey(profile, true);
    expect(profile.lessonId).toBe("L2-6");
  });

  it("ignores a wrong key and never rolls a find back", () => {
    const start: Profile = { ...initialProfile(), lessonId: "L2-4", findCorrect: 3 };
    expect(recordL2FindKey(start, false)).toEqual(start);
  });

  it("shows the F card and one single-hand stave per measure", async () => {
    const wrapper = mount(L2ReadingView, {
      props: {
        profile: l2Profile(),
        midiConnected: false,
      },
    });
    await flushPromises();

    expect(wrapper.text()).toContain("F 调有一个降号");
    expect(wrapper.text()).toContain("先右手、再左手");
    expect(wrapper.get("[data-test=lesson-goal]").text()).toBe("找键 0/16");
    expect(wrapper.get("[data-active=true]").text()).toBe("F 五指");
    expect(wrapper.get(".staff").element.querySelectorAll(".vf-stave").length).toBe(4);
    expect(wrapper.find("[data-test=keyboard]").exists()).toBe(true);
    // 琴键图跟着手位挪到 F 位：左手最低音 F3、右手最低音 F4。
    expect(wrapper.find(".hand[data-hand='LH']").attributes("style")).toContain("--hand-start: 3");
    expect(wrapper.find(".hand[data-hand='RH']").attributes("style")).toContain("--hand-start: 10");
    expect(wrapper.emitted("update-profile")).toBeFalsy();
  });

  it("walks RH finds to LH and then opens the G lesson", async () => {
    const input = new FakeInput();
    installAccess([input]);
    const wrapper = mount(L2ReadingView, {
      props: {
        profile: l2Profile({ lastSeed: 1, findCorrect: 0 }),
        midiConnected: true,
      },
    });
    await flushPromises();

    const right = keyFind(1, "F", "RH");
    const rightMidis = soundingMidis(right, "RH");
    expect(rightMidis.length).toBe(16);
    expect(flattenScore(right).every((note) => note.hand === "RH")).toBe(true);

    input.dispatchEvent(noteOn(1));
    await flushPromises();
    expect(wrapper.emitted("update-profile")).toBeFalsy();
    expect(wrapper.get(".hint").text()).toContain("F");
    expect(wrapper.get("[data-test=lesson-goal]").text()).toBe("找键 0/16");
    expect(wrapper.find("[data-wrong]").exists()).toBe(true);

    play(input, rightMidis.slice(0, 8));
    await flushPromises();
    const afterRight = wrapper.emitted("update-profile")?.at(-1)?.[0] as Profile;
    expect(afterRight.lessonId).toBe("L2-4");
    expect(afterRight.findCorrect).toBe(8);
    expect(afterRight.lastSeed).toBe(2);
    expect(wrapper.get("[data-test=lesson-goal]").text()).toBe("找键 8/16");
    expect(wrapper.get("[data-test=advance-banner]").text()).toContain("换左手");

    const left = keyFind(2, "F", "LH");
    const leftMidis = soundingMidis(left, "LH");
    expect(leftMidis.length).toBe(16);
    play(input, leftMidis);
    await flushPromises();

    const afterLeft = wrapper.emitted("update-profile")?.at(-1)?.[0] as Profile;
    expect(afterLeft.lessonId).toBe("L2-5");
    expect(afterLeft.findCorrect).toBe(0);
    expect(afterLeft.lastSeed).toBe(3);
    expect(wrapper.get("[data-test=advance-banner]").text()).toBe("F 五指过了。接下来练 G 五指。");
    expect(wrapper.get("[data-active=true]").text()).toBe("G 五指");
    expect(wrapper.get("[data-test=lesson-goal]").text()).toBe("找键 0/16");
    expect(wrapper.text()).toContain("G 调有一个升号");
  });

  it("plays the G five-finger position in L2-5 and moves on to L2-6", async () => {
    const input = new FakeInput();
    installAccess([input]);
    const wrapper = mount(L2ReadingView, {
      props: {
        profile: l2Profile({ lessonId: "L2-5", lastSeed: 5, findCorrect: 8 }),
        midiConnected: true,
      },
    });
    await flushPromises();

    // 琴键图在 G 位：左手最低音 G3、右手最低音 G4。
    expect(wrapper.find(".hand[data-hand='LH']").attributes("style")).toContain("--hand-start: 4");
    expect(wrapper.find(".hand[data-hand='RH']").attributes("style")).toContain("--hand-start: 11");

    const g = keyFind(5, "G", "LH");
    const f = keyFind(5, "F", "LH");
    const gLabels = flattenScore(g).map((note) => note.label);
    expect(gLabels).toContain("G3");
    expect(gLabels).toContain("D4");
    expect(gLabels).not.toContain("F3");
    expect(gLabels).not.toEqual(flattenScore(f).map((note) => note.label));

    play(input, soundingMidis(g, "LH").slice(0, 8));
    await flushPromises();
    const afterLeft = wrapper.emitted("update-profile")?.at(-1)?.[0] as Profile;
    expect(afterLeft.lessonId).toBe("L2-6");
    expect(afterLeft.findCorrect).toBe(0);
    expect(afterLeft.lastSeed).toBe(6);
    expect(wrapper.get("[data-test=advance-banner]").text()).toBe("G 五指过了。接下来把整段挪一次手位。");
    expect(wrapper.get("[data-active=true]").text()).toBe("五指平移");
    expect(wrapper.get("[data-test=lesson-goal]").text()).toBe("短句 0/2");
  });
});
