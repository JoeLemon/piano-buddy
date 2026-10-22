import type { Hand, PositionId, Score, Duration, KeySignature, Pitch } from "../domain/types";
import { isAllowed } from "../domain/allowed";
import {
  DURATION_BEATS,
  expansionPitches,
  keyAlteration,
  pitchesFor,
} from "../domain/vocabulary";
import { pitchToMidi } from "../domain/pitch";

/**
 * ── 技能图谱 ─────────────────────────────────────────────────
 * 把 MVP 的 L1–L6 词汇表升级为带前置关系的 DAG。
 * 每个技能节点是可独立声明依赖的最小「弹奏能力」，数据包 manifest 通过
 * skillDeps 引用这里的 id 声明「学/弹这个包需要先会什么」。
 *
 * 拆解引擎（requiredSkillsForScore）从一份乐谱的内容自动推导所需技能：
 * 谱号 / 双手 / 调号 / 节奏 / 和弦 / 临时升降 / 手位 / 跳进 / 织体。
 *
 * 手位判定优先使用乐谱里的指法（finger 1–5）：同一串音用 C 手指法还是
 * D 手指法，决定了它是「原地扩张」还是「换手位」。没有指法时退回音高覆盖
 * 启发式，并在 PositionAnalysis.source 里标明依据，方便内容 QA 区分。
 */

export interface Skill {
  id: string;
  name: string;
  /** 首次引入档位（对应 MVP 词汇表的 L1–L6） */
  level: number;
  /** 前置技能 id（学习顺序依赖） */
  prereq: string[];
}

export type SkillState = "locked" | "learning" | "passed";

export const SKILLS: readonly Skill[] = [
  // 基础（L1）
  { id: "clef.treble", name: "高音谱", level: 1, prereq: [] },
  { id: "clef.bass", name: "低音谱", level: 1, prereq: [] },
  { id: "pos.five", name: "五指位置", level: 1, prereq: [] },
  { id: "rhythm.quarter", name: "四分/二分/全音符", level: 1, prereq: [] },
  // 调性
  { id: "key.c", name: "C 大调", level: 1, prereq: [] },
  { id: "key.one-flat", name: "一个降号", level: 2, prereq: ["key.c"] },
  { id: "key.one-sharp", name: "一个升号", level: 2, prereq: ["key.c"] },
  { id: "key.two-acc", name: "两个升降号", level: 4, prereq: ["key.one-flat", "key.one-sharp"] },
  { id: "key.accidental", name: "临时升降号", level: 3, prereq: ["key.c"] },
  // 双手
  { id: "hands.both", name: "双手合奏", level: 2, prereq: ["pos.five"] },
  { id: "hands.alternate", name: "双手交替", level: 2, prereq: ["hands.both"] },
  { id: "hands.together", name: "双手同拍", level: 2, prereq: ["hands.alternate"] },
  // 节奏
  { id: "rhythm.eighth", name: "八分音符", level: 2, prereq: ["rhythm.quarter"] },
  { id: "rhythm.dotted", name: "附点节奏", level: 5, prereq: ["rhythm.eighth"] },
  { id: "rhythm.syncopation", name: "切分节奏", level: 5, prereq: ["rhythm.eighth"] },
  { id: "rhythm.sixteenth", name: "十六分音符", level: 6, prereq: ["rhythm.eighth"] },
  // 和声
  { id: "chord.interval", name: "双音音程", level: 3, prereq: ["pos.five"] },
  { id: "chord.triad", name: "三和弦", level: 3, prereq: ["chord.interval"] },
  { id: "chord.progression", name: "和弦连接", level: 3, prereq: ["chord.triad"] },
  // 手位/音域
  { id: "pos.shift", name: "手位平移", level: 2, prereq: ["pos.five"] },
  { id: "pos.expand", name: "手位两端扩张", level: 4, prereq: ["pos.shift"] },
  { id: "pos.leap", name: "六度/八度跳进", level: 6, prereq: ["pos.expand"] },
  // 织体/踏板（P0 先声明用于 schema 引用；自动判定见下方 requiredSkillsForScore）
  { id: "texture.broken", name: "分解和弦伴奏", level: 4, prereq: ["chord.triad"] },
  { id: "texture.comp", name: "柱式/半分解伴奏", level: 4, prereq: ["texture.broken"] },
  { id: "pedal.sustain", name: "延音踏板", level: 4, prereq: ["pos.five"] },
  { id: "chord.inversion", name: "和弦转位", level: 4, prereq: ["chord.triad"] },
  { id: "chord.seventh", name: "七和弦", level: 5, prereq: ["chord.triad"] },
];

