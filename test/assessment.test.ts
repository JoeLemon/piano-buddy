import { describe, expect, it } from "vitest";
import { initialProfile, type Profile } from "../src/domain/profile";
import {
  assessmentKey,
  assessmentsForSong,
  buildRepertoireAssessment,
  normalizeRepertoireAssessmentBook,
  recordRepertoireAssessment,
  type RepertoireSegmentResult,
} from "../src/repertoire/assessment";

const SEGMENTS: RepertoireSegmentResult[] = [
  {
    index: 0,
    start: 0,
    end: 2,
    label: "第 1–2 小节",
    onCount: 3,
    total: 4,
    accuracy: 0,
  },
  {
    index: 1,
    start: 2,
    end: 4,
    label: "第 3–4 小节",
    onCount: 4,
    total: 4,
    accuracy: 0,
  },
];

function assessment(overrides: Partial<Parameters<typeof buildRepertoireAssessment>[0]> = {}) {
  return buildRepertoireAssessment({
    songId: "song.ode-to-joy",
    arrangementId: "arr.ode-to-joy.standard",
    packageId: "pkg.ode-to-joy.standard",
    hand: "BOTH",
    bpm: 72,
    segments: SEGMENTS,
    completedAt: 10,
    ...overrides,
  });
}

describe("repertoire assessment", () => {
  it("weights the whole song by notes, not by segment count", () => {
    const result = assessment();

    expect(result.segments.map((segment) => segment.accuracy)).toEqual([0.75, 1]);
    expect(result.onCount).toBe(7);
    expect(result.total).toBe(8);
    expect(result.accuracy).toBeCloseTo(7 / 8);
    expect(result.completedAt).toBe(10);
  });

  it("keeps the best result for the same arrangement and hand", () => {
    const profile = initialProfile();
    const first = assessment();
    const afterFirst = recordRepertoireAssessment(profile, first);
    expect(afterFirst.repertoireAssessments[assessmentKey("arr.ode-to-joy.standard", "BOTH")])
      .toBe(first);

    const worse = assessment({
      segments: [{ ...SEGMENTS[0], onCount: 1 }],
      completedAt: 20,
    });
    expect(recordRepertoireAssessment(afterFirst, worse)).toBe(afterFirst);

    const better = assessment({
      segments: SEGMENTS.map((segment) => ({ ...segment, onCount: segment.total })),
      completedAt: 30,
    });
    const afterBetter = recordRepertoireAssessment(afterFirst, better);
    expect(afterBetter.repertoireAssessments[
      assessmentKey("arr.ode-to-joy.standard", "BOTH")
    ].accuracy).toBe(1);
  });

  it("does not rebuild or clear the skill ledger when recording an assessment", () => {
    const profile: Profile = {
      ...initialProfile(),
      skillLedger: {
        "pos.five@both": {
          skillId: "pos.five",
          hand: "both",
          state: "passed",
          confidence: 1,
        },
      },
    };

    const next = recordRepertoireAssessment(profile, assessment());
    expect(next.skillLedger).toBe(profile.skillLedger);
    expect(next.skillLedger["pos.five@both"]?.state).toBe("passed");
  });

  it("finds same-song history for the upgrade hint", () => {
    const book = {
      [assessmentKey("arr.ode-to-joy.simple", "BOTH")]: assessment({
        arrangementId: "arr.ode-to-joy.simple",
        packageId: "pkg.ode-to-joy.simple",
      }),
      [assessmentKey("arr.rainbow.full", "BOTH")]: assessment({
        songId: "song.rainbow",
        arrangementId: "arr.rainbow.full",
        packageId: "pkg.rainbow.full",
      }),
    };

    expect(assessmentsForSong(book, "song.ode-to-joy")).toHaveLength(1);
    expect(assessmentsForSong(book, "song.rainbow")).toHaveLength(1);
    expect(assessmentsForSong(book, "song.missing")).toEqual([]);
  });

  it("recomputes summary values and drops malformed stored records", () => {
    const key = assessmentKey("arr.ode-to-joy.standard", "BOTH");
    const stored = {
      [key]: {
        ...assessment(),
        onCount: 99,
        total: 1,
        accuracy: 0.01,
        segments: SEGMENTS.map((segment) => ({ ...segment, accuracy: 0.01 })),
      },
      broken: {
        songId: "song.ode-to-joy",
        arrangementId: "arr.ode-to-joy.standard",
        packageId: "pkg.ode-to-joy.standard",
        hand: "sideways",
        bpm: 72,
        segments: SEGMENTS,
      },
    };

    const normalized = normalizeRepertoireAssessmentBook(stored);
    expect(Object.keys(normalized)).toEqual([key]);
    expect(normalized[key].onCount).toBe(7);
    expect(normalized[key].total).toBe(8);
    expect(normalized[key].accuracy).toBeCloseTo(7 / 8);
    expect(normalized[key].segments[0].accuracy).toBe(0.75);
    expect(normalizeRepertoireAssessmentBook(null)).toEqual({});
  });
});
