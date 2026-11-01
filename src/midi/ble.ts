import { BleMidiDecoder, noteFromMidiMessage } from "./bleCodec";
import { nativeBleTransport } from "./bleNative";
import { bleError, type BleMidiLink, type BleMidiTransport, type BleTransportId } from "./bleTransport";
import { webBleTransport } from "./bleWeb";
import type { MidiNote } from "./types";

export { BleMidiDecoder, noteFromMidiMessage } from "./bleCodec";
export { MIDI_IO_CHARACTERISTIC_UUID, MIDI_SERVICE_UUID } from "./bleTransport";
export type { BleTransportId } from "./bleTransport";

/**
 * BLE MIDI 会话层：选通道 → 建连 → 解码 → 分发给订阅者。
 *
 * 通道只有两条，优先级是「原生优先」：
 *  - `capacitor-ble`：App 内可用（iOS / Android WebView 都没有 Web Bluetooth）；
 *  - `web-bluetooth`：浏览器内可用（桌面 Chrome/Edge、Android Chrome）。
 *
 * 本模块不认识 DOM，也不认识 Capacitor；两条通道的差异都关在各自的
 * transport 里，所以「解码与事件分发」只有一份实现、一套测试口径。
 */

const noteListeners = new Set<(note: MidiNote) => void>();
const stateListeners = new Set<(deviceName: string | null) => void>();

/** 按优先级排列的候选通道。 */
function transports(): readonly BleMidiTransport[] {
  return [nativeBleTransport, webBleTransport];
}

/** 当前环境实际会用的通道；都不支持时为 null。 */
export function bleTransport(): BleMidiTransport | null {
  return transports().find((transport) => transport.isSupported()) ?? null;
}

export function bleTransportId(): BleTransportId | null {
  return bleTransport()?.id ?? null;
}

/** 诊断面板用的一句话，例如「App 原生蓝牙」。 */
export function bleTransportLabel(): string | null {
  return bleTransport()?.label ?? null;
}

export function isBleSupported(): boolean {
  return bleTransport() !== null;
}

export function attachBleListener(listener: (note: MidiNote) => void): () => void {
  noteListeners.add(listener);
  return () => {
    noteListeners.delete(listener);
  };
}

export function subscribeBleState(listener: (deviceName: string | null) => void): () => void {
  stateListeners.add(listener);
  listener(activeSession?.name ?? null);
  return () => {
    stateListeners.delete(listener);
  };
}

function forwardBleNote(note: MidiNote): void {
  for (const listener of noteListeners) listener(note);
}

function emitBleState(): void {
  const name = activeSession?.name ?? null;
  for (const listener of stateListeners) listener(name);
}

function emitBleMidi(status: number, data1: number, data2: number): void {
  const note = noteFromMidiMessage(status, data1, data2);
  if (note) forwardBleNote(note);
}

type BleSession = { name: string; link: BleMidiLink; transport: BleTransportId };

let activeSession: BleSession | null = null;
/** 连接序号：并行连接时只让最后一次尝试生效。 */
let connectAttempt = 0;

export function bleDeviceName(): string | null {
  return activeSession?.name ?? null;
}

/** 当前连接的通道；未连接时为 null。 */
export function activeBleTransportId(): BleTransportId | null {
  return activeSession?.transport ?? null;
}

export function disconnectBleMidi(): void {
  const current = activeSession;
  activeSession = null;
  current?.link.disconnect();
  emitBleState();
}

/**
 * Requests a BLE MIDI device and streams its note events to all registered
 * listeners. Must be called from a user gesture (button tap / click).
 */
export async function connectBleMidi(): Promise<{ name: string }> {
  const transport = bleTransport();
  if (!transport) throw bleError("ble-unavailable");

  // 连点两下「连接」会并行起两条链路：只让最后发起的那条落地，
  // 先到的那条连上后立刻收掉，避免留下一个没人管的会话。
  const attempt = ++connectAttempt;
  disconnectBleMidi();

  const decoder = new BleMidiDecoder();
  let link: BleMidiLink | null = null;
  let lostBeforeReady = false;

  const created = await transport.connect({
    onPacket: (bytes) => decoder.decode(bytes, emitBleMidi),
    onLost: () => {
      lostBeforeReady = true;
      // 只有「当前这条」断开才清会话：用户换了设备时，旧链路的断开通知
      // 会晚到一步，不能把新连接一起清掉。
      if (!link || activeSession?.link !== link) return;
      activeSession = null;
      link.disconnect();
      emitBleState();
    },
  });
  link = created;

  if (attempt !== connectAttempt) {
    created.disconnect();
    throw bleError("ble-cancelled", "superseded by a newer attempt");
  }
  // 连上的一瞬间设备就掉了（iOS 上偶发）：别把死链路登记成「已连接」。
  if (lostBeforeReady) {
    created.disconnect();
    throw bleError("ble-connect-failed", "device disconnected right after connecting");
  }

  activeSession = { name: created.name, link: created, transport: transport.id };
  emitBleState();
  return { name: created.name };
}

/**
 * 把输入层的错误码翻成给用户看的一句话；不是 BLE 错误时返回 null，
 * 交给调用方自己的兜底文案。
 */
export function bleErrorMessage(error: unknown): string | null {
  if (!(error instanceof Error)) return null;
  switch (error.name) {
    case "ble-unavailable":
      return "当前环境没有可用的蓝牙通道：iOS 请用 App 版，浏览器请用桌面 Chrome/Edge";
    case "ble-cancelled":
      return "连接已取消";
    case "ble-no-device":
      return "没找到设备：请让键盘进入配对模式（指示灯闪烁）后重试";
    case "ble-no-midi-service":
      return "这台设备没有 BLE MIDI 服务：确认键盘处于 BLE MIDI 模式（不是普通蓝牙音频）";
    case "ble-permission":
      return "蓝牙权限被拒绝：请到系统设置里允许本应用使用蓝牙";
    case "ble-connect-failed":
      return error.message.replace(/^ble-connect-failed:\s*/, "") || "连接失败，请重试";
    default:
      return null;
  }
}
