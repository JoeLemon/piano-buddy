import { describe, expect, it, vi, afterEach } from "vitest";
import { APP_VERSION } from "../src/version";
import { copyText, currentDiagnostics, formatDiagnostics, type DiagnosticSnapshot } from "../src/ui/diagnostics";

function snapshot(overrides: Partial<DiagnosticSnapshot> = {}): DiagnosticSnapshot {
  return {
    runtime: "App（原生）",
    platform: "android",
    secureContext: true,
    webMidiAvailable: false,
    webMidiConnected: false,
    bleChannel: "App 原生蓝牙",
    bleDevice: "YAMAHA P-125",
    locationEnabled: true,
    midiError: null,
    ...overrides,
  };
}

describe("诊断文本", () => {
  it("一行一项，第一行带版本号", () => {
    const text = formatDiagnostics(snapshot());
    const lines = text.split("\n");
    expect(lines[0]).toBe(`Piano Buddy ${APP_VERSION}`);
    expect(lines).toContain("运行环境: App（原生） / android");
    expect(lines).toContain("蓝牙通道: App 原生蓝牙");
    expect(lines).toContain("蓝牙设备: YAMAHA P-125");
    expect(lines).toContain("最近错误: 无");
  });

  it("Web MIDI 区分「不支持」与「支持但没连上」", () => {
    expect(formatDiagnostics(snapshot({ webMidiAvailable: false }))).toContain("Web MIDI: 不支持");
    expect(formatDiagnostics(snapshot({ webMidiAvailable: true }))).toContain("Web MIDI: 支持（未连接）");
    expect(formatDiagnostics(snapshot({ webMidiAvailable: true, webMidiConnected: true }))).toContain(
      "Web MIDI: 支持（已连接）",
    );
  });

  it("定位服务未知 / 关 / 开分别写清楚", () => {
    expect(formatDiagnostics(snapshot({ locationEnabled: null }))).toContain("系统定位服务: 未知");
    expect(formatDiagnostics(snapshot({ locationEnabled: false }))).toContain("系统定位服务: 已关闭");
    expect(formatDiagnostics(snapshot({ locationEnabled: true }))).toContain("系统定位服务: 已开启");
  });

  it("没连通道、没设备、有报错时如实写", () => {
    const text = formatDiagnostics(
      snapshot({ bleChannel: null, bleDevice: null, midiError: "蓝牙权限被拒绝：请到系统设置里允许本应用使用蓝牙" }),
    );
    expect(text).toContain("蓝牙通道: 不可用");
    expect(text).toContain("蓝牙设备: 无");
    expect(text).toContain("最近错误: 蓝牙权限被拒绝");
  });

  it("视口与 UA 有就带上，没有就不留空行", () => {
    const withViewport = formatDiagnostics(snapshot({ viewport: { width: 390, height: 844, dpr: 2.75 }, userAgent: "Mozilla/5.0" }));
    expect(withViewport).toContain("视口: 390×844 @2.75");
    expect(withViewport).toContain("UA: Mozilla/5.0");
    expect(formatDiagnostics(snapshot())).not.toContain("视口:");
  });
});

describe("从当前环境拼快照", () => {
  afterEach(() => {
    delete (window as unknown as { Capacitor?: unknown }).Capacitor;
  });

  it("浏览器里标成「浏览器 / web」并带上视口", () => {
    const diagnostic = currentDiagnostics({
      secureContext: true,
      webMidiAvailable: true,
      webMidiConnected: false,
      bleChannel: null,
      bleDevice: null,
      locationEnabled: null,
      midiError: null,
    });
    expect(diagnostic.runtime).toBe("浏览器");
    expect(diagnostic.platform).toBe("web");
    expect(diagnostic.viewport?.width).toBe(window.innerWidth);
  });

  it("有 Capacitor 时标成 App 与具体平台", () => {
    (window as unknown as { Capacitor?: unknown }).Capacitor = {
      isNativePlatform: () => true,
      getPlatform: () => "ios",
    };
    const diagnostic = currentDiagnostics({
      secureContext: true,
      webMidiAvailable: false,
      webMidiConnected: false,
      bleChannel: "App 原生蓝牙",
      bleDevice: null,
      locationEnabled: null,
      midiError: null,
    });
    expect(diagnostic.runtime).toBe("App（原生）");
    expect(diagnostic.platform).toBe("ios");
  });
});

describe("写剪贴板", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("成功时返回 true", async () => {
    const writeText = vi.fn(async () => {});
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    expect(await copyText("abc")).toBe(true);
    expect(writeText).toHaveBeenCalledWith("abc");
  });

  it("没有 clipboard API 时返回 false（界面要给手动复制兜底）", async () => {
    vi.stubGlobal("navigator", {});
    expect(await copyText("abc")).toBe(false);
  });

  it("写失败（权限被拒）不抛错，只返回 false", async () => {
    vi.stubGlobal("navigator", {
      clipboard: {
        writeText: async () => {
          throw new Error("NotAllowedError");
        },
      },
    });
    await expect(copyText("abc")).resolves.toBe(false);
  });
});
