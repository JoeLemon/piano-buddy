export type MidiNote = {
  midi: number;
  timeMs: number;
  kind: "on" | "off";
};

export async function subscribeMidi(onNote: (note: MidiNote) => void): Promise<() => void> {
  if (typeof navigator === "undefined" || typeof navigator.requestMIDIAccess !== "function") {
    throw new Error("midi-unavailable");
  }

  let access: MIDIAccess;
  try {
    access = await navigator.requestMIDIAccess();
  } catch {
    throw new Error("midi-unavailable");
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

  const attach = (input: MIDIInput) => {
    if (listened.has(input)) return;
    if (input.connection !== "open") void input.open().catch(() => {});
    input.addEventListener("midimessage", onMessage);
    listened.add(input);
  };

  access.inputs.forEach((input) => {
    attach(input);
  });

  const onState = (event: MIDIConnectionEvent) => {
    const port = event.port;
    if (port?.type === "input" && port.state === "connected") attach(port as MIDIInput);
  };
  access.addEventListener("statechange", onState);

  return () => {
    access.removeEventListener("statechange", onState);
    for (const input of listened) input.removeEventListener("midimessage", onMessage);
    listened.clear();
  };
}
