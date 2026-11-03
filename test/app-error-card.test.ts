import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "../src/App.vue";
import { clearAppError, reportAppError } from "../src/app-errors";

enableAutoUnmount(afterEach);

afterEach(() => {
  clearAppError();
  vi.unstubAllGlobals();
});

async function mountApp() {
  const wrapper = mount(App);
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await flushPromises();
    if (!wrapper.find(".loading").exists()) break;
  }
  return wrapper;
}

describe("全局错误卡片", () => {
  it("平时不出现", async () => {
    const wrapper = await mountApp();
    expect(wrapper.find("[data-test=app-error]").exists()).toBe(false);
  });

  it("有未捕获错误时弹出，并把错误原文摊出来给人复制", async () => {
    vi.stubGlobal("navigator", {});
    const wrapper = await mountApp();

    reportAppError(new Error("跟弹时炸了"), "vue:render");
    await flushPromises();

    const card = wrapper.get("[data-test=app-error]");
    expect(card.text()).toContain("出了点问题");
    expect(card.text()).toContain("跟弹时炸了");

    // 剪贴板不可用：点复制应退化成摊开原文，而不是静默失败
    await card.get("[data-test=app-error-copy]").trigger("click");
    await flushPromises();
    const raw = wrapper.get("[data-test=app-error-raw]").text();
    expect(raw).toContain("来源: vue:render");
    expect(raw).toContain("Piano Buddy");
  });

  it("剪贴板可用时把诊断 + 堆栈写进去，不摊原文", async () => {
    const writeText = vi.fn(async (_text: string) => {});
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    const wrapper = await mountApp();

    reportAppError(new Error("写盘失败"), "unhandledrejection");
    await flushPromises();
    await wrapper.get("[data-test=app-error-copy]").trigger("click");
    await flushPromises();

    expect(writeText).toHaveBeenCalledTimes(1);
    const text = writeText.mock.calls[0][0];
    expect(text).toContain("Piano Buddy");
    expect(text).toContain("错误详情:");
    expect(text).toContain("unhandledrejection");
    expect(wrapper.find("[data-test=app-error-raw]").exists()).toBe(false);
    expect(wrapper.get("[data-test=app-error-copy]").text()).toContain("已复制");
  });

  it("点「知道了」收起，不挡后续操作", async () => {
    const wrapper = await mountApp();
    reportAppError(new Error("一次性的"), "test");
    await flushPromises();
    expect(wrapper.find("[data-test=app-error]").exists()).toBe(true);

    await wrapper.get("[data-test=app-error-dismiss]").trigger("click");
    await flushPromises();
    expect(wrapper.find("[data-test=app-error]").exists()).toBe(false);
  });
});
