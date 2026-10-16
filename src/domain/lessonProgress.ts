import type { Profile } from "./profile";

export type LessonStepId = "L1-1" | "L1-2" | "L1-3" | "L1-4" | "L1-test";

const STEPS: readonly LessonStepId[] = ["L1-1", "L1-2", "L1-3", "L1-4", "L1-test"];

const STEP_LABELS: Record<LessonStepId, string> = {
  "L1-1": "跟拍",
  "L1-2": "认五个音",
  "L1-3": "右手短句",
  "L1-4": "左手",
  "L1-test": "过关",
};

const TAP_GOAL = 8;
const FIND_GOAL = 8;
const LINE_GOAL = 2;

export function lessonSteps(): readonly LessonStepId[] {
  return STEPS;
}

export function lessonStepLabel(id: LessonStepId): string {
  return STEP_LABELS[id];
}

export function currentLessonIndex(profile: Profile): number {
  if (!profile.lessonId) return -1;
  return STEPS.indexOf(profile.lessonId);
}

export function lessonGoalText(profile: Profile): string {
  switch (profile.lessonId) {
    case "L1-1":
      return `稳拍 ${profile.tapStreak}/${TAP_GOAL}`;
    case "L1-2":
      return `找键 ${profile.findCorrect}/${FIND_GOAL}`;
    case "L1-3":
      return `短句 ${profile.linesCompleted}/${LINE_GOAL}`;
    case "L1-4":
      if (profile.lessonPhase === "notes") {
        return `找键 ${profile.findCorrect}/${FIND_GOAL}`;
      }
      return `短句 ${profile.linesCompleted}/${LINE_GOAL}`;
    case "L1-test":
      return "过关测试";
    default:
      return "";
  }
}

export function lessonAdvanceCopy(
  from: Profile["lessonId"],
  to: Profile["lessonId"],
): string {
  if (from === "L1-1" && to === "L1-2") return "跟拍稳住了。接下来认五个音。";
  if (from === "L1-2" && to === "L1-3") return "这五个音认得了。接下来弹右手短句。";
  if (from === "L1-3" && to === "L1-4") return "右手短句过了。接下来练左手。";
  if (from === "L1-4" && to === "L1-test") return "左手也认完了。准备过关测试。";
  return "";
}

export function homeLessonLabel(profile: Profile): string {
  if (!profile.lessonId) return "还没开始";
  if (profile.l1RightPassed && profile.l1LeftPassed) return "L1 已通过";
  if (profile.lessonId === "L1-test") {
    if (profile.l1RightPassed) return "过关：左手";
    if (profile.l1LeftPassed) return "过关：右手";
    return "过关测试";
  }
  return `当前：${STEP_LABELS[profile.lessonId]}`;
}
