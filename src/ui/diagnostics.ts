import { APP_VERSION } from "../version";
import { appPlatform, isNativeApp } from "../platform";

/**
 * 诊断文本：把「在哪跑、连的什么、最近报什么错」压成一段可复制的纯文本。
 *
 * 为什么需要：真机验收（`docs/移动端-BLE接入.md` 的 6 步）目前只能人工做，
 * 而人工最容易漏的就是「我的机型 / 通道 / 报错原文」。让用户点一下复制、粘给
 * 开发者，比让他描述「连不上」有用得多。格式固定成「字段: 值」一行一项，
 * 贴进 issue 或聊天里都不用再整理。
 */
export type DiagnosticSnapshot = {
  runtime: string;
  platform: string;
  secureContext: boolean;
  webMidiAvailable: boolean;
  webMidiConnected: boolean;
  bleChannel: string | null;
  bleDevice: string | null;
  locationEnabled: boolean | null;
  midiError: string | null;
  viewport?: { width: number; height: number; dpr: number } | null;
  userAgent?: string | null;
};

export function formatDiagnostics(snapshot: DiagnosticSnapshot): string {
  const yesNo = (value: boolean) => (value ? "是" : "否");
  const webMidi = snapshot.webMidiAvailable
    ? `支持（${snapshot.webMidiConnected ? "已连接" : "未连接"}）`
    : "不支持";
  const location =
    snapshot.locationEnabled === null ? "未知" : snapshot.locationEnabled ? "已开启" : "已关闭";

  const lines = [
    `Piano Buddy ${APP_VERSION}`,
    `运行环境: ${snapshot.runtime} / ${snapshot.platform}`,
    `安全上下文: ${yesNo(snapshot.secureContext)}`,
    `Web MIDI: ${webMidi}`,
    `蓝牙通道: ${snapshot.bleChannel ?? "不可用"}`,
    `蓝牙设备: ${snapshot.bleDevice ?? "无"}`,
    `系统定位服务: ${location}`,
    `最近错误: ${snapshot.midiError ?? "无"}`,
  ];
  if (snapshot.viewport) {
    const { width, height, dpr } = snapshot.viewport;
    lines.push(`视口: ${width}×${height} @${dpr}`);
  }
  if (snapshot.userAgent) lines.push(`UA: ${snapshot.userAgent}`);
  return lines.join("\n");
}

/** 从当前环境拼快照；视口与 UA 取不到时留空，不抛错。 */
export function currentDiagnostics(
  input: Omit<DiagnosticSnapshot, "runtime" | "platform" | "viewport" | "userAgent"> & {
    /** 抽屉上显示的运行环境来自 props，这里允许覆盖，免得复制出来的和看到的不一致。 */
    runtime?: string;
    platform?: string;
  },
): DiagnosticSnapshot {
  const viewport =
    typeof window !== "undefined" && typeof window.innerWidth === "number"
      ? { width: window.innerWidth, height: window.innerHeight, dpr: window.devicePixelRatio || 1 }
      : null;
  const userAgent = typeof navigator !== "undefined" && navigator.userAgent ? navigator.userAgent : null;
  return {
    ...input,
    runtime: input.runtime ?? (isNativeApp() ? "App（原生）" : "浏览器"),
    platform: input.platform ?? appPlatform(),
    viewport,
    userAgent,
  };
}

/** 写剪贴板。WebView 里偶尔没有 clipboard API（老版本、非安全上下文），失败返回 false。 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (typeof navigator === "undefined" || !navigator.clipboard?.writeText) return false;
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
