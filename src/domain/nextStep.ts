import { L3_PREP_LESSONS } from "../practice/l3Lessons";
import { SKILL_BY_ID } from "../repertoire/skillGraph";
import { staleSkills } from "../repertoire/skillState";
import { lessonGoalText, lessonStepLabel } from "./lessonProgress";
import { canEnterL2, canEnterSight, type Profile } from "./profile";

/**
 * 「今天该做什么」的唯一判据。
 *
 * 首页过去把六个入口平铺成同级按钮，用户得自己判断先后。这里把判断收到一个
 * 纯函数里：视图只负责把它渲染成一张主卡，App 只负责按 kind 切屏。
 * 任何学习路径的调整都只改这里，不再散落在视图的 v-if 里。
 */

export type NextActionKind = "placement" | "lesson" | "test" | "sight" | "review";

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
  /** 复习动作要去的技能；首页用它决定落到哪一课。 */
  skillIds?: string[];
};

export type PathStageId = "L1" | "L2" | "L3" | "library";

export type PathStage = {
  id: PathStageId;
  name: string;
  caption: string;
  state: "done" | "current" | "todo";
};

/**
 * 首页主卡：按「自评 → L1 → L2 → L3 → 视奏」的顺序给出唯一建议动作。
 * L3 是 L2 之后的和弦识谱课；L3 预备课仍可单独补，但不再阻塞主线。
 */
