import type { Hand, Measure, Score } from "../domain/types";
import { flattenScore } from "../domain/timeline";

/**
 * 按弹奏进度给乐谱上色：
 * - 已经过的（弹过的区域、休止符）→ 暖米灰
 * - 弹对的音符 → 低饱和绿
 * - 弹错的音符 → 低饱和砖红
 * - 当前音 → 金色高亮
 *
 * 颜色默认取 tokens.css 里的 CSS 变量，便于跟随主题；
 * 下面的回退值只在拿不到 CSS（测试 / SSR）时使用，与暖白卡内配色一致。
 */
const FALLBACK_PLAYED = "#efe9dc";
const FALLBACK_CORRECT = "#a9bfa0";
const FALLBACK_WRONG = "#b96a55";
const FALLBACK_ACTIVE = "#c9a45c";

export type ScorePaintState = {
  /** 已弹奏（被消费）的发声音数量，即游标位置。 */
  playedCount: number;
  correctIds: ReadonlySet<string>;
  wrongIds: ReadonlySet<string>;
  /** 正在响/正在弹的那一个音（例如「听一遍」跟随时的当前音）。 */
  activeId?: string | null;
};

export type GrandPaintState = {
  /** flattenScore 顺序里已弹奏的条目数量。 */
  timelineCount: number;
  /** 以 `${hand}:${id}` 为键。 */
  correctKeys: ReadonlySet<string>;
  wrongKeys: ReadonlySet<string>;
  /** 正在响的那一个音（「听一遍」跟随），也是 `${hand}:${id}`。 */
  activeKey?: string | null;
};

/** 单谱表：每个被渲染的音符（含休止符），`sounding` 是它在发声音序列里的序号。 */
export function flatRows(score: Score, hand: Hand): { id: string; sounding: number | null }[] {
  const rows: { id: string; sounding: number | null }[] = [];
  let sounding = 0;
  for (const measure of score.staves[hand]?.measures ?? []) {
    for (const note of measure.notes) {
      const isRest = isRestNote(note);
      rows.push({ id: note.id, sounding: isRest ? null : sounding });
      if (!isRest) sounding += 1;
    }
  }
  return rows;
}

/**
 * 大谱表（渐强谱）：DOM 中 `.vf-stavenote` 的顺序 —— 每小节先高音谱再低音谱。
 * keys 用 `${hand}:${id}`。
 */
export function grandRows(score: Score): { hand: Hand; id: string }[] {
  const right = score.staves.RH;
  const left = score.staves.LH;
  const measureCount = Math.min(right?.measures.length ?? 0, left?.measures.length ?? 0);
  const rows: { hand: Hand; id: string }[] = [];
  for (let index = 0; index < measureCount; index += 1) {
    for (const measure of [right!.measures[index], left!.measures[index]]) {
      for (const note of measure.notes) {
        rows.push({ hand: measure === right!.measures[index] ? "RH" : "LH", id: note.id });
      }
    }
  }
  return rows;
}

function isRestNote(note: Measure["notes"][number]): boolean {
  return note.duration.endsWith("r") || note.pitches.length === 0;
}

/**
 * 发声音总数（不含休止符），用于进度比例。
 */
export function soundingTotal(score: Score, hand: Hand): number {
  const rows = flatRows(score, hand);
  return rows.filter((row) => row.sounding != null).length;
}

export function scoreProgressRatio(score: Score, hand: Hand, playedCount: number): number {
  const total = soundingTotal(score, hand);
  if (total <= 0) return 0;
  return clamp01(playedCount / total);
}

export function grandProgressRatio(score: Score, timelineCount: number): number {
  const total = flattenScore(score).length;
  if (total <= 0) return 0;
  return clamp01(timelineCount / total);
}

