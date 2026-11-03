import { appPlatform, isNativeApp } from "./platform";

/**
 * Android 硬件返回键。
 *
 * 不接会怎样：Capacitor 只在「没有任何 backButton 监听」时才让系统退出 App；
 * 一旦我们想接管，就必须自己决定「消费掉」还是「真的退出」。之前一行都没写，
 * 结果是任何页面按返回都直接退出应用——跟弹到一半、微课做到一半都会被打断。
 *
 * 这里的口径：
 *   1. 设置抽屉开着 → 关抽屉（最浅的一层，先收）；
 *   2. 页面能返回（`showBack`）→ 回上一页，不动练习中的音频由调用方负责；
 *   3. 一级分区页（我的 / 学习 …）→ 回今日；
 *   4. 已经在今日 / 建档页 → 不消费，退出 App（保持系统默认手感）。
 *
 * 只在 Android 原生壳里生效：iOS 没有返回键，浏览器里交给浏览器自己的历史栈。
 */

type BackListener = { remove(): Promise<void> };

export type AppPlugin = {
  App: {
    addListener(event: "backButton", callback: () => void): Promise<BackListener>;
    exitApp(): Promise<void>;
  };
};

/** 返回 true 表示「这次返回已经处理」，false 交给系统退出。 */
export type BackHandler = () => boolean;

async function importAppPlugin(): Promise<AppPlugin> {
  return (await import("@capacitor/app")) as unknown as AppPlugin;
}

let loadPlugin: () => Promise<AppPlugin> = importAppPlugin;

/** 测试/自动化用：替换插件实现。传 `null` 恢复真实插件。 */
export function setAppPlugin(plugin: AppPlugin | null): void {
  loadPlugin = plugin ? async () => plugin : importAppPlugin;
}

/** 返回键在哪些环境归我们管。 */
export function ownsBackButton(): boolean {
  return isNativeApp() && appPlatform() === "android";
}

/**
 * 装上返回键监听，返回清理函数。
 * 非 Android 原生环境、或插件加载失败时返回空清理函数（不影响 App 启动）。
 */
export async function installBackButton(handler: BackHandler): Promise<() => void> {
  if (!ownsBackButton()) return () => {};
  let App: AppPlugin["App"];
  try {
    App = (await loadPlugin()).App;
  } catch {
    return () => {};
  }
  if (!App || typeof App.addListener !== "function") return () => {};

  let listener: BackListener | null = null;
  try {
    listener = await App.addListener("backButton", () => {
      if (handler()) return;
      // 不消费 = 用户想退出：走系统默认，回桌面。
      void App.exitApp().catch(() => {});
    });
  } catch {
    return () => {};
  }

  return () => {
    void listener?.remove().catch(() => {});
    listener = null;
  };
}
