import { Factory, Renderer, type StemmableNote } from "vexflow";
import { pitchLabel, pitchToMidi } from "../domain/pitch";
import type { Duration, Hand, Measure, NoteEvent, Score, Step } from "../domain/types";

const WHITE_STEPS: readonly Step[] = ["C", "D", "E", "F", "G", "A", "B"];

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

export function renderScore(element: HTMLElement, score: Score, hand: Hand, showFingers: boolean): void {
  element.replaceChildren();
  const stave = score.staves[hand];
  if (!stave || stave.measures.length === 0) return;

  const host = document.createElement("div");
  element.append(host);

  const gap = 12;
  let cursor = 10;
  const placements = stave.measures.map((_, index) => {
    const width = index === 0 ? 360 : 240;
    const placement = { x: cursor, width };
    cursor += width + gap;
    return placement;
  });

  const width = cursor + 10;
  const height = 240;
  const factory = new Factory({
    renderer: { elementId: null, width, height },
  });
  factory.setContext(Renderer.buildContext(host, Renderer.Backends.SVG, width, height));

  const time = `${score.meter.beats}/${score.meter.beatValue}`;
  const easy = factory.EasyScore();
  easy.set({ clef: stave.clef, time });

  stave.measures.forEach((measure, index) => {
    const line = measure.notes.map(noteToken).join(", ");
    if (!line) return;
    const notes = easy.notes(line, { clef: stave.clef });
    if (showFingers) addFingers(factory, notes, measure);
    const voice = easy.voice(notes, { time });
    const placement = placements[index];
    const system = factory.System({ x: placement.x, y: 80, width: placement.width });
    const rendered = system.addStave({ voices: [voice] });
    if (index === 0) {
      rendered.addClef(stave.clef).addTimeSignature(time).addKeySignature(score.keySignature);
    }
  });

  factory.draw();
}

function addFingers(factory: Factory, notes: StemmableNote[], measure: Measure): void {
  measure.notes.forEach((event, index) => {
    const finger = event.fingers?.[0];
    if (finger == null) return;
    notes[index]?.addModifier(factory.Annotation({ text: String(finger), vJustify: "top" }));
  });
}

function noteToken(note: NoteEvent): string {
  const duration = VEX_DURATION[note.duration];
  if (note.pitches.length === 0) return `B4/${duration}`;
  if (note.pitches.length === 1) return `${pitchLabel(note.pitches[0])}/${duration}`;
  return `(${note.pitches.map((pitch) => pitchLabel(pitch)).join(" ")})/${duration}`;
}
