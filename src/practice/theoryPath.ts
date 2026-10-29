import type { TheoryProgress } from "../domain/profile";
import { CURRICULUM_STAGES, L4_PREP_STAGES } from "./curriculum";
import { L3_PREP_LESSONS } from "./l3Lessons";
import type { PracticeKind } from "./quiz";
import type { SymbolGroup } from "./theoryContent";

/**
 * 乐理路径：一条进度串起「基础十关 + L3 预备九课 + L4 预备两课」。
 *
 * 原来的专项题组和 L3 预备课是两套入口、两套进度；这里把它们排成
 * 三章一条线。基础关按顺序解锁，L3/L4 课作为第二、三章可以随时复习
 * （曲库缺对应技能时按钮直达）；通过任意一章都会写入
 * `Profile.theoryPath`，和关卡测试共用同一份进度。
 */
export type TheoryChapterId = "basics" | "l3" | "l4";

export type TheoryChapter = {
  id: TheoryChapterId;
  title: string;
  description: string;
};

export type TheoryNode = {
  id: string;
  chapter: TheoryChapterId;
  title: string;
  goal: string;
  guidance: string;
  /** 基础关的题型；L3 课由 L3PrepView 承接，所以为空。 */
  kind?: PracticeKind;
  symbolGroups?: readonly SymbolGroup[];
  questionCount: number;
  passScore: number;
  /** L3 节点对应的课 id，点击后直接打开这一节。 */
  lessonId?: string;
};

export const THEORY_CHAPTERS: readonly TheoryChapter[] = [
  {
    id: "basics",
    title: "基础十关",
    description: "单音、符号、音程、和弦、进行、音型、听调性，按顺序过关。",
  },
  {
    id: "l3",
    title: "L3 预备课",
    description: "九节短课，配合 L3 和弦识谱；可以随时进去复习。",
  },
  {
    id: "l4",
    title: "L4 预备课",
    description: "两节短课：分解和弦与手位读谱，配合 L4 编配；可以随时进去复习。",
  },
];

export const THEORY_PATH: readonly TheoryNode[] = [
  ...CURRICULUM_STAGES.map((stage) => ({
    id: stage.id,
    chapter: "basics" as const,
    title: stage.title,
    goal: stage.goal,
    guidance: stage.guidance,
    kind: stage.kind,
    symbolGroups: stage.symbolGroups,
    questionCount: stage.questionCount,
    passScore: stage.passScore,
  })),
  ...L3_PREP_LESSONS.map((lesson) => ({
    id: lesson.id,
    chapter: "l3" as const,
    title: lesson.title,
    goal: lesson.goal,
    guidance: lesson.intro,
    questionCount: lesson.questionCount,
    passScore: lesson.passScore,
    lessonId: lesson.id,
  })),
  // L4 节直接是练习题型（没有独立界面），所以带 kind、不带 lessonId。
  ...L4_PREP_STAGES.map((stage) => ({
    id: stage.id,
    chapter: "l4" as const,
    title: stage.title,
    goal: stage.goal,
    guidance: stage.guidance,
    kind: stage.kind as PracticeKind,
    questionCount: stage.questionCount,
    passScore: stage.passScore,
  })),
];

export type TheoryNodeState = "done" | "available" | "locked";

/** 当前节点是否完成；L3 旧字段在加载时已经并进 theoryPath。 */
export function isTheoryNodeDone(progress: TheoryProgress, nodeId: string): boolean {
  return progress.completed.includes(nodeId);
}

/**
 * 基础关按顺序解锁；L3/L4 章不锁，保持「随时复习、缺技能直达」的定位。
 * 这样既有一条主线，又不会把已经学过的 L3/L4 课锁在十关后面。
 */
export function theoryNodeState(progress: TheoryProgress, node: TheoryNode): TheoryNodeState {
  if (isTheoryNodeDone(progress, node.id)) return "done";
  if (node.chapter !== "basics") return "available";
  const basics = THEORY_PATH.filter((item) => item.chapter === "basics");
  const index = basics.findIndex((item) => item.id === node.id);
  if (index <= 0) return "available";
  return isTheoryNodeDone(progress, basics[index - 1].id) ? "available" : "locked";
}

export function theoryChapterNodes(chapter: TheoryChapterId): readonly TheoryNode[] {
  return THEORY_PATH.filter((node) => node.chapter === chapter);
}

export function theoryChapterDone(
  progress: TheoryProgress,
  chapter: TheoryChapterId,
): number {
  return theoryChapterNodes(chapter).filter((node) => isTheoryNodeDone(progress, node.id)).length;
}

export function theoryPathDone(progress: TheoryProgress): number {
  return THEORY_PATH.filter((node) => isTheoryNodeDone(progress, node.id)).length;
}

/** 下一个建议节点：基础关里第一个没完成的；十关全过后是 L3、再是 L4 的第一节未完成。 */
export function nextTheoryNode(progress: TheoryProgress): TheoryNode | null {
  const basics = theoryChapterNodes("basics");
  const nextBasic = basics.find((node) => !isTheoryNodeDone(progress, node.id));
  if (nextBasic) {
    const index = basics.findIndex((node) => node.id === nextBasic.id);
    if (index === 0 || isTheoryNodeDone(progress, basics[index - 1].id)) return nextBasic;
  }
  return (
    theoryChapterNodes("l3").find((node) => !isTheoryNodeDone(progress, node.id)) ??
    theoryChapterNodes("l4").find((node) => !isTheoryNodeDone(progress, node.id)) ??
    null
  );
}
