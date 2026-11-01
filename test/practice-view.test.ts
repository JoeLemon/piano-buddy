import { mount, type VueWrapper } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { initialProfile, type Profile } from "../src/domain/profile";
import { parsePitchLabel, pitchToMidi } from "../src/domain/pitch";
import { createCurriculumStageQuestions, midiLabel } from "../src/practice";
import KeyboardDiagram from "../src/ui/KeyboardDiagram.vue";
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

/**
 * 模拟父组件：把最近一次 emit 的档案应用回 props。
 *
 * 真实页面里 App.vue 的 persist() 会同步更新 profile.value，答题统计靠这个
 * 链条逐题累积；测试里 props 是静态的，不回写就永远从同一份档案出发。
 */
async function applyEmittedProfile(wrapper: VueWrapper) {
  const emitted = wrapper.emitted("update-profile");
  if (emitted && emitted.length > 0) {
    await wrapper.setProps({ profile: emitted[emitted.length - 1][0] as Profile });
  }
}

/** 点掉当前题的第一个选项并推进到下一题（对错不影响统计用例的断言）。 */
async function answerCurrent(wrapper: VueWrapper) {
  await wrapper.findAll("[data-test=practice-choice]")[0].trigger("click");
  await applyEmittedProfile(wrapper);
  await wrapper.get("[data-test=practice-next]").trigger("click");
}

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

  it("routes to sight reading and the error book from the practice hub", async () => {
    const wrapper = mount(PracticeView, { props: { seed: 1 } });

    await wrapper.get("[data-test=practice-sight]").trigger("click");
    expect(wrapper.emitted("open-sight")).toHaveLength(1);

    // 没有错题时错题入口置灰，避免进到空页面。
    expect(wrapper.get("[data-test=practice-errors]").attributes("disabled")).toBeDefined();
    expect(wrapper.get("[data-test=practice-errors]").text()).toContain("暂无错题");
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

  it("draws the melody staff so the follow-up has something to read", async () => {
    const wrapper = mount(PracticeView, { props: { seed: 2 } });

    try {
      await wrapper.get("[data-test=practice-tab-melodies]").trigger("click");
      // 谱面与试听同源（melodyStaff）：答完调性后照着同一份谱跟弹。
      expect(wrapper.find("[data-test=practice-staff]").exists()).toBe(true);
      // 跟弹区随旋律题出现。
      expect(wrapper.find("[data-test=melody-follow]").exists()).toBe(true);
    } finally {
      wrapper.unmount();
    }
  });

  it("hides the melody staff until the key is answered in listen-first mode", async () => {
    const wrapper = mount(PracticeView, { props: { seed: 2 } });

    try {
      await wrapper.get("[data-test=practice-tab-melodies]").trigger("click");
      await wrapper.get("[data-test=practice-listen-first]").trigger("click");
      await wrapper.vm.$nextTick();
      // 先听再看：谱面藏着，否则调性可以直接从谱上数出来。
      expect(wrapper.find("[data-test=practice-staff]").exists()).toBe(false);
      expect(wrapper.find("[data-test=practice-listen-hint]").exists()).toBe(true);

      // 答完调性：照着同一份谱面跟弹，谱面立刻出现（不前进到下一题）。
      await wrapper.findAll("[data-test=practice-choice]")[0].trigger("click");
      await wrapper.vm.$nextTick();
      expect(wrapper.find("[data-test=practice-staff]").exists()).toBe(true);
    } finally {
      wrapper.unmount();
    }
  });

  it("records a theory drill preset into the shared path progress", async () => {
    const wrapper = mount(PracticeView, {
      props: { seed: 1, profile: initialProfile() },
    });

    expect(wrapper.find("[data-test=practice-stages]").exists()).toBe(true);
    await wrapper.get("[data-test=practice-stage-Q1]").trigger("click");
    expect(wrapper.find("[data-test=practice-stage-head]").exists()).toBe(true);
    expect(wrapper.get("[data-test=practice-progress]").text()).toBe("第 1 / 5 题");

    for (const question of createCurriculumStageQuestions("Q1", 1 + 7919)) {
      const answer = question.choices.find((choice) => choice.id === question.answerId);
      expect(answer).toBeTruthy();
      const button = wrapper
        .findAll("[data-test=practice-choice]")
        .find((choice) => choice.text() === answer?.label);
      expect(button).toBeTruthy();
      await button!.trigger("click");
      await applyEmittedProfile(wrapper);
      await wrapper.get("[data-test=practice-next]").trigger("click");
    }

    expect(wrapper.get("[data-test=practice-summary]").text()).toContain("本组答对");
    // 乐理路径只有一份进度：过关后最高答对数与完成标记都写进 theoryPath。
    const emitted = wrapper.emitted("update-profile");
    // 5 次答题各写一笔统计，finish 再写关卡结论。
    expect(emitted).toHaveLength(6);
    const next = emitted![5][0] as Profile;
    expect(next.theoryPath.best.Q1).toBe(5);
    expect(next.theoryPath.completed).toContain("Q1");
    // 统计只记答数/答对数，不写技能过关。Q1 关的题型是 notes。
    expect(next.practiceStats.notes).toEqual({ answered: 5, correct: 5 });
    expect(next.skillLedger).toEqual({});
  });

  it("opens an L4 prep stage from the map and records it in the same path", async () => {
    const wrapper = mount(PracticeView, {
      props: { seed: 1, profile: initialProfile() },
    });

    // L4 章不锁：随时能进（曲库缺 texture.broken / pos.expand 时直达这里）。
    await wrapper.get("[data-test=practice-stage-L4-1]").trigger("click");
    expect(wrapper.get("[data-test=practice-progress]").text()).toBe("第 1 / 5 题");
    // 分解和弦题的谱面是依次弹出的几个音，并带「柱式」对照试听。
    expect(wrapper.get("[data-test=practice-prompt]").text()).toMatch(/–/);
    expect(wrapper.find("[data-test=practice-block]").exists()).toBe(true);
    expect(wrapper.find("[data-test=practice-arpeggio]").exists()).toBe(false);

    for (const question of createCurriculumStageQuestions("L4-1", 1 + 7919)) {
      const answer = question.choices.find((choice) => choice.id === question.answerId);
      const button = wrapper
        .findAll("[data-test=practice-choice]")
        .find((choice) => choice.text() === answer?.label);
      await button!.trigger("click");
      await applyEmittedProfile(wrapper);
      await wrapper.get("[data-test=practice-next]").trigger("click");
    }

    const emitted = wrapper.emitted("update-profile");
    expect(emitted).toHaveLength(6);
    const next = emitted![5][0] as Profile;
    expect(next.theoryPath.best["L4-1"]).toBe(5);
    expect(next.theoryPath.completed).toContain("L4-1");
    // 关卡的题型是 broken：统计按题型落账。
    expect(next.practiceStats.broken).toEqual({ answered: 5, correct: 5 });
  });

  it("opens a hand-written L5 lesson with its 6/8 staff", async () => {
    const wrapper = mount(PracticeView, {
      props: { seed: 1, profile: initialProfile(), focusStageId: "L5-2" },
    });

    await wrapper.vm.$nextTick();

    expect(wrapper.get("[data-test=practice-progress]").text()).toBe("第 1 / 4 题");
    expect(wrapper.get("[data-test=practice-stage-head]").text()).toContain("6/8 拍");
    expect(wrapper.find("[data-test=practice-staff]").exists()).toBe(true);
    wrapper.unmount();
  });

  it("counts free-practice answers into per-kind stats and shows the cumulative rate", async () => {
    const wrapper = mount(PracticeView, { props: { seed: 1, profile: initialProfile() } });

    // 没答过的题型不显示累计行。
    expect(wrapper.find("[data-test=practice-kind-accuracy]").exists()).toBe(false);

    await wrapper.get("[data-test=practice-tab-chords]").trigger("click");
    await answerCurrent(wrapper);
    await answerCurrent(wrapper);

    expect(wrapper.get("[data-test=practice-kind-accuracy]").text()).toContain("累计");
    const emitted = wrapper.emitted("update-profile");
    // 自由练习没有关卡结论，emit 全部来自答题统计。
    expect(emitted).toHaveLength(2);
    const last = emitted![1][0] as Profile;
    expect(last.practiceStats.chords.answered).toBe(2);
    expect(last.practiceStats.chords.correct).toBeLessThanOrEqual(2);
    wrapper.unmount();
  });

  it("starts directly on a stage brought in from the repertoire page", async () => {
    const wrapper = mount(PracticeView, {
      props: { seed: 1, profile: initialProfile(), focusStageId: "L4-2" },
    });

    // onMounted 里开关卡改的是 ref，DOM 要等下一个 tick 才刷出来。
    await wrapper.vm.$nextTick();

    // 进页即开到手位读谱关，不用再点地图。
    expect(wrapper.get("[data-test=practice-progress]").text()).toBe("第 1 / 5 题");
    expect(wrapper.get("[data-test=practice-stage-head]").text()).toContain("手位读谱");
    wrapper.unmount();
  });

  it("keeps the block listen on broken questions and the arpeggio on chords", async () => {
    const wrapper = mount(PracticeView, { props: { seed: 1 } });

    await wrapper.get("[data-test=practice-tab-chords]").trigger("click");
    expect(wrapper.find("[data-test=practice-arpeggio]").exists()).toBe(true);
    expect(wrapper.find("[data-test=practice-block]").exists()).toBe(false);

    await wrapper.get("[data-test=practice-tab-broken]").trigger("click");
    expect(wrapper.find("[data-test=practice-block]").exists()).toBe(true);
    expect(wrapper.find("[data-test=practice-arpeggio]").exists()).toBe(false);
    wrapper.unmount();
  });
});

