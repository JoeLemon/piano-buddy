import type { LessonId } from "./profile";

/**
 * 曲库缺技能 → 具体微课。
 *
 * 曲库只负责说明「差什么」，但用户真正需要的是「去哪补」。这里把技能图谱里
 * L1–L3 的技能映射到现有课程；L4–L6 的织体、转位、小调、七和弦、拍号与
 * 节奏技能映射到乐理练习的 L4–L6 预备关（`stage` 直达练习页）；没有内容的
 * 技能返回 null，界面显示「暂无微课」。
 */
export type SkillRoute =
  | { kind: "reading"; lessonId: LessonId; label: string }
  | { kind: "l3"; lessonId: LessonId; label: string }
  | { kind: "theory"; lessonId: string; label: string }
  | { kind: "stage"; stageId: string; label: string };

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
  // L4–L6：乐理地图的预备关（练习页题型，不是独立课程界面）
  "texture.broken": { kind: "stage", stageId: "L4-1", label: "去 L4 预备 · 分解和弦" },
  "pos.expand": { kind: "stage", stageId: "L4-2", label: "去 L4 预备 · 手位读谱" },
  "chord.inversion": { kind: "stage", stageId: "L4-3", label: "去 L4 预备 · 和弦转位" },
  "chord.minor": { kind: "stage", stageId: "L4-4", label: "去 L4 预备 · 小调与小三和弦" },
  "key.minor": { kind: "stage", stageId: "L4-4", label: "去 L4 预备 · 小调与小三和弦" },
  "chord.seventh": { kind: "stage", stageId: "L5-1", label: "去 L5 预备 · 七和弦" },
  // 减七/半减七有专门的一节 L6 预备课（题库只筛这两类，四题从四个例子里取）。
  "chord.diminished": { kind: "stage", stageId: "L6-6", label: "去 L6 预备 · 减七与半减七" },
  "meter.six-eight": { kind: "stage", stageId: "L5-2", label: "去 L5 预备 · 6/8 拍" },
  "rhythm.triplet": { kind: "stage", stageId: "L5-3", label: "去 L5 预备 · 三连音" },
  "rhythm.dotted": { kind: "stage", stageId: "L5-4", label: "去 L5 预备 · 附点与切分" },
  "rhythm.syncopation": { kind: "stage", stageId: "L5-4", label: "去 L5 预备 · 附点与切分" },
  "rhythm.sixteenth": { kind: "stage", stageId: "L6-1", label: "去 L6 预备 · 十六分音符" },
  "pos.leap": { kind: "stage", stageId: "L6-2", label: "去 L6 预备 · 六度与八度跳进" },
};

export function routeForSkill(skillId: string): SkillRoute | null {
  return ROUTES[skillId] ?? null;
}
