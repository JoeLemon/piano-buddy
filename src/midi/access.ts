import { attachBleListener } from "./ble";
import { attachKeyboardListener } from "./keyboard";
import type { MidiNote } from "./types";

export type { MidiNote } from "./types";
export {
  connectBleMidi,
  disconnectBleMidi,
  isBleSupported,
  subscribeBleState,
  bleDeviceName,
} from "./ble";
export {
  MIDI_TO_KEY,
  keyCapFor,
  keyboardMode,
  setKeyboardMode,
  toggleKeyboardMode,
} from "./keyboard";

/**
 * Subscribes to incoming note events from every connected MIDI source.
 *
 * The Web MIDI API (navigator.requestMIDIAccess) covers USB and BLE MIDI on
 * desktop Chrome/Edge. Where that API is missing (iOS Safari, Android Chrome),
 * the subscription silently falls back to Bluetooth-only delivery via the BLE
 * session managed in `ble.ts`. In simulation mode the computer keyboard is
 * treated as one more note source.
 */
export async function subscribeMidi(onNote: (note: MidiNote) => void): Promise<() => void> {
  const detachBle = attachBleListener(onNote);
  const detachKeyboard = attachKeyboardListener(onNote);

  if (typeof navigator === "undefined" || typeof navigator.requestMIDIAccess !== "function") {
    return () => {
      detachBle();
      detachKeyboard();
    };
  }

  let access: MIDIAccess;
  try {
    access = await navigator.requestMIDIAccess();
  } catch {
    return () => {
      detachBle();
      detachKeyboard();
    };
  }

  const listened = new Set<MIDIInput>();

  const onMessage = (event: MIDIMessageEvent) => {
    const data = event.data;
    if (!data || data.length < 2) return;
    const status = data[0] & 0xf0;
    const midi = data[1];
    const velocity = data.length > 2 ? data[2] : 0;
    const timeMs = performance.now();
    if (status === 0x90 && velocity > 0) {
      onNote({ midi, timeMs, kind: "on" });
    } else if (status === 0x80 || (status === 0x90 && velocity === 0)) {
      onNote({ midi, timeMs, kind: "off" });
    }
  };

  const attach = async (input: MIDIInput) => {
    if (!listened.has(input)) {
      input.addEventListener("midimessage", onMessage);
      listened.add(input);
    }
    if (input.connection !== "open") await input.open();
  };

  const opening: Promise<void>[] = [];
  access.inputs.forEach((input) => {
    opening.push(attach(input));
  });
  try {
    await Promise.all(opening);
  } catch (error) {
    for (const input of listened) input.removeEventListener("midimessage", onMessage);
    listened.clear();
    detachBle();
    detachKeyboard();
    throw error;
  }

  const onState = (event: MIDIConnectionEvent) => {
    const port = event.port;
    if (port?.type === "input" && port.state === "connected") void attach(port as MIDIInput).catch(() => {});
  };
  access.addEventListener("statechange", onState);

  return () => {
    access.removeEventListener("statechange", onState);
    for (const input of listened) input.removeEventListener("midimessage", onMessage);
    listened.clear();
    detachBle();
    detachKeyboard();
  };
}
