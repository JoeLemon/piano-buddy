import { afterEach, describe, expect, it } from "vitest";
import {
  attachBleListener,
  bleDeviceName,
  BleMidiDecoder,
  connectBleMidi,
  disconnectBleMidi,
  noteFromMidiMessage,
  subscribeBleState,
} from "../src/midi/ble";

const MIDI_SERVICE_UUID = "03b80e5a-ede8-4b33-a751-6ce34ec4c700";
const MIDI_IO_CHAR_UUID = "7772e5db-3868-4112-a1a9-f2669d106bf3";

describe("BleMidiDecoder", () => {
  const decoder = () => new BleMidiDecoder();
  const collect = (packets: Uint8Array[]) => {
    const d = decoder();
    const out: [number, number, number][] = [];
    for (const packet of packets) {
      d.decode(packet, (status, data1, data2) => out.push([status, data1, data2]));
    }
    return out;
  };

  it("decodes a note-on with a 6-bit timestamp header", () => {
    expect(collect([Uint8Array.from([0x80, 0x90, 60, 100])])).toEqual([[0x90, 60, 100]]);
  });

  it("decodes a note-off with a 13-bit timestamp header", () => {
    expect(collect([Uint8Array.from([0xc1, 0x00, 0x80, 60, 64])])).toEqual([[0x80, 60, 64]]);
  });

  it("applies running status across consecutive messages", () => {
    expect(collect([Uint8Array.from([0x80, 0x90, 60, 100, 62, 101])])).toEqual([
      [0x90, 60, 100],
      [0x90, 62, 101],
    ]);
  });

  it("reassembles a message split across two packets", () => {
    const out = collect([Uint8Array.from([0x80, 0x90, 60]), Uint8Array.from([0x80, 100])]);
    expect(out).toEqual([[0x90, 60, 100]]);
  });

  it("handles a one-data-byte program change", () => {
    expect(collect([Uint8Array.from([0x80, 0xc0, 5])])).toEqual([[0xc0, 5, 0]]);
  });

  it("ignores a malformed header byte", () => {
    expect(collect([Uint8Array.from([0x00, 0x90, 60, 100])])).toEqual([]);
  });
});

describe("noteFromMidiMessage", () => {
  it("maps note-on, note-off, and velocity-zero note-on", () => {
    expect(noteFromMidiMessage(0x90, 60, 100)).toMatchObject({ midi: 60, kind: "on" });
    expect(noteFromMidiMessage(0x80, 60, 64)).toMatchObject({ midi: 60, kind: "off" });
    expect(noteFromMidiMessage(0x90, 60, 0)).toMatchObject({ midi: 60, kind: "off" });
  });

  it("returns null for non-note messages", () => {
    expect(noteFromMidiMessage(0xb0, 64, 127)).toBeNull();
    expect(noteFromMidiMessage(0xc0, 5, 0)).toBeNull();
  });
});

class FakeCharacteristic extends EventTarget {
  uuid = MIDI_IO_CHAR_UUID;
  value: DataView | undefined;
  properties = { notify: true } as unknown as BluetoothCharacteristicProperties;

  startNotifications(): Promise<unknown> {
    return Promise.resolve(this);
  }

  stopNotifications(): Promise<unknown> {
    return Promise.resolve(this);
  }

  notify(data: Uint8Array): void {
    const copy = data.slice();
    this.value = new DataView(copy.buffer, copy.byteOffset, copy.byteLength);
    this.dispatchEvent(new Event("characteristicvaluechanged"));
  }
}

class FakeDevice extends EventTarget {
  id = "fake-device";
  name = "测试键盘";
  characteristic = new FakeCharacteristic();

  constructor() {
    super();
    this.gatt = {
      device: this,
      connected: true,
      connect: () => Promise.resolve(this.gatt),
      disconnect: () => {
        this.gatt.connected = false;
        this.dispatchEvent(new Event("gattserverdisconnected"));
      },
      getPrimaryService: (uuid: string) => {
        expect(uuid).toBe(MIDI_SERVICE_UUID);
        return Promise.resolve({
          uuid: MIDI_SERVICE_UUID,
          device: this,
          isPrimary: true,
          getCharacteristic: (charUuid: string) => {
            expect(charUuid).toBe(MIDI_IO_CHAR_UUID);
            return Promise.resolve(this.characteristic);
          },
        } as unknown as BluetoothRemoteGATTService);
      },
    } as unknown as BluetoothRemoteGATTServer;
  }

  gatt: BluetoothRemoteGATTServer;
}

function installBluetooth(device: FakeDevice): void {
  (navigator as unknown as { bluetooth?: Bluetooth }).bluetooth = {
    getAvailability: () => Promise.resolve(true),
    requestDevice: () => Promise.resolve(device as unknown as BluetoothDevice),
  } as Bluetooth;
}

afterEach(() => {
  disconnectBleMidi();
  delete (navigator as { bluetooth?: unknown }).bluetooth;
});

describe("connectBleMidi", () => {
  it("streams decoded note events to subscribed listeners", async () => {
    const device = new FakeDevice();
    installBluetooth(device);

    const notes: { midi: number; kind: string }[] = [];
    const detach = attachBleListener((note) => notes.push({ midi: note.midi, kind: note.kind }));

    const { name } = await connectBleMidi();
    expect(name).toBe("测试键盘");

    device.characteristic.notify(Uint8Array.from([0x80, 0x90, 60, 100]));
    device.characteristic.notify(Uint8Array.from([0x80, 0x80, 60, 64]));

    expect(notes).toEqual([
      { midi: 60, kind: "on" },
      { midi: 60, kind: "off" },
    ]);

    detach();
  });

  it("clears the active session when the device disconnects", async () => {
    const device = new FakeDevice();
    installBluetooth(device);

    await connectBleMidi();
    expect(bleDeviceName()).toBe("测试键盘");

    device.gatt.disconnect();
    expect(bleDeviceName()).toBeNull();
  });

  it("reports device name changes to state subscribers", async () => {
    const device = new FakeDevice();
    installBluetooth(device);

    const names: (string | null)[] = [];
    const stop = subscribeBleState((name) => names.push(name));
    expect(names).toEqual([null]);

    await connectBleMidi();
    expect(names.at(-1)).toBe("测试键盘");

    disconnectBleMidi();
    expect(names.at(-1)).toBeNull();
    stop();
  });
});
