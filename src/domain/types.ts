export type Step = "C" | "D" | "E" | "F" | "G" | "A" | "B";
export type Pitch = { step: Step; octave: number; alteration: -1 | 0 | 1 };

export type Level = 1 | 2 | 3 | 4 | 5 | 6;
export type Hand = "RH" | "LH";
export type Clef = "treble" | "bass";
export type Duration = "w" | "hd" | "h" | "qd" | "q" | "8" | "16" | "wr" | "hr" | "qr" | "8r" | "16r";
export type KeySignature = "C" | "F" | "G" | "D" | "Bb" | "Am" | "Em" | "Dm";
export type Mode = "reading-lesson" | "reading-test" | "sight" | "repertoire";
export type PositionId = "C" | "D-shift" | "F" | "G" | "D-major" | "Bb";

/**
 * 拍号。`beats` 是分子、`beatValue` 是分母，和谱面上写的一致。
 *
 * 内部时间轴仍以**四分音符**为 1 拍（`DURATION_BEATS` 的口径），所以 6/8
 * 的一小节是 `6 × 4/8 = 3` 拍。凡是要把拍号换算成小节拍数，一律走
 * `domain/vocabulary.ts` 的 `meterQuarterBeats()`，别拿 `beats` 硬乘。
 */
export type Meter = { beats: 3 | 4 | 6; beatValue: 4 | 8 };

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
  /**
   * 三连音组 id（3:2）。同一组内连续 3 个音共用这个 id；`duration` 写的是
   * 谱面上的基础时值（例如八分音符写 `"8"`），实际拍数由
   * `vocabulary.ts` 的 `noteBeats()` 按 2/3 折算。
   *
   * 只支持「3 个同基础时值的音占 2 个」这一种三连音；更复杂的连音符
   * 留给后续扩展。组 id 在一份谱内必须唯一，且不能跨小节。
   */
  tuplet?: string;
};

export type Measure = { notes: NoteEvent[] };
export type Stave = { clef: Clef; measures: Measure[] };

/**
 * `|: :|` 反复段落（小节号 0 起算，两端都包含）。
 *
 * 记在 `Score` 上而不是 `Measure` 上：反复线属于整份谱的结构，两只手共用
 * 同一组小节号；写在每个 `Measure` 里迟早会出现「右手有、左手忘了」。
 */
export type RepeatSpan = {
  from: number;
  to: number;
  /** 总演奏次数；省略为 2（弹两遍）。 */
  times?: number;
};

/**
 * D.C./D.S. 等导航记号。`at` 是记号所在小节（0 起算）。
 *
 * - `dc`：Da Capo，回到第 1 小节；
 * - `ds`：Dal Segno，回到 `segno` 所在小节；
 * - `segno` / `coda`：落点记号；
 * - `fine`：D.C./D.S. 之后的收尾小节；
 * - `to-coda`：第二遍到这里跳到 `coda`。
 */
export type NavigationKind = "dc" | "ds" | "segno" | "coda" | "fine" | "to-coda";
export type NavigationMark = { at: number; kind: NavigationKind };

export type Score = {
  id: string;
  mode: Mode;
  level: Level;
  meter: Meter;
  keySignature: KeySignature;
  hands: Hand[];
  bpm: number;
  staves: Partial<Record<Hand, Stave>>;
  /**
   * 弱起小节：首小节的实际拍数（四分音符单位，和内部时间轴一致）。省略表示
   * 首小节满拍。
   *
   * 取值 0 < pickup < 每小节四分音符拍数，且是十六分音符/三连音栅格的整数倍；
   * 首小节的时值必须正好等于它。事件流仍从第 0 拍起算（弱起的第一个音就是
   * 第 0 拍），只有小节边界往后挪——换算小节号请用 `domain/pickup.ts`，
   * 不要硬除。
   */
  pickup?: number;
  /** `|: :|` 反复段落；见 domain/repeats.ts。 */
  repeats?: RepeatSpan[];
  /** D.C./D.S./Segno/Coda/Fine 等导航记号。 */
  navigation?: NavigationMark[];
};
