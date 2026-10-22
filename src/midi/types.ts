/** 音符事件来自哪里：MIDI 硬件、电脑键盘，还是屏幕上点按的琴键。 */
export type NoteSource = "midi" | "keyboard" | "screen";

export type MidiNote = {
  midi: number;
  timeMs: number;
  kind: "on" | "off";
  /** 缺省视为 MIDI 硬件（老调用方不传也能用）。 */
  source?: NoteSource;
};
