export type Step = "C" | "D" | "E" | "F" | "G" | "A" | "B";
export type Pitch = { step: Step; octave: number; alteration: -1 | 0 | 1 };

export type Level = 1 | 2 | 3 | 4 | 5 | 6;
export type Hand = "RH" | "LH";
export type Clef = "treble" | "bass";
export type Duration = "w" | "hd" | "h" | "qd" | "q" | "8" | "16" | "wr" | "hr" | "qr" | "8r" | "16r";
export type KeySignature = "C" | "F" | "G" | "D" | "Bb";
export type Mode = "reading-lesson" | "reading-test" | "sight" | "repertoire";
export type PositionId = "C" | "D-shift" | "F" | "G" | "D-major" | "Bb";

export type NoteEvent = {
  id: string;
  pitches: Pitch[];
  duration: Duration;
  fingers?: number[];
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
};
