import { Factory, Renderer, Voice, Barline, Stave, type EasyScore, type StemmableNote } from "vexflow";
import { pitchToMidi } from "../domain/pitch";
import { navigationLabelsAt, repeatBarlines } from "../domain/repeats";
import { samePitches, tiesFrom, tiesTo } from "../domain/tie";
import type { Clef, Duration, Hand, KeySignature, Measure, NoteEvent, Pitch, Score, Step } from "../domain/types";
import { keyAlteration, meterQuarterBeats, noteBeats } from "../domain/vocabulary";

const WHITE_STEPS: readonly Step[] = ["C", "D", "E", "F", "G", "A", "B"];
const BLACK_STEPS: readonly Step[] = ["C", "D", "F", "G", "A"];

const VEX_DURATION: Record<Duration, string> = {
  w: "w",
  hd: "h.",
  h: "h",
  qd: "q.",
  q: "q",
  "8": "8",
  "16": "16",
  wr: "w/r",
  hr: "h/r",
  qr: "q/r",
  "8r": "8/r",
  "16r": "16/r",
};

/** 按小节数估算自然的横向宽度：第一小节带谱号/调号，宽一些。 */
function naturalWidth(measureCount: number, gap: number): number {
  if (measureCount <= 0) return 0;
  const first = 360;
  const rest = (measureCount - 1) * 240;
  return 20 + first + rest + gap * (measureCount - 1);
}

/** 补足拍数用的休止符时值（四分音符单位），从大到小贪心分解。 */
const REST_FILL: readonly { duration: Duration; beats: number }[] = [
  { duration: "wr", beats: 4 },
  { duration: "hr", beats: 2 },
  { duration: "qr", beats: 1 },
  { duration: "8r", beats: 0.5 },
  { duration: "16r", beats: 0.25 },
];

/** 把不满一小节的剩余拍数拆成若干个休止符；不足十六分之一的余量忽略。 */
function restTokensFor(remaining: number, clef: Clef): string[] {
  const tokens: string[] = [];
  let left = Math.round(remaining * 100) / 100;
  for (const fill of REST_FILL) {
    while (left >= fill.beats - 0.001) {
      tokens.push(`${restPitch(clef)}/${VEX_DURATION[fill.duration]}`);
      left = Math.round((left - fill.beats) * 100) / 100;
    }
  }
  return tokens;
}

/**
 * 谱面原本是固定宽度，三小节就超出卡片、出现横向滚动条。
 * 按容器可视宽度等比压缩；窄屏最多压到 0.72，再窄就保留滚动，
 * 免得音符挤成一团。
 */
function fitScale(element: HTMLElement, natural: number): number {
  const available = element.clientWidth;
  if (!available || available <= 0 || natural <= 0) return 1;
  return Math.min(1, Math.max(0.72, (available - 6) / natural));
}

/** White-key MIDI numbers from C3 through C5. Middle C is C4 (60). */
export function whiteKeyMidis(): number[] {
  const midis: number[] = [];
  for (const octave of [3, 4]) {
    for (const step of WHITE_STEPS) {
      midis.push(pitchToMidi({ step, octave, alteration: 0 }));
    }
  }
  midis.push(pitchToMidi({ step: "C", octave: 5, alteration: 0 }));
  return midis;
}

/** Black-key MIDI numbers sitting between the C3–C5 white keys. */
export function blackKeyMidis(): number[] {
  const midis: number[] = [];
  for (const octave of [3, 4]) {
    for (const step of BLACK_STEPS) {
      midis.push(pitchToMidi({ step, octave, alteration: 1 }));
    }
  }
  return midis;
}

/** Middle line of the staff: B4 in treble, D3 in bass. */
export function restPitch(clef: Clef): "B4" | "D3" {
  return clef === "bass" ? "D3" : "B4";
}