/** 上色：按 `弹过区域 < 弹对 < 弹错` 的优先级覆盖颜色。 */
export function paintScoreProgress(
  element: HTMLElement,
  score: Score,
  hand: Hand,
  state: ScorePaintState,
): void {
  const colors = readColors();
  const rows = flatRows(score, hand);
  applyGroupMarks(element, rows.length, (groupIndex) => {
    const row = rows[groupIndex];
    if (!row) return null;
    if (state.wrongIds.has(row.id)) return { attribute: "data-wrong", color: colors.wrong };
    if (state.correctIds.has(row.id)) return { attribute: "data-correct", color: colors.correct };
    if (state.activeId != null && row.id === state.activeId) {
      return { attribute: "data-active", color: colors.active };
    }
    if (row.sounding != null && row.sounding < state.playedCount) {
      return { attribute: "data-played", color: colors.played };
    }
    // 休止符：跟随它前面最近的发声音的进度；谱首休止符在开始弹奏后也算已过。
    if (row.sounding == null) {
      const previous = lastSounding(groupIndex, rows);
      const past = previous < 0 ? state.playedCount > 0 : previous < state.playedCount;
      if (past) return { attribute: "data-played", color: colors.played };
    }
    return null;
  });
}

/** 该行之前最近一个发声音的序号；没有则 -1。 */
function lastSounding(groupIndex: number, rows: { id: string; sounding: number | null }[]): number {
  for (let index = groupIndex - 1; index >= 0; index -= 1) {
    const sounding = rows[index].sounding;
    if (sounding != null) return sounding;
  }
  return -1;
}

/** 大谱表版本：keys 为 `${hand}:${id}`。 */
export function paintGrandProgress(
  element: HTMLElement,
  score: Score,
  state: GrandPaintState,
): void {
  const colors = readColors();
  const rows = grandRows(score);
  const timeline = flattenScore(score);
  const timelineIndex = new Map<string, number>();
  timeline.forEach((note, index) => {
    const key = `${note.hand}:${note.id}`;
    if (!timelineIndex.has(key)) timelineIndex.set(key, index);
  });
  let lastSoundingIndex = -1;
  applyGroupMarks(element, rows.length, (groupIndex) => {
    const row = rows[groupIndex];
    if (!row) return null;
    const key = `${row.hand}:${row.id}`;
    const position = timelineIndex.get(key);
    if (state.wrongKeys.has(key)) return { attribute: "data-wrong", color: colors.wrong };
    if (state.correctKeys.has(key)) return { attribute: "data-correct", color: colors.correct };
    if (state.activeKey != null && key === state.activeKey) {
      return { attribute: "data-active", color: colors.active };
    }
    if (position != null) {
      lastSoundingIndex = position;
      if (position < state.timelineCount) return { attribute: "data-played", color: colors.played };
      return null;
    }
    // 休止符：跟随它前面最近的发声音的进度。
    if (position == null && lastSoundingIndex >= 0 && lastSoundingIndex < state.timelineCount) {
      return { attribute: "data-played", color: colors.played };
    }
    return null;
  });
}

/** 把谱子水平滚到游标处：让当前待弹的音大约停在视口 30% 的位置。 */
export function scrollScoreToCursor(
  element: HTMLElement,
  score: Score,
  hand: Hand,
  playedCount: number,
): void {
  const rows = flatRows(score, hand);
  const target = rows.findIndex((row) => row.sounding != null && row.sounding >= playedCount);
  scrollGroupIntoView(element, target);
}

/** 大谱表版本：滚到 flattenScore 顺序里的当前条目。 */
export function scrollGrandToCursor(
  element: HTMLElement,
  score: Score,
  timelineCount: number,
): void {
  const timeline = flattenScore(score);
  const target = timeline[timelineCount];
  if (!target) return;
  const rows = grandRows(score);
  const rowIndex = rows.findIndex((row) => row.hand === target.hand && row.id === target.id);
  scrollGroupIntoView(element, rowIndex);
}

/** 大谱表版本：第几条（flattenScore 顺序）落在第几小节。 */
export function measureForTimeline(
  score: Score,
  timelineIndex: number,
): { current: number; total: number } {
  const total = Math.max(
    score.staves.RH?.measures.length ?? 0,
    score.staves.LH?.measures.length ?? 0,
  );
  if (total === 0) return { current: 0, total: 0 };
  const entry = flattenScore(score)[timelineIndex];
  if (!entry) return { current: total, total };
  const measures = score.staves[entry.hand]?.measures ?? [];
  const index = measures.findIndex((measure) => measure.notes.some((note) => note.id === entry.id));
  return { current: index < 0 ? total : index + 1, total };
}

