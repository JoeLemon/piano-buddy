import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import { initialProfile, type Profile } from "../src/domain/profile";
import type { Score } from "../src/domain/types";
import HomeView from "../src/ui/HomeView.vue";
import PlacementView from "../src/ui/PlacementView.vue";

function profile(partial: Partial<Profile> = {}): Profile {
  return { ...initialProfile(), ...partial };
}

const snippet: Score = {
  id: "err-1",
  mode: "sight",
  level: 1,
  meter: { beats: 4, beatValue: 4 },
  keySignature: "C",
  hands: ["RH"],
  bpm: 60,
  staves: { RH: { clef: "treble", measures: [] } },
};

describe("HomeView", () => {
  it("opens reading when neither hand is unlocked", async () => {
    const wrapper = mount(HomeView, {
      props: {
        profile: profile(),
        rightUnlocked: false,
        leftUnlocked: false,
      },
    });
    await wrapper.get("[data-test=sight]").trigger("click");
    expect(wrapper.emitted("open-reading")).toBeTruthy();
    expect(wrapper.emitted("open-sight")).toBeFalsy();
    expect(wrapper.text()).toContain("视奏里只会用到已经认过的五个音，先把它们认准。");
  });

  it("opens sight reading after the right hand has passed", async () => {
    const wrapper = mount(HomeView, {
      props: {
        profile: profile({ l1RightPassed: true }),
        rightUnlocked: true,
        leftUnlocked: false,
      },
    });
    await wrapper.get("[data-test=sight]").trigger("click");
    expect(wrapper.emitted("open-sight")).toBeTruthy();
  });

  it("opens sight reading when only the left hand has passed", async () => {
    const wrapper = mount(HomeView, {
      props: {
        profile: profile({ l1LeftPassed: true }),
        rightUnlocked: false,
        leftUnlocked: true,
      },
    });
    await wrapper.get("[data-test=sight]").trigger("click");
    expect(wrapper.emitted("open-sight")).toBeTruthy();
    expect(wrapper.emitted("open-reading")).toBeFalsy();
    expect(wrapper.text()).not.toContain("视奏里只会用到已经认过的五个音，先把它们认准。");
  });

  it("opens reading from the reading button", async () => {
    const wrapper = mount(HomeView, {
      props: {
        profile: profile({ l1RightPassed: true, l1LeftPassed: true }),
        rightUnlocked: true,
        leftUnlocked: true,
      },
    });
    await wrapper.get("[data-test=reading]").trigger("click");
    expect(wrapper.emitted("open-reading")).toBeTruthy();
  });

  it("opens placement without treating the questionnaire as a pass", async () => {
    const wrapper = mount(HomeView, {
      props: {
        profile: profile(),
        rightUnlocked: false,
        leftUnlocked: false,
      },
    });
    await wrapper.get("[data-test=placement]").trigger("click");
    expect(wrapper.emitted("open-placement")).toBeTruthy();
    expect(wrapper.text()).not.toContain("%");
  });

  it("opens the theory practice hub without requiring a MIDI unlock", async () => {
    const wrapper = mount(HomeView, {
      props: {
        profile: profile(),
        rightUnlocked: false,
        leftUnlocked: false,
      },
    });
    await wrapper.get("[data-test=practice]").trigger("click");
    expect(wrapper.emitted("open-practice")).toBeTruthy();
  });

  it("shows the error book when unlocked and snippets exist", async () => {
    const wrapper = mount(HomeView, {
      props: {
        profile: profile({ l1RightPassed: true, errorSnippets: [snippet] }),
        rightUnlocked: true,
        leftUnlocked: false,
      },
    });
    expect(wrapper.find("[data-test=error-book]").exists()).toBe(true);
    await wrapper.get("[data-test=error-book]").trigger("click");
    expect(wrapper.emitted("open-error")).toBeTruthy();
  });

  it("puts one next step in front and routes it into the lesson", async () => {
    const wrapper = mount(HomeView, {
      props: {
        profile: profile({
          assessment: { knowsTreble: true, knowsBass: false, keepsPulse: true },
          lessonId: "L1-3",
          l1RightPassed: true,
          linesCompleted: 1,
        }),
        rightUnlocked: true,
        leftUnlocked: false,
      },
    });
    expect(wrapper.get("[data-test=next-goal]").text()).toBe("短句 1/2");
    expect(wrapper.get(".hero h1").text()).toContain("右手短句");
    await wrapper.get("[data-test=next-cta]").trigger("click");
    expect(wrapper.emitted("open-reading")).toHaveLength(1);
  });

  it("shows where the learner stands on the path", () => {
    const wrapper = mount(HomeView, {
      props: {
        profile: profile({
          assessment: { knowsTreble: true, knowsBass: true, keepsPulse: true },
          lessonId: "L2-1",
          l1RightPassed: true,
          l1LeftPassed: true,
        }),
        rightUnlocked: true,
        leftUnlocked: true,
      },
    });
    expect(wrapper.get('[data-stage=L1]').attributes("data-state")).toBe("done");
    expect(wrapper.get('[data-stage=L2]').attributes("data-state")).toBe("current");
    expect(wrapper.get("[data-test=learning-path]").text()).toContain("正在学");
  });
});

describe("PlacementView", () => {
  it("submits the three answers and does not unlock sight reading", async () => {
    const wrapper = mount(PlacementView);
    expect(wrapper.text()).toContain("认识高音谱吗？");
    expect(wrapper.text()).toContain("认识低音谱吗？");
    expect(wrapper.text()).toContain("跟得上拍吗？");
    const labels = wrapper.findAll("button").map((button) => button.text());
    expect(labels.filter((label) => label === "会")).toHaveLength(3);
    expect(labels.filter((label) => label === "还不会")).toHaveLength(3);
    await wrapper.get("[data-test=knowsTreble-yes]").trigger("click");
    await wrapper.get("[data-test=knowsBass-no]").trigger("click");
    await wrapper.get("[data-test=keepsPulse-yes]").trigger("click");
    await wrapper.get("[data-test=submit]").trigger("click");
    expect(wrapper.emitted("submit")).toEqual([[{
      knowsTreble: true,
      knowsBass: false,
      keepsPulse: true,
    }]]);
    expect(wrapper.emitted("open-sight")).toBeFalsy();
    expect(wrapper.text()).not.toContain("%");
  });

  it("does not submit until every question is answered", async () => {
    const wrapper = mount(PlacementView);
    await wrapper.get("[data-test=knowsTreble-no]").trigger("click");
    await wrapper.get("[data-test=submit]").trigger("click");
    expect(wrapper.emitted("submit")).toBeFalsy();
  });
});
