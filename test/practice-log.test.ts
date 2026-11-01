import { describe, expect, it } from "vitest";
import {
  dayKey,
  formatClock,
  formatMinutes,
  practiceHistory,
  practiceSummary,
  recordPractice,
} from "../src/domain/practiceLog";
import { initialProfile } from "../src/domain/profile";

const NOON = (day: number) => new Date(2026, 9, day, 12, 0, 0).getTime();
const MINUTE = 60 * 1000;

describe("practiceLog", () => {
  it("ignores empty or invalid durations and clamps one entry to 45 minutes", () => {
    const base = initialProfile();
    expect(recordPractice(base, "reading", 0).practiceLog).toHaveLength(0);
    expect(recordPractice(base, "reading", Number.NaN).practiceLog).toHaveLength(0);
    expect(recordPractice(base, "reading", -5).practiceLog).toHaveLength(0);

    const long = recordPractice(base, "sight", 3 * 60 * MINUTE, NOON(20));
    expect(long.practiceLog).toHaveLength(1);
    expect(long.practiceLog[0]?.ms).toBe(45 * MINUTE);
  });

  it("summarises today and counts the streak from today or yesterday", () => {
    let profile = initialProfile();
    profile = recordPractice(profile, "reading", 20 * MINUTE, NOON(18));
    profile = recordPractice(profile, "sight", 5 * MINUTE, NOON(19));
    profile = recordPractice(profile, "theory", 10 * MINUTE, NOON(20));

    const today = practiceSummary(profile, NOON(20));
    expect(today.todayCount).toBe(1);
    expect(today.todayMs).toBe(10 * MINUTE);
    expect(today.totalCount).toBe(3);
    expect(today.totalMs).toBe(35 * MINUTE);
    expect(today.streak).toBe(3);

    // 今天还没练时，连续天数从昨天往前算，不把「今天」算成断档。
    const tomorrow = practiceSummary(profile, NOON(21));
    expect(tomorrow.todayCount).toBe(0);
    expect(tomorrow.streak).toBe(3);
  });

  it("uses local dates and formats minutes without zero-minute noise", () => {
    expect(dayKey(NOON(20))).toBe("2026-10-20");
    expect(formatMinutes(0)).toBe("0 分钟");
    expect(formatMinutes(30 * 1000)).toBe("1 分钟");
    expect(formatMinutes(25 * MINUTE)).toBe("25 分钟");
  });

  it("keeps only the newest 400 entries", () => {
    let profile = initialProfile();
    for (let index = 0; index < 405; index += 1) {
      profile = recordPractice(profile, "reading", 1000, NOON(20) + index);
    }
    expect(profile.practiceLog).toHaveLength(400);
    expect(profile.practiceLog[0]?.at).toBe(NOON(20) + 5);
  });

  it("groups the last days into a newest-first history with readable labels", () => {
    let profile = initialProfile();
    profile = recordPractice(profile, "reading", 20 * MINUTE, NOON(20));
    profile = recordPractice(profile, "theory", 10 * MINUTE, NOON(20) + MINUTE);
    profile = recordPractice(profile, "sight", 5 * MINUTE, NOON(19));

    const history = practiceHistory(profile, 7, NOON(20));
    expect(history.map((day) => day.day)).toEqual(["2026-10-20", "2026-10-19"]);
    expect(history.map((day) => day.label)).toEqual(["今天", "昨天"]);
    expect(history[0]?.ms).toBe(30 * MINUTE);
    // 同一天内按时间倒序，12:01 的乐理排在 12:00 的识谱前面。
    expect(history[0]?.entries.map((entry) => entry.kind)).toEqual(["theory", "reading"]);
    expect(history[0]?.entries[0]?.label).toBe("乐理");
    expect(history[1]?.entries[0]?.label).toBe("视奏");
  });

  it("limits history days and formats an older date plus local clock", () => {
    let profile = initialProfile();
    profile = recordPractice(profile, "reading", MINUTE, NOON(17));
    profile = recordPractice(profile, "sight", MINUTE, NOON(18));
    profile = recordPractice(profile, "theory", MINUTE, NOON(19));

    const history = practiceHistory(profile, 2, NOON(20));
    expect(history).toHaveLength(2);
    expect(history.map((day) => day.label)).toEqual(["昨天", "10 月 18 日"]);
    expect(formatClock(new Date(2026, 9, 20, 9, 5, 0).getTime())).toBe("09:05");
  });
});