export const SKILL_BY_ID: ReadonlyMap<string, Skill> = new Map(SKILLS.map((s) => [s.id, s]));

const RHYTHM_RANK: Record<string, number> = {
  "rhythm.quarter": 0,
  "rhythm.eighth": 1,
  "rhythm.dotted": 2,
  "rhythm.syncopation": 2,
  "rhythm.sixteenth": 3,
};

function rhythmSkill(d: Duration): string {
  if (d === "16" || d === "16r") return "rhythm.sixteenth";
  if (d === "hd" || d === "qd") return "rhythm.dotted";
  if (d === "8" || d === "8r") return "rhythm.eighth";
  return "rhythm.quarter";
}

function keySkill(key: KeySignature): string {
  switch (key) {
    case "C": return "key.c";
    case "F": return "key.one-flat";
    case "G": return "key.one-sharp";
    case "D":
    case "Bb": return "key.two-acc";
  }
}

const pitchKey = (p: Pitch): number => pitchToMidi(p);

const POSITIONS: readonly PositionId[] = ["C", "D-shift", "F", "G", "D-major", "Bb"];

function samePitch(a: Pitch, b: Pitch): boolean {
  return a.step === b.step && a.octave === b.octave && a.alteration === b.alteration;
}

function pitchesFitPosition(pitches: Pitch[], position: PositionId, hand: Hand): boolean {
  const slots = pitchesFor(position, hand);
  return pitches.every((p) => slots.some((slot) => samePitch(p, slot)));
}

function pitchesFitExpansion(pitches: Pitch[], position: PositionId, hand: Hand): boolean {
  const [below, above] = expansionPitches(position, hand);
  return pitches.every((p) => samePitch(p, below) || samePitch(p, above));
}

function fingerFitsPosition(pitch: Pitch, finger: number, position: PositionId, hand: Hand): boolean {
  const slots = pitchesFor(position, hand);
  const index = slots.findIndex((slot) => samePitch(pitch, slot));
  if (index < 0) return false;
  const expected = hand === "RH" ? index + 1 : 5 - index;
  return expected === finger;
}

function pitchFitsExpansion(pitch: Pitch, position: PositionId, hand: Hand): boolean {
  const [below, above] = expansionPitches(position, hand);
  return samePitch(pitch, below) || samePitch(pitch, above);
}

type HandNote = { pitches: Pitch[]; fingers?: number[] };

function soundingNotes(score: Score, hand: Hand): HandNote[] {
  const stave = score.staves[hand];
  if (!stave) return [];
  const out: HandNote[] = [];
  for (const measure of stave.measures) {
    for (const note of measure.notes) {
      if (note.pitches.length === 0 || note.duration.endsWith("r")) continue;
      out.push({ pitches: note.pitches, fingers: note.fingers });
    }
  }
  return out;
}

export interface PositionAnalysis {
  shift: boolean;
  expand: boolean;
  /** 参与判定的手位（按出现次数排序，便于调试/展示） */
  positions: PositionId[];
  /** fingering = 用了乐谱指法；pitch = 没有指法，退回音高覆盖 */
  source: "fingering" | "pitch";
}

interface HandPositionResult {
  shift: boolean;
  expand: boolean;
  positions: PositionId[];
}

