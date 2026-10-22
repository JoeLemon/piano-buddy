import { describe, expect, it } from "vitest";
import { initialProfile, mergeProfile } from "../src/domain/profile";
import { CURRICULUM_STAGES, createCurriculumStageQuestions } from "../src/practice";

describe("theory drill presets", () => {
  it("defines ten unique presets with fixed question counts", () => {
    expect(CURRICULUM_STAGES).toHaveLength(10);
    expect(new Set(CURRICULUM_STAGES.map((stage) => stage.id)).size).toBe(10);
    for (const stage of CURRICULUM_STAGES) {
      const questions = createCurriculumStageQuestions(stage.id, 42);
      expect(questions).toHaveLength(stage.questionCount);
      expect(new Set(questions.map((question) => question.id)).size).toBe(questions.length);
      expect(stage.passScore).toBeLessThanOrEqual(stage.questionCount);
      for (const question of questions) {
        expect(question.choices).toHaveLength(4);
        expect(question.choices.some((choice) => choice.id === question.answerId)).toBe(true);
      }
    }
    expect(createCurriculumStageQuestions("Q-missing", 1)).toEqual([]);
  });

  it("does not carry a second progress track in the profile", () => {
    expect(initialProfile()).not.toHaveProperty("curriculumCompleted");
    // 旧档案里的 curriculumCompleted 会被忽略，不再迁移进新档案。
    const merged = mergeProfile({ curriculumCompleted: ["Q1", "Q2"] } as never);
    expect(merged).not.toHaveProperty("curriculumCompleted");
    expect(merged.practiceLog).toEqual([]);
  });
});
