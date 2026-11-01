import type { MidiNote } from "./types";

// Standard BLE MIDI service and I/O characteristic UUIDs (assigned by the
// Bluetooth SIG in the MIDI over BLE specification).

/**
 * Decodes MIDI-over-BLE byte packets into raw MIDI channel-voice messages.
 *
 * Each BLE notification carries one packet: a 1-byte header (with a 6- or
 * 13-bit timestamp), followed by one or more MIDI messages that may omit the
 * status byte via running status, and may be split across packet boundaries.
 *
 * 与传输通道无关：Web Bluetooth 和原生插件送来的都是同一种字节流，所以
 * 解码器只有这一份。
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