/** 单手指法分析；只要该手有一个音没有合法指法就返回 null，交给音高兜底。 */
function analyzeHandByFingering(score: Score, hand: Hand): HandPositionResult | null {
  const notes = soundingNotes(score, hand);
  if (notes.length === 0) return null;
  const allFingered = notes.every(
    (note) =>
      note.fingers &&
      note.fingers.length === note.pitches.length &&
      note.fingers.every((finger) => finger >= 1 && finger <= 5),
  );
  if (!allFingered) return null;

  const counts = new Map<PositionId, number>();
  const fingeredNotes: Array<{ pitches: Pitch[]; fingers: number[] }> = [];
  let fingeredPitches = 0;
  let hasExpansion = false;

  for (const note of notes) {
    const fingers = note.fingers!;
    fingeredPitches += note.pitches.length;
    fingeredNotes.push({ pitches: note.pitches, fingers });
    const matches = POSITIONS.filter((position) =>
      note.pitches.every((pitch, index) => fingerFitsPosition(pitch, fingers[index], position, hand)),
    );
    for (const position of matches) {
      counts.set(position, (counts.get(position) ?? 0) + note.pitches.length);
    }
    if (matches.length === 0) {
      const expansion = POSITIONS.some((position) =>
        note.pitches.some((pitch) => pitchFitsExpansion(pitch, position, hand)),
      );
      if (expansion) hasExpansion = true;
    }
  }

  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  // 一个手位至少要覆盖 3 个音、或 10% 的音，才算「真的用过」。
  // 10% 而不是 15%：8 小节教学曲里一个完整和弦只占 12.5%，
  // 它已经是真实的换位，不能因为篇幅短就被忽略。
  const significant = ranked.filter(([, count]) => count >= Math.max(3, Math.ceil(fingeredPitches * 0.1)));
  if (significant.length > 1) {
    return { shift: true, expand: hasExpansion, positions: ranked.map(([position]) => position) };
  }

  const best = ranked[0]?.[0];
  let expand = hasExpansion;
  if (best) {
    for (const note of fingeredNotes) {
      const fitsBest = note.pitches.every((pitch, index) =>
        fingerFitsPosition(pitch, note.fingers[index], best, hand),
      );
      if (!fitsBest && note.pitches.some((pitch) => pitchFitsExpansion(pitch, best, hand))) {
        expand = true;
      }
    }
  }
  return { shift: false, expand, positions: best ? [best] : [] };
}

/** 单手音高兜底：没有指法时只能判断「有没有换位/扩张」。 */
function analyzeHandByPitch(score: Score, hand: Hand): HandPositionResult | null {
  const notes = soundingNotes(score, hand);
  if (notes.length === 0) return null;

  const baseCover = POSITIONS.find((position) =>
    notes.every((note) => pitchesFitPosition(note.pitches, position, hand)),
  );
  if (baseCover) return { shift: false, expand: false, positions: [baseCover] };

  const expandCover = POSITIONS.find((position) =>
    notes.every(
      (note) =>
        pitchesFitPosition(note.pitches, position, hand) || pitchesFitExpansion(note.pitches, position, hand),
    ),
  );
  if (expandCover) return { shift: false, expand: true, positions: [expandCover] };

  const positions = new Set<PositionId>();
  for (const note of notes) {
    for (const position of POSITIONS) {
      if (pitchesFitPosition(note.pitches, position, hand)) positions.add(position);
    }
  }
  return { shift: true, expand: false, positions: [...positions] };
}

/**
 * 判断是否需要在曲中换手位，或只是原地扩一个二度。
 *
 * 按手分别判断：右手在 C、左手在 F 这种「两只手各自静态」不算换位；
 * 只有同一只手在曲中换了位置才算 `pos.shift`。
 *
 * 指法优先：同一串音在 C 手位和 D 手位的指法不同，因此可以区分
 * 「C 手位 + 高音 A4 扩张」和「C → D 平移」。
 * 没有指法时只能按音高覆盖估计，C→D 这类会被误判为扩张，内容 QA
 * 应要求曲目包带指法（validateSongContent 会报错）。
 */
export function analyzeHandPositions(score: Score): PositionAnalysis {
  const results: HandPositionResult[] = [];
  let source: "fingering" | "pitch" = "fingering";

  for (const hand of score.hands) {
    const fingered = analyzeHandByFingering(score, hand);
    const result = fingered ?? analyzeHandByPitch(score, hand);
    if (!fingered) source = "pitch";
    if (result) results.push(result);
  }

  return {
    shift: results.some((result) => result.shift),
    expand: results.some((result) => result.expand),
    positions: [...new Set(results.flatMap((result) => result.positions))],
    source,
  };
}

