import { describe, expect, it } from "vitest";
import type { CompareResult } from "../src/domain/compare";
import { sightFeedbackText } from "../src/domain/feedback";
import { mergeProfile, pruneExhaustedErrorSnippet, initialProfile } from "../src/domain/profile";
import type { Score } from "../src/domain/types";

const empty: CompareResult = {
  pitchErrors: 0,
  rhythmBreaks: 0,
  firstWrongLabel: null,
  wrongPitchNoteIds: [],
  lateNoteIds: [], shortNoteIds: [],
};

const snippet: Score = {
  id: "line-1",
  mode: "sight",
  level: 1,
  meter: { beats: 4, beatValue: 4 },
  keySignature: "C",
  hands: ["RH"],
  bpm: 60,
  staves: {},
};

describe("sightFeedbackText", () => {
  it("puts rhythm ahead of pitch", () => {
    expect(sightFeedbackText({ ...empty, rhythmBreaks: 2, pitchErrors: 3, firstWrongLabel: "C4" })).toContain(
      "比拍子晚了",
    );
    expect(sightFeedbackText({ ...empty, rhythmBreaks: 1 })).toContain("有一处比拍子晚了");
    expect(sightFeedbackText(empty)).toContain("完成啦");
  });
});

describe("mergeProfile", () => {
  it("fills tip flags missing from an old record", () => {
    const merged = mergeProfile({ lastSeed: 9, l1RightPassed: true });
    expect(merged.lastSeed).toBe(9);
    expect(merged.l1RightPassed).toBe(true);
    expect(merged.seenReadingTips).toBe(false);
    expect(merged.seenSightTips).toBe(false);
    expect(merged.weakPitchQueue).toEqual([]);
  });
});

describe("pruneExhaustedErrorSnippet", () => {
  it("removes a snippet after two uses", () => {
    const profile = {
      ...initialProfile(),
      errorSnippets: [snippet],
      sightUses: { "line-1": 2 },
    };
    const next = pruneExhaustedErrorSnippet(profile, "line-1");
    expect(next.errorSnippets).toEqual([]);
    expect(pruneExhaustedErrorSnippet(profile, "other").errorSnippets).toHaveLength(1);
  });
});
