/**
 * 运行环境探测。
 *
 * Web 版跑在浏览器里，App 版（Capacitor）跑在原生 WebView 里。两者能力差距
 * 很大：iOS 的 WebView 既没有 Web MIDI 也没有 Web Bluetooth，只有走原生插件
 * 才能连蓝牙键盘。所以「现在在哪个平台」是输入层要先问清楚的事。
 */

export type AppPlatform = "ios" | "android" | "web";

type CapacitorGlobal = {
  isNativePlatform?: () => boolean;
  getPlatform?: () => string;
  Plugins?: Record<string, unknown>;
};

function capacitor(): CapacitorGlobal | null {
  if (typeof window === "undefined") return null;
  const candidate = (window as unknown as { Capacitor?: CapacitorGlobal }).Capacitor;
  return candidate ?? null;
}

/** 是否跑在原生壳里（Capacitor 注入的 `window.Capacitor`）。 */
export function isNativeApp(): boolean {
  const cap = capacitor();
  if (!cap) return false;
  try {
    if (typeof cap.isNativePlatform === "function") return cap.isNativePlatform() === true;
    if (typeof cap.getPlatform === "function") return cap.getPlatform() !== "web";
  } catch {
    return false;
  }
  return false;
}

/** 平台名；认不出来时一律当 web，避免把浏览器误判成原生。 */
export function appPlatform(): AppPlatform {
  const cap = capacitor();
  const name = typeof cap?.getPlatform === "function" ? cap.getPlatform() : "web";
  return name === "ios" || name === "android" ? name : "web";
}
