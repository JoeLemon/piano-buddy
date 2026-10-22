import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import { initialProfile, type Profile } from "../src/domain/profile";
import { L3_PREP_LESSONS, createL3LessonQuestions } from "../src/practice";
import L3PrepView from "../src/ui/L3PrepView.vue";

function profile(partial: Partial<Profile> = {}): Profile {
  return { ...initialProfile(), ...partial };
}

async function answerLesson(
  wrapper: VueWrapper,
  lessonId: string,
  seed: number,
  correct: boolean,
) {
  const lesson = L3_PREP_LESSONS.find((item) => item.id === lessonId);
  expect(lesson).toBeTruthy();
  const questions = createL3LessonQuestions(lessonId, seed);

  for (const question of questions) {
    const answer = correct
      ? question.choices.find((choice) => choice.id === question.answerId)
      : question.choices.find((choice) => choice.id !== question.answerId);
    expect(answer).toBeTruthy();
    const button = wrapper
      .findAll("[data-test=l3-choice]")
      .find((choice) => choice.text() === answer?.label);
    expect(button).toBeTruthy();
    await button!.trigger("click");
    await wrapper.get("[data-test=l3-next]").trigger("click");
  }
}

describe("L3PrepView", () => {
  it("shows nine lessons and opens the first one", () => {
    const wrapper = mount(L3PrepView, {
      props: { profile: profile(), seed: 1 },
    });

    expect(wrapper.find("[data-test=l3-prep]").exists()).toBe(true);
    expect(wrapper.findAll('[data-test^="l3-lesson-"]')).toHaveLength(9);
    expect(wrapper.get("[data-test=l3-overall]").text()).toContain("已完成 0 / 9");
    expect(wrapper.get("[data-test=l3-current]").text()).toContain("三和弦");
    expect(wrapper.get("[data-test=l3-progress]").text()).toBe("第 1 / 4 题");
  });

  it("renders a staff for the current notation question", async () => {
    const wrapper = mount(L3PrepView, {
      props: { profile: profile(), seed: 1 },
    });
    await flushPromises();
    expect(wrapper.find("[data-test=l3-staff]").exists()).toBe(true);
    expect(wrapper.find("[data-test=l3-staff] svg").exists()).toBe(true);
  });

  it("switches to another lesson and starts its own question set", async () => {
    const wrapper = mount(L3PrepView, {
      props: { profile: profile(), seed: 1 },
    });

    await wrapper.get("[data-test=l3-lesson-L3-2]").trigger("click");
    expect(wrapper.get("[data-test=l3-current]").text()).toContain("临时升降");
    expect(wrapper.get("[data-test=l3-progress]").text()).toBe("第 1 / 4 题");
    expect(wrapper.get("[data-test=l3-prompt]").text().length).toBeGreaterThan(0);
  });

  it("marks a lesson complete only after reaching the pass score", async () => {
    const wrapper = mount(L3PrepView, {
      props: { profile: profile(), seed: 1 },
    });

    await answerLesson(wrapper, "L3-1", 1, true);
    expect(wrapper.get("[data-test=l3-summary]").text()).toContain("本节完成");
    expect(wrapper.get("[data-test=l3-summary]").text()).toContain("不会因此直接消失");

    const emitted = wrapper.emitted("update-profile");
    expect(emitted).toHaveLength(1);
    expect((emitted?.[0]?.[0] as Profile).l3PrepCompleted).toEqual(["L3-1"]);
    expect(wrapper.get("[data-test=l3-overall]").text()).toContain("已完成 1 / 9");
    expect(wrapper.get("[data-test=l3-next-lesson]").text()).toContain("下一节");
  });

  it("does not persist a failed lesson and offers a retry", async () => {
    const wrapper = mount(L3PrepView, {
      props: { profile: profile(), seed: 2 },
    });

    await answerLesson(wrapper, "L3-1", 2, false);
    expect(wrapper.get("[data-test=l3-summary]").text()).toContain("还差一点");
    expect(wrapper.emitted("update-profile")).toBeFalsy();
    expect(wrapper.get("[data-test=l3-overall]").text()).toContain("已完成 0 / 9");
    await wrapper.get("[data-test=l3-restart]").trigger("click");
    expect(wrapper.get("[data-test=l3-progress]").text()).toBe("第 1 / 4 题");
  });

  it("opens the first unfinished lesson for a returning learner", () => {
    const wrapper = mount(L3PrepView, {
      props: { profile: profile({ l3PrepCompleted: ["L3-1"] }), seed: 1 },
    });

    expect(wrapper.get("[data-test=l3-overall]").text()).toContain("已完成 1 / 9");
    expect(wrapper.get("[data-test=l3-lesson-L3-1]").text()).toContain("✓ 已完成");
    expect(wrapper.get("[data-test=l3-current]").text()).toContain("临时升降");
  });
});
