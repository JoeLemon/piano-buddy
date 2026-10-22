import { describe, expect, it } from "vitest";
import {
  dayKey,
  formatMinutes,
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
});
