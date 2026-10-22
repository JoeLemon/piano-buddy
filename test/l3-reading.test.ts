import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import { generateL3 } from "../src/domain/generateL3";
import { initialProfile, type Profile } from "../src/domain/profile";
import { scoreEvents } from "../src/domain/scoreEvents";
import type { Hand } from "../src/domain/types";
import { saveProfile } from "../src/storage/db";
import App from "../src/App.vue";
import L3ReadingView from "../src/ui/L3ReadingView.vue";

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

function l3Profile(partial: Partial<Profile> = {}): Profile {
  return {
    ...initialProfile(),
    lessonId: "L3R-1",
    lastSeed: 1,
    ...partial,
  };
}

/** 与视图里的 handFor 保持一致：奇偶 seed 轮换手别。 */
function handFor(seed: number): Hand {
  return seed % 2 === 0 ? "RH" : "LH";
}

function lineMidis(seed: number): number[][] {
  const hand = handFor(seed);
  const score = generateL3({
    seed,
    mode: "reading-lesson",
    shape: { kind: "interval", hand },
  });
  return scoreEvents(score, hand).map((event) => event.midis);
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

describe("L3ReadingView", () => {
  it("shows the chord card and line goal without MIDI", () => {
    const wrapper = mount(L3ReadingView, {
      props: {
        profile: l3Profile(),
        midiConnected: false,
      },
    });

    expect(wrapper.text()).toContain("请连接 MIDI 键盘");
    expect(wrapper.text()).toContain("两个音一起按");
    expect(wrapper.get("[data-test=lesson-progress]").text()).toContain("双音");
    expect(wrapper.get("[data-test=lesson-goal]").text()).toBe("短句 0/2");
    expect(wrapper.emitted("update-profile")).toBeFalsy();
  });

  it("requires the whole interval before advancing to the next line", async () => {
    const input = new FakeInput();
    installAccess([input]);
    const wrapper = mount(L3ReadingView, {
      props: {
        profile: l3Profile(),
        midiConnected: true,
      },
    });
    await flushPromises();

    const first = lineMidis(1);
    // 只按双音里的一个音，不算过。
    input.dispatchEvent(noteOn(first[0][0]!));
    await flushPromises();
    expect(wrapper.emitted("update-profile")).toBeFalsy();
    expect(wrapper.get("[data-test=lesson-goal]").text()).toBe("短句 0/2");

    for (const midis of first) {
      for (const midi of midis) input.dispatchEvent(noteOn(midi));
    }
    await flushPromises();
    const afterFirst = wrapper.emitted("update-profile")?.at(-1)?.[0] as Profile;
    expect(afterFirst.lessonId).toBe("L3R-1");
    expect(afterFirst.linesCompleted).toBe(1);
    expect(afterFirst.lastSeed).toBe(2);

    for (const midis of lineMidis(2)) {
      for (const midi of midis) input.dispatchEvent(noteOn(midi));
    }
    await flushPromises();
    const afterSecond = wrapper.emitted("update-profile")?.at(-1)?.[0] as Profile;
    expect(afterSecond.lessonId).toBe("L3R-2");
    expect(afterSecond.linesCompleted).toBe(0);
    expect(afterSecond.lastSeed).toBe(3);
    expect(wrapper.get("[data-test=lesson-goal]").text()).toBe("短句 0/2");
  });

  it("stays in review mode after L3 has been passed", async () => {
    const input = new FakeInput();
    installAccess([input]);
    const wrapper = mount(L3ReadingView, {
      props: {
        profile: l3Profile({ lessonId: "L3R-4", l3Passed: true, lastSeed: 9 }),
        midiConnected: true,
      },
    });
    await flushPromises();

    expect(wrapper.get("[data-test=l3-review]").text()).toContain("回看模式");
    const hand = handFor(9);
    const score = generateL3({
      seed: 9,
      mode: "reading-lesson",
      shape: { kind: "accidental", hand },
    });
    for (const event of scoreEvents(score, hand)) {
      for (const midi of event.midis) input.dispatchEvent(noteOn(midi));
    }
    await flushPromises();

    // 回看不写档案，也不会再触发 L3 过关测试。
    expect(wrapper.emitted("update-profile")).toBeFalsy();
    expect(wrapper.get("[data-test=lesson-goal]").text()).toBe("短句 0/2");
  });
});

describe("App L3 reading", () => {
  it("routes the home card into the L3 chord course instead of the L2 review path", async () => {
    await saveProfile({
      ...initialProfile(),
      assessment: { knowsTreble: true, knowsBass: true, keepsPulse: true },
      lessonId: "L3R-1",
      l1RightPassed: true,
      l1LeftPassed: true,
      l2Passed: true,
    });
    const wrapper = mount(App);
    await untilText(wrapper, "L3 · 双音");

    await wrapper.get("[data-test=next-cta]").trigger("click");
    await untilText(wrapper, "两个音一起按");
    expect(wrapper.get("[data-test=lesson-progress]").text()).toContain("双音");
    expect(wrapper.get("[data-test=lesson-goal]").text()).toBe("短句 0/2");
  });
});
