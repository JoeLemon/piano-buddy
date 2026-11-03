import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installBackButton, ownsBackButton, setAppPlugin, type AppPlugin } from "../src/back-button";

/** 假插件：记录监听与 exitApp 调用，行为与 @capacitor/app 一致。 */
function fakePlugin() {
  let listener: (() => void) | null = null;
  const removed: string[] = [];
  const exitApp = vi.fn(async () => {});
  const plugin: AppPlugin = {
    App: {
      async addListener(_event, callback) {
        listener = callback;
        return {
          async remove() {
            removed.push("back");
            listener = null;
          },
        };
      },
      exitApp,
    },
  };
  return {
    plugin,
    exitApp,
    removed,
    pressBack() {
      if (!listener) throw new Error("返回键监听没装上");
      listener();
    },
    hasListener: () => listener !== null,
  };
}

function setNative(platform: "android" | "ios" | null) {
  const w = window as unknown as { Capacitor?: unknown };
  if (platform === null) {
    delete w.Capacitor;
    return;
  }
  w.Capacitor = {
    isNativePlatform: () => true,
    getPlatform: () => platform,
  };
}

afterEach(() => {
  setAppPlugin(null);
  setNative(null);
  vi.restoreAllMocks();
});

describe("返回键归属", () => {
  it("只在 Android 原生壳里接管", () => {
    setNative("android");
    expect(ownsBackButton()).toBe(true);
    setNative("ios");
    expect(ownsBackButton()).toBe(false);
    setNative(null);
    expect(ownsBackButton()).toBe(false);
  });
});

describe("Android 返回键", () => {
  beforeEach(() => {
    setNative("android");
  });

  it("界面消费掉返回时不退出 App", async () => {
    const fake = fakePlugin();
    setAppPlugin(fake.plugin);
    const handler = vi.fn(() => true);

    const stop = await installBackButton(handler);
    expect(fake.hasListener()).toBe(true);
    fake.pressBack();

    expect(handler).toHaveBeenCalledTimes(1);
    expect(fake.exitApp).not.toHaveBeenCalled();
    stop();
  });

  it("没人消费时退出 App（保持系统默认手感）", async () => {
    const fake = fakePlugin();
    setAppPlugin(fake.plugin);
    const handler = vi.fn(() => false);

    const stop = await installBackButton(handler);
    fake.pressBack();
    expect(fake.exitApp).toHaveBeenCalledTimes(1);
    stop();
  });

  it("清理函数会把监听摘掉", async () => {
    const fake = fakePlugin();
    setAppPlugin(fake.plugin);
    const stop = await installBackButton(() => true);
    stop();
    expect(fake.removed).toEqual(["back"]);
    expect(fake.hasListener()).toBe(false);
  });

  it("浏览器里装了个空监听（不碰插件）", async () => {
    setNative(null);
    const fake = fakePlugin();
    setAppPlugin(fake.plugin);
    const handler = vi.fn(() => true);

    const stop = await installBackButton(handler);
    expect(fake.hasListener()).toBe(false);
    expect(typeof stop).toBe("function");
    expect(() => stop()).not.toThrow();
  });

  it("iOS 原生也不接管（没有返回键）", async () => {
    setNative("ios");
    const fake = fakePlugin();
    setAppPlugin(fake.plugin);
    await installBackButton(() => true);
    expect(fake.hasListener()).toBe(false);
  });

  it("插件加不起来时不抛错，App 照常启动", async () => {
    setAppPlugin({
      App: {
        addListener: async () => {
          throw new Error("plugin missing");
        },
        exitApp: async () => {},
      },
    });
    const stop = await installBackButton(() => true);
    expect(typeof stop).toBe("function");
  });

  it("退出失败（比如已经在后台）不会冒泡成未捕获异常", async () => {
    const exitApp = vi.fn(async () => {
      throw new Error("no activity");
    });
    let listener: (() => void) | null = null;
    setAppPlugin({
      App: {
        async addListener(_event, callback) {
          listener = callback;
          return { remove: async () => {} };
        },
        exitApp,
      },
    });
    await installBackButton(() => false);
    expect(() => listener?.()).not.toThrow();
    await Promise.resolve();
    expect(exitApp).toHaveBeenCalled();
  });
});
