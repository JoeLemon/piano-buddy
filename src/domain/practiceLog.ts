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

/** 本地日期 key（YYYY-MM-DD），避免用 UTC 把晚上的练习算到第二天。 */
export function dayKey(at: number): string {
  const date = new Date(at);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function recordPractice(
  profile: Profile,
  kind: PracticeKind,
  ms: number,
  at = Date.now(),
): Profile {
  if (!Number.isFinite(ms) || ms <= 0) return profile;
  const entry: PracticeEntry = {
    at,
    kind,
    ms: Math.min(MAX_ENTRY_MS, Math.round(ms)),
  };
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
