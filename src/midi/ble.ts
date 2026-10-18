import type { MidiNote } from "./types";

// Standard BLE MIDI service and I/O characteristic UUIDs (assigned by the
// Bluetooth SIG in the MIDI over BLE specification).
const MIDI_SERVICE_UUID = "03b80e5a-ede8-4b33-a751-6ce34ec4c700";
const MIDI_IO_CHARACTERISTIC_UUID = "7772e5db-3868-4112-a1a9-f2669d106bf3";

/**
 * Decodes MIDI-over-BLE byte packets into raw MIDI channel-voice messages.
 *
 * Each BLE notification carries one packet: a 1-byte header (with a 6- or
 * 13-bit timestamp), followed by one or more MIDI messages that may omit the
 * status byte via running status, and may be split across packet boundaries.
 */
export class BleMidiDecoder {
  private runningStatus = 0;
  private pending: number[] = [];
  private inSysex = false;

  decode(input: Uint8Array, onMessage: (status: number, data1: number, data2: number) => void): void {
    if (input.length === 0) return;

    const header = input[0];
    if ((header & 0x80) === 0) return; // malformed header

    // Timestamp: 6-bit when bit 6 is clear, otherwise 13-bit (one extra byte).
    let index = 1;
    if ((header & 0x40) !== 0) index = 2;
    if (index > input.length) return;

    for (; index < input.length; index++) {
      const byte = input[index];

      if (this.inSysex) {
        if (byte === 0xf7) this.inSysex = false;
        continue;
      }

      if ((byte & 0x80) !== 0) {
        // Status byte.
        if (byte === 0xf0) {
          this.inSysex = true;
          this.runningStatus = 0;
          this.pending = [];
          continue;
        }
        if (byte === 0xf7) continue; // stray end-of-sysex
        if (byte >= 0xf8) continue; // system real-time, single byte, keeps running status
        this.runningStatus = byte;
        this.pending = [];
      } else {
        // Data byte, decoded under the current running status.
        this.pending.push(byte);
        this.tryEmit(onMessage);
      }
    }
  }

  private tryEmit(onMessage: (status: number, data1: number, data2: number) => void): void {
    const status = this.runningStatus;
    const type = status & 0xf0;
    if (type === 0xc0 || type === 0xd0) {
      // Program change / channel pressure: one data byte.
      if (this.pending.length >= 1) {
        onMessage(status, this.pending[0], 0);
        this.pending = [];
      }
    } else if (type === 0x80 || type === 0x90 || type === 0xa0 || type === 0xb0 || type === 0xe0) {
      // Note on/off, poly pressure, control change, pitch bend: two data bytes.
      if (this.pending.length >= 2) {
        onMessage(status, this.pending[0], this.pending[1]);
        this.pending = [];
      }
    }
  }
}

/** Maps a raw channel-voice message to a note event, or null when irrelevant. */
export function noteFromMidiMessage(status: number, data1: number, data2: number): MidiNote | null {
  const kind = status & 0xf0;
  const timeMs = performance.now();
  if (kind === 0x90 && data2 > 0) {
    return { midi: data1, timeMs, kind: "on" };
  }
  if (kind === 0x80 || (kind === 0x90 && data2 === 0)) {
    return { midi: data1, timeMs, kind: "off" };
  }
  return null;
}

const noteListeners = new Set<(note: MidiNote) => void>();
const stateListeners = new Set<(deviceName: string | null) => void>();

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

type BleSession = { name: string; stop: () => void };

let activeSession: BleSession | null = null;

export function isBleSupported(): boolean {
  return typeof navigator !== "undefined" && typeof navigator.bluetooth?.requestDevice === "function";
}

export function bleDeviceName(): string | null {
  return activeSession?.name ?? null;
}

export function disconnectBleMidi(): void {
  const current = activeSession;
  activeSession = null;
  current?.stop();
  emitBleState();
}

/**
 * Requests a BLE MIDI device and streams its note events to all registered
 * listeners. Must be called from a user gesture (button tap / click).
 */
export async function connectBleMidi(): Promise<{ name: string }> {
  if (!isBleSupported()) throw new Error("ble-unavailable");

  disconnectBleMidi();

  // acceptAllDevices: some BLE MIDI keyboards advertise only their name (or a
  // trimmed service list) once paired, so filtering by the MIDI service UUID
  // can hide them from the chooser. Listing every BLE device is more reliable;
  // optionalServices still grants access to the MIDI service after selection.
  const device = await navigator.bluetooth!.requestDevice({
    acceptAllDevices: true,
    optionalServices: [MIDI_SERVICE_UUID],
  });
  if (!device.gatt) throw new Error("ble-no-gatt");

  const server = await device.gatt.connect();
  const service = await server.getPrimaryService(MIDI_SERVICE_UUID);
  const characteristic = await service.getCharacteristic(MIDI_IO_CHARACTERISTIC_UUID);
  await characteristic.startNotifications();

  const decoder = new BleMidiDecoder();
  const onChanged = (event: Event) => {
    const value = (event.target as BluetoothRemoteGATTCharacteristic).value;
    if (!value) return;
    const bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    decoder.decode(bytes, emitBleMidi);
  };
  characteristic.addEventListener("characteristicvaluechanged", onChanged);

  let stopped = false;
  const session: BleSession = {
    name: device.name ?? "蓝牙 MIDI 键盘",
    stop: () => {
      if (stopped) return;
      stopped = true;
      characteristic.removeEventListener("characteristicvaluechanged", onChanged);
      device.removeEventListener("gattserverdisconnected", onGattDisconnected);
      void characteristic.stopNotifications().catch(() => {});
      if (server.connected) server.disconnect();
    },
  };

  const onGattDisconnected = () => {
    if (activeSession === session) {
      activeSession = null;
      session.stop();
      emitBleState();
    }
  };
  device.addEventListener("gattserverdisconnected", onGattDisconnected);

  activeSession = session;
  emitBleState();
  return { name: session.name };
}
