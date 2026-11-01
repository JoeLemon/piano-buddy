import { isNativeApp } from "../platform";
import {
  bleError,
  MIDI_IO_CHARACTERISTIC_UUID,
  MIDI_SERVICE_UUID,
  type BleMidiLink,
  type BleMidiTransport,
} from "./bleTransport";

/**
 * App（Capacitor）内的 BLE MIDI 通道，走 `@capacitor-community/bluetooth-le`。
 *
 * 为什么需要它：iOS 的 WKWebView 既没有 `navigator.requestMIDIAccess`，也没有
 * `navigator.bluetooth`；Android WebView 同样没有 Web Bluetooth。所以 App 版
 * 想连蓝牙键盘，只能由原生插件把 GATT 通知转成字节流送进来——解码仍复用
 * `BleMidiDecoder`，和浏览器那条路完全一致。
 */

export type NativeBleDevice = {
  deviceId: string;
  name?: string;
  uuids?: string[];
};

export type NativeBlePlugin = {
  BleClient: {
    initialize(options?: { androidNeverForLocation?: boolean }): Promise<void>;
    requestDevice(options?: {
      services?: string[];
      optionalServices?: string[];
      namePrefix?: string;
      displayMode?: "alert" | "list";
    }): Promise<NativeBleDevice>;
    connect(
      deviceId: string,
      onDisconnect?: (deviceId: string) => void,
      options?: { timeout?: number; services?: string[] },
    ): Promise<void>;
    startNotifications(
      deviceId: string,
      service: string,
      characteristic: string,
      callback: (value: DataView) => void,
      options?: { timeout?: number },
    ): Promise<void>;
    stopNotifications(deviceId: string, service: string, characteristic: string): Promise<void>;
    disconnect(deviceId: string): Promise<void>;
  };
};

/**
 * 插件按需加载：Web 构建里这条代码路径永远不会执行，测试里换成假插件，
 * 因此单测不需要真的装原生依赖、也不需要真机。
 */
async function importPlugin(): Promise<NativeBlePlugin> {
  const module = (await import("@capacitor-community/bluetooth-le")) as unknown as NativeBlePlugin;
  return module;
}

let loadPlugin: () => Promise<NativeBlePlugin> = importPlugin;

/** 测试/自动化用：替换插件实现。传 `null` 恢复真实插件。 */
export function setNativeBlePlugin(plugin: NativeBlePlugin | null): void {
  loadPlugin = plugin ? async () => plugin : importPlugin;
}

/** 原生通道只在 App 里成立；浏览器里 `window.Capacitor` 不存在。 */
export function isNativeBleSupported(): boolean {
  return isNativeApp();
}

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "message" in error) return String((error as { message: unknown }).message);
  return "";
}

function normalizeNativeBleError(error: unknown): Error {
  const message = messageOf(error);
  if (/cancel/i.test(message)) return bleError("ble-cancelled", message);
  if (/not found|no device|timeout/i.test(message)) return bleError("ble-no-device", message);
  if (/denied|permission|unauthor/i.test(message)) return bleError("ble-permission", message);
  if (/not supported|unsupported|unavailable|disabled/i.test(message)) return bleError("ble-unavailable", message);
  if (/service .*not found|no service/i.test(message)) return bleError("ble-no-midi-service", message);
  return bleError("ble-connect-failed", message);
}

function toBytes(value: DataView): Uint8Array {
  return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
}

export const nativeBleTransport: BleMidiTransport = {
  id: "capacitor-ble",
  label: "App 原生蓝牙",
  isSupported: isNativeBleSupported,

  async connect({ onPacket, onLost }): Promise<BleMidiLink> {
    if (!isNativeBleSupported()) throw bleError("ble-unavailable", "not a native app");

    let client: NativeBlePlugin["BleClient"];
    try {
      client = (await loadPlugin()).BleClient;
    } catch (error) {
      throw bleError("ble-unavailable", messageOf(error) || "bluetooth-le plugin missing");
    }
    if (!client) throw bleError("ble-unavailable", "bluetooth-le plugin missing");

    try {
      // androidNeverForLocation：Android 12+ 只要声明不使用扫描结果推断位置，
      // 就不再需要定位权限（对应 AndroidManifest 的 neverForLocation 标记）。
      await client.initialize({ androidNeverForLocation: true });
    } catch (error) {
      throw normalizeNativeBleError(error);
    }

    const device = await requestMidiDevice(client);
    const name = device.name?.trim() || "蓝牙 MIDI 键盘";

    let disconnected = false;
    const stopNativeSide = () => {
      void client.stopNotifications(device.deviceId, MIDI_SERVICE_UUID, MIDI_IO_CHARACTERISTIC_UUID).catch(() => {});
      void client.disconnect(device.deviceId).catch(() => {});
    };

    try {
      // 只发现 MIDI 服务：iOS 上能明显缩短连接时间（默认要把所有服务都扫一遍）。
      await client.connect(
        device.deviceId,
        () => {
          if (disconnected) return;
          disconnected = true;
          onLost();
        },
        { services: [MIDI_SERVICE_UUID], timeout: 10_000 },
      );
    } catch (error) {
      throw normalizeNativeBleError(error);
    }

    try {
      await client.startNotifications(
        device.deviceId,
        MIDI_SERVICE_UUID,
        MIDI_IO_CHARACTERISTIC_UUID,
        (value) => onPacket(toBytes(value)),
      );
    } catch (error) {
      stopNativeSide();
      throw normalizeNativeBleError(error);
    }

    let stopped = false;
    return {
      name,
      disconnect: () => {
        if (stopped) return;
        stopped = true;
        disconnected = true;
        stopNativeSide();
      },
    };
  },
};

/**
 * 先按 MIDI 服务过滤扫描；一台都没找到时再不加过滤扫一次。
 *
 * 和 Web 那条路同因：有些键盘配对之后广播里只剩名字、不带服务列表，
 * 只按服务过滤会让它在选择框里消失。这里第二次扫描仍由用户在选择框里
 * 挑设备，不会静默连到别的设备上。
 */
async function requestMidiDevice(client: NativeBlePlugin["BleClient"]): Promise<NativeBleDevice> {
  try {
    return await client.requestDevice({
      services: [MIDI_SERVICE_UUID],
      optionalServices: [MIDI_SERVICE_UUID],
      displayMode: "list",
    });
  } catch (error) {
    const normalized = normalizeNativeBleError(error);
    if (normalized.name !== "ble-no-device") throw normalized;
    try {
      return await client.requestDevice({ services: [], displayMode: "list" });
    } catch (retryError) {
      throw normalizeNativeBleError(retryError);
    }
  }
}
