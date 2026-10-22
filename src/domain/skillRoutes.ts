import type { LessonId } from "./profile";

/**
 * 曲库缺技能 → 具体微课。
 *
 * 曲库只负责说明「差什么」，但用户真正需要的是「去哪补」。这里把技能图谱里
 * L1–L3 的技能映射到现有课程；L4+ 还没有课，返回 null，界面显示「暂无微课」。
 */
export type SkillRoute =
  | { kind: "reading"; lessonId: LessonId; label: string }
  | { kind: "l3"; lessonId: LessonId; label: string }
  | { kind: "theory"; lessonId: string; label: string };

const ROUTES: Record<string, SkillRoute> = {
  "rhythm.quarter": { kind: "reading", lessonId: "L1-1", label: "去 L1 跟拍" },
  "clef.treble": { kind: "reading", lessonId: "L1-2", label: "去 L1 认五线" },
  "key.c": { kind: "reading", lessonId: "L1-2", label: "去 L1 认 C 调" },
  "pos.five": { kind: "reading", lessonId: "L1-3", label: "去 L1 右手短句" },
  "clef.bass": { kind: "reading", lessonId: "L1-4", label: "去 L1 左手" },
  "rhythm.eighth": { kind: "reading", lessonId: "L2-1", label: "去 L2 八分音符" },
  "hands.both": { kind: "reading", lessonId: "L2-2", label: "去 L2 双手交替" },
  "hands.alternate": { kind: "reading", lessonId: "L2-3", label: "去 L2 双手同拍" },
  "hands.together": { kind: "reading", lessonId: "L2-3", label: "去 L2 双手同拍" },
  "key.one-flat": { kind: "reading", lessonId: "L2-4", label: "去 L2 F 五指" },
  "key.one-sharp": { kind: "reading", lessonId: "L2-5", label: "去 L2 G 五指" },
  "pos.shift": { kind: "reading", lessonId: "L2-6", label: "去 L2 手位平移" },
  "chord.interval": { kind: "l3", lessonId: "L3R-1", label: "去 L3 双音" },
  "chord.triad": { kind: "l3", lessonId: "L3R-2", label: "去 L3 三和弦" },
  "chord.progression": { kind: "theory", lessonId: "L3-4", label: "去 L3 预备 · 和弦连接" },
  "key.accidental": { kind: "l3", lessonId: "L3R-4", label: "去 L3 临时升降" },
};

export function routeForSkill(skillId: string): SkillRoute | null {
  return ROUTES[skillId] ?? null;
}
