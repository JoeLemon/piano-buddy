import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import HomeView from "../src/ui/HomeView.vue";
import PlacementView from "../src/ui/PlacementView.vue";

describe("HomeView", () => {
  it("opens reading when neither hand is unlocked", async () => {
    const wrapper = mount(HomeView, {
      props: { rightUnlocked: false, leftUnlocked: false },
    });
    await wrapper.get("[data-test=sight]").trigger("click");
    expect(wrapper.emitted("open-reading")).toBeTruthy();
    expect(wrapper.text()).toContain("先认识这五个音，视奏里只会用到它们。");
  });

  it("opens sight reading after the right hand has passed", async () => {
    const wrapper = mount(HomeView, {
      props: { rightUnlocked: true, leftUnlocked: false },
    });
    await wrapper.get("[data-test=sight]").trigger("click");
    expect(wrapper.emitted("open-sight")).toBeTruthy();
  });

  it("opens sight reading when only the left hand has passed", async () => {
    const wrapper = mount(HomeView, {
      props: { rightUnlocked: false, leftUnlocked: true },
    });
    await wrapper.get("[data-test=sight]").trigger("click");
    expect(wrapper.emitted("open-sight")).toBeTruthy();
    expect(wrapper.emitted("open-reading")).toBeFalsy();
    expect(wrapper.text()).not.toContain("先认识这五个音，视奏里只会用到它们。");
  });

  it("opens reading from the reading button", async () => {
    const wrapper = mount(HomeView, {
      props: { rightUnlocked: true, leftUnlocked: true },
    });
    await wrapper.get("[data-test=reading]").trigger("click");
    expect(wrapper.emitted("open-reading")).toBeTruthy();
  });

  it("opens placement without treating the questionnaire as a pass", async () => {
    const wrapper = mount(HomeView, {
      props: { rightUnlocked: false, leftUnlocked: false },
    });
    await wrapper.get("[data-test=placement]").trigger("click");
    expect(wrapper.emitted("open-placement")).toBeTruthy();
    expect(wrapper.text()).not.toContain("%");
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
