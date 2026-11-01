/**
 * BLE MIDI 的传输层契约。
 *
 * 同一个 BLE MIDI 键盘，在桌面浏览器里只能走 Web Bluetooth，在 App 里只能走
 * Capacitor 的原生 BLE 插件（iOS WebView 两条 Web API 都没有）。上层
 * （`ble.ts` 的会话、解码、事件分发）不应该知道自己跑在哪，所以把它收成
 * 「一个能吐字节流的连接」。
 */

/** Standard BLE MIDI service / I/O characteristic (Bluetooth SIG). */
export const MIDI_SERVICE_UUID = "03b80e5a-ede8-4b33-a751-6ce34ec4c700";
export const MIDI_IO_CHARACTERISTIC_UUID = "7772e5db-3868-4112-a1a9-f2669d106bf3";

export type BleTransportId = "capacitor-ble" | "web-bluetooth";

/** 已建立的连接。`disconnect()` 必须可重复调用（幂等）。 */
export type BleMidiLink = {
  name: string;
  disconnect: () => void;
};

export type BleConnectHandlers = {
  /** BLE MIDI 原始包，交给 `BleMidiDecoder` 解。 */
  onPacket: (bytes: Uint8Array) => void;
  /** 设备侧断开（关琴、走远、系统断链）。上层据此清空会话。 */
  onLost: () => void;
};

export type BleMidiTransport = {
  id: BleTransportId;
  /** 诊断面板上显示的名字。 */
  label: string;
  /** 同步判断：当前环境能不能用这条通道。 */
  isSupported: () => boolean;
  /**
   * 拉起连接。**必须由用户手势直接触发**（浏览器与 iOS 都要求），
   * 选择器/授权框会在这里弹出来。
   */
  connect: (handlers: BleConnectHandlers) => Promise<BleMidiLink>;
};

/**
 * 输入层对外统一的错误码。UI 只认这些码，不认浏览器/插件各说各话的
 * `DOMException.name` 或原生错误文案。
 */
export type BleErrorCode =
  | "ble-unavailable"
  | "ble-cancelled"
  | "ble-no-device"
  | "ble-no-midi-service"
  | "ble-permission"
  | "ble-connect-failed";

export function bleError(code: BleErrorCode, detail?: string): Error {
  const error = new Error(detail ? `${code}: ${detail}` : code);
  error.name = code;
  return error;
}
