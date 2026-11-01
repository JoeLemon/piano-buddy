import { measureBudget } from "./pickup";
import type { Hand, Measure, NavigationKind, NavigationMark, RepeatSpan, Score } from "./types";
import { noteBeats } from "./vocabulary";

/**
 * ── 反复与导航记号 ───────────────────────────────────────────
 *
 * 谱面仍然是「写一遍」的线性小节；演奏顺序由 `playOrder()` 展开。所有派生层
 * （事件、时间轴、示范播放、节拍网格）都读同一份顺序，免得「听到的」和
 * 「判的」不是同一遍。
 *
 * 支持：
 * - `|: :|`（可嵌套、可指定总遍数）；
 * - D.C. / D.S.（可配 Fine 或 To Coda / Coda）。
 *
 * 小节号一律 0 起算，和 `pickup`、切片内部坐标一致；给作者看的报错会 +1。
 */

const MAX_REPEAT_TIMES = 16;
const NAVIGATION_KINDS: readonly NavigationKind[] = [
  "dc",
  "ds",
  "segno",
  "coda",
  "fine",
  "to-coda",
];

export type PerformedMeasure = {
  /** 原始谱面上的小节号（1 起算，供界面显示）。 */
  number: number;
  /** 演奏顺序里的起始拍。 */
  startBeat: number;
  /** 这一遍的拍数。 */
  beats: number;
};

/** 全曲小节数（两只手取较长的一只）。 */
export function measureTotal(score: Score): number {
  let max = 0;
  for (const hand of score.hands) {
    max = Math.max(max, score.staves[hand]?.measures.length ?? 0);
  }
  return max;
}

/**
 * 反复/导航记号是否自洽。返回可直接展示给作者的问题列表。
 *
 * 和 `tieErrors` / `pickupErrors` 一样，`isAllowed` 与内容 QA 共用这一份，
 * 避免「渲染能画、校验说错」。
 */
export function repeatErrors(score: Score): string[] {
  const total = measureTotal(score);
  const errors: string[] = [];
  const spans = score.repeats ?? [];

  const valid: RepeatSpan[] = [];
  const seen = new Set<string>();
  for (const span of spans) {
    const where = `反复段落 ${formatSpan(span)}`;
    if (!Number.isInteger(span.from) || !Number.isInteger(span.to)) {
      errors.push(`${where}：小节号必须是整数`);
      continue;
    }
    if (span.from < 0 || span.to >= total) {
      errors.push(`${where}：超出全曲 ${total} 小节的范围`);
      continue;
    }
    if (span.from > span.to) {
      errors.push(`${where}：起点晚于终点`);
      continue;
    }
    if (span.times !== undefined) {
      if (!Number.isInteger(span.times) || span.times < 2) {
        errors.push(`${where}：遍数必须是 ≥2 的整数`);
      } else if (span.times > MAX_REPEAT_TIMES) {
        errors.push(`${where}：遍数 ${span.times} 超过上限 ${MAX_REPEAT_TIMES}`);
      }
    }
    const key = `${span.from}-${span.to}`;
    if (seen.has(key)) {
      errors.push(`${where}：同一段落重复声明`);
      continue;
    }
    seen.add(key);
    valid.push(span);
  }

  // 嵌套合法，交叉（部分重叠）不合法：演奏顺序会变成两段互相插入。
  const sorted = [...valid].sort((a, b) => a.from - b.from || b.to - a.to);
  const stack: RepeatSpan[] = [];
  for (const span of sorted) {
    while (stack.length > 0 && span.from > stack[stack.length - 1].to) stack.pop();
    const top = stack[stack.length - 1];
    if (top) {
      if (span.from === top.from) {
        errors.push(`反复段落 ${formatSpan(span)}：同一小节有两个反复起点`);
      } else if (span.to > top.to) {
        errors.push(
          `反复段落 ${formatSpan(span)} 与 ${formatSpan(top)} 部分重叠（只能嵌套或前后分开）`,
        );
      }
    }
    stack.push(span);
  }

  errors.push(...navigationErrors(score, total));
  return errors;
}

function navigationErrors(score: Score, total: number): string[] {
  const errors: string[] = [];
  const marks = score.navigation ?? [];
  const byKind = new Map<NavigationKind, NavigationMark[]>();

  for (const mark of marks) {
    if (!NAVIGATION_KINDS.includes(mark.kind)) {
      errors.push(`未知的导航记号 ${String(mark.kind)}`);
      continue;
    }
    if (!Number.isInteger(mark.at) || mark.at < 0 || mark.at >= total) {
      errors.push(`导航记号 ${mark.kind} 落在第 ${mark.at + 1} 小节，超出全曲 ${total} 小节范围`);
      continue;
    }
    const list = byKind.get(mark.kind) ?? [];
    list.push(mark);
    byKind.set(mark.kind, list);
  }

  const single = (kind: NavigationKind, label: string): NavigationMark | null => {
    const list = byKind.get(kind) ?? [];
    if (list.length > 1) errors.push(`${label} 只能出现一次（当前 ${list.length} 处）`);
    return list[0] ?? null;
  };

  const dc = single("dc", "D.C.");
  const ds = single("ds", "D.S.");
  const segno = single("segno", "Segno");
  single("coda", "Coda");
  single("fine", "Fine");
  const toCoda = single("to-coda", "To Coda");

  if (dc && ds) errors.push("同一份谱不能同时有 D.C. 和 D.S.");
  if (ds && !segno) errors.push("有 D.S. 但没有 Segno 记号，不知道回到哪里");
  if (ds && segno && segno.at >= ds.at) errors.push("Segno 必须在 D.S. 之前");
  if (toCoda && !byKind.has("coda")) errors.push("有 To Coda 但没有 Coda 记号");
  return errors;
}

