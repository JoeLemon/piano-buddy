import type { Profile } from "./profile";

export type LessonStepId = NonNullable<Profile["lessonId"]>;

const L1_STEPS: readonly LessonStepId[] = ["L1-1", "L1-2", "L1-3", "L1-4", "L1-test"];
const L2_STEPS: readonly LessonStepId[] = ["L2-1", "L2-2", "L2-3", "L2-4", "L2-5", "L2-6", "L2-test"];
const L3_STEPS: readonly LessonStepId[] = ["L3R-1", "L3R-2", "L3R-3", "L3R-4", "L3R-test"];

const STEP_LABELS: Record<LessonStepId, string> = {
  "L1-1": "跟拍",
  "L1-2": "认五个音",
  "L1-3": "右手短句",
  "L1-4": "左手",
  "L1-test": "过关",
  "L2-1": "八分音符",
  "L2-2": "双手交替",
  "L2-3": "双手同拍",
  "L2-4": "F 五指",
  "L2-5": "G 五指",
  "L2-6": "五指平移",
  "L2-test": "过关",
  "L3R-1": "双音",
  "L3R-2": "右手三和弦",
  "L3R-3": "左手三和弦",
  "L3R-4": "临时升降",
  "L3R-test": "L3 过关",
};

const TAP_GOAL = 8;
export const FIND_GOAL = 8;
const LINE_GOAL = 2;

export function lessonSteps(level: 1 | 2 | 3 = 1): readonly LessonStepId[] {
  if (level === 3) return L3_STEPS;
  return level === 2 ? L2_STEPS : L1_STEPS;
}

export function lessonStepLabel(id: LessonStepId): string {
  return STEP_LABELS[id];
}

export function currentLessonIndex(profile: Profile): number {
  if (!profile.lessonId) return -1;
  const steps = profile.lessonId.startsWith("L3R")
    ? L3_STEPS
    : profile.lessonId.startsWith("L2")
      ? L2_STEPS
      : L1_STEPS;
  return steps.indexOf(profile.lessonId);
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
    case "L2-1":
    case "L2-2":
    case "L2-3":
    case "L2-6":
      return `短句 ${profile.linesCompleted}/${LINE_GOAL}`;
    case "L2-4":
    case "L2-5":
      return `找键 ${profile.findCorrect}/${FIND_GOAL * 2}`;
    case "L2-test":
      return "过关测试";
    case "L3R-1":
    case "L3R-2":
    case "L3R-3":
    case "L3R-4":
      return `短句 ${profile.linesCompleted}/${LINE_GOAL}`;
    case "L3R-test":
      return "L3 过关测试";
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
  if (from === "L2-1" && to === "L2-2") return "八分音符过了。接下来练双手交替。";
  if (from === "L2-2" && to === "L2-3") return "双手交替过了。接下来练双手同拍。";
  if (from === "L2-3" && to === "L2-4") return "双手同拍过了。接下来练 F 五指。";
  if (from === "L2-4" && to === "L2-5") return "F 五指过了。接下来练 G 五指。";
  if (from === "L2-5" && to === "L2-6") return "G 五指过了。接下来把整段挪一次手位。";
  if (from === "L2-6" && to === "L2-test") return "五指平移过了。准备 L2 过关测试。";
  if (from === "L3R-1" && to === "L3R-2") return "双音过了。接下来用右手弹三和弦。";
  if (from === "L3R-2" && to === "L3R-3") return "右手三和弦过了。换左手。";
  if (from === "L3R-3" && to === "L3R-4") return "左手三和弦过了。接下来认临时升降。";
  if (from === "L3R-4" && to === "L3R-test") return "临时升降过了。准备 L3 过关测试。";
  return "";
}

export function homeLessonLabel(profile: Profile): string {
  if (!profile.lessonId) return "还没开始";
  if (profile.lessonId.startsWith("L3R")) {
    if (profile.l3Passed) return "L3 已通过";
    return `当前：${STEP_LABELS[profile.lessonId]}`;
  }
  if (profile.lessonId.startsWith("L2")) {
    if (profile.l2Passed) return "L2 已通过";
    return `当前：${STEP_LABELS[profile.lessonId]}`;
  }
  if (profile.l1RightPassed && profile.l1LeftPassed) return "L1 已通过";
  if (profile.lessonId === "L1-test") {
    if (profile.l1RightPassed) return "过关：左手";
    if (profile.l1LeftPassed) return "过关：右手";
    return "过关测试";
  }
  return `当前：${STEP_LABELS[profile.lessonId]}`;
}
