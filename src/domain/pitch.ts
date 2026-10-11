import type { Pitch, Step } from "./types";

const SEMI: Record<Step, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

export function pitchToMidi(pitch: Pitch): number {
  return (pitch.octave + 1) * 12 + SEMI[pitch.step] + pitch.alteration;
}

export function pitchLabel(pitch: Pitch): string {
  const accidental = pitch.alteration === 1 ? "#" : pitch.alteration === -1 ? "b" : "";
  return `${pitch.step}${accidental}${pitch.octave}`;
}

export function parsePitchLabel(label: string): Pitch {
  const match = /^([A-G])([#b]?)(-?\d+)$/.exec(label);
  if (!match) throw new Error(`bad pitch label: ${label}`);
  const alteration = match[2] === "#" ? 1 : match[2] === "b" ? -1 : 0;
  return { step: match[1] as Step, octave: Number(match[3]), alteration };
}
