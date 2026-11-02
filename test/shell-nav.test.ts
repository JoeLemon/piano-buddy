import { mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import { flushPromises } from "@vue/test-utils";
import AppShell from "../src/ui/AppShell.vue";

const androidLocationEnabled = vi.fn<() => Promise<boolean | null>>();
const openSystemLocationSettings = vi.fn<() => Promise<boolean>>();

vi.mock("../src/midi/access", () => ({
  androidLocationEnabled: () => androidLocationEnabled(),
  openSystemLocationSettings: () => openSystemLocationSettings(),
}));

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

  it("names the bluetooth channel that is actually in use", async () => {
    const wrapper = shell({ bleAvailable: true, bleChannel: "App 原生蓝牙" });
    await wrapper.get("[data-test=open-settings]").trigger("click");
    const drawer = wrapper.get("[data-test=settings]");
    expect(drawer.get("[data-test=diag-ble-channel]").text()).toBe("App 原生蓝牙");
    expect(drawer.get("[data-test=diag-runtime]").text()).toBe("浏览器");
    expect(drawer.find("[data-test=diag-ble-hint]").exists()).toBe(false);
  });

  it("explains what to do when no bluetooth channel exists", async () => {
    const wrapper = shell({ bleAvailable: false, bleChannel: null, nativeApp: false });
    await wrapper.get("[data-test=open-settings]").trigger("click");
    const drawer = wrapper.get("[data-test=settings]");
    expect(drawer.get("[data-test=diag-ble-channel]").text()).toBe("不可用");
    // 浏览器里没蓝牙时，指向 App 版而不是让人反复试点「连接」
    expect(drawer.get("[data-test=diag-ble-hint]").text()).toContain("App 版");
  });
});

describe("AppShell 定位服务诊断（Android）", () => {
  async function openDrawer(wrapper: Awaited<ReturnType<typeof shell>>) {
    await wrapper.get("[data-test=open-settings]").trigger("click");
    await flushPromises();
    return wrapper.get("[data-test=settings]");
  }

  it("浏览器里不显示这一行（没有定位服务可查）", async () => {
    const wrapper = shell({ nativeApp: false });
    const drawer = await openDrawer(wrapper);
    expect(drawer.find("[data-test=diag-location]").exists()).toBe(false);
    expect(androidLocationEnabled).not.toHaveBeenCalled();
  });

  it("插件查不到时也不显示，不摆一行吓人的「未知」", async () => {
    androidLocationEnabled.mockResolvedValue(null);
    const wrapper = shell({ nativeApp: true });
    const drawer = await openDrawer(wrapper);
    expect(drawer.find("[data-test=diag-location]").exists()).toBe(false);
    expect(drawer.find("[data-test=diag-location-hint]").exists()).toBe(false);
  });

  it("定位开着时显示「已开启」，不给多余按钮", async () => {
    androidLocationEnabled.mockResolvedValue(true);
    const wrapper = shell({ nativeApp: true });
    const drawer = await openDrawer(wrapper);
    expect(drawer.get("[data-test=diag-location]").text()).toBe("已开启");
    expect(drawer.find("[data-test=diag-location-hint]").exists()).toBe(false);
  });

  it("定位关着时给出「去打开」，点了真的跳系统设置并重新查状态", async () => {
    androidLocationEnabled.mockResolvedValue(false);
    openSystemLocationSettings.mockResolvedValue(true);
    const wrapper = shell({ nativeApp: true });
    const drawer = await openDrawer(wrapper);

    expect(drawer.get("[data-test=diag-location]").text()).toBe("已关闭");
    const hint = drawer.get("[data-test=diag-location-hint]");
    expect(hint.text()).toContain("Android 11 及以下");

    await drawer.get("[data-test=diag-open-location]").trigger("click");
    await flushPromises();
    expect(openSystemLocationSettings).toHaveBeenCalledTimes(1);
    // 跳之前问过一次、回来又查了一次
    expect(androidLocationEnabled.mock.calls.length).toBeGreaterThanOrEqual(2);

    // 用户改好了：重新开抽屉时状态跟着变
    androidLocationEnabled.mockResolvedValue(true);
    await wrapper.get(".drawer-close").trigger("click");
    await openDrawer(wrapper);
    expect(drawer.get("[data-test=diag-location]").text()).toBe("已开启");
  });

  it("跳不过去（插件缺方法）时不假报「已带你到系统设置」", async () => {
    androidLocationEnabled.mockResolvedValue(false);
    openSystemLocationSettings.mockResolvedValue(false);
    const wrapper = shell({ nativeApp: true });
    const drawer = await openDrawer(wrapper);
    await drawer.get("[data-test=diag-open-location]").trigger("click");
    await flushPromises();
    expect(drawer.get("[data-test=diag-location-hint]").text()).not.toContain("已带你到系统设置");
  });
});
