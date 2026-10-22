import { mount } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { initialProfile, type Profile } from "../src/domain/profile";
import RepertoireView from "../src/ui/RepertoireView.vue";

vi.mock("../src/notation/renderScore", () => ({
  renderGrandScore: vi.fn(),
  renderScore: vi.fn(),
}));

function profile(partial: Partial<Profile> = {}): Profile {
  return { ...initialProfile(), ...partial };
}

function installAudioContext() {
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

afterEach(() => {
  delete (globalThis as { AudioContext?: unknown }).AudioContext;
});

describe("RepertoireView", () => {
  it("lists the three Ode to Joy arrangements and the missing skills", () => {
    const wrapper = mount(RepertoireView, {
      props: { profile: profile() },
    });

    expect(wrapper.text()).toContain("欢乐颂");
    expect(wrapper.text()).toContain("Ludwig van Beethoven");
    expect(wrapper.findAll("[data-test=arrangement]")).toHaveLength(3);

    const readiness = wrapper.get("[data-test=readiness]").text();
    expect(readiness).toContain("还差");
    expect(wrapper.get("[data-test=repertoire-skills]").text()).toContain("高音谱");
    expect(wrapper.get("[data-test=repertoire-skills]").text()).toContain("低音谱");
    expect(wrapper.get("[data-test=repertoire-skills]").text()).toContain("补短板顺序");
  });

  it("switches arrangements and shows the L3 chord requirements", async () => {
    const wrapper = mount(RepertoireView, {
      props: { profile: profile() },
    });

    await wrapper.get('[data-arrangement="arr.ode-to-joy.standard"]').trigger("click");

    expect(wrapper.get("[data-test=repertoire-detail]").text()).toContain("L3 编配");
    expect(wrapper.get("[data-test=repertoire-skills]").text()).toContain("三和弦");
    expect(wrapper.get("[data-test=repertoire-skills]").text()).toContain("和弦连接");
  });

  it("marks the L2 arrangement ready for a player who has passed L1 and L2", () => {
    const wrapper = mount(RepertoireView, {
      props: {
        profile: profile({
          l1RightPassed: true,
          l1LeftPassed: true,
          l2Passed: true,
        }),
      },
    });

    expect(wrapper.get("[data-test=readiness]").text()).toContain("所需技能已齐");
  });

  it("offers the L1/L2 lesson path when basics are missing", async () => {
    const wrapper = mount(RepertoireView, {
      props: { profile: profile() },
    });

    const practice = wrapper.get("[data-test=repertoire-practice]");
    expect(practice.text()).toContain("回识谱课");
    await practice.trigger("click");
    expect(wrapper.emitted("open-reading")).toHaveLength(1);
  });

  it("does not route an advanced-only gap back to the L2 test", async () => {
    const wrapper = mount(RepertoireView, {
      props: {
        profile: profile({
          l1RightPassed: true,
          l1LeftPassed: true,
          l2Passed: true,
        }),
      },
    });

    await wrapper.get('[data-arrangement="arr.ode-to-joy.standard"]').trigger("click");
    expect(wrapper.find("[data-test=repertoire-practice]").exists()).toBe(false);
    expect(wrapper.get("[data-test=repertoire-l3-gap]").text()).toContain("不会直接跳过");
    await wrapper.get("[data-test=repertoire-l3]").trigger("click");
    expect(wrapper.emitted("open-l3")).toHaveLength(1);
    expect(wrapper.emitted("open-reading")).toBeFalsy();
  });

  it("starts playback through the shared preview player", async () => {
    vi.useFakeTimers();
    installAudioContext();
    const wrapper = mount(RepertoireView, {
      props: { profile: profile() },
    });

    try {
      await wrapper.get("[data-test=repertoire-play]").trigger("click");
      expect(wrapper.get("[data-test=repertoire-play]").text()).toBe("暂停");
      expect(wrapper.get("[data-test=repertoire-seek]").attributes("disabled")).toBeUndefined();
    } finally {
      wrapper.unmount();
      vi.useRealTimers();
    }
  });
});