export function renderScore(element: HTMLElement, score: Score, hand: Hand, showFingers: boolean): void {
  element.replaceChildren();
  const stave = score.staves[hand];
  if (!stave || stave.measures.length === 0) return;

  const host = document.createElement("div");
  element.append(host);

  const gap = 12;
  const natural = naturalWidth(stave.measures.length, gap);
  const scale = fitScale(element, natural);
  let cursor = 10;
  const placements = stave.measures.map((_, index) => {
    const width = (index === 0 ? 360 : 240) * scale;
    const placement = { x: cursor, width };
    cursor += width + gap * scale;
    return placement;
  });

  const width = cursor + 10;
  const height = 280;
  const factory = new Factory({
    renderer: { elementId: null, width, height },
  });
  factory.setContext(Renderer.buildContext(host, Renderer.Backends.SVG, width, height));

  const time = `${score.meter.beats}/${score.meter.beatValue}`;
  const easy = factory.EasyScore();
  easy.set({ clef: stave.clef, time });

  // 一小节的拍数预算（四分音符单位）：4/4 = 4，3/4 = 3，6/8 = 3。
  const beatQuarters = 4 / score.meter.beatValue;
  const budget = score.meter.beats * beatQuarters;

  const rendered: (StemmableNote[] | undefined)[] = [];
  const renderedIndices: ((number | null)[] | undefined)[] = [];
  const repeatMarks = repeatBarlines(score);
  stave.measures.forEach((measure, index) => {
    const built = measureTokens(measure, stave.clef, score.keySignature);
    // VexFlow 的 voice 默认 STRICT：拍数不满一小节就抛 IncompleteVoice。
    // 练习谱面常有 3 个四分音符（音型、分解和弦、手位读谱），按记谱惯例
    // 在末尾补休止符——顺带修掉音型题三音组一直渲染不出来的老问题。
    const used = measure.notes.reduce((sum, note) => sum + noteBeats(note), 0);
    if (used > 0 && used < budget - 1e-6) {
      const rests = restTokensFor(budget - used, stave.clef);
      // 弱起小节的缺口在**开头**：把休止符补在前面，音符就落在小节末的拍点上，
      // 和跟弹时钟听到的位置一致。补在后面会把它画成「第一拍起音」。
      if (index === 0 && score.pickup !== undefined) {
        built.tokens.unshift(...rests);
        built.noteIndices.unshift(...rests.map(() => null));
      } else {
        built.tokens.push(...rests);
        built.noteIndices.push(...rests.map(() => null));
      }
    }
    const line = built.tokens.join(", ");
    if (!line) return;
    const notes = easy.notes(line, { clef: stave.clef });
    applyTuplets(easy, notes, measure, built.noteIndices);
    rendered[index] = notes;
    renderedIndices[index] = built.noteIndices;
    if (showFingers) addFingers(factory, notes, measure, built.noteIndices);
    addNavigation(factory, notes, built.noteIndices, score, index);
    const voice = easy.voice(notes, { time });
    const placement = placements[index];
    const system = factory.System({ x: placement.x, y: 90, width: placement.width });
    const renderedStave = system.addStave({ voices: [voice] });
    applyRepeatBarlines(renderedStave, repeatMarks.get(index));
    if (index === 0) {
      renderedStave.addClef(stave.clef).addTimeSignature(time).addKeySignature(score.keySignature);
    }
  });

  drawStaveTies(factory, stave.measures, rendered, renderedIndices);
  factory.draw();
  markFillerRests(host, rendered, renderedIndices);
  styleFingerAnnotations(host);
  trimCanvas(host);
}

