import {
  bleError,
  MIDI_IO_CHARACTERISTIC_UUID,
  MIDI_SERVICE_UUID,
  type BleMidiLink,
  type BleMidiTransport,
} from "./bleTransport";

/**
 * 桌面浏览器（Chrome / Edge，桌面与 Android）上的 BLE MIDI 通道。
 *
 * Windows 的 BLE MIDI 只经 WinRT 暴露，Chrome 的 Web MIDI（底层 winmm）看不到，
 * 所以桌面上想连蓝牙键盘只能走这条。
 */
export function isWebBluetoothSupported(): boolean {
  return typeof navigator !== "undefined" && typeof navigator.bluetooth?.requestDevice === "function";
}

function normalizeWebBleError(error: unknown): Error {
  if (!(error instanceof Error)) return bleError("ble-connect-failed", String(error));
  const message = error.message || "";
  if (/cancel/i.test(message)) return bleError("ble-cancelled", message);
  if (error.name === "NotFoundError") return bleError("ble-no-device", message);
  if (error.name === "SecurityError" || error.name === "NotAllowedError") {
    return bleError("ble-permission", message);
  }
  if (/not supported|unsupported/i.test(message)) return bleError("ble-unavailable", message);
  if (/no services|service .* not found/i.test(message)) return bleError("ble-no-midi-service", message);
  return bleError("ble-connect-failed", message || error.name);
}

export const webBleTransport: BleMidiTransport = {
  id: "web-bluetooth",
  label: "浏览器 Web Bluetooth",
  isSupported: isWebBluetoothSupported,

  async connect({ onPacket, onLost }): Promise<BleMidiLink> {
    const bluetooth = navigator.bluetooth;
    if (!bluetooth || typeof bluetooth.requestDevice !== "function") {
      throw bleError("ble-unavailable", "navigator.bluetooth");
    }

    // acceptAllDevices: some BLE MIDI keyboards advertise only their name (or a
    // trimmed service list) once paired, so filtering by the MIDI service UUID
    // can hide them from the chooser. Listing every BLE device is more reliable;
    // optionalServices still grants access to the MIDI service after selection.
    let device: BluetoothDevice;
    try {
      device = await bluetooth.requestDevice({
        acceptAllDevices: true,
        optionalServices: [MIDI_SERVICE_UUID],
      });
    } catch (error) {
      throw normalizeWebBleError(error);
    }

    if (!device.gatt) throw bleError("ble-connect-failed", "device has no GATT server");

    let characteristic: BluetoothRemoteGATTCharacteristic;
    let server: BluetoothRemoteGATTServer;
    try {
      server = await device.gatt.connect();
      const service = await server.getPrimaryService(MIDI_SERVICE_UUID);
      characteristic = await service.getCharacteristic(MIDI_IO_CHARACTERISTIC_UUID);
      await characteristic.startNotifications();
    } catch (error) {
      throw normalizeWebBleError(error);
    }

    const onChanged = (event: Event) => {
      const value = (event.target as BluetoothRemoteGATTCharacteristic).value;
      if (!value) return;
      onPacket(new Uint8Array(value.buffer, value.byteOffset, value.byteLength));
    };
    characteristic.addEventListener("characteristicvaluechanged", onChanged);

    let stopped = false;
    const stop = () => {
      if (stopped) return;
      stopped = true;
      characteristic.removeEventListener("characteristicvaluechanged", onChanged);
      device.removeEventListener("gattserverdisconnected", handleDisconnected);
      void characteristic.stopNotifications().catch(() => {});
      if (server.connected) server.disconnect();
    };

    function handleDisconnected(): void {
      // 设备侧断开：先通知上层清会话，再收尾本地资源。
      stop();
      onLost();
    }

    device.addEventListener("gattserverdisconnected", handleDisconnected);

    return {
      name: device.name ?? "蓝牙 MIDI 键盘",
      disconnect: stop,
    };
  },
};
