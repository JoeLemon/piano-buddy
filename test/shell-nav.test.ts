import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import AppShell from "../src/ui/AppShell.vue";

const sections = [
  { id: "today", label: "今日" },
  { id: "learn", label: "学习" },
  { id: "practice", label: "练习" },
  { id: "library", label: "曲库" },
  { id: "me", label: "我的" },
] as const;

function shell(props: Record<string, unknown> = {}) {
  return mount(AppShell, {
    props: {
      midiConnected: false,
      ...props,
    },
  });
}

describe("AppShell 导航", () => {
  it("renders the section tabs and reports the active one", () => {
    const wrapper = shell({ sections, activeSection: "learn" });
    const tabs = wrapper.findAll(".tab");
    expect(tabs.map((tab) => tab.text())).toEqual(["今日", "学习", "练习", "曲库", "我的"]);
    expect(wrapper.get('[data-section=learn]').attributes("aria-current")).toBe("page");
    expect(wrapper.get('[data-section=today]').attributes("aria-current")).toBeUndefined();
  });

  it("emits navigate when a tab is clicked", async () => {
    const wrapper = shell({ sections, activeSection: "today" });
    await wrapper.get('[data-section=library]').trigger("click");
    expect(wrapper.emitted("navigate")).toEqual([["library"]]);
  });

  it("hides the tabs in immersive mode", () => {
    const wrapper = shell({ sections: [], activeSection: "learn" });
    expect(wrapper.findAll(".tab")).toHaveLength(0);
  });

  it("shows the section breadcrumb instead of the brand inside a section", () => {
    const wrapper = shell({ section: "学习" });
    expect(wrapper.get(".crumb-section").text()).toBe("学习");
    expect(wrapper.find(".brand").exists()).toBe(false);
  });

  it("falls back to the brand on the dashboard", () => {
    const wrapper = shell();
    expect(wrapper.get(".brand").text()).toBe("Piano Buddy");
    expect(wrapper.find(".crumb-section").exists()).toBe(false);
  });
});

describe("AppShell 设置抽屉", () => {
  it("stays closed until the settings button is pressed", async () => {
    const wrapper = shell();
    const drawer = () => wrapper.get("[data-test=settings]").element as HTMLElement;
    expect(drawer().style.display).toBe("none");
    await wrapper.get("[data-test=open-settings]").trigger("click");
    expect(drawer().style.display).not.toBe("none");
  });

  it("keeps the keyboard switch, theme and diagnostics inside the drawer", async () => {
    const wrapper = shell({ keyboardMode: true, theme: "dark" });
    await wrapper.get("[data-test=open-settings]").trigger("click");
    const drawer = wrapper.get("[data-test=settings]");
    expect(drawer.text()).toContain("模拟键盘 开");
    expect(drawer.find("[data-test=keyboard-hint]").exists()).toBe(true);
    expect(drawer.find("[data-test=midi-diag]").exists()).toBe(true);

    await drawer.get("[data-test=toggle-keyboard]").trigger("click");
    expect(wrapper.emitted("toggle-keyboard")).toHaveLength(1);
    await drawer.get("[data-test=toggle-theme]").trigger("click");
    expect(wrapper.emitted("toggle-theme")).toHaveLength(1);
  });

  it("shows the new key map and a separate key-label switch", async () => {
    const wrapper = shell({ keyboardMode: true, keyLabels: true });
    await wrapper.get("[data-test=open-settings]").trigger("click");
    const drawer = wrapper.get("[data-test=settings]");
    // 说明文案换成 A 行白键 / Q 行黑键 / 数字键切音区
    expect(drawer.get("[data-test=keyboard-hint]").text()).toContain("D 永远是 C");
    expect(drawer.get("[data-test=keyboard-hint]").text()).toContain("1–7");

    const labels = drawer.get("[data-test=toggle-key-labels]");
    expect(labels.text()).toContain("按键标注 开");
    await labels.trigger("click");
    expect(wrapper.emitted("toggle-key-labels")).toHaveLength(1);
  });

  it("keeps the device chip actionable when nothing is connected", async () => {
    const wrapper = shell();
    const chip = wrapper.get("[data-test=connect-midi]");
    expect(chip.text()).toContain("连接键盘");
    await chip.trigger("click");
    expect(wrapper.emitted("connectMidi")).toHaveLength(1);
  });
});
