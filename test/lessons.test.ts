import { describe, expect, it } from "vitest";
import { initialProfile, recordFindKey, recordLineFinished, recordTap, type Profile } from "../src/domain/profile";

describe("L1 lessons", () => {
  it("advances after eight steady gaps", () => {
    let profile: Profile = { ...initialProfile(), lessonId: "L1-1" as const };
    profile = recordTap(profile, null);
    for (let i = 0; i < 7; i += 1) profile = recordTap(profile, 1000);
    expect(profile.lessonId).toBe("L1-1");
    profile = recordTap(profile, 1000);
    expect(profile.lessonId).toBe("L1-2");
    expect(profile.tapStreak).toBe(0);
  });

  it("resets the tap streak when a gap is outside 800-1200ms", () => {
    let profile: Profile = { ...initialProfile(), lessonId: "L1-1" as const };
    profile = recordTap(profile, null);
    profile = recordTap(profile, 1000);
    profile = recordTap(profile, 1400);
    expect(profile.tapStreak).toBe(0);
    expect(profile.lessonId).toBe("L1-1");
  });

  it("queues a missed pitch twice and advances after eight correct finds", () => {
    let profile: Profile = { ...initialProfile(), lessonId: "L1-2" as const };
    profile = recordFindKey(profile, "F4", false);
    expect(profile.weakPitchQueue).toEqual(["F4", "F4"]);
    for (let i = 0; i < 8; i += 1) profile = recordFindKey(profile, "C4", true);
    expect(profile.lessonId).toBe("L1-3");
  });

  it("teaches left-hand notes before the left-hand lines", () => {
    let profile: Profile = { ...initialProfile(), lessonId: "L1-4" as const };
    for (let i = 0; i < 8; i += 1) profile = recordFindKey(profile, "C3", true);
    expect(profile.lessonId).toBe("L1-4");
    expect(profile.lessonPhase).toBe("lines");
    profile = recordLineFinished(profile);
    profile = recordLineFinished(profile);
    expect(profile.lessonId).toBe("L1-test");
  });
});