export function nextAction(profile: Profile, now: number = Date.now()): NextAction {
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
      return afterL1(profile, now);
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

  if (profile.lessonId.startsWith("L3R")) {
    if (profile.l3Passed) return sightAction(profile, now);
    if (profile.lessonId === "L3R-test") {
      return {
        kind: "test",
        eyebrow: "L3 过关",
        title: "L3 过关测试 · 双手",
        detail: "带三和弦与临时升降的双手谱。音高错 ≤ 3，节奏中断 ≤ 1。",
        cta: "开始过关",
        goal: "L3 和弦",
      };
    }
    return {
      kind: "lesson",
      eyebrow: "L3 和弦",
      title: `L3 · ${lessonStepLabel(profile.lessonId)}`,
      cta: "继续这一课",
      goal: lessonGoalText(profile),
    };
  }

  if (profile.lessonId.startsWith("L2")) {
    // 过完 L2 后 lessonId 仍停在 L2-test，所以先看 l2Passed，否则会一直让人重考。
    if (profile.l2Passed) return afterL1(profile, now);
    if (profile.lessonId === "L2-test") {
      return {
        kind: "test",
        eyebrow: "L2 过关",
        title: "过关测试 · 双手",
        detail: "新的双手 4 小节谱，过了可以进入 L3 和弦。",
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

  if (profile.l1RightPassed && profile.l1LeftPassed) return afterL1(profile, now);

  return {
    kind: "lesson",
    eyebrow: "L1 识谱课",
    title: `L1 · ${lessonStepLabel(profile.lessonId)}`,
    cta: "继续这一课",
    goal: lessonGoalText(profile),
  };
}

/** 两手都过了 L1 之后：先开 L2，过 L2 后进 L3，L3 过了视奏当日常。 */
function afterL1(profile: Profile, now: number): NextAction {
  if (!canEnterL2(profile)) {
    return {
      kind: "lesson",
      eyebrow: "识谱课",
      title: "继续 L1",
      cta: "继续这一课",
      goal: lessonGoalText(profile),
    };
  }
  if (profile.l2Passed) {
    if (profile.l3Passed) return sightAction(profile, now);
    if (profile.lessonId === "L3R-test") {
      return {
        kind: "test",
        eyebrow: "L3 过关",
        title: "L3 过关测试 · 双手",
        detail: "带三和弦与临时升降的双手谱。音高错 ≤ 3，节奏中断 ≤ 1。",
        cta: "开始过关",
        goal: "L3 和弦",
      };
    }
    const started = profile.lessonId?.startsWith("L3R");
    const currentId = started ? profile.lessonId! : "L3R-1";
    return {
      kind: "lesson",
      eyebrow: "L3 和弦",
      title: `L3 · ${lessonStepLabel(currentId)}`,
      detail: started ? undefined : "L2 已过关。接下来练双音、三和弦与临时升降。",
      cta: started ? "继续这一课" : "开始 L3",
      goal: started ? lessonGoalText(profile) : "短句 0/2",
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

/**
 * 复习优先于新视奏。
 *
 * 技能账本里的 `passed` 不是永久有效：超过 30 天没碰，识谱速度会掉。进入
 * 日常练习阶段后，如果账本里有「学过但放旧了」的技能，首页先推复习；复习
 * 一次写回 `lastPracticedAt`，主卡自然回到视奏。没到 L3 的不打断主线。
 */
function sightAction(profile: Profile, now: number): NextAction {
  const review = reviewAction(profile, now);
  if (review) return review;
  return {
    kind: "sight",
    eyebrow: "今日练习",
    title: "5 分钟视奏",
    detail: "L3 也过了。视奏里会出现和弦与临时升降，每天一条就够了。",
    cta: "开始视奏",
    goal: "一条最多 2 遍",
  };
}

/** 取最久没练的 3 个已掌握技能；同一技能左右手都过期时只算一项。 */
export function reviewAction(profile: Profile, now: number = Date.now()): NextAction | null {
  const seen = new Set<string>();
  const stale = staleSkills(profile.skillLedger, now)
    .sort((a, b) => (a.lastPracticedAt ?? 0) - (b.lastPracticedAt ?? 0))
    .filter((item) => {
      if (seen.has(item.skillId)) return false;
      seen.add(item.skillId);
      return true;
    });
  if (stale.length === 0) return null;

  const top = stale.slice(0, 3);
  const names = top
    .map((item) => SKILL_BY_ID.get(item.skillId)?.name ?? item.skillId)
    .join("、");
  const more = stale.length > top.length ? ` 等 ${stale.length} 项` : "";
  return {
    kind: "review",
    eyebrow: "复习提醒",
    title: `该复习了 · ${stale.length} 项技能`,
    detail: `超过 30 天没练：${names}${more}。先复习，再开新内容。`,
    cta: "去复习",
    goal: `${stale.length} 项待复习`,
    skillIds: top.map((item) => item.skillId),
  };
}

function handStateText(profile: Profile): string {
  const right = profile.l1RightPassed ? "右手 ✓" : "右手待过";
  const left = profile.l1LeftPassed ? "左手 ✓" : "左手待过";
  return `${right} · ${left}`;
}

/**
 * 学习路径条：把「学到哪儿」画成四段，进度不再靠用户自己拼。
 * L3 段看和弦识谱是否过关；预备课完成数只作为补充说明。
 */
export function learningPath(profile: Profile): PathStage[] {
  const l1Done = profile.l1RightPassed && profile.l1LeftPassed;
  const l2Done = profile.l2Passed;
  const l3Done = profile.l3Passed;
  const l3PrepDone = profile.l3PrepCompleted.length;
  const l3Total = L3_PREP_LESSONS.length;
  const lessonId = profile.lessonId ?? "";
  const l3Started = lessonId.startsWith("L3R") || l3PrepDone > 0;

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
      name: "L3 和弦",
      caption: l3Done
        ? "已过关"
        : l3Started
          ? l3PrepDone > 0
            ? `正在学 · 预备 ${l3PrepDone}/${l3Total}`
            : "正在学"
          : l2Done
            ? "可以开始"
            : "",
      state: l3Done ? "done" : l2Done || l3Started ? "current" : "todo",
    },
    {
      id: "library",
      name: "曲库",
      // 曲库不是“最后才能进”的关卡：L2 后就可以挑，L3 后正式进入曲目闭环。
      caption: l3Done ? "挑一首曲子弹" : l2Done ? "可以边学边挑" : "",
      state: l3Done ? "current" : "todo",
    },
  ];
}

export function sightUnlocked(profile: Profile): boolean {
  return canEnterSight(profile, "RH") || canEnterSight(profile, "LH");
}
