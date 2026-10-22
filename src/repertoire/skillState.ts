import type { Profile } from "../domain/profile";
import { L3_PREP_SKILL_MAP } from "../practice/l3Lessons";
import { SKILLS, SKILL_BY_ID, type SkillState } from "./skillGraph";

/**
 * ── 技能掌握状态账本 ─────────────────────────────────────────
 * 两条学习路径（按部就班 / 先选曲）写同一份状态。
 *
 * 但「一个技能一个 state」不足以表达 MVP 的现实：
 *  - 同一技能左右手可以不同步（L1 本来就是分左右手解锁）；
 *  - 同一技能在不同速度下掌握程度不同；
 *  - 技能会遗忘。
 *
 * 所以账本的 key 是 skillId + hand，value 带 bpm / confidence / 时间戳。
 * `passed` 只能由该技能的过关检查写入；课内完成只写 `learning`，
 * 避免路径 B 的 5 分钟练习绕过 MVP 的「识谱过关才解锁视奏」。
 */

export type SkillHand = "RH" | "LH" | "both" | "none";
export type MasteryHand = "RH" | "LH" | "both";

export interface SkillMastery {
  skillId: string;
  hand: SkillHand;
  state: SkillState;
  /** 该技能最近一次稳定完成的速度；没有速度概念时为空 */
  bpm?: number;
  /** 0..1，练习次数越多越接近 1；passed 固定为 1 */
  confidence: number;
  masteredAt?: number;
  lastPracticedAt?: number;
}

export type SkillLedger = Record<string, SkillMastery>;

export interface PracticeOptions {
  passed?: boolean;
  bpm?: number;
  at?: number;
}

export function skillKey(skillId: string, hand: SkillHand): string {
  return `${skillId}@${hand}`;
}

/** 技能是单手、双手还是与手无关（节奏/调号）。 */
export function skillHandScope(skillId: string): "RH" | "LH" | "both" | "none" {
  if (skillId === "clef.treble") return "RH";
  if (skillId === "clef.bass") return "LH";
  if (
    skillId.startsWith("rhythm.") ||
    skillId.startsWith("key.") ||
    skillId.startsWith("pedal.")
  ) {
    return "none";
  }
  return "both";
}

function resolveHand(skillId: string, hand: MasteryHand): SkillHand {
  const scope = skillHandScope(skillId);
  if (scope === "none") return "none";
  if (scope === "RH") return "RH";
  if (scope === "LH") return "LH";
  return hand === "RH" || hand === "LH" ? hand : "both";
}

function passed(ledger: SkillLedger, skillId: string, hand: SkillHand): boolean {
  return ledger[skillKey(skillId, hand)]?.state === "passed";
}

/** 某技能是否已掌握。默认要求双手（单手技能只看对应手）。 */
export function isMastered(ledger: SkillLedger, skillId: string, hand: MasteryHand = "both"): boolean {
  const scope = skillHandScope(skillId);
  if (scope === "none") return passed(ledger, skillId, "none");
  if (scope === "RH") return passed(ledger, skillId, "RH") || passed(ledger, skillId, "both");
  if (scope === "LH") return passed(ledger, skillId, "LH") || passed(ledger, skillId, "both");
  if (hand === "RH") return passed(ledger, skillId, "RH") || passed(ledger, skillId, "both");
  if (hand === "LH") return passed(ledger, skillId, "LH") || passed(ledger, skillId, "both");
  return (
    passed(ledger, skillId, "both") ||
    (passed(ledger, skillId, "RH") && passed(ledger, skillId, "LH"))
  );
}

/** 供 missingSkills 使用：当前用户已掌握的技能 id 集合。 */
export function masteredSkillIds(ledger: SkillLedger, hand: MasteryHand = "both"): Set<string> {
  const out = new Set<string>();
  for (const skill of SKILLS) {
    if (isMastered(ledger, skill.id, hand)) out.add(skill.id);
  }
  return out;
}

/** 记录一次练习。passed 只能由过关检查传入；普通练习最多把状态推到 learning。 */
export function recordPractice(
  ledger: SkillLedger,
  skillId: string,
  hand: MasteryHand,
  opts: PracticeOptions = {},
): SkillLedger {
  const at = opts.at ?? Date.now();
  const resolved = resolveHand(skillId, hand);
  const key = skillKey(skillId, resolved);
  const existing = ledger[key];
  const state: SkillState = opts.passed
    ? "passed"
    : existing?.state === "passed"
      ? "passed"
      : "learning";
  const confidence = opts.passed || existing?.state === "passed"
    ? 1
    : Math.min(0.8, (existing?.confidence ?? 0) + 0.15);
  return {
    ...ledger,
    [key]: {
      skillId,
      hand: resolved,
      state,
      bpm: opts.bpm ?? existing?.bpm,
      confidence,
      masteredAt: opts.passed ? (existing?.masteredAt ?? at) : existing?.masteredAt,
      lastPracticedAt: at,
    },
  };
}

/** L1–L6 过关测试覆盖的技能。L1 可按左右手分别过关。 */
export const LEVEL_SKILLS: Record<number, readonly string[]> = {
  1: ["clef.treble", "clef.bass", "pos.five", "rhythm.quarter", "key.c"],
  2: [
    "rhythm.eighth",
    "hands.both",
    "hands.alternate",
    "hands.together",
    "key.one-flat",
    "key.one-sharp",
    "pos.shift",
  ],
  3: ["chord.interval", "chord.triad", "chord.progression", "key.accidental"],
  4: ["key.two-acc", "pos.expand", "texture.broken", "chord.inversion", "pedal.sustain"],
  5: ["rhythm.dotted", "rhythm.syncopation", "chord.seventh"],
  6: ["rhythm.sixteenth", "pos.leap"],
};