/** Treble on top, bass below. `score.hands` must include both RH and LH. */
export function renderGrandScore(element: HTMLElement, score: Score, showFingers: boolean): void {
  if (!score.hands.includes("RH") || !score.hands.includes("LH")) {
    throw new Error("renderGrandScore requires RH and LH");
  }
  const right = score.staves.RH;
  const left = score.staves.LH;
  if (!right || !left) {
    throw new Error("renderGrandScore requires RH and LH staves");
  }

  element.replaceChildren();
  const measureCount = Math.min(right.measures.length, left.measures.length);
  if (measureCount === 0) return;

  const host = document.createElement("div");
  element.append(host);

  const gap = 12;
  // 弱起小节按拍数比例缩窄：不缩的话它和整小节一样宽、内容却少一截，
  // 看上去像「漏了音」而不是「从后面进来」。
  // 公式 = 谱号/调号/拍号固定占位 120 + 每拍 60；满拍时正好回到 360。
  const firstWidth = score.pickup
    ? Math.max(150, Math.round(120 + 240 * (score.pickup / meterQuarterBeats(score.meter))))
    : 360;
  const natural = naturalWidth(measureCount, gap) - (360 - firstWidth);
  const scale = fitScale(element, natural);
  let cursor = 28;
  const placements = Array.from({ length: measureCount }, (_, index) => {
    const width = (index === 0 ? firstWidth : 240) * scale;
    const placement = { x: cursor, width };
    cursor += width + gap * scale;
    return placement;
  });

  const width = cursor + 10;
  const height = 420;
  const factory = new Factory({
    renderer: { elementId: null, width, height },
  });
  factory.setContext(Renderer.buildContext(host, Renderer.Backends.SVG, width, height));

  const time = `${score.meter.beats}/${score.meter.beatValue}`;
  const easy = factory.EasyScore();
  easy.set({ time });

  const rightRendered: (StemmableNote[] | undefined)[] = [];
  const leftRendered: (StemmableNote[] | undefined)[] = [];
  const rightIndices: ((number | null)[] | undefined)[] = [];
  const leftIndices: ((number | null)[] | undefined)[] = [];
  const repeatMarks = repeatBarlines(score);
  for (let index = 0; index < measureCount; index += 1) {
    const rightMeasure = right.measures[index];
    const leftMeasure = left.measures[index];
    const rightBuilt = measureTokens(rightMeasure, right.clef, score.keySignature);
    const leftBuilt = measureTokens(leftMeasure, left.clef, score.keySignature);
    if (rightBuilt.tokens.length === 0 || leftBuilt.tokens.length === 0) continue;

    const rightNotes = easy.notes(rightBuilt.tokens.join(", "), { clef: right.clef });
    const leftNotes = easy.notes(leftBuilt.tokens.join(", "), { clef: left.clef });
    applyTuplets(easy, rightNotes, rightMeasure, rightBuilt.noteIndices);
    applyTuplets(easy, leftNotes, leftMeasure, leftBuilt.noteIndices);
    rightRendered[index] = rightNotes;
    leftRendered[index] = leftNotes;
    rightIndices[index] = rightBuilt.noteIndices;
    leftIndices[index] = leftBuilt.noteIndices;
    if (showFingers) {
      addFingers(factory, rightNotes, rightMeasure, rightBuilt.noteIndices);
      addFingers(factory, leftNotes, leftMeasure, leftBuilt.noteIndices);
    }
    // 导航记号只画在上方谱表，两份重复反而看不清。
    addNavigation(factory, rightNotes, rightBuilt.noteIndices, score, index);

    const placement = placements[index];
    const system = factory.System({
      x: placement.x,
      y: 48,
      width: placement.width,
      spaceBetweenStaves: 16,
    });
    const treble = system.addStave({ voices: [openVoice(factory, rightNotes, time)] });
    const bass = system.addStave({ voices: [openVoice(factory, leftNotes, time)] });
    applyRepeatBarlines(treble, repeatMarks.get(index));
    applyRepeatBarlines(bass, repeatMarks.get(index));
    if (index === 0) {
      treble.addClef(right.clef).addTimeSignature(time).addKeySignature(score.keySignature);
      bass.addClef(left.clef).addTimeSignature(time).addKeySignature(score.keySignature);
      // 大括号只在这一行的开头出现一次，逐小节重复会看成四个独立谱表
      system.addConnector("brace");
      system.addConnector("singleLeft");
    }
  }

  drawStaveTies(factory, right.measures, rightRendered, rightIndices);
  drawStaveTies(factory, left.measures, leftRendered, leftIndices);
  factory.draw();
  styleFingerAnnotations(host);
  trimCanvas(host);
}