/** 题面上的音高（`C4 E4 G4` / `C4 – E4` / 单音 `C4` 都按同一个分隔符拆）。 */
function promptMidis(wrapper: VueWrapper): number[] {
  return wrapper
    .get("[data-test=practice-prompt]")
    .text()
    .split("–")
    .map((part) => pitchToMidi(parsePitchLabel(part.trim())));
}

/** 直接让琴键发音符，走的是和真机一样的入口（不经过指针事件）。 */
async function play(wrapper: VueWrapper, midis: number[]): Promise<void> {
  const keyboard = wrapper.findComponent(KeyboardDiagram);
  for (const midi of midis) {
    keyboard.vm.$emit("note", { midi, timeMs: 0, kind: "on", source: "screen" });
  }
  await wrapper.vm.$nextTick();
}

/** 带时刻的版本：时值判定读的就是这些时间戳。 */
async function playAt(
  wrapper: VueWrapper,
  notes: Array<{ midi: number; atMs: number }>,
): Promise<void> {
  const keyboard = wrapper.findComponent(KeyboardDiagram);
  for (const note of notes) {
    keyboard.vm.$emit("note", {
      midi: note.midi,
      timeMs: note.atMs,
      kind: "on",
      source: "screen",
    });
  }
  await wrapper.vm.$nextTick();
}

