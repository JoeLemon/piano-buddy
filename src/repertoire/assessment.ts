import type { Profile } from "../domain/profile";
import type { Hand } from "../domain/types";

/**
 * ── 整曲评测 ────────────────────────────────────────────────
 * 曲库的分段跟弹回答「这两小节弹得怎么样」；整曲评测回答「整首曲子现在
 * 能弹到几分」。两者共用 `ScoreFollow` 的判定结果，只是把每段结果按小节
 * 顺序收起来，再按音数加权汇总。
 *
 * 记录按「编配 + 手别」分开：右手弹顺了不代表左手也会，L2 编配的成绩也
 * 不能冒充 L4 编配。`Profile.skillLedger` 仍是全局账本，换编配不会清零
 * 已掌握技能；这里只负责保留每首曲子自己的评测历史。
 */

export type RepertoireAssessmentHand = Hand | "BOTH";

/** 一整首曲子里的一段评测结果；索引与小节坐标都来自 `scoreSegments`。 */
export type RepertoireSegmentResult = {
  index: number;
  start: number;
  end: number;
  label: string;
  /** 音高与拍点都对的槽位数。 */
  onCount: number;
  /** 这一段的总槽位数。 */
  total: number;
  /** 0..1，等于 onCount / total。 */
  accuracy: number;
};

export type RepertoireAssessment = {
  songId: string;
  arrangementId: string;
  packageId: string;
  hand: RepertoireAssessmentHand;
  bpm: number;
  segments: RepertoireSegmentResult[];
  onCount: number;
  total: number;
  /** 0..1，按音数加权，不是各段百分比的简单平均。 */
  accuracy: number;
  completedAt: number;
};

export type RepertoireAssessmentBook = Record<string, RepertoireAssessment>;

export interface RepertoireAssessmentInput {
  songId: string;
  arrangementId: string;
  packageId: string;
  hand: RepertoireAssessmentHand;
  bpm: number;
  segments: readonly RepertoireSegmentResult[];
  completedAt?: number;
}

export function assessmentKey(
  arrangementId: string,
  hand: RepertoireAssessmentHand,
): string {
  return `${arrangementId}@${hand}`;
}

/** 把分段结果汇总成一次整曲评测；各段按音数加权。 */
export function buildRepertoireAssessment(
  input: RepertoireAssessmentInput,
): RepertoireAssessment {
  const segments = input.segments.map((segment) => {
    const total = Math.max(0, Math.floor(segment.total));
    const onCount = Math.min(total, Math.max(0, Math.floor(segment.onCount)));
    return {
      ...segment,
      onCount,
      total,
      accuracy: total > 0 ? onCount / total : 0,
    };
  });
  const onCount = segments.reduce((sum, segment) => sum + segment.onCount, 0);
  const total = segments.reduce((sum, segment) => sum + segment.total, 0);
  return {
    songId: input.songId,
    arrangementId: input.arrangementId,
    packageId: input.packageId,
    hand: input.hand,
    bpm: input.bpm,
    segments,
    onCount,
    total,
    accuracy: total > 0 ? onCount / total : 0,
    completedAt: input.completedAt ?? Date.now(),
  };
}

/**
 * 写一次整曲评测。
 *
 * 同一编配、同一只手只保留最好的一次：重测失手不该把已经拿到的成绩冲掉。
 * 返回新档案而不是原地修改，`skillLedger` 等其它字段原样带过去——同歌升级
 * 时已掌握技能不清零，靠的就是这里不重建账本。
 */
export function recordRepertoireAssessment(
  profile: Profile,
  assessment: RepertoireAssessment,
): Profile {
  const key = assessmentKey(assessment.arrangementId, assessment.hand);
  const previous = profile.repertoireAssessments?.[key];
  if (previous && !isBetterAssessment(assessment, previous)) return profile;
  return {
    ...profile,
    repertoireAssessments: {
      ...(profile.repertoireAssessments ?? {}),
      [key]: assessment,
    },
  };
}

function isBetterAssessment(
  next: RepertoireAssessment,
  previous: RepertoireAssessment,
): boolean {
  if (next.accuracy !== previous.accuracy) return next.accuracy > previous.accuracy;
  if (next.total !== previous.total) return next.total > previous.total;
  return next.completedAt > previous.completedAt;
}

/** 同一首歌的所有评测记录；用于曲库页的「同歌升级」提示。 */
export function assessmentsForSong(
  book: RepertoireAssessmentBook | undefined,
  songId: string,
): RepertoireAssessment[] {
  if (!book || !songId) return [];
  return Object.values(book).filter((assessment) => assessment.songId === songId);
}

/**
 * 读盘时只做结构校验：坏数据丢掉，好数据重算汇总值。
 *
 * 汇总值不信任存盘里的 `accuracy` / `onCount`——它们可能来自旧版本或手改
 * 档案；以分段结果为准，界面上的整曲匹配率才不会和分段列表对不上。
 */
export function normalizeRepertoireAssessmentBook(
  value: unknown,
): RepertoireAssessmentBook {
  if (!value || typeof value !== "object") return {};
  const out: RepertoireAssessmentBook = {};
  for (const raw of Object.values(value as Record<string, unknown>)) {
    const assessment = normalizeAssessment(raw);
    if (!assessment) continue;
    const key = assessmentKey(assessment.arrangementId, assessment.hand);
    const previous = out[key];
    if (!previous || isBetterAssessment(assessment, previous)) out[key] = assessment;
  }
  return out;
}

function normalizeAssessment(value: unknown): RepertoireAssessment | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Partial<RepertoireAssessment>;
  const songId = nonEmpty(item.songId);
  const arrangementId = nonEmpty(item.arrangementId);
  const packageId = nonEmpty(item.packageId);
  const hand = item.hand === "RH" || item.hand === "LH" || item.hand === "BOTH"
    ? item.hand
    : null;
  const bpm = positiveNumber(item.bpm);
  const completedAt = finiteNumber(item.completedAt) ?? 0;
  if (!songId || !arrangementId || !packageId || !hand || bpm === null) return null;
  if (!Array.isArray(item.segments)) return null;

  const segments: RepertoireSegmentResult[] = [];
  for (const rawSegment of item.segments) {
    const segment = normalizeSegment(rawSegment);
    if (segment) segments.push(segment);
  }
  if (segments.length === 0) return null;

  return buildRepertoireAssessment({
    songId,
    arrangementId,
    packageId,
    hand,
    bpm,
    completedAt,
    segments,
  });
}

function normalizeSegment(value: unknown): RepertoireSegmentResult | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Partial<RepertoireSegmentResult>;
  const index = nonNegativeInteger(item.index);
  const start = nonNegativeInteger(item.start);
  const end = nonNegativeInteger(item.end);
  const label = nonEmpty(item.label);
  const total = positiveInteger(item.total);
  const onCount = nonNegativeInteger(item.onCount);
  if (
    index === null
    || start === null
    || end === null
    || end < start
    || !label
    || total === null
    || onCount === null
    || onCount > total
  ) {
    return null;
  }
  return {
    index,
    start,
    end,
    label,
    onCount,
    total,
    accuracy: onCount / total,
  };
}

function nonEmpty(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function positiveNumber(value: unknown): number | null {
  const number = finiteNumber(value);
  return number !== null && number > 0 ? number : null;
}

function nonNegativeInteger(value: unknown): number | null {
  const number = finiteNumber(value);
  return number !== null && Number.isInteger(number) && number >= 0 ? number : null;
}

function positiveInteger(value: unknown): number | null {
  const number = nonNegativeInteger(value);
  return number !== null && number > 0 ? number : null;
}
