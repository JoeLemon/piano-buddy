import { mount } from "@vue/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import { initialProfile, type Profile } from "../src/domain/profile";
import { createCurriculumStageQuestions } from "../src/practice";
import PracticeView from "../src/ui/PracticeView.vue";

function installAudioContext() {
  (globalThis as { AudioContext?: unknown }).AudioContext = class {
    destination = {};
    currentTime = 0;
    createOscillator() {
      return {
        type: "sine",
        frequency: { setValueAtTime() {} },
        connect() {},
        start() {},
        stop() {},
        disconnect() {},
        onended: null as (() => void) | null,
      };
    }
    createGain() {
      return {
        gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} },
        connect() {},
        disconnect() {},
      };
    }
    resume() {
      return Promise.resolve();
    }
    close() {
      return Promise.resolve();
    }
  };
}

afterEach(() => {
  delete (globalThis as { AudioContext?: unknown }).AudioContext;
});

describe("PracticeView", () => {
  it("shows the five practice tabs and starts with a symbol question", () => {
    const wrapper = mount(PracticeView, { props: { seed: 1 } });

    expect(wrapper.find("[data-test=practice]").exists()).toBe(true);
    expect(wrapper.findAll("[data-test=practice-tab-symbols]")).toHaveLength(1);
    expect(wrapper.findAll("[data-test=practice-tab-intervals]")).toHaveLength(1);
    expect(wrapper.findAll("[data-test=practice-tab-chords]")).toHaveLength(1);
    expect(wrapper.findAll("[data-test=practice-tab-progressions]")).toHaveLength(1);
    expect(wrapper.findAll("[data-test=practice-tab-accidentals]")).toHaveLength(1);
    expect(wrapper.findAll("[data-test=practice-tab-melodies]")).toHaveLength(1);
    expect(wrapper.get("[data-test=practice-prompt]").text().length).toBeGreaterThan(0);
    expect(wrapper.findAll("[data-test=practice-choice]")).toHaveLength(4);
    expect(wrapper.find("[data-test=practice-feedback]").exists()).toBe(false);
  });

  it("answers, explains, and advances through the quiz", async () => {
    const wrapper = mount(PracticeView, { props: { seed: 1 } });

    await wrapper.get("[data-test=practice-tab-intervals]").trigger("click");
    expect(wrapper.get("[data-test=practice-prompt]").text().length).toBeGreaterThan(0);
    await wrapper.findAll("[data-test=practice-choice]")[0].trigger("click");

    expect(wrapper.find("[data-test=practice-feedback]").exists()).toBe(true);
    expect(wrapper.find("[data-test=practice-feedback]").text()).toMatch(/答对了|不对/);
    expect(wrapper.find("[data-test=practice-next]").exists()).toBe(true);

    await wrapper.get("[data-test=practice-next]").trigger("click");
    expect(wrapper.get("[data-test=practice-progress]").text()).toBe("第 2 / 8 题");
  });

  it("finishes a group and can start another one", async () => {
    const wrapper = mount(PracticeView, { props: { seed: 1 } });

    for (let index = 0; index < 7; index += 1) {
      await wrapper.findAll("[data-test=practice-choice]")[0].trigger("click");
      await wrapper.get("[data-test=practice-next]").trigger("click");
    }
    await wrapper.findAll("[data-test=practice-choice]")[0].trigger("click");
    expect(wrapper.get("[data-test=practice-next]").text()).toBe("看结果");
    await wrapper.get("[data-test=practice-next]").trigger("click");

    expect(wrapper.get("[data-test=practice-summary]").text()).toContain("本组答对");
    await wrapper.get("[data-test=practice-restart]").trigger("click");
    expect(wrapper.get("[data-test=practice-progress]").text()).toBe("第 1 / 8 题");
  });

  it("links to the L3 prep lessons", async () => {
    const wrapper = mount(PracticeView, { props: { seed: 1 } });

    await wrapper.get("[data-test=practice-l3]").trigger("click");
    expect(wrapper.emitted("open-l3")).toHaveLength(1);
  });

  it("plays a melody question through the shared preview player", async () => {
    installAudioContext();
    const wrapper = mount(PracticeView, { props: { seed: 2 } });

    try {
      await wrapper.get("[data-test=practice-tab-melodies]").trigger("click");
      expect(wrapper.get("[data-test=practice-prompt]").text()).toBe("听旋律，判断调性");
      const play = wrapper.get("[data-test=practice-play]");
      expect(play.attributes("disabled")).toBeUndefined();
      await play.trigger("click");
      expect(wrapper.get("[data-test=practice-play]").text()).toBe("播放中…");
      await wrapper.get("[data-test=practice-stop]").trigger("click");
      expect(wrapper.get("[data-test=practice-play]").text()).toBe("播放旋律");
    } finally {
      wrapper.unmount();
    }
  });

  it("runs the first curriculum stage and records a pass", async () => {
    const wrapper = mount(PracticeView, {
      props: { seed: 1, initialMode: "stages", profile: initialProfile() },
    });

    expect(wrapper.find("[data-test=practice-stages]").exists()).toBe(true);
    expect(wrapper.get("[data-test=practice-stage-Q1]").attributes("data-state")).toBe("current");
    expect(wrapper.get("[data-test=practice-stage-Q2]").attributes("data-state")).toBe("locked");
    expect(wrapper.get("[data-test=practice-progress]").text()).toBe("第 1 / 5 题");

    for (const question of createCurriculumStageQuestions("Q1", 1)) {
      const answer = question.choices.find((choice) => choice.id === question.answerId);
      expect(answer).toBeTruthy();
      const button = wrapper
        .findAll("[data-test=practice-choice]")
        .find((choice) => choice.text() === answer?.label);
      expect(button).toBeTruthy();
      await button!.trigger("click");
      await wrapper.get("[data-test=practice-next]").trigger("click");
    }

    expect(wrapper.get("[data-test=practice-summary]").text()).toContain("本关通过");
    const emitted = wrapper.emitted("update-profile");
    expect(emitted).toHaveLength(1);
    expect((emitted?.[0]?.[0] as Profile).curriculumCompleted).toEqual(["Q1"]);
    expect(wrapper.get("[data-test=practice-stage-Q2]").attributes("data-state")).toBe("current");
  });
});
