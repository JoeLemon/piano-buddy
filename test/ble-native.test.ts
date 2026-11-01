import { afterEach, describe, expect, it } from "vitest";
import {
  attachBleListener,
  bleDeviceName,
  bleErrorMessage,
  bleTransportId,
  connectBleMidi,
  disconnectBleMidi,
  isBleSupported,
} from "../src/midi/ble";
import { setNativeBlePlugin, type NativeBlePlugin } from "../src/midi/bleNative";
import { appPlatform, isNativeApp } from "../src/platform";

const MIDI_SERVICE_UUID = "03b80e5a-ede8-4b33-a751-6ce34ec4c700";
const MIDI_IO_CHAR_UUID = "7772e5db-3868-4112-a1a9-f2669d106bf3";

type Call = { method: string; args: unknown[] };

/** 假的原生插件：只记录调用、把 startNotifications 的 callback 留给测试触发。 */
function fakePlugin(
  options: {
    devices?: { deviceId: string; name?: string }[];
    failFirstScan?: boolean;
    /** connect() 立刻回报掉线（模拟 iOS 上「连上就掉」）。 */
    loseOnConnect?: boolean;
    /** connect() 挂起，由 release() 手动放行，用来测并行连接。 */
    holdConnect?: boolean;
  } = {},
) {
  const calls: Call[] = [];
  let notify: ((value: DataView) => void) | null = null;
  let onDisconnect: ((deviceId: string) => void) | null = null;
  let disconnectCalls = 0;
  let scanAttempts = 0;
  const pending: (() => void)[] = [];

  const client: NativeBlePlugin["BleClient"] = {
    async initialize(opts) {
      calls.push({ method: "initialize", args: [opts] });
    },
    async requestDevice(opts) {
      scanAttempts += 1;
      calls.push({ method: "requestDevice", args: [opts] });
      if (options.failFirstScan && scanAttempts === 1) throw new Error("No device found");
      return options.devices?.[0] ?? { deviceId: "dev-1", name: "测试键盘", uuids: [MIDI_SERVICE_UUID] };
    },
    connect(deviceId, callback, opts) {
      calls.push({ method: "connect", args: [deviceId, opts] });
      onDisconnect = callback ?? null;
      if (options.holdConnect) {
        return new Promise<void>((resolve) => pending.push(resolve));
      }
      if (options.loseOnConnect) callback?.(deviceId);
      return Promise.resolve();
    },
    async startNotifications(deviceId, service, characteristic, callback) {
      calls.push({ method: "startNotifications", args: [deviceId, service, characteristic] });
      notify = callback;
    },
    async stopNotifications(deviceId, service, characteristic) {
      calls.push({ method: "stopNotifications", args: [deviceId, service, characteristic] });
    },
    async disconnect(deviceId) {
      disconnectCalls += 1;
      calls.push({ method: "disconnect", args: [deviceId] });
    },
  };

  return {
    plugin: { BleClient: client } as NativeBlePlugin,
    calls,
    get disconnectCalls() {
      return disconnectCalls;
    },
    push(bytes: number[]) {
      const data = Uint8Array.from(bytes);
      notify?.(new DataView(data.buffer, data.byteOffset, data.byteLength));
    },
    loseDevice() {
      onDisconnect?.("dev-1");
    },
    /** 放行第 index 个被 holdConnect 挂起的连接。 */
    release(index = 0) {
      pending[index]?.();
    },
    get pendingCount() {
      return pending.length;
    },
  };
}

