import type { PracticeEntry, PracticeKind, Profile } from "./profile";

const DAY_MS = 24 * 60 * 60 * 1000;
/** 单次练习最多记 45 分钟，防止页面开着过夜把时长灌进档案。 */
const MAX_ENTRY_MS = 45 * 60 * 1000;
const MAX_ENTRIES = 400;

export type PracticeSummary = {
  todayCount: number;
  todayMs: number;
  totalCount: number;
  totalMs: number;
  /** 连续练习天数：今天有记录从今天算，否则从昨天算。 */
  streak: number;
};

export const PRACTICE_KIND_LABELS: Record<PracticeKind, string> = {
  reading: "识谱",
  sight: "视奏",
  test: "过关测试",
  theory: "乐理",
  l3: "L3 和弦",
  repertoire: "曲库",
};

export type PracticeHistoryEntry = PracticeEntry & {
  label: string;
};

export type PracticeHistoryDay = {
  day: string;
  label: string;
  ms: number;
  entries: PracticeHistoryEntry[];
};

/** 一天内的记录按时间倒序；跨天按日期倒序，最多返回 `limitDays` 天。 */
export function practiceHistory(
  profile: Profile,
  limitDays = 7,
  now = Date.now(),
): PracticeHistoryDay[] {
  const byDay = new Map<string, PracticeEntry[]>();
  for (const entry of profile.practiceLog ?? []) {
    const key = dayKey(entry.at);
    const list = byDay.get(key) ?? [];
    list.push(entry);
    byDay.set(key, list);
  }

  return [...byDay.entries()]
    .sort(([a], [b]) => b.localeCompare(a))
    .slice(0, Math.max(1, limitDays))
    .map(([day, entries]) => {
      const sorted = [...entries].sort((a, b) => b.at - a.at);
      return {
        day,
        label: dayLabel(day, now),
        ms: sorted.reduce((sum, entry) => sum + entry.ms, 0),
        entries: sorted.map((entry) => ({
          ...entry,
          label: PRACTICE_KIND_LABELS[entry.kind],
        })),
      };
    });
}

/** 今天/昨天用相对说法，更早的日期写成「10 月 30 日」。 */
function dayLabel(day: string, now: number): string {
  const today = dayKey(now);
  const yesterday = dayKey(now - DAY_MS);
  if (day === today) return "今天";
  if (day === yesterday) return "昨天";
  const [, month, date] = day.split("-").map(Number);
  return `${month} 月 ${date} 日`;
}

/** 记录里的本地时间，用于「最近练习」逐条回看。 */
export function formatClock(at: number): string {
  const date = new Date(at);
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

/** 本地日期 key（YYYY-MM-DD），避免用 UTC 把晚上的练习算到第二天。 */
export function dayKey(at: number): string {
  const date = new Date(at);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export type PracticeEntryMeta = {
  /** 离开页面前是否完成过至少一次练习闭环。 */
  completed?: boolean;
  /** 离开的页面标识。 */
  screen?: string;
  /** 页面内的具体内容。 */
  focus?: string;
};

export function recordPractice(
  profile: Profile,
  kind: PracticeKind,
  ms: number,
  at = Date.now(),
  meta: PracticeEntryMeta = {},
): Profile {
  if (!Number.isFinite(ms) || ms <= 0) return profile;
  const entry: PracticeEntry = {
    at,
    kind,
    ms: Math.min(MAX_ENTRY_MS, Math.round(ms)),
  };
  if (typeof meta.completed === "boolean") entry.completed = meta.completed;
  if (meta.screen) entry.screen = meta.screen;
  if (meta.focus) entry.focus = meta.focus;
  const practiceLog = [...profile.practiceLog, entry].slice(-MAX_ENTRIES);
  return { ...profile, practiceLog };
}

export function practiceSummary(profile: Profile, now = Date.now()): PracticeSummary {
  const log = profile.practiceLog ?? [];
  const today = dayKey(now);
  const todayEntries = log.filter((entry) => dayKey(entry.at) === today);
  const days = new Set(log.map((entry) => dayKey(entry.at)));
  return {
    todayCount: todayEntries.length,
    todayMs: todayEntries.reduce((sum, entry) => sum + entry.ms, 0),
    totalCount: log.length,
    totalMs: log.reduce((sum, entry) => sum + entry.ms, 0),
    streak: streakFor(days, now),
  };
}

function streakFor(days: Set<string>, now: number): number {
  if (days.size === 0) return 0;
  let cursor = now;
  // 今天还没练不算断：从昨天开始数，今天练了则从今天开始。
  if (!days.has(dayKey(cursor))) cursor -= DAY_MS;
  let streak = 0;
  while (days.has(dayKey(cursor))) {
    streak += 1;
    cursor -= DAY_MS;
  }
  return streak;
}

export function formatMinutes(ms: number): string {
  if (ms <= 0) return "0 分钟";
  const minutes = Math.max(1, Math.round(ms / 60000));
  return `${minutes} 分钟`;
}
