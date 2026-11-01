import { describe, expect, it } from "vitest";
import { initialProfile, mergeProfile } from "../src/domain/profile";
import {
  ALL_STAGES,
  CURRICULUM_STAGES,
  L4_PREP_STAGES,
  L5_PREP_STAGES,
  L6_PREP_STAGES,
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

  it("gives L4–L6 four lessons plus a test at every level", () => {
    expect(L4_PREP_STAGES.map((stage) => stage.id)).toEqual([
      "L4-1",
      "L4-2",
      "L4-3",
      "L4-4",
      "L4-5",
    ]);
    expect(L5_PREP_STAGES.map((stage) => stage.id)).toEqual([
      "L5-1",
      "L5-2",
      "L5-3",
      "L5-4",
      "L5-5",
    ]);
    // L6-6「减七与半减七」是后加的补充课，显示顺序排在小测之前，
    // id 没有重排（重排会让已有档案里的 L6-5 完成态错位）。
    expect(L6_PREP_STAGES.map((stage) => stage.id)).toEqual([
      "L6-1",
      "L6-2",
      "L6-3",
      "L6-4",
      "L6-6",
      "L6-5",
    ]);

    for (const stage of [...L4_PREP_STAGES, ...L5_PREP_STAGES, ...L6_PREP_STAGES]) {
      const questions = createCurriculumStageQuestions(stage.id, 42);
      expect(questions, stage.id).toHaveLength(stage.questionCount);
      expect(new Set(questions.map((question) => question.id)).size, stage.id).toBe(
        questions.length,
      );
      expect(stage.passScore, stage.id).toBeLessThanOrEqual(stage.questionCount);
      for (const question of questions) {
        expect(question.choices, `${stage.id}:${question.id}`).toHaveLength(4);
        expect(new Set(question.choices.map((choice) => choice.id)).size).toBe(4);
        expect(new Set(question.choices.map((choice) => choice.label)).size).toBe(4);
        expect(
          question.choices.some((choice) => choice.id === question.answerId),
          `${stage.id}:${question.id}`,
        ).toBe(true);
      }
    }
  });

  it("finds stages across all lists and keeps next-stage inside one list", () => {
    expect(ALL_STAGES).toHaveLength(
      CURRICULUM_STAGES.length +
        L4_PREP_STAGES.length +
        L5_PREP_STAGES.length +
        L6_PREP_STAGES.length,
    );
    expect(findStage("Q10")?.title).toBe("听调性");
    expect(findStage("L4-1")?.title).toBe("分解和弦");
    expect(findStage("L5-2")?.title).toBe("6/8 拍");
    expect(findStage("L6-5")?.title).toBe("L6 综合小测");
    expect(findStage(null)).toBeUndefined();
    expect(findStage("nope")).toBeUndefined();
    // 「下一关」不跨章：Q10 后面不是 L4-1。
    expect(stageListFor("Q10")).toBe(CURRICULUM_STAGES);
    expect(stageListFor("L4-1")).toBe(L4_PREP_STAGES);
    expect(stageListFor("L5-1")).toBe(L5_PREP_STAGES);
    expect(stageListFor("L6-1")).toBe(L6_PREP_STAGES);
  });

  it("does not carry a second progress track in the profile", () => {
    expect(initialProfile()).not.toHaveProperty("curriculumCompleted");
    // 旧档案里的 curriculumCompleted 会被忽略，不再迁移进新档案。
    const merged = mergeProfile({ curriculumCompleted: ["Q1", "Q2"] } as never);
    expect(merged).not.toHaveProperty("curriculumCompleted");
    expect(merged.practiceLog).toEqual([]);
  });
});
