import { L3_PREP_LESSONS } from "../practice/l3Lessons";
import { lessonGoalText, lessonStepLabel } from "./lessonProgress";
import { canEnterL2, canEnterSight, type Profile } from "./profile";

/**
 * 「今天该做什么」的唯一判据。
 *
 * 首页过去把六个入口平铺成同级按钮，用户得自己判断先后。这里把判断收到一个
 * 纯函数里：视图只负责把它渲染成一张主卡，App 只负责按 kind 切屏。
 * 任何学习路径的调整都只改这里，不再散落在视图的 v-if 里。
 */

export type NextActionKind = "placement" | "lesson" | "test" | "sight";

export type NextAction = {
  kind: NextActionKind;
  /** 主卡上方的小标签，说明这是哪一类动作。 */
  eyebrow: string;
  title: string;
  /** 只有需要交代规则时才写一句；课中/过关这种自带上下文的留空。 */
  detail?: string;
  cta: string;
  /** 这一课的量化目标（「短句 1/2」）；没有量化目标时为空串。 */
  goal: string;
};

export type PathStageId = "L1" | "L2" | "L3" | "library";

export type PathStage = {
  id: PathStageId;
  name: string;
  caption: string;
  state: "done" | "current" | "todo";
};

/**
 * 首页主卡：按「自评 → L1 → L2 → 视奏」的顺序给出唯一建议动作。
 * 前三步是必修，视奏在解锁后成为日常练习的默认落点。
 */
export function nextAction(profile: Profile): NextAction {
  if (!profile.assessment) {
    return {
      kind: "placement",
      eyebrow: "第一步",
      title: "先做一次三道自评",
      detail: "只决定从哪一课开始，不会直接解锁视奏。",
      cta: "开始自评",
      goal: "",
    };
  }

  if (!profile.lessonId) {
    return {
      kind: "lesson",
      eyebrow: "识谱课",
      title: "从 L1 第一课开始",
      cta: "进入课程",
      goal: "",
    };
  }

  if (profile.lessonId === "L1-test") {
    if (profile.l1RightPassed && profile.l1LeftPassed) {
      return sightOrL2(profile);
    }
    const hands = profile.l1RightPassed ? "左手" : profile.l1LeftPassed ? "右手" : "右手和左手";
    return {
      kind: "test",
      eyebrow: "L1 过关",
      title: `过关测试 · ${hands}`,
      detail: "新的一条单手谱。音高错 ≤ 2，节奏中断 ≤ 1。",
      cta: "开始过关",
      goal: handStateText(profile),
    };
  }

  if (profile.lessonId.startsWith("L2")) {
    // 过完 L2 后 lessonId 仍停在 L2-test，所以先看 l2Passed，否则会一直让人重考。
    if (profile.l2Passed) return sightOrL2(profile);
    if (profile.lessonId === "L2-test") {
      return {
        kind: "test",
        eyebrow: "L2 过关",
        title: "过关测试 · 双手",
        detail: "新的双手 4 小节谱，过了视奏升级为双手。",
        cta: "开始过关",
        goal: handStateText(profile),
      };
    }
    return {
      kind: "lesson",
      eyebrow: "L2 识谱课",
      title: `L2 · ${lessonStepLabel(profile.lessonId)}`,
      cta: "继续这一课",
      goal: lessonGoalText(profile),
    };
  }

  if (profile.l1RightPassed && profile.l1LeftPassed) return sightOrL2(profile);

  return {
    kind: "lesson",
    eyebrow: "L1 识谱课",
    title: `L1 · ${lessonStepLabel(profile.lessonId)}`,
    cta: "继续这一课",
    goal: lessonGoalText(profile),
  };
}

/** 两手都过了 L1 之后：还没开 L2 就推 L2，过了 L2 就让视奏当日常。 */
function sightOrL2(profile: Profile): NextAction {
  if (profile.l2Passed) {
    return {
      kind: "sight",
      eyebrow: "今日练习",
      title: "5 分钟视奏",
      detail: "L2 也过了。视奏现在是双手的，每天一条就够了。",
      cta: "开始视奏",
      goal: "一条最多 2 遍",
    };
  }
  if (!canEnterL2(profile)) {
    return {
      kind: "lesson",
      eyebrow: "识谱课",
      title: "继续 L1",
      cta: "继续这一课",
      goal: lessonGoalText(profile),
    };
  }
  return {
    kind: "lesson",
    eyebrow: "L2 识谱课",
    title: "进入 L2 · 八分音符",
    detail: "L1 已过关。接下来是八分音符与双手。",
    cta: "开始 L2",
    goal: "",
  };
}

function handStateText(profile: Profile): string {
  const right = profile.l1RightPassed ? "右手 ✓" : "右手待过";
  const left = profile.l1LeftPassed ? "左手 ✓" : "左手待过";
  return `${right} · ${left}`;
}

/**
 * 学习路径条：把「学到哪儿」画成四段，进度不再靠用户自己拼。
 * L3 只统计预备课完成数，仍然不等于技能过关。
 */
export function learningPath(profile: Profile): PathStage[] {
  const l1Done = profile.l1RightPassed && profile.l1LeftPassed;
  const l2Done = profile.l2Passed;
  const l3Total = L3_PREP_LESSONS.length;
  const l3Done = profile.l3PrepCompleted.length;
  const lessonId = profile.lessonId ?? "";

  return [
    {
      id: "L1",
      name: "L1 认谱",
      // 只写状态，不说废话：没到这一步就不解释
      caption: l1Done ? "已过关" : lessonId.startsWith("L1") || !lessonId ? "正在学" : "",
      state: l1Done ? "done" : lessonId.startsWith("L1") || !lessonId ? "current" : "todo",
    },
    {
      id: "L2",
      name: "L2 双手",
      caption: l2Done ? "已过关" : lessonId.startsWith("L2") ? "正在学" : "",
      state: l2Done ? "done" : lessonId.startsWith("L2") || (l1Done && !l2Done) ? "current" : "todo",
    },
    {
      id: "L3",
      name: "L3 预备",
      caption: l3Done > 0 ? `已上 ${l3Done}/${l3Total}` : "",
      state: l3Done >= l3Total && l3Total > 0 ? "done" : l3Done > 0 ? "current" : "todo",
    },
    {
      id: "library",
      name: "曲库",
      caption: l2Done ? "可以挑曲子" : "",
      state: "todo",
    },
  ];
}

export function sightUnlocked(profile: Profile): boolean {
  return canEnterSight(profile, "RH") || canEnterSight(profile, "LH");
}
