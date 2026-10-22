import { parsePitchLabel } from "../domain/pitch";
import type { Duration, Score } from "../domain/types";
import type { PlaybackQuestion } from "./melodyTypes";

/**
 * 把 Playback 题库的一条旋律转成现有带时值 IR，供 previewScore 试听。
 *
 * 这里只用于「听旋律选调性」：主音和弦放在最前面，旋律放在同一个小节里。
 * 不渲染谱面，所以不要求小节时值严格配平；previewEvents 会按累计拍点播放。
 */
export function melodyToScore(question: PlaybackQuestion): Score {
  const notes = [
    {
      id: "tonic",
      pitches: question.tonic.map((pitch) => parsePitchLabel(pitch)),
      duration: (question.meter === "3/4" ? "hd" : "w") as Duration,
    },
    ...question.melody.map((note, index) => ({
      id: `m${index + 1}`,
      pitches: [parsePitchLabel(note.pitch)],
      duration: durationFor(note.beats),
    })),
  ];

  return {
    id: `practice.melody.${question.id}`,
    mode: "reading-lesson",
    level: 2,
    meter: { beats: question.meter === "3/4" ? 3 : 4, beatValue: 4 },
    keySignature: "C",
    hands: ["RH"],
    bpm: 80,
    staves: {
      RH: { clef: "treble", measures: [{ notes }] },
    },
  };
}

function durationFor(beats: number): Duration {
  if (beats >= 4) return "w";
  if (beats >= 3) return "hd";
  if (beats >= 2) return "h";
  if (beats >= 1.5) return "qd";
  if (beats >= 1) return "q";
  if (beats >= 0.5) return "8";
  return "16";
}
