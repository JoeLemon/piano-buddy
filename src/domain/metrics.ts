import { PRACTICE_KIND_LABELS, dayKey } from "./practiceLog";
import type {
  GapAttempt,
  GapAttemptSource,
  PracticeKind,
  Profile,
} from "./profile";
import type { Hand } from "./types";

/**
 * 本地练习指标。
 *
 * 指标只从当前档案里算，不上传任何数据：
 * - 练习时长/次数来自 `practiceLog`；
 * - 放弃点来自离开页面时写入的 `completed: false` 记录；
 * - 缺口命中率来自 `gapAttempts`：错题本重练，或曲库里还没弹对的分段的跟弹。
 *
 * 指标是「观察」而不是「评分」：它不参与过关、不改变技能账本，也不替用户
 * 判断练得好不好。导出 JSON 只是把同一份事实换一种格式给作者/自己看。
 */

const DAY_MS = 24 * 60 * 60 * 1000;
export const MAX_GAP_ATTEMPTS = 200;

export type MetricsOptions = {
  /** 统计最近多少天；默认 30 天。 */
  days?: number;
  now?: number;
};

export type PracticeKindMetrics = {
  sessions: number;
  durationMs: number;
  /** 明确标记为完成的记录数。 */
  completed: number;
  /** 明确标记为未完成的记录数（旧记录没有该字段，不计入）。 */
  abandoned: number;
};

export type PracticeDayMetrics = {
  day: string;
  sessions: number;
  durationMs: number;
};

export type AbandonPoint = {
  key: string;
  kind: PracticeKind;
  label: string;
  screen?: string;
  focus?: string;
  sessions: number;
  durationMs: number;
  averageMs: number;
  lastAt: number;
};

export type GapHitRateBucket = {
  attempts: number;
  onCount: number;
  total: number;
  /** 0..1；没有重练记录时为 null。 */
  rate: number | null;
};

export type GapHitRate = GapHitRateBucket & {
  bySource: Record<GapAttemptSource, GapHitRateBucket>;
  /** 最近 10 次缺口重练，按时间倒序。 */
  recent: Array<GapAttempt & { accuracy: number }>;
};

export type PracticeMetrics = {
  app: "piano-buddy";
  schemaVersion: 1;
  generatedAt: string;
  range: {
    days: number;
    from: string;
    to: string;
  };
  practice: {
    sessions: number;
    durationMs: number;
    completed: number;
    abandoned: number;
    byKind: Record<PracticeKind, PracticeKindMetrics>;
    byDay: PracticeDayMetrics[];
  };
  abandonPoints: AbandonPoint[];
  gapHitRate: GapHitRate;
};

export type GapAttemptInput = {
  source: GapAttemptSource;
  scoreId: string;
  hand: Hand | "BOTH";
  onCount: number;
  total: number;
  at?: number;
};

const PRACTICE_KINDS: readonly PracticeKind[] = [
  "reading",
  "sight",
  "test",
  "theory",
  "l3",
  "repertoire",
];

const GAP_SOURCES: readonly GapAttemptSource[] = ["error-book", "repertoire-segment"];

/** 记一次缺口重练；坏的槽位数据直接忽略，不让指标污染档案。 */
export function recordGapAttempt(profile: Profile, input: GapAttemptInput): Profile {
  const total = Math.floor(input.total);
  if (!input.scoreId || !Number.isFinite(total) || total <= 0) return profile;
  const onCount = Math.min(total, Math.max(0, Math.floor(input.onCount)));
  if (!Number.isFinite(onCount)) return profile;
  const attempt: GapAttempt = {
    at: Number.isFinite(input.at) ? input.at! : Date.now(),
    source: input.source,
    scoreId: input.scoreId,
    hand: input.hand,
    onCount,
    total,
  };
  return {
    ...profile,
    gapAttempts: [...(profile.gapAttempts ?? []), attempt].slice(-MAX_GAP_ATTEMPTS),
  };
}

