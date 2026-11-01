import { describe, expect, it } from "vitest";
import {
  buildPracticeMetrics,
  MAX_GAP_ATTEMPTS,
  metricsFilename,
  recordGapAttempt,
} from "../src/domain/metrics";
import { initialProfile, mergeProfile, type Profile } from "../src/domain/profile";

const NOON = new Date(2026, 9, 20, 12, 0, 0).getTime();
const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;

function profile(partial: Partial<Profile> = {}): Profile {
  return { ...initialProfile(), ...partial };
}

describe("practice metrics", () => {
  it("aggregates duration, completion and abandon points inside the range", () => {
    const source = profile({
      practiceLog: [
        {
          at: NOON - MINUTE,
          kind: "reading",
          ms: 20 * MINUTE,
          completed: true,
          screen: "reading",
          focus: "L1-2",
        },
        {
          at: NOON - 2 * MINUTE,
          kind: "theory",
          ms: 8 * MINUTE,
          completed: false,
          screen: "practice",
          focus: "L4-1",
        },
        {
          at: NOON - 3 * MINUTE,
          kind: "theory",
          ms: 4 * MINUTE,
          completed: false,
          screen: "practice",
          focus: "L4-1",
        },
        { at: NOON - 10 * DAY, kind: "sight", ms: 30 * MINUTE, completed: true },
      ],
    });

    const metrics = buildPracticeMetrics(source, { days: 7, now: NOON });

    expect(metrics.practice.sessions).toBe(3);
    expect(metrics.practice.durationMs).toBe(32 * MINUTE);
    expect(metrics.practice.completed).toBe(1);
    expect(metrics.practice.abandoned).toBe(2);
    expect(metrics.practice.byKind.reading).toMatchObject({ sessions: 1, durationMs: 20 * MINUTE });
    expect(metrics.practice.byKind.theory).toMatchObject({
      sessions: 2,
      durationMs: 12 * MINUTE,
      abandoned: 2,
    });
    expect(metrics.practice.byDay).toHaveLength(1);
    expect(metrics.practice.byDay[0]?.day).toBe("2026-10-20");

    expect(metrics.abandonPoints).toHaveLength(1);
    expect(metrics.abandonPoints[0]).toMatchObject({
      kind: "theory",
      focus: "L4-1",
      sessions: 2,
      durationMs: 12 * MINUTE,
      averageMs: 6 * MINUTE,
    });
  });

  it("keeps legacy entries in the duration but out of completion counts", () => {
    const metrics = buildPracticeMetrics(
      profile({ practiceLog: [{ at: NOON, kind: "theory", ms: MINUTE }] }),
      { days: 30, now: NOON },
    );

    expect(metrics.practice.sessions).toBe(1);
    expect(metrics.practice.durationMs).toBe(MINUTE);
    expect(metrics.practice.completed).toBe(0);
    expect(metrics.practice.abandoned).toBe(0);
    expect(metrics.abandonPoints).toHaveLength(0);
  });

  it("computes gap hit rate across error-book and repertoire retries", () => {
    const source = profile({
      gapAttempts: [
        { at: NOON - MINUTE, source: "error-book", scoreId: "s1", hand: "RH", onCount: 3, total: 4 },
        {
          at: NOON - 2 * MINUTE,
          source: "repertoire-segment",
          scoreId: "s2",
          hand: "BOTH",
          onCount: 1,
          total: 2,
        },
        { at: NOON - 10 * DAY, source: "error-book", scoreId: "old", hand: "RH", onCount: 0, total: 4 },
      ],
    });

    const metrics = buildPracticeMetrics(source, { days: 7, now: NOON });

    expect(metrics.gapHitRate).toMatchObject({ attempts: 2, onCount: 4, total: 6 });
    expect(metrics.gapHitRate.rate).toBeCloseTo(4 / 6);
    expect(metrics.gapHitRate.bySource["error-book"]).toMatchObject({
      attempts: 1,
      onCount: 3,
      total: 4,
    });
    expect(metrics.gapHitRate.bySource["repertoire-segment"]).toMatchObject({
      attempts: 1,
      onCount: 1,
      total: 2,
    });
    expect(metrics.gapHitRate.recent.map((item) => item.scoreId)).toEqual(["s1", "s2"]);
    expect(metrics.gapHitRate.recent[0]?.accuracy).toBe(0.75);
  });

  it("returns null rates when there is nothing to measure", () => {
    const metrics = buildPracticeMetrics(profile(), { now: NOON });

    expect(metrics.gapHitRate.rate).toBeNull();
    expect(metrics.gapHitRate.bySource["error-book"].rate).toBeNull();
    expect(metrics.practice.sessions).toBe(0);
  });
});

describe("recordGapAttempt", () => {
  it("ignores invalid totals and clamps hit counts", () => {
    const base = profile();
    expect(recordGapAttempt(base, {
      source: "error-book",
      scoreId: "",
      hand: "RH",
      onCount: 1,
      total: 2,
    })).toBe(base);
    expect(recordGapAttempt(base, {
      source: "error-book",
      scoreId: "s1",
      hand: "RH",
      onCount: 1,
      total: 0,
    })).toBe(base);

    const next = recordGapAttempt(base, {
      source: "error-book",
      scoreId: "s1",
      hand: "RH",
      onCount: 99,
      total: 4,
      at: NOON,
    });
    expect(next.gapAttempts[0]).toMatchObject({ onCount: 4, total: 4, at: NOON });
  });

  it("keeps only the newest attempts", () => {
    let next = profile();
    for (let index = 0; index < MAX_GAP_ATTEMPTS + 5; index += 1) {
      next = recordGapAttempt(next, {
        source: "repertoire-segment",
        scoreId: `s${index}`,
        hand: "RH",
        onCount: 1,
        total: 2,
        at: NOON + index,
      });
    }
    expect(next.gapAttempts).toHaveLength(MAX_GAP_ATTEMPTS);
    expect(next.gapAttempts[0]?.scoreId).toBe("s5");
  });
});

describe("metrics profile normalisation", () => {
  it("keeps valid metadata and drops malformed gap attempts", () => {
    const merged = mergeProfile({
      practiceLog: [
        {
          at: NOON,
          kind: "reading",
          ms: MINUTE,
          completed: false,
          screen: "reading",
          focus: "L1-2",
        },
        { at: NOON, kind: "reading", ms: MINUTE, completed: "yes" },
      ],
      gapAttempts: [
        { at: NOON, source: "error-book", scoreId: "s1", hand: "RH", onCount: 2, total: 4 },
        { at: NOON, source: "unknown", scoreId: "bad", hand: "RH", onCount: 1, total: 2 },
        { at: NOON, source: "error-book", scoreId: "bad", hand: "RH", onCount: 9, total: 4 },
      ],
    } as Partial<Profile>);

    expect(merged.practiceLog).toHaveLength(2);
    expect(merged.practiceLog[0]).toMatchObject({
      completed: false,
      screen: "reading",
      focus: "L1-2",
    });
    expect(merged.practiceLog[1]?.completed).toBeUndefined();
    expect(merged.gapAttempts).toHaveLength(2);
    expect(merged.gapAttempts[0]).toMatchObject({ onCount: 2, total: 4 });
    expect(merged.gapAttempts[1]).toMatchObject({ onCount: 4, total: 4 });
  });
});

describe("metricsFilename", () => {
  it("uses the local date", () => {
    expect(metricsFilename(new Date(2026, 9, 20, 9, 5))).toBe("piano-buddy-metrics-2026-10-20.json");
  });
});
