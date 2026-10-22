import type { Hand, Score } from "../domain/types";
import { DURATION_BEATS } from "../domain/vocabulary";
import { pitchToMidi } from "../domain/pitch";

/**
 * ── 演奏事件中间表示（Motion IR）─────────────────────────────
 * 主项目用「拍」描述音乐，demo 用「秒 + finger」描述动画。
 * 这里定义两边共享的中立表示：MotionNote 只关心音高、拍点、时值、
 * 左右手、指法，不关心 3D 手模型；demo 侧再用 toDemoEvents() 转成
 * 它自己的 NoteEvent（绝对秒）。
 *
 * 这样主项目不会把 demo 的手部假设带进来，demo 也可以单独替换渲染层。
 */

export type MotionHand = "L" | "R";

export interface MotionNote {
  id: string;
  midi: number;
  /** 从曲首算起的拍点 */
  onsetBeats: number;
  durationBeats: number;
  hand: MotionHand;
  /** 1..5，1 = 大拇指 */
  finger: number;
  /** 0..1 */
  velocity: number;
  /** 声部编号；P0 统一为 0，后续支持多声部时使用 */
  voice: number;
  /** 连音线：true 时 demo 不应重新击键 */
  tie: boolean;
}

export interface MotionScore {
  title: string;
  bpm: number;
  notes: MotionNote[];
  /** 最后一个音的结束拍 */
  totalBeats: number;
}

export interface MotionValidation {
  ok: boolean;
  errors: string[];
}

/** demo 侧的 NoteEvent 形状（绝对秒）。只在这里出现，避免污染主模型。 */
export interface DemoNoteEvent {
  midi: number;
  start: number;
  end: number;
  hand: MotionHand;
  finger: number;
  vel: number;
}

const HANDS: readonly Hand[] = ["RH", "LH"];

/**
 * 把 Score 摊平成 MotionNote[]。
 * 与 domain/timeline.ts 的 flattenScore 不同：这里保留和弦里的每个音、
 * 每个音的指法，以及每个音的时值（flattenScore 只取和弦第一个音，供比对用）。
 */
export function scoreToMotion(score: Score, title: string = score.id): MotionScore {
  const notes: MotionNote[] = [];
  let scoreBeats = 0;
  for (const hand of HANDS) {
    const stave = score.staves[hand];
    if (!stave) continue;
    let beat = 0;
    stave.measures.forEach((measure, measureIndex) => {
      measure.notes.forEach((note, noteIndex) => {
        const durationBeats = DURATION_BEATS[note.duration];
        if (note.pitches.length > 0 && !note.duration.endsWith("r")) {
          note.pitches.forEach((pitch, pitchIndex) => {
            notes.push({
              id: `${note.id || `${hand}-${measureIndex}-${noteIndex}`}:${pitchIndex}`,
              midi: pitchToMidi(pitch),
              onsetBeats: beat,
              durationBeats,
              hand: hand === "RH" ? "R" : "L",
              finger: note.fingers?.[pitchIndex] ?? 0,
              velocity: 0.75,
              voice: 0,
              tie: false,
            });
          });
        }
        beat += durationBeats;
      });
    });
    scoreBeats = Math.max(scoreBeats, beat);
  }
  notes.sort((a, b) => a.onsetBeats - b.onsetBeats || (a.hand === b.hand ? 0 : a.hand === "R" ? -1 : 1));
  const totalBeats = Math.max(
    scoreBeats,
    notes.reduce((max, note) => Math.max(max, note.onsetBeats + note.durationBeats), 0),
  );
  return { title, bpm: score.bpm, notes, totalBeats };
}

/**
 * 内容 QA / 桥接前的硬校验。
 * finger=0 是目前 demo 的崩溃点（Pianist 会访问 fingers[-1]），必须拒绝。
 */
export function validateMotion(motion: MotionScore): MotionValidation {
  const errors: string[] = [];
  if (!(motion.bpm > 0) || !Number.isFinite(motion.bpm)) errors.push("bpm 必须是正数");

  const byHandMidi = new Map<string, Array<{ start: number; end: number; tie: boolean }>>();
  for (const note of motion.notes) {
    if (!Number.isInteger(note.finger) || note.finger < 1 || note.finger > 5) {
      errors.push(`${note.id}: finger 必须是 1..5，当前为 ${note.finger}`);
    }
    if (!Number.isInteger(note.midi) || note.midi < 21 || note.midi > 108) {
      errors.push(`${note.id}: midi 必须在 21..108，当前为 ${note.midi}`);
    }
    if (!(note.onsetBeats >= 0) || !Number.isFinite(note.onsetBeats)) {
      errors.push(`${note.id}: onsetBeats 必须是非负数`);
    }
    if (!(note.durationBeats > 0) || !Number.isFinite(note.durationBeats)) {
      errors.push(`${note.id}: durationBeats 必须是正数`);
    }
    const key = `${note.hand}:${note.midi}`;
    const spans = byHandMidi.get(key) ?? [];
    spans.push({ start: note.onsetBeats, end: note.onsetBeats + note.durationBeats, tie: note.tie });
    byHandMidi.set(key, spans);
  }

  for (const [key, spans] of byHandMidi) {
    spans.sort((a, b) => a.start - b.start);
    for (let i = 1; i < spans.length; i += 1) {
      const prev = spans[i - 1];
      const cur = spans[i];
      if (!prev.tie && cur.start < prev.end - 1e-6) {
        errors.push(`${key}: 同一手同一音重叠，且不是连音线`);
      }
    }
  }

  return { ok: errors.length === 0, errors };
}

/** 拍 → 秒。demo 的 ScoreBuilder 本来就是 beat × spb，这里保持同一约定。 */
export function toDemoEvents(motion: MotionScore): DemoNoteEvent[] {
  const secondsPerBeat = 60 / motion.bpm;
  return motion.notes.map((note) => ({
    midi: note.midi,
    start: +(note.onsetBeats * secondsPerBeat).toFixed(3),
    end: +((note.onsetBeats + note.durationBeats) * secondsPerBeat).toFixed(3),
    hand: note.hand,
    finger: note.finger,
    vel: note.velocity,
  }));
}

export function motionDurationSeconds(motion: MotionScore): number {
  return motion.totalBeats * (60 / motion.bpm);
}

/** 一步到位：Score → Motion → demo events，供 P1 桥接直接使用。 */
export function scoreToDemoEvents(score: Score): {
  motion: MotionScore;
  events: DemoNoteEvent[];
  validation: MotionValidation;
} {
  const motion = scoreToMotion(score);
  return {
    motion,
    events: toDemoEvents(motion),
    validation: validateMotion(motion),
  };
}