export function buildPracticeMetrics(
  profile: Profile,
  options: MetricsOptions = {},
): PracticeMetrics {
  const days = Math.max(1, Math.floor(options.days ?? 30));
  const now = Number.isFinite(options.now) ? options.now! : Date.now();
  const from = now - days * DAY_MS;

  const byKind = emptyKindMetrics();
  const byDay = new Map<string, PracticeDayMetrics>();
  let sessions = 0;
  let durationMs = 0;
  let completed = 0;
  let abandoned = 0;

  for (const entry of profile.practiceLog ?? []) {
    if (entry.at < from || entry.at > now) continue;
    sessions += 1;
    durationMs += entry.ms;
    if (entry.completed === true) completed += 1;
    if (entry.completed === false) abandoned += 1;

    const kind = byKind[entry.kind];
    kind.sessions += 1;
    kind.durationMs += entry.ms;
    if (entry.completed === true) kind.completed += 1;
    if (entry.completed === false) kind.abandoned += 1;

    const day = dayKey(entry.at);
    const dayMetrics = byDay.get(day) ?? { day, sessions: 0, durationMs: 0 };
    dayMetrics.sessions += 1;
    dayMetrics.durationMs += entry.ms;
    byDay.set(day, dayMetrics);
  }

  const abandonMap = new Map<string, AbandonPoint>();
  for (const entry of profile.practiceLog ?? []) {
    if (entry.at < from || entry.at > now || entry.completed !== false) continue;
    const key = `${entry.kind}|${entry.screen ?? ""}|${entry.focus ?? ""}`;
    const point = abandonMap.get(key) ?? {
      key,
      kind: entry.kind,
      label: PRACTICE_KIND_LABELS[entry.kind],
      screen: entry.screen,
      focus: entry.focus,
      sessions: 0,
      durationMs: 0,
      averageMs: 0,
      lastAt: entry.at,
    };
    point.sessions += 1;
    point.durationMs += entry.ms;
    point.lastAt = Math.max(point.lastAt, entry.at);
    abandonMap.set(key, point);
  }
  const abandonPoints = [...abandonMap.values()]
    .map((point) => ({
      ...point,
      averageMs: point.sessions > 0 ? Math.round(point.durationMs / point.sessions) : 0,
    }))
    .sort((a, b) => b.sessions - a.sessions || b.lastAt - a.lastAt);

  return {
    app: "piano-buddy",
    schemaVersion: 1,
    generatedAt: new Date(now).toISOString(),
    range: {
      days,
      from: new Date(from).toISOString(),
      to: new Date(now).toISOString(),
    },
    practice: {
      sessions,
      durationMs,
      completed,
      abandoned,
      byKind,
      byDay: [...byDay.values()].sort((a, b) => b.day.localeCompare(a.day)),
    },
    abandonPoints,
    gapHitRate: gapHitRate(profile, from, now),
  };
}

function emptyKindMetrics(): Record<PracticeKind, PracticeKindMetrics> {
  return Object.fromEntries(
    PRACTICE_KINDS.map((kind) => [
      kind,
      { sessions: 0, durationMs: 0, completed: 0, abandoned: 0 },
    ]),
  ) as Record<PracticeKind, PracticeKindMetrics>;
}

function gapHitRate(profile: Profile, from: number, now: number): GapHitRate {
  const bySource = Object.fromEntries(
    GAP_SOURCES.map((source) => [source, emptyGapBucket()]),
  ) as Record<GapAttemptSource, GapHitRateBucket>;
  const totalBucket = emptyGapBucket();
  const recent: Array<GapAttempt & { accuracy: number }> = [];

  for (const attempt of profile.gapAttempts ?? []) {
    if (attempt.at < from || attempt.at > now) continue;
    addGapAttempt(totalBucket, attempt);
    addGapAttempt(bySource[attempt.source], attempt);
    recent.push({ ...attempt, accuracy: attempt.total > 0 ? attempt.onCount / attempt.total : 0 });
  }

  recent.sort((a, b) => b.at - a.at);
  return {
    ...totalBucket,
    bySource,
    recent: recent.slice(0, 10),
  };
}

function emptyGapBucket(): GapHitRateBucket {
  return { attempts: 0, onCount: 0, total: 0, rate: null };
}

function addGapAttempt(bucket: GapHitRateBucket, attempt: GapAttempt): void {
  bucket.attempts += 1;
  bucket.onCount += attempt.onCount;
  bucket.total += attempt.total;
  bucket.rate = bucket.total > 0 ? bucket.onCount / bucket.total : null;
}

export function metricsFilename(at = new Date()): string {
  const year = at.getFullYear();
  const month = String(at.getMonth() + 1).padStart(2, "0");
  const day = String(at.getDate()).padStart(2, "0");
  return `piano-buddy-metrics-${year}-${month}-${day}.json`;
}