/** 相邻发声音之间的最大音程（半音数），休止处断开。 */
function maxLeapSemitones(score: Score): number {
  let max = 0;
  for (const hand of score.hands) {
    const stave = score.staves[hand];
    if (!stave) continue;
    let prev: number[] | null = null;
    for (const measure of stave.measures) {
      for (const note of measure.notes) {
        if (note.pitches.length === 0) {
          prev = null;
          continue;
        }
        const mids = note.pitches.map(pitchKey);
        if (prev) {
          // 取两个发声事件之间最近的音高距离：和弦换位（C-E-G → G-B-D）
          // 不是旋律跳进，不能把低音到高音的跨声部距离算成手位跳进。
          let nearest = Number.POSITIVE_INFINITY;
          for (const a of prev) for (const b of mids) nearest = Math.min(nearest, Math.abs(a - b));
          max = Math.max(max, nearest);
        }
        prev = mids;
      }
    }
  }
  return max;
}

/** 最小能容纳这份乐谱的档位；任何档都不容纳时返回 7（超出词汇表）。 */
export function minLevelForScore(score: Score): number {
  for (let l = 1; l <= 6; l++) {
    if (isAllowed({ ...score, level: l as Score["level"] })) return l;
  }
  return 7;
}

/** 统计每只手的发声音拍点，用于区分「交替」和「同拍」。 */
function soundingBeats(score: Score): Map<Hand, Set<number>> {
  const out = new Map<Hand, Set<number>>();
  for (const hand of score.hands) {
    const beats = new Set<number>();
    const stave = score.staves[hand];
    if (stave) {
      let beat = 0;
      for (const measure of stave.measures) {
        for (const note of measure.notes) {
          const beatsForNote = DURATION_BEATS[note.duration];
          if (note.pitches.length > 0 && !note.duration.endsWith("r")) beats.add(beat);
          beat += beatsForNote;
        }
      }
    }
    out.set(hand, beats);
  }
  return out;
}

/** 是否有跨拍的切分：从半拍开始、且时值至少一拍。 */
function hasSyncopation(score: Score): boolean {
  for (const hand of score.hands) {
    const stave = score.staves[hand];
    if (!stave) continue;
    let beat = 0;
    for (const measure of stave.measures) {
      for (const note of measure.notes) {
        const beats = DURATION_BEATS[note.duration];
        if (note.pitches.length > 0 && !note.duration.endsWith("r")) {
          const offBeat = Math.abs((beat % 1) - 0.5) < 1e-6;
          if (offBeat && beats >= 1) return true;
        }
        beat += beats;
      }
    }
  }
  return false;
}

/** 3 个音级是否能组成大三/小三/减/增三和弦（允许任意转位）。 */
function isTriadPitchClasses(pitchClasses: number[]): boolean {
  if (pitchClasses.length !== 3) return false;
  const triads = new Set(["0,3,7", "0,4,7", "0,3,6", "0,4,8"]);
  for (const root of pitchClasses) {
    const normalized = pitchClasses
      .map((pc) => (pc - root + 12) % 12)
      .sort((a, b) => a - b)
      .join(",");
    if (triads.has(normalized)) return true;
  }
  return false;
}

/**
 * 分解和弦织体：低音手在至少两个小节里出现「从最低音起、跨五度以上、
 * 包含一次三度以上跳进、音级构成三和弦」的连续单音型。
 * 这是启发式，用于把 L4 编配从「单音旋律」里区分出来。
 */
function hasBrokenChordTexture(score: Score): boolean {
  if (score.hands.length < 2) return false;
  const patternCounts = new Map<string, number>();
  for (const hand of score.hands) {
    if (hand !== "LH") continue;
    const stave = score.staves[hand];
    if (!stave) continue;
    for (const measure of stave.measures) {
      const notes = measure.notes.filter(
        (note) => note.pitches.length === 1 && !note.duration.endsWith("r"),
      );
      if (notes.length < 4) continue;
      const midis = notes.map((note) => pitchToMidi(note.pitches[0]));
      const span = Math.max(...midis) - Math.min(...midis);
      if (span < 7) continue;
      if (midis[0] !== Math.min(...midis)) continue;
      if (!midis.slice(1).some((midi, index) => Math.abs(midi - midis[index]) >= 4)) continue;
      const pitchClasses = [...new Set(midis.map((midi) => midi % 12))].sort((a, b) => a - b);
      if (!isTriadPitchClasses(pitchClasses)) continue;
      const key = pitchClasses.join(",");
      const count = (patternCounts.get(key) ?? 0) + 1;
      patternCounts.set(key, count);
      if (count >= 2) return true;
    }
  }
  return false;
}

