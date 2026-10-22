import { describe, expect, it } from "vitest";
import {
  completeCurriculumStage,
  initialProfile,
  mergeProfile,
} from "../src/domain/profile";
import {
  CURRICULUM_STAGES,
  createCurriculumStageQuestions,
  curriculumProgress,
  curriculumStageState,
} from "../src/practice";

describe("curriculum stages", () => {
  it("defines ten unique stages with fixed question counts", () => {
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

  it("unlocks stages sequentially", () => {
    expect(curriculumStageState([], 0)).toBe("current");
    expect(curriculumStageState([], 1)).toBe("locked");
    expect(curriculumStageState(["Q1"], 0)).toBe("done");
    expect(curriculumStageState(["Q1"], 1)).toBe("current");
    expect(curriculumStageState(["Q1"], 2)).toBe("locked");
    expect(curriculumStageState(["Q1", "Q2"], 2)).toBe("current");
  });

  it("counts completed stages", () => {
    expect(curriculumProgress([])).toEqual({ done: 0, total: 10 });
    expect(curriculumProgress(["Q1", "Q2"])).toEqual({ done: 2, total: 10 });
    expect(curriculumProgress(["Q1", "Q1"])).toEqual({ done: 1, total: 10 });
  });

  it("persists completion idempotently and migrates old profiles", () => {
    const once = completeCurriculumStage(initialProfile(), "Q1");
    expect(once.curriculumCompleted).toEqual(["Q1"]);
    expect(completeCurriculumStage(once, "Q1")).toBe(once);

    const merged = mergeProfile({ curriculumCompleted: ["Q1", "Q1", "Q2"] });
    expect(merged.curriculumCompleted).toEqual(["Q1", "Q2"]);
    expect(mergeProfile({}).curriculumCompleted).toEqual([]);
  });
});
