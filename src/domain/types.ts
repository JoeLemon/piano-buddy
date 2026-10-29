export type Step = "C" | "D" | "E" | "F" | "G" | "A" | "B";
export type Pitch = { step: Step; octave: number; alteration: -1 | 0 | 1 };

export type Level = 1 | 2 | 3 | 4 | 5 | 6;
export type Hand = "RH" | "LH";
export type Clef = "treble" | "bass";
export type Duration = "w" | "hd" | "h" | "qd" | "q" | "8" | "16" | "wr" | "hr" | "qr" | "8r" | "16r";
export type KeySignature = "C" | "F" | "G" | "D" | "Bb";
export type Mode = "reading-lesson" | "reading-test" | "sight" | "repertoire";
export type PositionId = "C" | "D-shift" | "F" | "G" | "D-major" | "Bb";

/**
 * 连音线（MusicXML 的 `<tie>`）：
 *
 * - `start`：从本音往下一个同音高的音连线。
 * - `stop`：承接前一个同音高的音，**不重新击键**。
 * - `continue`：两头都连（跨三个以上小节时的中间段）。
 *
 * 语义只在「怎么弹」上生效：stop/continue 音不产生新的按键事件，时值并到
 * 前一个开放音上——谱面上仍是两个音符，听起来是一个长音。指法只写在
 * `start` 那个音上，后续段沿用。
 */
export type TieMark = "start" | "stop" | "continue";

export type NoteEvent = {
  id: string;
  pitches: Pitch[];
  duration: Duration;
  fingers?: number[];
  tie?: TieMark;
};

export type Measure = { notes: NoteEvent[] };
export type Stave = { clef: Clef; measures: Measure[] };

export type Score = {
  id: string;
  mode: Mode;
  level: Level;
  meter: { beats: 3 | 4; beatValue: 4 };
  keySignature: KeySignature;
  hands: Hand[];
  bpm: number;
  staves: Partial<Record<Hand, Stave>>;
  /**
   * 弱起小节：首小节的实际拍数。省略表示首小节满拍。
   *
   * 取值 0 < pickup < meter.beats，且是十六分音符的整数倍；首小节的时值
   * 必须正好等于它。事件流仍从第 0 拍起算（弱起的第一个音就是第 0 拍），
   * 只有小节边界往后挪——换算小节号请用 `domain/pickup.ts`，不要硬除。
   */
  pickup?: number;
};