/**
 * 第几个发声音（0 起）落在第几小节：给的序号是「当前所在的音」，
 * 序号超出范围时收在最后一小节。`total` 是整条的小节数。
 */
export function measureForSounding(
  score: Score,
  hand: Hand,
  soundingIndex: number,
): { current: number; total: number } {
  const measures = score.staves[hand]?.measures ?? [];
  const total = measures.length;
  if (total === 0) return { current: 0, total: 0 };
  let seen = 0;
  for (let index = 0; index < total; index += 1) {
    const sounding = measures[index].notes.filter((note) => !isRestNote(note)).length;
    if (soundingIndex < seen + sounding) return { current: index + 1, total };
    seen += sounding;
  }
  return { current: total, total };
}

/** 滚到指定发声音（不含休止符）处，用于「听一遍」的跟随。 */
export function scrollScoreToNote(
  element: HTMLElement,
  score: Score,
  hand: Hand,
  soundingIndex: number,
): void {
  const rows = flatRows(score, hand);
  const target = rows.findIndex((row) => row.sounding === soundingIndex);
  scrollGroupIntoView(element, target);
}

type Mark = {
  attribute: "data-played" | "data-correct" | "data-wrong" | "data-active";
  color: string;
} | null;

function applyGroupMarks(
  element: HTMLElement,
  count: number,
  markFor: (groupIndex: number) => Mark,
): void {
  const groups = element.querySelectorAll(".vf-stavenote");
  for (let index = 0; index < count; index += 1) {
    const group = groups.item(index) as Element | null;
    if (!group) break;
    const mark = markFor(index);
    group.removeAttribute("data-played");
    group.removeAttribute("data-correct");
    group.removeAttribute("data-wrong");
    group.removeAttribute("data-active");
    const paths = group.querySelectorAll("path");
    if (!mark) {
      for (let pathIndex = 0; pathIndex < paths.length; pathIndex += 1) {
        const path = paths.item(pathIndex);
        path.removeAttribute("fill");
        path.removeAttribute("stroke");
      }
      continue;
    }
    group.setAttribute(mark.attribute, "true");
    for (let pathIndex = 0; pathIndex < paths.length; pathIndex += 1) {
      const path = paths.item(pathIndex);
      if (!path) continue;
      path.setAttribute("fill", mark.color);
      path.setAttribute("stroke", mark.color);
    }
  }
}

function scrollGroupIntoView(element: HTMLElement, groupIndex: number): void {
  if (groupIndex < 0) return;
  const groups = element.querySelectorAll(".vf-stavenote");
  const node = groups.item(groupIndex) as Element | null;
  if (!node) return;
  const svg = node.closest("svg");
  if (!svg) return;
  const hostRect = svg.getBoundingClientRect();
  const rect = node.getBoundingClientRect();
  // happy-dom / SSR 环境没有真实布局，跳过。
  if (rect.width === 0 && rect.height === 0 && hostRect.width === 0) return;
  const left = rect.left - hostRect.left + element.scrollLeft;
  const right = rect.right - hostRect.left + element.scrollLeft;
  const view = element.clientWidth;
  if (view <= 0) return;
  const current = element.scrollLeft;
  if (current <= left - 8 && right - current <= view - 8) return; // 已经完整可见
  const desired = Math.max(0, left - view * 0.3);
  if (typeof element.scrollTo === "function") {
    element.scrollTo({ left: desired, behavior: "smooth" });
  } else {
    element.scrollLeft = desired;
  }
}

function readColors(): { played: string; correct: string; wrong: string; active: string } {
  return {
    played: cssVar("--pb-score-played", FALLBACK_PLAYED),
    correct: cssVar("--pb-score-correct", FALLBACK_CORRECT),
    wrong: cssVar("--pb-score-wrong", FALLBACK_WRONG),
    active: cssVar("--pb-score-active", FALLBACK_ACTIVE),
  };
}

function cssVar(name: string, fallback: string): string {
  try {
    if (typeof getComputedStyle === "function" && typeof document !== "undefined") {
      const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
      if (value) return value;
    }
  } catch {
    // 环境不支持时使用回退色
  }
  return fallback;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}
