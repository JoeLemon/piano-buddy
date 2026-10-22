import { Factory, Renderer, Voice, type StemmableNote } from "vexflow";
import { pitchLabel, pitchToMidi } from "../domain/pitch";
import type { Clef, Duration, Hand, Measure, NoteEvent, Score, Step } from "../domain/types";

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

  stave.measures.forEach((measure, index) => {
    const line = measure.notes.map((note) => noteToken(note, stave.clef)).join(", ");
    if (!line) return;
    const notes = easy.notes(line, { clef: stave.clef });
    if (showFingers) addFingers(factory, notes, measure);
    const voice = easy.voice(notes, { time });
    const placement = placements[index];
    const system = factory.System({ x: placement.x, y: 90, width: placement.width });
    const rendered = system.addStave({ voices: [voice] });
    if (index === 0) {
      rendered.addClef(stave.clef).addTimeSignature(time).addKeySignature(score.keySignature);
    }
  });

  factory.draw();
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
  const natural = naturalWidth(measureCount, gap);
  const scale = fitScale(element, natural);
  let cursor = 28;
  const placements = Array.from({ length: measureCount }, (_, index) => {
    const width = (index === 0 ? 360 : 240) * scale;
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

  for (let index = 0; index < measureCount; index += 1) {
    const rightMeasure = right.measures[index];
    const leftMeasure = left.measures[index];
    const rightLine = rightMeasure.notes.map((note) => noteToken(note, right.clef)).join(", ");
    const leftLine = leftMeasure.notes.map((note) => noteToken(note, left.clef)).join(", ");
    if (!rightLine || !leftLine) continue;

    const rightNotes = easy.notes(rightLine, { clef: right.clef });
    const leftNotes = easy.notes(leftLine, { clef: left.clef });
    if (showFingers) {
      addFingers(factory, rightNotes, rightMeasure);
      addFingers(factory, leftNotes, leftMeasure);
    }

    const placement = placements[index];
    const system = factory.System({
      x: placement.x,
      y: 48,
      width: placement.width,
      spaceBetweenStaves: 16,
    });
    const treble = system.addStave({ voices: [openVoice(factory, rightNotes, time)] });
    const bass = system.addStave({ voices: [openVoice(factory, leftNotes, time)] });
    if (index === 0) {
      treble.addClef(right.clef).addTimeSignature(time).addKeySignature(score.keySignature);
      bass.addClef(left.clef).addTimeSignature(time).addKeySignature(score.keySignature);
      // 大括号只在这一行的开头出现一次，逐小节重复会看成四个独立谱表
      system.addConnector("brace");
      system.addConnector("singleLeft");
    }
  }

  factory.draw();
  styleFingerAnnotations(host);
  trimCanvas(host);
}

function openVoice(factory: Factory, notes: StemmableNote[], time: string) {
  const voice = factory.Voice({ time });
  // A lesson bar may be shorter than the meter. FULL still rejects notes that run past the bar.
  voice.setMode(Voice.Mode.FULL);
  return voice.addTickables(notes);
}

function addFingers(factory: Factory, notes: StemmableNote[], measure: Measure): void {
  measure.notes.forEach((event, index) => {
    // 和弦音的每个音各有一个指法，合并显示（如 C-E-G → 1·3·5）。
    const fingers = (event.fingers ?? []).filter((finger) => finger >= 1 && finger <= 5);
    if (fingers.length === 0) return;
    notes[index]?.addModifier(
      factory.Annotation({
        text: fingers.length === 1 ? String(fingers[0]) : fingers.join("·"),
        vJustify: "top",
        font: { family: "IBM Plex Sans, sans-serif", size: 14, weight: "600" },
      }),
    );
  });
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

function noteToken(note: NoteEvent, clef: Clef): string {
  const duration = VEX_DURATION[note.duration];
  if (note.pitches.length === 0) return `${restPitch(clef)}/${duration}`;
  if (note.pitches.length === 1) return `${pitchLabel(note.pitches[0])}/${duration}`;
  return `(${note.pitches.map((pitch) => pitchLabel(pitch)).join(" ")})/${duration}`;
}
