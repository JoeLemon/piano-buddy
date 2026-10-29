import { mount } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { initialProfile, type Profile } from "../src/domain/profile";
import { paintGrandProgress } from "../src/notation/scorePaint";
import RepertoireView from "../src/ui/RepertoireView.vue";
import ScoreFollow from "../src/ui/ScoreFollow.vue";

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
    // 曲库会继续加曲子，这里只数《欢乐颂》自己的三档编配。
    expect(wrapper.findAll('[data-arrangement^="arr.ode-to-joy"]')).toHaveLength(3);

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

  it("marks the L2 arrangement ready for a player who has passed L1 and L2", async () => {
    const wrapper = mount(RepertoireView, {
      props: {
        profile: profile({
          l1RightPassed: true,
          l1LeftPassed: true,
          l2Passed: true,
        }),
      },
    });

    // 曲库里不止一首歌，别靠「默认选中第一档」——明确点到 L2 编配。
    await wrapper.get('[data-arrangement="arr.ode-to-joy.simple"]').trigger("click");
    expect(wrapper.get("[data-test=readiness]").text()).toContain("所需技能已齐");
  });

  it("estimates how long the gap will take to close", async () => {
    const wrapper = mount(RepertoireView, {
      props: { profile: profile() },
    });

    await wrapper.get('[data-arrangement="arr.ode-to-joy.simple"]').trigger("click");
    // L2 编配的 8 个缺口全都有微课：5 个 L1 × 5 分钟 + 3 个 L2 × 8 分钟 = 49。
    const estimate = wrapper.get("[data-test=repertoire-estimate]").text();
    expect(estimate).toMatch(/预计约 49 分钟/);

    // L4 编配：分解和弦与手位读谱也接了 L4 预备关，12 个缺口全部有入口，
    // 估算覆盖全部（原来的 81 + 分解和弦 15 = 96），不再只说「有微课的部分」。
    await wrapper.get('[data-arrangement="arr.ode-to-joy.full"]').trigger("click");
    const l4Estimate = wrapper.get("[data-test=repertoire-estimate]").text();
    expect(l4Estimate).toMatch(/预计约 96 分钟/);
    expect(l4Estimate).not.toContain("有微课的部分");
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

  it("sends the L4 arrangement's broken-chord gap to the L4 prep stage", async () => {
    const wrapper = mount(RepertoireView, {
      props: { profile: profile() },
    });

    await wrapper.get('[data-arrangement="arr.ode-to-joy.full"]').trigger("click");
    const link = wrapper.get('[data-test="skill-route-texture.broken"]');
    expect(link.text()).toContain("去 L4 预备 · 分解和弦");
    await link.trigger("click");
    // L4 预备关在乐理练习页里，带关卡 id 直达，不进 L3PrepView。
    expect(wrapper.emitted("open-stage")).toEqual([["L4-1"]]);
    expect(wrapper.emitted("open-theory")).toBeUndefined();
  });

  it("follows the selected measures in place, with only the chosen hand", async () => {
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

    // 右手跟弹：切出来的谱子只保留高音谱表，而且不离开曲库。
    await wrapper.findAll("[data-test=repertoire-hand]").at(1)?.trigger("click");
    await wrapper.get("[data-test=repertoire-follow]").trigger("click");

    const follow = wrapper.get("[data-test=score-follow]");
    expect(follow.attributes("data-score-id")).toMatch(/\.m1-2\.RH$/);
    expect(Number(follow.attributes("data-slots"))).toBeGreaterThan(0);
    expect(wrapper.find("[data-test=repertoire]").exists()).toBe(true);

    // 再点一次收起，同一段可以直接重来。
    expect(wrapper.get("[data-test=repertoire-follow]").text()).toContain("收起跟弹");
    await wrapper.get("[data-test=repertoire-follow]").trigger("click");
    expect(wrapper.find("[data-test=score-follow]").exists()).toBe(false);
  });

  it("banks a clean pass as practice evidence, not as mastery", async () => {
    const wrapper = mount(RepertoireView, {
      props: { profile: profile() },
    });

    await wrapper.get('[data-arrangement="arr.ode-to-joy.standard"]').trigger("click");
    await wrapper.findAll("[data-test=repertoire-hand]").at(1)?.trigger("click");
    await wrapper.get("[data-test=repertoire-follow]").trigger("click");
    const follow = wrapper.getComponent(ScoreFollow);

    // 没弹完整段不记账：练个半熟不该让技能清单上的「练过」变廉价。
    follow.vm.$emit("done", { onCount: 2, total: 4 });
    expect(wrapper.emitted("update-profile")).toBeUndefined();

    follow.vm.$emit("done", { onCount: 4, total: 4 });
    const next = wrapper.emitted("update-profile")?.[0]?.[0] as Profile;
    expect(next.followedSegments[0]).toMatch(/\.m1-2\.RH$/);

    const entries = Object.values(next.skillLedger);
    expect(entries.length).toBeGreaterThan(0);
    // 跟弹只证明「在曲子里练过」，识谱过关仍由关卡测试判定。
    expect(entries.every((item) => item.state === "learning")).toBe(true);
    expect(entries.every((item) => typeof item.bpm === "number" && item.bpm > 0)).toBe(true);

    // 档案回写后，「已弹对」和「练过」都从档案来，刷新页面不丢。
    await wrapper.setProps({ profile: next });
    const options = wrapper.findAll("[data-test=repertoire-segment] option");
    expect(options[0]?.text()).toContain("已弹对");
    expect(wrapper.get("[data-test=repertoire-skills]").text()).toContain("练过");

    // 缺口总数不变，但「其中 N 项已经练过」让学生知道差在哪。
    expect(wrapper.get("[data-test=readiness]").text()).toContain("项已经练过");
    // 同档里练过的排前：先把半熟的补成过关，没碰过的排后面。
    const missingItems = wrapper.findAll(".skill-list.missing li");
    expect(missingItems[0]?.text()).toContain("练过");
    expect(missingItems[0]?.text()).not.toContain("低音谱");

    // 换成左手就是另一份谱子，同一段要重新弹对。
    await wrapper.findAll("[data-test=repertoire-hand]").at(2)?.trigger("click");
    expect(options[0]?.text()).not.toContain("已弹对");
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

  it("tints the score while the demo plays", async () => {    installAudioContext();
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

  it("plays only the followed segment once the follow panel is open", async () => {
    installAudioContext();
    const wrapper = mount(RepertoireView, { props: { profile: profile() } });

    try {
      await wrapper.get('[data-arrangement="arr.ode-to-joy.standard"]').trigger("click");
      const fullBeats = Number(wrapper.get("[data-test=repertoire-seek]").attributes("max"));

      await wrapper.get("[data-test=repertoire-follow]").trigger("click");
      const segmentBeats = Number(wrapper.get("[data-test=repertoire-seek]").attributes("max"));

      // 示范播放跟着谱面走：跟弹只画两小节，播放条也只算这两小节。
      expect(segmentBeats).toBeGreaterThan(0);
      expect(segmentBeats).toBeLessThan(fullBeats);
    } finally {
      wrapper.unmount();
    }
  });

  it("parks the playhead at the segment start when the loop is switched on", async () => {
    installAudioContext();
    const wrapper = mount(RepertoireView, { props: { profile: profile() } });

    try {
      await wrapper.get('[data-arrangement="arr.ode-to-joy.standard"]').trigger("click");
      // 第 3–4 小节：4/4 拍，从第 8 拍起
      await wrapper.get("[data-test=repertoire-segment]").setValue("1");
      await wrapper.get("[data-test=repertoire-loop]").trigger("click");

      const loopButton = wrapper.get("[data-test=repertoire-loop]");
      expect(loopButton.text()).toBe("取消循环");
      expect(loopButton.attributes("aria-pressed")).toBe("true");
      expect((wrapper.get("[data-test=repertoire-seek]").element as HTMLInputElement).value).toBe("8");

      // 再点一次收起：播放头留在原处，只是不再循环。
      await loopButton.trigger("click");
      expect(wrapper.get("[data-test=repertoire-loop]").text()).toBe("循环本段");
      expect((wrapper.get("[data-test=repertoire-seek]").element as HTMLInputElement).value).toBe("8");
    } finally {
      wrapper.unmount();
    }
  });

  it("wraps the demo at the segment end instead of finishing", async () => {
    vi.useFakeTimers();
    installAudioContext();
    const wrapper = mount(RepertoireView, { props: { profile: profile() } });

    try {
      await wrapper.get('[data-arrangement="arr.ode-to-joy.standard"]').trigger("click");
      await wrapper.get("[data-test=repertoire-segment]").setValue("1");
      await wrapper.get("[data-test=repertoire-loop]").trigger("click");
      await wrapper.get("[data-test=repertoire-play]").trigger("click");
      expect(wrapper.get("[data-test=repertoire-play]").text()).toBe("暂停");

      // 第 3–4 小节 8 拍、72bpm 约 6.7 秒；越过末端应该重播，不是结束。
      await vi.advanceTimersByTimeAsync(7000);
      expect(wrapper.get("[data-test=repertoire-play]").text()).toBe("暂停");
      // 播放头回到段首附近，说明真的绕回去了
      const position = Number((wrapper.get("[data-test=repertoire-seek]").element as HTMLInputElement).value);
      expect(position).toBeGreaterThanOrEqual(8);
      expect(position).toBeLessThan(10);
    } finally {
      wrapper.unmount();
      vi.useRealTimers();
    }
  });

  it("keeps the loop on through the follow panel", async () => {
    vi.useFakeTimers();
    installAudioContext();
    const wrapper = mount(RepertoireView, { props: { profile: profile() } });

    try {
      await wrapper.get('[data-arrangement="arr.ode-to-joy.standard"]').trigger("click");
      await wrapper.get("[data-test=repertoire-loop]").trigger("click");
      expect(wrapper.get("[data-test=repertoire-loop]").text()).toBe("取消循环");

      // 跟弹时播放器谱面就是这一段，循环整个播放区即可，不需要用户重设。
      await wrapper.get("[data-test=repertoire-follow]").trigger("click");
      expect(wrapper.find("[data-test=score-follow]").exists()).toBe(true);
      expect(wrapper.get("[data-test=repertoire-loop]").text()).toBe("取消循环");

      // 这一段 8 拍、72bpm 约 6.7 秒：越过末端还在放，说明循环真的设上了。
      await wrapper.get("[data-test=repertoire-play]").trigger("click");
      await vi.advanceTimersByTimeAsync(7000);
      expect(wrapper.get("[data-test=repertoire-play]").text()).toBe("暂停");

      // 收起跟弹后循环区换回整首坐标里的这一段，状态不丢。
      await wrapper.get("[data-test=repertoire-follow]").trigger("click");
      expect(wrapper.get("[data-test=repertoire-loop]").text()).toBe("取消循环");
    } finally {
      wrapper.unmount();
      vi.useRealTimers();
    }
  });
});