describe("PracticeView · 弹奏作答", () => {
  beforeEach(() => {
    // 作答偏好会写 localStorage；每条用例都从「选项」开始，免得上一条影响下一条。
    localStorage.clear();
  });

  it("swaps the four choices for the keyboard", async () => {
    const wrapper = mount(PracticeView, { props: { seed: 1 } });
    await wrapper.get("[data-test=practice-tab-notes]").trigger("click");
    expect(wrapper.findAll("[data-test=practice-choice]")).toHaveLength(4);

    await wrapper.get("[data-test=practice-answer-keys]").trigger("click");
    expect(wrapper.find("[data-test=practice-play]").exists()).toBe(true);
    expect(wrapper.findAll("[data-test=practice-choice]")).toHaveLength(0);
    expect(wrapper.get("[data-test=practice-play-progress]").text()).toBe("已弹 0 / 1");
    wrapper.unmount();
  });

  it("marks a single note correct as soon as it is played", async () => {
    const wrapper = mount(PracticeView, { props: { seed: 4 } });
    await wrapper.get("[data-test=practice-tab-notes]").trigger("click");
    await wrapper.get("[data-test=practice-answer-keys]").trigger("click");

    await play(wrapper, promptMidis(wrapper));

    expect(wrapper.get("[data-test=practice-feedback]").classes()).toContain("ok");
    expect(wrapper.get("[data-test=practice-play-verdict]").text()).toContain("一个不多一个不少");
    wrapper.unmount();
  });

  it("names the octave slip instead of just saying wrong", async () => {
    const wrapper = mount(PracticeView, { props: { seed: 4 } });
    await wrapper.get("[data-test=practice-tab-notes]").trigger("click");
    await wrapper.get("[data-test=practice-answer-keys]").trigger("click");

    const [pitch] = promptMidis(wrapper);
    await play(wrapper, [pitch + 12]);

    expect(wrapper.get("[data-test=practice-feedback]").classes()).toContain("bad");
    const verdict = wrapper.get("[data-test=practice-play-verdict]").text();
    expect(verdict).toContain("音名对了，八度不对");
    expect(verdict).toContain(midiLabel(pitch + 12));
    wrapper.unmount();
  });

  it("accepts the two notes of an interval in either order", async () => {
    const wrapper = mount(PracticeView, { props: { seed: 7 } });
    await wrapper.get("[data-test=practice-tab-intervals]").trigger("click");
    await wrapper.get("[data-test=practice-answer-keys]").trigger("click");

    const [low, high] = promptMidis(wrapper);
    await play(wrapper, [high]);
    expect(wrapper.find("[data-test=practice-feedback]").exists()).toBe(false);
    expect(wrapper.get("[data-test=practice-play-progress]").text()).toBe("已弹 1 / 2");

    await play(wrapper, [low]);
    expect(wrapper.get("[data-test=practice-feedback]").classes()).toContain("ok");
    wrapper.unmount();
  });

  it("keeps the score once the question is settled", async () => {
    const wrapper = mount(PracticeView, { props: { seed: 4 } });
    await wrapper.get("[data-test=practice-tab-notes]").trigger("click");
    await wrapper.get("[data-test=practice-answer-keys]").trigger("click");

    const [pitch] = promptMidis(wrapper);
    await play(wrapper, [pitch]);
    await play(wrapper, [pitch + 2]);

    // 答完之后再按别的键只是试弹，不改判定；进度行让位给反馈卡。
    expect(wrapper.get("[data-test=practice-feedback]").classes()).toContain("ok");
    expect(wrapper.find("[data-test=practice-play-progress]").exists()).toBe(false);
    expect(wrapper.findAll(".play-chip")).toHaveLength(1);
    wrapper.unmount();
  });

  it("falls back to choices for kinds with no playable answer", async () => {
    const wrapper = mount(PracticeView, { props: { seed: 1 } });
    // 默认是符号题：问的是符号含义，没有唯一该弹的音。
    await wrapper.get("[data-test=practice-answer-keys]").trigger("click");

    expect(wrapper.find("[data-test=practice-answer-fallback]").exists()).toBe(true);
    expect(wrapper.find("[data-test=practice-play]").exists()).toBe(false);
    expect(wrapper.findAll("[data-test=practice-choice]")).toHaveLength(4);
    wrapper.unmount();
  });

  it("passes a drill preset by playing, and records it like choices do", async () => {
    const wrapper = mount(PracticeView, {
      props: { seed: 1, profile: initialProfile() },
    });
    await wrapper.get("[data-test=practice-answer-keys]").trigger("click");
    await wrapper.get("[data-test=practice-stage-Q1]").trigger("click");

    for (let index = 0; index < 5; index += 1) {
      await play(wrapper, promptMidis(wrapper));
      await applyEmittedProfile(wrapper);
      await wrapper.get("[data-test=practice-next]").trigger("click");
    }

    expect(wrapper.get("[data-test=practice-summary]").text()).toContain("本组答对 5 / 5");
    const emitted = wrapper.emitted("update-profile");
    // 弹奏作答和选项作答走同一个 settleAnswer：5 次统计 + 1 次关卡结论。
    expect(emitted).toHaveLength(6);
    const next = emitted![5][0] as Profile;
    expect(next.theoryPath.best.Q1).toBe(5);
    expect(next.theoryPath.completed).toContain("Q1");
    expect(next.practiceStats.notes).toEqual({ answered: 5, correct: 5 });
    wrapper.unmount();
  });

  it("reports a pattern's rhythm without changing the verdict", async () => {
    const wrapper = mount(PracticeView, { props: { seed: 1 } });
    await wrapper.get("[data-test=practice-tab-patterns]").trigger("click");
    await wrapper.get("[data-test=practice-answer-keys]").trigger("click");

    const midis = promptMidis(wrapper);
    // 音高全对，但每个音之间空了两秒：42bpm 以下的拖沓，时值完全走样。
    await playAt(
      wrapper,
      midis.map((midi, index) => ({ midi, atMs: index * 2000 })),
    );

    // 时值不影响对错：音弹对了就是对了。
    expect(wrapper.get("[data-test=practice-feedback]").classes()).toContain("ok");
    const rhythm = wrapper.get("[data-test=practice-play-rhythm]").text();
    expect(rhythm).toContain(`节拍：1 / ${midis.length}`);
    wrapper.unmount();
  });

  it("says nothing about rhythm when only one note was played", async () => {
    const wrapper = mount(PracticeView, { props: { seed: 4 } });
    await wrapper.get("[data-test=practice-tab-notes]").trigger("click");
    await wrapper.get("[data-test=practice-answer-keys]").trigger("click");

    await play(wrapper, promptMidis(wrapper));

    // 单音没有时值可言，不该硬凑一句节拍结论。
    expect(wrapper.find("[data-test=practice-play-rhythm]").exists()).toBe(false);
    wrapper.unmount();
  });
});
