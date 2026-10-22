import { describe, expect, it } from "vitest";
import {
  completeL3PrepLesson,
  initialProfile,
  mergeProfile,
  type Profile,
} from "../src/domain/profile";
import {
  L3_PREP_LESSONS,
  L3_PREP_SKILL_MAP,
  createL3LessonQuestions,
} from "../src/practice";
import { isMastered, migrateProfile, skillKey } from "../src/repertoire";

function profile(partial: Partial<Profile> = {}): Profile {
  return { ...initialProfile(), ...partial };
}

describe("L3 prep lessons", () => {
  it("defines nine unique lessons with fixed question counts", () => {
    expect(L3_PREP_LESSONS).toHaveLength(9);
    expect(new Set(L3_PREP_LESSONS.map((lesson) => lesson.id)).size).toBe(9);
    for (const lesson of L3_PREP_LESSONS) {
      expect(lesson.passScore).toBeLessThanOrEqual(lesson.questionCount);
      const questions = createL3LessonQuestions(lesson.id, 42);
      expect(questions).toHaveLength(lesson.questionCount);
      expect(new Set(questions.map((question) => question.id)).size).toBe(questions.length);
      for (const question of questions) {
        expect(question.choices).toHaveLength(4);
        expect(question.choices.some((choice) => choice.id === question.answerId)).toBe(true);
      }
    }
  });

  it("gives every triad question a staff prompt", () => {
    const questions = createL3LessonQuestions("L3-1", 1);
    expect(questions).toHaveLength(4);
    for (const question of questions) {
      expect(question.staff?.groups.length).toBeGreaterThan(0);
    }
  });

  it("is deterministic and puts the four knowledge types in the mixed lesson", () => {
    const first = createL3LessonQuestions("L3-9", 7);
    const second = createL3LessonQuestions("L3-9", 7);
    expect(first).toEqual(second);
    expect(first.map((question) => question.kind)).toEqual(
      expect.arrayContaining(["chords", "accidentals", "intervals", "progressions"]),
    );
    expect(createL3LessonQuestions("L3-missing", 1)).toEqual([]);
  });

  it("covers the four L3 skills and only writes learning to the ledger", () => {
    expect(Object.keys(L3_PREP_SKILL_MAP)).toHaveLength(9);
    expect(L3_PREP_SKILL_MAP["L3-1"]).toEqual(["chord.triad"]);
    expect(L3_PREP_SKILL_MAP["L3-2"]).toEqual(["key.accidental"]);
    // 纯复习课没有技能映射，不写账本。
    expect(L3_PREP_SKILL_MAP["L3-6"]).toEqual([]);
    expect(L3_PREP_SKILL_MAP["L3-8"]).toEqual([]);

    const ledger = migrateProfile(profile({ l3PrepCompleted: ["L3-1"] }), 100);
    const key = skillKey("chord.triad", "both");
    expect(ledger[key]?.state).toBe("learning");
    expect(isMastered(ledger, "chord.triad")).toBe(false);
  });

  it("persists completed lesson ids without duplicating them", () => {
    const once = completeL3PrepLesson(profile(), "L3-1");
    expect(once.l3PrepCompleted).toEqual(["L3-1"]);
    expect(completeL3PrepLesson(once, "L3-1")).toBe(once);

    const merged = mergeProfile({
      l3PrepCompleted: ["L3-1", "L3-1", "L3-2"],
    });
    expect(merged.l3PrepCompleted).toEqual(["L3-1", "L3-2"]);
    expect(mergeProfile({}).l3PrepCompleted).toEqual([]);
  });
});
