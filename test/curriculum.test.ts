import { describe, expect, it } from "vitest";
import { initialProfile, mergeProfile } from "../src/domain/profile";
import {
  ALL_STAGES,
  CURRICULUM_STAGES,
  L4_PREP_STAGES,
  createCurriculumStageQuestions,
  findStage,
  stageListFor,
} from "../src/practice";

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

  it("keeps the two L4 prep stages on practice-page question types", () => {
    expect(L4_PREP_STAGES.map((stage) => stage.id)).toEqual(["L4-1", "L4-2"]);
    for (const stage of L4_PREP_STAGES) {
      const questions = createCurriculumStageQuestions(stage.id, 42);
      expect(questions, stage.id).toHaveLength(stage.questionCount);
      expect(questions.every((question) => question.kind === stage.kind), stage.id).toBe(true);
      for (const question of questions) {
        expect(question.choices).toHaveLength(4);
        expect(question.choices.some((choice) => choice.id === question.answerId)).toBe(true);
      }
    }
  });

  it("finds stages across both lists and keeps next-stage inside one list", () => {
    expect(ALL_STAGES).toHaveLength(CURRICULUM_STAGES.length + L4_PREP_STAGES.length);
    expect(findStage("Q10")?.title).toBe("听调性");
    expect(findStage("L4-1")?.title).toBe("分解和弦");
    expect(findStage(null)).toBeUndefined();
    expect(findStage("nope")).toBeUndefined();
    // 「下一关」不跨章：Q10 后面不是 L4-1。
    expect(stageListFor("Q10")).toBe(CURRICULUM_STAGES);
    expect(stageListFor("L4-1")).toBe(L4_PREP_STAGES);
  });

  it("does not carry a second progress track in the profile", () => {
    expect(initialProfile()).not.toHaveProperty("curriculumCompleted");
    // 旧档案里的 curriculumCompleted 会被忽略，不再迁移进新档案。
    const merged = mergeProfile({ curriculumCompleted: ["Q1", "Q2"] } as never);
    expect(merged).not.toHaveProperty("curriculumCompleted");
    expect(merged.practiceLog).toEqual([]);
  });
});