type LessonId = NonNullable<Profile["lessonId"]>;

type LessonSkill = { skillId: string; hand?: MasteryHand };

/** 课内完成只写 learning；过关测试才写 passed。 */
export const LESSON_SKILL_MAP: Record<LessonId, readonly LessonSkill[]> = {
  "L1-1": [{ skillId: "rhythm.quarter" }],
  "L1-2": [
    { skillId: "clef.treble", hand: "RH" },
    { skillId: "pos.five", hand: "RH" },
  ],
  "L1-3": [
    { skillId: "clef.treble", hand: "RH" },
    { skillId: "rhythm.quarter" },
  ],
  "L1-4": [
    { skillId: "clef.bass", hand: "LH" },
    { skillId: "pos.five", hand: "LH" },
  ],
  "L1-test": LEVEL_SKILLS[1].map((skillId) => ({ skillId })),
  "L2-1": [{ skillId: "rhythm.eighth" }],
  "L2-2": [{ skillId: "hands.both" }, { skillId: "hands.alternate" }],
  "L2-3": [{ skillId: "hands.both" }, { skillId: "hands.together" }],
  "L2-4": [{ skillId: "key.one-flat" }, { skillId: "pos.five" }],
  "L2-5": [{ skillId: "key.one-sharp" }, { skillId: "pos.five" }],
  "L2-6": [{ skillId: "pos.shift" }],
  "L2-test": LEVEL_SKILLS[2].map((skillId) => ({ skillId })),
};

export function applyLessonCompletion(
  ledger: SkillLedger,
  lessonId: LessonId,
  at: number = Date.now(),
): SkillLedger {
  let next = ledger;
  for (const { skillId, hand } of LESSON_SKILL_MAP[lessonId]) {
    next = recordPractice(next, skillId, hand ?? "both", { at, passed: false });
  }
  return next;
}

/** L3 预备课只写 learning：它是补短板的入口，不是技能过关。 */
export function applyL3PrepCompletion(
  ledger: SkillLedger,
  lessonId: string,
  at: number = Date.now(),
): SkillLedger {
  const skillIds = L3_PREP_SKILL_MAP[lessonId] ?? [];
  let next = ledger;
  for (const skillId of skillIds) {
    next = recordPractice(next, skillId, "both", { at, passed: false });
  }
  return next;
}

export function applyLevelTestPass(
  ledger: SkillLedger,
  level: number,
  hand: MasteryHand = "both",
  at: number = Date.now(),
): SkillLedger {
  const skills = LEVEL_SKILLS[level];
  if (!skills) return ledger;
  const targets: MasteryHand[] = level === 1 && hand !== "both" ? [hand] : ["both"];
  let next = ledger;
  for (const skillId of skills) {
    const scope = skillHandScope(skillId);
    // 单手 L1 过关只写该手能证明的技能：右手测试不应把低音谱也标成通过。
    if (level === 1 && hand !== "both" && scope !== "none" && scope !== "both" && scope !== hand) {
      continue;
    }
    for (const target of targets) {
      next = recordPractice(next, skillId, target, { at, passed: true });
    }
  }
  return next;
}

/**
 * 把 MVP 现有 Profile 迁移到账本。
 * 已过关的 L1 按左右手分别写；L2 及以后按双手写；当前在学的课只写 learning。
 */
export function migrateProfile(profile: Profile, at: number = Date.now()): SkillLedger {
  let ledger: SkillLedger = {};
  if (profile.l1RightPassed) ledger = applyLevelTestPass(ledger, 1, "RH", at);
  if (profile.l1LeftPassed) ledger = applyLevelTestPass(ledger, 1, "LH", at);
  if (profile.l2Passed) ledger = applyLevelTestPass(ledger, 2, "both", at);
  if (profile.lessonId) {
    ledger = applyLessonCompletion(ledger, profile.lessonId, at);
  }
  for (const lessonId of profile.l3PrepCompleted ?? []) {
    ledger = applyL3PrepCompletion(ledger, lessonId, at);
  }
  return ledger;
}

/** 超过 staleDays 没练的已掌握技能；用于「先选曲」前的复习提示。 */
export function staleSkills(
  ledger: SkillLedger,
  now: number = Date.now(),
  staleDays = 30,
): SkillMastery[] {
  const cutoff = now - staleDays * 24 * 60 * 60 * 1000;
  return Object.values(ledger).filter(
    (item) => item.state === "passed" && (item.lastPracticedAt ?? 0) < cutoff,
  );
}

export function summarizeLedger(ledger: SkillLedger): Record<SkillState | "total", number> {
  const summary: Record<SkillState | "total", number> = { locked: 0, learning: 0, passed: 0, total: 0 };
  for (const skill of SKILLS) {
    const scope = skillHandScope(skill.id);
    const hands: SkillHand[] =
      scope === "none" ? ["none"] : scope === "RH" ? ["RH"] : scope === "LH" ? ["LH"] : ["RH", "LH"];
    if (scope === "both" && ledger[skillKey(skill.id, "both")]) {
      const item = ledger[skillKey(skill.id, "both")];
      summary.total += 1;
      summary[item.state] += 1;
      continue;
    }
    for (const hand of hands) {
      const item = ledger[skillKey(skill.id, hand)];
      summary.total += 1;
      if (item) summary[item.state] += 1;
    }
  }
  return summary;
}

/** 校验账本里的技能 id 是否都存在于图谱；用于持久化恢复。 */
export function unknownSkillIds(ledger: SkillLedger): string[] {
  return [...new Set(Object.values(ledger).map((item) => item.skillId))].filter(
    (id) => !SKILL_BY_ID.has(id),
  );
}