/**
 * 画连音线。
 *
 * 每个小节是一个独立的 `System`，但它们横向排在同一行上，所以「跨小节」
 * 不等于「换行」——一条完整的曲线就能跨过小节间隙，比拆成两段更连贯。
 *
 * 这个渲染器**不换行**：宽度不够时整体缩放、再不够就横向滚动（见 `fitScale`），
 * 所以目标音永远在起音右边。哪天改成多行排版，这里要按「目标是否跑到下一行」
 * 拆成两条半截线（`StaveTie` 的 `from` 或 `to` 传 null）。
 *
 * 找不到接续音时什么都不画：`isAllowed` 会把这种谱面判为不合法，渲染层
 * 不必再抛错，能把剩下的内容画出来反而更好排查。
 */
function drawStaveTies(
  factory: Factory,
  measures: readonly Measure[],
  rendered: readonly (StemmableNote[] | undefined)[],
  renderedIndices: readonly ((number | null)[] | undefined)[],
): void {
  measures.forEach((measure, measureIndex) => {
    const notes = rendered[measureIndex];
    if (!notes) return;
    measure.notes.forEach((note, noteIndex) => {
      if (!tiesTo(note)) return;
      const fromToken = renderedIndices[measureIndex]?.indexOf(noteIndex) ?? -1;
      if (fromToken < 0) return;
      const from = notes[fromToken];
      if (!from) return;
      const target = nextTieTarget(measures, measureIndex, noteIndex, note.pitches);
      if (!target) return;
      const toToken = renderedIndices[target.measure]?.indexOf(target.index) ?? -1;
      if (toToken < 0) return;
      const to = rendered[target.measure]?.[toToken];
      if (!to) return;
      const indices = tieIndices(note.pitches, target.pitches);
      if (!indices) return;
      factory.StaveTie({
        from,
        to,
        first_indices: indices.first,
        last_indices: indices.last,
      });
    });
  });
}

/** 连音线的另一端：往后第一个发声的音，且必须真的是这根线的接续。 */
function nextTieTarget(
  measures: readonly Measure[],
  measureIndex: number,
  noteIndex: number,
  pitches: readonly Pitch[],
): { measure: number; index: number; pitches: Pitch[] } | null {
  for (let m = measureIndex; m < measures.length; m += 1) {
    const start = m === measureIndex ? noteIndex + 1 : 0;
    for (let i = start; i < measures[m].notes.length; i += 1) {
      const candidate = measures[m].notes[i];
      if (candidate.pitches.length === 0 || candidate.duration.endsWith("r")) continue;
      // 中间隔了别的音就不再是同一根线，别硬连到后面去。
      if (!tiesFrom(candidate) || !samePitches(pitches, candidate.pitches)) return null;
      return { measure: m, index: i, pitches: candidate.pitches };
    }
  }
  return null;
}

/** 和弦连音线要逐音配对：两端各给一组下标，缺一个音就不显示。 */
function tieIndices(
  from: readonly Pitch[],
  to: readonly Pitch[],
): { first: number[]; last: number[] } | null {
  const first: number[] = [];
  const last: number[] = [];
  from.forEach((pitch, index) => {
    const match = to.findIndex(
      (other) =>
        other.step === pitch.step &&
        other.octave === pitch.octave &&
        other.alteration === pitch.alteration,
    );
    if (match < 0) return;
    first.push(index);
    last.push(match);
  });
  return first.length > 0 ? { first, last } : null;
}

function openVoice(factory: Factory, notes: StemmableNote[], time: string) {
  const voice = factory.Voice({ time });
  // A lesson bar may be shorter than the meter. FULL still rejects notes that run past the bar.
  voice.setMode(Voice.Mode.FULL);
  return voice.addTickables(notes);
}

