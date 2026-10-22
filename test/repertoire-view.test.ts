import { mount } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { initialProfile, type Profile } from "../src/domain/profile";
import { paintGrandProgress } from "../src/notation/scorePaint";
import RepertoireView from "../src/ui/RepertoireView.vue";

vi.mock("../src/notation/renderScore", () => ({
  renderGrandScore: vi.fn(),
  renderScore: vi.fn(),
}));

// 谱面渲染本身被 mock，播放上色改从调用参数上验证。
vi.mock("../src/notation/scorePaint", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/notation/scorePaint")>();
  return {
    ...actual,
    paintScoreProgress: vi.fn(actual.paintScoreProgress),
    paintGrandProgress: vi.fn(actual.paintGrandProgress),
  };
});

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
    expect(wrapper.get("[data-test=repertoire-l3]").text()).toContain("直达对应课");
    expect(wrapper.emitted("open-reading")).toBeFalsy();

    // L3 缺口也有具体课位，不是只把人赶回学习分区。
    const triad = wrapper.get('[data-test="skill-route-chord.triad"]');
    expect(triad.text()).toContain("去 L3 三和弦");
    await triad.trigger("click");
    expect(wrapper.emitted("open-lesson")).toEqual([["L3R-2"]]);

    const progression = wrapper.get('[data-test="skill-route-chord.progression"]');
    await progression.trigger("click");
    expect(wrapper.emitted("open-theory")).toEqual([["L3-4"]]);
  });

  it("links each missing skill to a concrete micro lesson", async () => {
    const wrapper = mount(RepertoireView, {
      props: { profile: profile() },
    });

    const link = wrapper.get('[data-test="skill-route-clef.treble"]');
    expect(link.text()).toContain("去 L1");
    await link.trigger("click");
    expect(wrapper.emitted("open-lesson")).toEqual([["L1-2"]]);
  });

  it("follows the selected measures as a sliced score", async () => {
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
    expect(wrapper.findAll("[data-test=repertoire-segment] option").length).toBeGreaterThan(0);

    // 右手跟弹：切出来的谱子只保留高音谱表。
    await wrapper.findAll("[data-test=repertoire-hand]").at(1)?.trigger("click");
    await wrapper.get("[data-test=repertoire-follow]").trigger("click");

    const payload = wrapper.emitted("follow-score")?.[0]?.[0] as {
      score: { id: string; hands: string[]; staves: Record<string, { measures: unknown[] }> };
      hand: string;
      title: string;
    };
    expect(payload.hand).toBe("RH");
    expect(payload.score.hands).toEqual(["RH"]);
    expect(payload.score.staves.RH?.measures).toHaveLength(2);
    expect(payload.score.id).toMatch(/\.m1-2\.RH$/);
    expect(payload.title).toContain("第 1–2 小节");
  });

  it("starts playback through the shared preview player", async () => {    vi.useFakeTimers();
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

  it("tints the score while the demo plays", async () => {
    installAudioContext();
    vi.useFakeTimers();
    const wrapper = mount(RepertoireView, {
      props: { profile: profile() },
    });

    try {
      const paint = vi.mocked(paintGrandProgress);
      paint.mockClear();

      await wrapper.get("[data-test=repertoire-play]").trigger("click");
      // 播放器按墙钟逐个回调 onNote，推进到第一个音之后应触发一次上色。
      await vi.advanceTimersByTimeAsync(300);

      const call = paint.mock.calls.at(-1);
      expect(call).toBeTruthy();
      expect(call?.[2]?.timelineCount).toBeGreaterThan(0);
    } finally {
      wrapper.unmount();
      vi.useRealTimers();
    }
  });
});