/** 等两条连接都真正走到插件 connect()（前面的动态加载与 requestDevice 是异步的）。 */
async function waitForPending(fake: { pendingCount: number }, expected = 2): Promise<void> {
  for (let i = 0; i < 50 && fake.pendingCount < expected; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  expect(fake.pendingCount).toBe(expected);
}

function enterNativeApp(platform: "ios" | "android" = "ios"): void {
  (window as unknown as { Capacitor?: unknown }).Capacitor = {
    isNativePlatform: () => true,
    getPlatform: () => platform,
  };
}

afterEach(() => {
  disconnectBleMidi();
  setNativeBlePlugin(null);
  delete (window as { Capacitor?: unknown }).Capacitor;
  delete (navigator as { bluetooth?: unknown }).bluetooth;
});

describe("platform", () => {
  it("treats a plain browser as web", () => {
    expect(isNativeApp()).toBe(false);
    expect(appPlatform()).toBe("web");
  });

  it("reads the platform Capacitor injects", () => {
    enterNativeApp("android");
    expect(isNativeApp()).toBe(true);
    expect(appPlatform()).toBe("android");
  });
});

describe("native BLE transport", () => {
  it("prefers the native transport inside the app", () => {
    enterNativeApp();
    setNativeBlePlugin(fakePlugin().plugin);

    expect(isBleSupported()).toBe(true);
    expect(bleTransportId()).toBe("capacitor-ble");
  });

  it("keeps Web Bluetooth for browsers", () => {
    (navigator as unknown as { bluetooth?: unknown }).bluetooth = {
      requestDevice: () => Promise.resolve(null),
    };
    expect(bleTransportId()).toBe("web-bluetooth");
  });

  it("streams decoded notes from the native plugin", async () => {
    enterNativeApp();
    const fake = fakePlugin();
    setNativeBlePlugin(fake.plugin);

    const notes: { midi: number; kind: string }[] = [];
    const detach = attachBleListener((note) => notes.push({ midi: note.midi, kind: note.kind }));

    const { name } = await connectBleMidi();
    expect(name).toBe("测试键盘");
    expect(bleDeviceName()).toBe("测试键盘");

    fake.push([0x80, 0x90, 60, 100]);
    fake.push([0x80, 0x80, 60, 64]);

    expect(notes).toEqual([
      { midi: 60, kind: "on" },
      { midi: 60, kind: "off" },
    ]);
    detach();
  });

  it("asks for the MIDI service and pins the connection to it", async () => {
    enterNativeApp();
    const fake = fakePlugin();
    setNativeBlePlugin(fake.plugin);

    await connectBleMidi();

    const request = fake.calls.find((call) => call.method === "requestDevice");
    expect(request?.args[0]).toMatchObject({ services: [MIDI_SERVICE_UUID] });
    const connect = fake.calls.find((call) => call.method === "connect");
    expect(connect?.args[1]).toMatchObject({ services: [MIDI_SERVICE_UUID] });
    const notify = fake.calls.find((call) => call.method === "startNotifications");
    expect(notify?.args).toEqual(["dev-1", MIDI_SERVICE_UUID, MIDI_IO_CHAR_UUID]);
  });

  it("retries without a service filter when the filtered scan finds nothing", async () => {
    enterNativeApp();
    const fake = fakePlugin({ failFirstScan: true });
    setNativeBlePlugin(fake.plugin);

    await connectBleMidi();

    const scans = fake.calls.filter((call) => call.method === "requestDevice");
    expect(scans).toHaveLength(2);
    expect(scans[1].args[0]).toMatchObject({ services: [] });
  });

  it("stops notifications and disconnects on disconnectBleMidi", async () => {
    enterNativeApp();
    const fake = fakePlugin();
    setNativeBlePlugin(fake.plugin);

    await connectBleMidi();
    disconnectBleMidi();

    expect(fake.calls.some((call) => call.method === "stopNotifications")).toBe(true);
    expect(fake.disconnectCalls).toBe(1);
    expect(bleDeviceName()).toBeNull();
  });

  it("clears the session when the device walks away", async () => {
    enterNativeApp();
    const fake = fakePlugin();
    setNativeBlePlugin(fake.plugin);

    await connectBleMidi();
    fake.loseDevice();

    expect(bleDeviceName()).toBeNull();
  });

  it("ignores the late disconnect of a replaced device", async () => {
    enterNativeApp();
    const first = fakePlugin({ devices: [{ deviceId: "dev-1", name: "旧键盘" }] });
    setNativeBlePlugin(first.plugin);
    await connectBleMidi();

    const second = fakePlugin({ devices: [{ deviceId: "dev-2", name: "新键盘" }] });
    setNativeBlePlugin(second.plugin);
    await connectBleMidi();

    first.loseDevice();
    expect(bleDeviceName()).toBe("新键盘");
  });

  it("refuses to register a link that dies right after connecting", async () => {
    enterNativeApp();
    setNativeBlePlugin(fakePlugin({ loseOnConnect: true }).plugin);

    await expect(connectBleMidi()).rejects.toMatchObject({ name: "ble-connect-failed" });
    expect(bleDeviceName()).toBeNull();
  });

  it("keeps only the newest of two overlapping connects", async () => {
    enterNativeApp();
    const fake = fakePlugin({ holdConnect: true });
    setNativeBlePlugin(fake.plugin);

    const first = connectBleMidi();
    const second = connectBleMidi();
    // connectBleMidi 里先 await 插件加载与扫描，稍等一拍再放行
    await waitForPending(fake);

    fake.release(1);
    await expect(second).resolves.toMatchObject({ name: "测试键盘" });

    fake.release(0);
    await expect(first).rejects.toMatchObject({ name: "ble-cancelled" });
    // 后到的那条仍是当前会话，先到的已经被收掉
    expect(bleDeviceName()).toBe("测试键盘");
    expect(fake.disconnectCalls).toBe(1);
  });

  it("falls back to a default name when the device reports none", async () => {
    enterNativeApp();
    setNativeBlePlugin(fakePlugin({ devices: [{ deviceId: "dev-3" }] }).plugin);

    const { name } = await connectBleMidi();
    expect(name).toBe("蓝牙 MIDI 键盘");
  });

  it("maps permission errors to a readable message", async () => {
    enterNativeApp();
    const plugin: NativeBlePlugin = {
      BleClient: {
        initialize: () => Promise.reject(new Error("Permission denied")),
        requestDevice: () => Promise.reject(new Error("unreachable")),
        connect: () => Promise.resolve(),
        startNotifications: () => Promise.resolve(),
        stopNotifications: () => Promise.resolve(),
        disconnect: () => Promise.resolve(),
      },
    };
    setNativeBlePlugin(plugin);

    await expect(connectBleMidi()).rejects.toMatchObject({ name: "ble-permission" });
    const error = await connectBleMidi().catch((reason: unknown) => reason);
    expect(bleErrorMessage(error)).toContain("蓝牙权限被拒绝");
  });

  it("reports ble-unavailable when the plugin cannot be loaded", async () => {
    enterNativeApp();
    setNativeBlePlugin({
      get BleClient() {
        throw new Error("plugin missing");
      },
    } as unknown as NativeBlePlugin);

    await expect(connectBleMidi()).rejects.toMatchObject({ name: "ble-unavailable" });
  });

  it("reports ble-unavailable outside the app and the browser", async () => {
    expect(isBleSupported()).toBe(false);
    await expect(connectBleMidi()).rejects.toMatchObject({ name: "ble-unavailable" });
  });
});