function addFingers(
  factory: Factory,
  notes: StemmableNote[],
  measure: Measure,
  noteIndices: readonly (number | null)[],
): void {
  measure.notes.forEach((event, index) => {
    // 和弦音的每个音各有一个指法，合并显示（如 C-E-G → 1·3·5）。
    const fingers = (event.fingers ?? []).filter((finger) => finger >= 1 && finger <= 5);
    if (fingers.length === 0) return;
    const tokenIndex = noteIndices.indexOf(index);
    if (tokenIndex < 0) return;
    notes[tokenIndex]?.addModifier(
      factory.Annotation({
        text: fingers.length === 1 ? String(fingers[0]) : fingers.join("·"),
        vJustify: "top",
        font: { family: "IBM Plex Sans, sans-serif", size: 14, weight: "600" },
      }),
    );
  });
}

/**
 * `|:` / `:|` 直接交给 VexFlow 的 barline 类型，比手画两条竖线可靠：
 * 反复点、粗细和谱表宽度都由它按当前缩放排。
 */
function applyRepeatBarlines(
  stave: Stave,
  marks: { begin: boolean; end: boolean } | undefined,
): void {
  if (!marks) return;
  if (marks.begin) stave.setBegBarType(Barline.type.REPEAT_BEGIN);
  if (marks.end) stave.setEndBarType(Barline.type.REPEAT_END);
}

/**
 * D.C./D.S./Fine/Coda 先画成谱表下方的一行小字。
 *
 * 没有用 VexFlow 的 `Repetition` 记号：它只认 Coda/Segno 两种图形，D.C. 文本
 * 仍要另画，混着用反而多一套定位。文字挂在第一拍上，测试也能直接读到。
 */
function addNavigation(
  factory: Factory,
  notes: StemmableNote[],
  noteIndices: readonly (number | null)[],
  score: Score,
  measureIndex: number,
): void {
  const labels = navigationLabelsAt(score, measureIndex);
  if (labels.length === 0 || notes.length === 0) return;
  // 弱起小节前面可能补了休止符；导航文字挂在第一个真实音符上。
  const first = noteIndices.findIndex((index) => index !== null);
  const tokenIndex = first >= 0 ? first : 0;
  notes[tokenIndex]?.addModifier(
    factory.Annotation({
      text: labels.join(" · "),
      vJustify: "bottom",
      font: { family: "IBM Plex Sans, sans-serif", size: 12, weight: "600" },
    }),
  );
}

function styleFingerAnnotations(host: HTMLElement): void {
  const texts = host.querySelectorAll(".vf-annotation text, .vf-annotation");
  for (let index = 0; index < texts.length; index += 1) {
    const node = texts.item(index);
    if (!(node instanceof SVGElement)) continue;
    // 与 tokens.css 的 --pb-score-ink 一致：谱面上的文字只用近黑色
    node.setAttribute("fill", "#1a1a1a");
    if (node instanceof SVGTextElement) {
      node.setAttribute("font-size", "14");
      node.setAttribute("font-weight", "600");
    }
  }
}

/**
 * 谱面画布留了固定高度（单手 280 / 双手 420）并在顶部预留 y=48~90，
 * 实际内容只占中间一条，卡片里就拖出上下两大块空白。
 * 画完后按内容包围盒裁掉上下多余部分，各留 8px 余量。
 *
 * 注意 VexFlow 同时写了 viewBox、height 属性和内联 style，只改一个会被
 * 另一个按比例缩放回来（谱面会变小并居中），所以三处一起改。
 * happy-dom 没有 getBBox，取不到就保留原高度，测试不受影响。
 */
function trimCanvas(host: HTMLElement): void {
  const svg = host.querySelector("svg");
  if (!(svg instanceof SVGSVGElement)) return;
  try {
    const box = svg.getBBox();
    if (!Number.isFinite(box.height) || box.height <= 0) return;
    const viewBox = svg.getAttribute("viewBox")?.split(/\s+/).map(Number);
    const currentHeight = viewBox?.[3] ?? Number(svg.getAttribute("height") ?? 0);
    if (!Number.isFinite(currentHeight) || currentHeight <= 0) return;

    const pad = 12;
    const top = Math.max(0, Math.floor(box.y - pad));
    const bottom = Math.ceil(box.y + box.height + pad);
    const height = bottom - top;
    if (height <= 0 || height >= currentHeight) return;

    const viewBoxWidth = viewBox?.[2] ?? Number(svg.getAttribute("width") ?? 0);
    svg.setAttribute("viewBox", `0 ${top} ${viewBoxWidth} ${height}`);
    svg.setAttribute("height", String(height));
    svg.style.height = `${height}px`;
  } catch {
    // 没有布局引擎（测试环境）时保持原样
  }
}