/** 不同三和弦的出现次数；>= 2 视为需要「和弦连接」技能。 */
function chordProgressionCount(score: Score): number {
  const chords = new Set<string>();
  for (const hand of score.hands) {
    const stave = score.staves[hand];
    if (!stave) continue;
    for (const measure of stave.measures) {
      for (const note of measure.notes) {
        if (note.pitches.length < 3) continue;
        const pcs = [...new Set(note.pitches.map((pitch) => pitchToMidi(pitch) % 12))].sort((a, b) => a - b);
        chords.add(pcs.join(","));
      }
    }
  }
  return chords.size;
}

/** 从乐谱内容推导所需技能 id 集合（拆解引擎核心）。 */
export function requiredSkillsForScore(score: Score): Set<string> {
  const skills = new Set<string>();

  for (const hand of score.hands) {
    skills.add(hand === "RH" ? "clef.treble" : "clef.bass");
    skills.add("pos.five");
  }
  skills.add(keySkill(score.keySignature));

  let hasAccidental = false;
  let maxChordSize = 1;
  let rhythm: string | null = null;
  for (const hand of score.hands) {
    const stave = score.staves[hand];
    if (!stave) continue;
    for (const measure of stave.measures) {
      for (const note of measure.notes) {
        const r = rhythmSkill(note.duration);
        if (rhythm === null || RHYTHM_RANK[r] > RHYTHM_RANK[rhythm]) rhythm = r;
        maxChordSize = Math.max(maxChordSize, note.pitches.length);
        for (const p of note.pitches) {
          if (p.alteration !== keyAlteration(score.keySignature, p.step)) hasAccidental = true;
        }
      }
    }
  }

  if (rhythm) skills.add(rhythm);
  if (hasAccidental) skills.add("key.accidental");
  if (hasSyncopation(score)) skills.add("rhythm.syncopation");

  if (maxChordSize >= 3) skills.add("chord.triad");
  else if (maxChordSize === 2) skills.add("chord.interval");
  if (chordProgressionCount(score) >= 2) skills.add("chord.progression");

  const positions = analyzeHandPositions(score);
  if (positions.shift) skills.add("pos.shift");
  if (positions.expand) skills.add("pos.expand");
  if (maxLeapSemitones(score) >= 8) skills.add("pos.leap");

  const beats = soundingBeats(score);
  const rh = beats.get("RH") ?? new Set<number>();
  const lh = beats.get("LH") ?? new Set<number>();
  if (rh.size > 0 && lh.size > 0) {
    skills.add("hands.both");
    const shared = [...rh].some((beat) => lh.has(beat));
    const onlyRh = [...rh].some((beat) => !lh.has(beat));
    const onlyLh = [...lh].some((beat) => !rh.has(beat));
    if (shared) skills.add("hands.together");
    if (onlyRh && onlyLh) skills.add("hands.alternate");
  }

  if (hasBrokenChordTexture(score)) skills.add("texture.broken");

  return skills;
}

/** 技能集合对应的最高档位（未知 id 忽略）。 */
export function maxSkillLevel(ids: Iterable<string>): number {
  let m = 0;
  for (const id of ids) {
    const s = SKILL_BY_ID.get(id);
    if (s) m = Math.max(m, s.level);
  }
  return m;
}

/** 某技能的全部前置闭包。 */
export function prerequisites(id: string): Set<string> {
  const out = new Set<string>();
  const stack = [...(SKILL_BY_ID.get(id)?.prereq ?? [])];
  while (stack.length) {
    const cur = stack.pop()!;
    if (out.has(cur)) continue;
    out.add(cur);
    stack.push(...(SKILL_BY_ID.get(cur)?.prereq ?? []));
  }
  return out;
}

/** 补短板：目标技能 vs 已掌握技能 → 缺失技能（含其未掌握的前置，保证学习顺序）。 */
export function missingSkills(required: Iterable<string>, mastered: Iterable<string>): Set<string> {
  const done = new Set(mastered);
  const missing = new Set<string>();
  for (const id of required) if (!done.has(id)) missing.add(id);
  for (const id of [...missing]) {
    for (const p of prerequisites(id)) if (!done.has(p)) missing.add(p);
  }
  return missing;
}

/** 供 manifest 校验使用：所有合法技能 id（物化为数组，可重复迭代）。 */
export function knownSkillIds(): readonly string[] {
  return [...SKILL_BY_ID.keys()];
}
