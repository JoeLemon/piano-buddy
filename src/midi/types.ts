/** 音符事件来自哪里：MIDI 硬件、电脑键盘，还是屏幕上点按的琴键。 */
export type NoteSource = "midi" | "keyboard" | "screen";

export type MidiNote = {
  midi: number;
  timeMs: number;
  kind: "on" | "off";
  /** 缺省视为 MIDI 硬件（老调用方不传也能用）。 */
  source?: NoteSource;
};

/**
 * 带序号的音符推送，用于穿过 props 把事件交给子组件。
 *
 * 直接传 `MidiNote` 不行：连着弹同一个键时两次事件的字段完全相同，
 * 会被当成没变化的 prop 而漏掉第二下。序号只负责「这是一次新的按键」，
 * 本身没有语义。
 */
export type NotePulse = {
  seq: number;
  note: MidiNote;
};
