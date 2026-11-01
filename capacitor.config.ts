import type { CapacitorConfig } from "@capacitor/cli";

/**
 * Capacitor 壳配置（App 版）。
 *
 * 为什么需要 App 版：iOS 的 WKWebView 没有 Web MIDI，也没有 Web Bluetooth，
 * 蓝牙键盘只能由原生 BLE 插件接入（见 `src/midi/bleNative.ts`）。
 *
 * 构建流程：
 *   npm run build          # 先出 dist/（webDir 必须存在）
 *   npm run cap:sync       # 把 dist 与插件同步进原生工程
 *   npm run cap:android    # 用 Android Studio 打开 android/
 */
const config: CapacitorConfig = {
  appId: "app.pianobuddy.mobile",
  appName: "Piano Buddy",
  webDir: "dist",
  // App 内没有地址栏，用 https scheme 才能拿到 secure context（Web Audio、
  // Crypto.subtle 校验 checksum 都要求它）。
  server: {
    androidScheme: "https",
  },
  ios: {
    // 让 WKWebView 自己处理安全区，配合 CSS 的 env(safe-area-inset-*)。
    contentInset: "always",
    backgroundColor: "#132f28",
  },
  android: {
    backgroundColor: "#132f28",
  },
};

export default config;
