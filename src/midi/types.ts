export type MidiNote = {
  midi: number;
  timeMs: number;
  kind: "on" | "off";
};
