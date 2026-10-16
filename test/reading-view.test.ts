import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import { parsePitchLabel, pitchToMidi } from "../src/domain/pitch";
import { initialProfile, type Profile } from "../src/domain/profile";
import { whiteKeyMidis } from "../src/notation/renderScore";
import ReadingView from "../src/ui/ReadingView.vue";

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

enableAutoUnmount(afterEach);

afterEach(() => {
  delete (navigator as { requestMIDIAccess?: unknown }).requestMIDIAccess;
});

describe("ReadingView", () => {
  it("shows the keyboard map and does not advance without MIDI", async () => {
    const wrapper = mount(ReadingView, {
      props: {
        profile: { ...initialProfile(), lessonId: "L1-2", seenReadingTips: true },
        midiConnected: false,
      },
    });
    expect(wrapper.text()).toContain("请连接 MIDI 键盘");
    expect(wrapper.find("[data-test=keyboard]").exists()).toBe(true);
    expect(wrapper.find("[data-test=lesson-progress]").exists()).toBe(true);
    expect(wrapper.get("[data-test=lesson-goal]").text()).toBe("找键 0/8");
    expect(wrapper.emitted("update-profile")).toBeFalsy();
  });

  it("drops queued right-hand pitches before the first left-hand find", async () => {
    const input = new FakeInput();
    installAccess([input]);
    const wrapper = mount(ReadingView, {
      props: {
        profile: {
          ...initialProfile(),
          lessonId: "L1-4",
          lessonPhase: "notes",
          findCorrect: 6,
          weakPitchQueue: ["D4", "G4"],
          seenReadingTips: true,
        },
        midiConnected: true,
      },
    });

    expect(wrapper.text()).toContain("低音 C 在低音谱第二间，左手五指。");
    expect(wrapper.text()).not.toContain("高音谱下加一间");
    const highlighted = wrapper.findAll(".white-key").findIndex((key) => key.classes().includes("is-target"));
    expect(whiteKeyMidis()[highlighted]).toBe(pitchToMidi(parsePitchLabel("C3")));

    const presented = wrapper.emitted("update-profile")?.[0]?.[0] as Profile;
    expect(presented.findCorrect).toBe(6);
    expect(presented.lessonId).toBe("L1-4");
    expect(presented.weakPitchQueue).not.toContain("D4");
    expect(presented.weakPitchQueue).not.toContain("G4");

    await flushPromises();
    const emitsBefore = wrapper.emitted("update-profile")?.length ?? 0;
    input.dispatchEvent(noteOn(pitchToMidi(parsePitchLabel("D4"))));
    await flushPromises();

    expect(wrapper.emitted("update-profile")?.length).toBeGreaterThan(emitsBefore);
    const after = wrapper.emitted("update-profile")?.at(-1)?.[0] as Profile;
    expect(after.findCorrect).toBe(6);
    expect(after.lessonPhase).toBe("notes");
    expect(after.weakPitchQueue).not.toContain("D4");
  });
});