/**
 * 演奏顺序：返回原始小节号序列，可能重复、可能跳回。
 *
 * 反复用栈处理嵌套；D.C./D.S. 只触发一次，第二遍遇到 `fine` 收尾或遇到
 * `to-coda` 跳到 Coda。防御性地上限保护，坏谱不会把界面卡死。
 */
export function playOrder(score: Score): number[] {
  const total = measureTotal(score);
  if (total === 0) return [];

  const startAt = new Map<number, RepeatSpan>();
  const endAt = new Map<number, RepeatSpan>();
  for (const span of score.repeats ?? []) {
    if (span.from < 0 || span.to >= total || span.from > span.to) continue;
    if (!startAt.has(span.from)) startAt.set(span.from, span);
    if (!endAt.has(span.to)) endAt.set(span.to, span);
  }

  const navAt = new Map<number, NavigationKind[]>();
  let segnoAt: number | null = null;
  let codaAt: number | null = null;
  let toCodaAt: number | null = null;
  let fineAt: number | null = null;
  for (const mark of score.navigation ?? []) {
    if (mark.at < 0 || mark.at >= total) continue;
    const list = navAt.get(mark.at) ?? [];
    list.push(mark.kind);
    navAt.set(mark.at, list);
    if (mark.kind === "segno" && segnoAt === null) segnoAt = mark.at;
    if (mark.kind === "coda" && codaAt === null) codaAt = mark.at;
    if (mark.kind === "to-coda" && toCodaAt === null) toCodaAt = mark.at;
    if (mark.kind === "fine" && fineAt === null) fineAt = mark.at;
  }

  const order: number[] = [];
  const stack: RepeatSpan[] = [];
  const plays = new Map<RepeatSpan, number>();
  let jumped = false;
  let inCoda = false;
  let index = 0;
  let guard = 0;
  const limit = Math.max(64, total * MAX_REPEAT_TIMES * 4);

  while (index >= 0 && index < total) {
    guard += 1;
    if (guard > limit) break;
    order.push(index);

    const kinds = navAt.get(index) ?? [];
    if (!jumped) {
      const jump = kinds.find((kind) => kind === "dc" || kind === "ds");
      if (jump) {
        jumped = true;
        const target = jump === "dc" ? 0 : segnoAt;
        if (target !== null && target !== index) {
          index = target;
          continue;
        }
      }
    } else if (!inCoda && toCodaAt === index && codaAt !== null) {
      inCoda = true;
      index = codaAt;
      continue;
    } else if (fineAt === index) {
      break;
    }

    const starting = startAt.get(index);
    if (starting && stack[stack.length - 1] !== starting) stack.push(starting);

    const ending = endAt.get(index);
    if (ending) {
      if (stack[stack.length - 1] === ending) stack.pop();
      const done = (plays.get(ending) ?? 0) + 1;
      const times = ending.times ?? 2;
      if (done < times) {
        plays.set(ending, done);
        index = ending.from;
        continue;
      }
      plays.delete(ending);
    }

    index += 1;
  }

  return order;
}

/**
 * 演奏顺序里每一遍小节的起始拍。
 *
 * 参考手优先右手：两只手小节对齐时拍坐标一致；跟弹选单手时用那只手。
 * 事件层按实际音符时值累加，这里也按实际时值算，两边才对得上。
 */
export function performanceMeasures(
  score: Score,
  hand: Hand | "BOTH" = "BOTH",
): PerformedMeasure[] {
  const reference: Hand | null =
    hand === "BOTH"
      ? score.hands.includes("RH")
        ? "RH"
        : score.hands[0] ?? null
      : hand;
  const measures = reference ? score.staves[reference]?.measures ?? [] : [];
  const out: PerformedMeasure[] = [];
  let beat = 0;
  for (const index of playOrder(score)) {
    // 单手跟弹只看那只手的小节数：另一只手更长时不该把拍坐标拖出谱尾。
    if (reference && index >= measures.length) continue;
    const measure = measures[index];
    const beats = measure ? measureBeats(measure) : measureBudget(score, index);
    out.push({ number: index + 1, startBeat: beat, beats });
    beat += beats;
  }
  return out;
}

/** 反复线在哪些小节：`begin` 画 `|:`，`end` 画 `:|`。 */
export function repeatBarlines(score: Score): Map<number, { begin: boolean; end: boolean }> {
  const out = new Map<number, { begin: boolean; end: boolean }>();
  for (const span of score.repeats ?? []) {
    const from = out.get(span.from) ?? { begin: false, end: false };
    from.begin = true;
    out.set(span.from, from);
    const to = out.get(span.to) ?? { begin: false, end: false };
    to.end = true;
    out.set(span.to, to);
  }
  return out;
}

const NAVIGATION_LABELS: Record<NavigationKind, string> = {
  dc: "D.C.",
  ds: "D.S.",
  segno: "Segno",
  coda: "Coda",
  fine: "Fine",
  "to-coda": "To Coda",
};

/** 某一小节上的导航记号文字（渲染层用）。 */
export function navigationLabelsAt(score: Score, measureIndex: number): string[] {
  return (score.navigation ?? [])
    .filter((mark) => mark.at === measureIndex)
    .map((mark) => NAVIGATION_LABELS[mark.kind]);
}

/** 这份谱是否真的会重复/跳转（全曲只有一段 `times: 1` 不算）。 */
export function hasRepeats(score: Score): boolean {
  const total = measureTotal(score);
  if (total === 0) return false;
  return playOrder(score).length > total;
}

function measureBeats(measure: Measure): number {
  return measure.notes.reduce((sum, note) => sum + noteBeats(note), 0);
}

function formatSpan(span: RepeatSpan): string {
  return `第 ${span.from + 1}–${span.to + 1} 小节`;
}