/**
 * 一小节的 token 串。VexFlow 的 EasyScore 拿到 keySignature 后不会自己补还原号，
 * 所以这里维护「本小节当前生效的升降」：调号先铺底，遇到同音高的临时记号就写入，
 * 需要还原时显式加 `n`。这样 L3 的临时升降谱才能正确显示还原记号。
 */
type MeasureTokens = {
  tokens: string[];
  /** token 下标 → Measure.notes 下标；补出来的休止符是 null。 */
  noteIndices: (number | null)[];
};

function measureTokens(measure: Measure, clef: Clef, key: KeySignature): MeasureTokens {
  const state = new Map<string, number>();
  const tokens: string[] = [];
  const noteIndices: (number | null)[] = [];
  measure.notes.forEach((note, index) => {
    const duration = VEX_DURATION[note.duration];
    if (note.pitches.length === 0) {
      tokens.push(`${restPitch(clef)}/${duration}`);
    } else {
      const pitches = note.pitches.map((pitch) => {
        const slot = `${pitch.step}${pitch.octave}`;
        const current = state.get(slot) ?? keyAlteration(key, pitch.step);
        let accidental = "";
        if (pitch.alteration !== current) {
          accidental = pitch.alteration === 1 ? "#" : pitch.alteration === -1 ? "b" : "n";
        }
        state.set(slot, pitch.alteration);
        return `${pitch.step}${accidental}${pitch.octave}`;
      });
      tokens.push(pitches.length === 1 ? `${pitches[0]}/${duration}` : `(${pitches.join(" ")})/${duration}`);
    }
    noteIndices.push(index);
  });
  return { tokens, noteIndices };
}

/**
 * 补出来的休止符只是排版占位，不属于 `measure.notes`。
 * `scorePaint` 按 DOM 顺序上色时要跳过它们，否则弱起/短小节会整体错位。
 * 必须等 `factory.draw()` 之后才拿得到 SVG 节点。
 */
function markFillerRests(
  host: HTMLElement,
  rendered: readonly (StemmableNote[] | undefined)[],
  renderedIndices: readonly ((number | null)[] | undefined)[],
): void {
  const groups = host.querySelectorAll(".vf-stavenote");
  let domIndex = 0;
  rendered.forEach((notes, measureIndex) => {
    const indices = renderedIndices[measureIndex];
    if (!notes || !indices) return;
    indices.forEach((noteIndex) => {
      if (noteIndex === null) groups.item(domIndex)?.classList.add("pb-filler-rest");
      domIndex += 1;
    });
  });
}

/**
 * 把同一组三连音的 token 交给 VexFlow 的 Tuplet。
 *
 * 谱面 token 仍按基础时值写（三个八分音符），Tuplet 会把它们的 tick 按 2/3
 * 缩放；必须在 `easy.voice()` 之前调用，voice 才会按 1 拍而不是 1.5 拍校验。
 */
function applyTuplets(
  easy: EasyScore,
  notes: StemmableNote[],
  measure: Measure,
  noteIndices: readonly (number | null)[],
): void {
  let index = 0;
  while (index < measure.notes.length) {
    const id = measure.notes[index].tuplet;
    if (!id) {
      index += 1;
      continue;
    }
    const group: StemmableNote[] = [];
    let cursor = index;
    while (cursor < measure.notes.length && measure.notes[cursor].tuplet === id) {
      const tokenIndex = noteIndices.indexOf(cursor);
      if (tokenIndex >= 0 && notes[tokenIndex]) group.push(notes[tokenIndex]);
      cursor += 1;
    }
    if (group.length === 3) {
      easy.tuplet(group, { num_notes: 3, notes_occupied: 2, bracketed: true });
    }
    index = cursor;
  }
}
