import type { Profile } from "../domain/profile";
import { routeForSkill } from "../domain/skillRoutes";
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
  "L3R-1": [{ skillId: "chord.interval" }],
  "L3R-2": [{ skillId: "chord.triad", hand: "RH" }],
  "L3R-3": [{ skillId: "chord.triad", hand: "LH" }],
  "L3R-4": [{ skillId: "key.accidental" }],
  "L3R-test": LEVEL_SKILLS[3].map((skillId) => ({ skillId })),
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

/**
 * 记一次曲库跟弹：整段弹对才算，且只写 learning。
 *
 * 为什么不写 passed：把一首曲子弹下来不等于会认谱——学生可以盯着指法数字
 * 或者靠肌肉记忆弹完一段。识谱是否过关仍由各级过关测试判定，这里只留下
 * 「在什么速度下练过」的证据，让缺技能清单看得出练习量。
 *
 * 图谱里没有的技能 id 直接跳过：内容包可以声明额外技能，账本不替它们打分。
 */
export function recordFollowPractice(
  ledger: SkillLedger,
  skillIds: Iterable<string>,
  hand: MasteryHand,
  bpm?: number,
  at: number = Date.now(),
): SkillLedger {
  let next = ledger;
  for (const skillId of skillIds) {
    if (!SKILL_BY_ID.has(skillId)) continue;
    next = recordPractice(next, skillId, hand, { bpm, at, passed: false });
  }
  return next;
}

/** 某个技能最近一次的练习记录；没练过返回 null。左右手分开记，取最新的那条。 */
export function practiceEvidence(ledger: SkillLedger, skillId: string): SkillMastery | null {
  let best: SkillMastery | null = null;
  for (const item of Object.values(ledger)) {
    if (item.skillId !== skillId) continue;
    if (!best || (item.lastPracticedAt ?? 0) >= (best.lastPracticedAt ?? 0)) best = item;
  }
  return best;
}

/**
 * 补短板排序：档位升序（保证前置先学），同档里「练过」的排前面。
 *
 * 练过的技能是半熟——学生在曲子里已经能把它弹下来，只差认谱过关。先把这些
 * 补成 passed 最快，也能让学生看见「先选曲」路径的练习确实在推进按部就班
 * 的关卡；没碰过的技能按 id 稳定排序，不来回跳动。
 *
 * 注意这不改 missingSkills 的结果，只改展示顺序：补短板的集合仍由
 * 「缺什么 + 未掌握的前置」决定。
 */
export function missingSkillOrder(missing: Iterable<string>, ledger: SkillLedger): string[] {
  return [...missing].sort((a, b) => {
    const level = (SKILL_BY_ID.get(a)?.level ?? 0) - (SKILL_BY_ID.get(b)?.level ?? 0);
    if (level !== 0) return level;
    const practicedA = practiceEvidence(ledger, a) ? 0 : 1;
    const practicedB = practiceEvidence(ledger, b) ? 0 : 1;
    if (practicedA !== practicedB) return practicedA - practicedB;
    return a.localeCompare(b);
  });
}

/**
 * 补短板耗时估算：把缺口折算成「还要练多少分钟」。
 *
 * 粗估，回答的是「这首曲子离能弹还差多久」：按档位给每个技能一个基准分钟数
 * （L1 5 / L2 8 / L3 12，随档位递增——越往后一课的容量越大），练过的打三折
 * ——曲子已经能弹下来，只差认谱过关，复习一遍比从头学快。
 *
 * 没有微课的技能（L4+）不计入分钟：没有课就谈不上「多久补完」，界面会单独
 * 说「暂无微课」。宁可少算，也不虚报一个到不了的承诺。
 *
 * 分钟数是估算，界面用「约」字开口；不作为验收承诺。
 */
const PRACTICE_MINUTES_BY_LEVEL: Record<number, number> = {
  1: 5,
  2: 8,
  3: 12,
  4: 15,
  5: 18,
  6: 20,
};
/** 练过但未过关的折数：复习一遍即可，不必从头学。 */
const PRACTICED_RATIO = 0.3;

export interface PracticeEstimate {
  /** 预计分钟数（四舍五入到整分钟）。 */
  minutes: number;
  /** 参与估算的缺口数（有微课的那部分）。 */
  estimated: number;
  /** 没有微课、无法估算的缺口数。 */
  unrouted: number;
}

export function estimatePracticeMinutes(
  missing: Iterable<string>,
  ledger: SkillLedger,
): PracticeEstimate {
  let raw = 0;
  let estimated = 0;
  let unrouted = 0;
  for (const id of missing) {
    const skill = SKILL_BY_ID.get(id);
    if (!skill || !routeForSkill(id)) {
      unrouted += 1;
      continue;
    }
    const base = PRACTICE_MINUTES_BY_LEVEL[skill.level] ?? 10;
    raw += practiceEvidence(ledger, id) ? base * PRACTICED_RATIO : base;
    estimated += 1;
  }
  return { minutes: Math.round(raw), estimated, unrouted };
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
 *
 * 从档案里已存的账本出发，再把过关状态叠上去：曲库跟弹写下的练习证据
 * （learning + bpm）因此能跨会话保留，而已过关的技能仍由关卡测试置为 passed。
 */
export function migrateProfile(profile: Profile, at: number = Date.now()): SkillLedger {
  let ledger: SkillLedger = { ...(profile.skillLedger ?? {}) };
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
