import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import { pitchToMidi, parsePitchLabel } from "../src/domain/pitch";
import KeyboardDiagram from "../src/ui/KeyboardDiagram.vue";

describe("KeyboardDiagram", () => {
  it("highlights a black key for Bb4", () => {
    const midi = pitchToMidi(parsePitchLabel("Bb4"));
    const wrapper = mount(KeyboardDiagram, { props: { highlightMidi: midi } });
    expect(wrapper.find("[data-test=keyboard]").exists()).toBe(true);
    expect(wrapper.find(".black-key.is-target").exists()).toBe(true);
  });

  it("shows two hands laid out over the keyboard with numbered fingers", () => {
    const wrapper = mount(KeyboardDiagram, { props: { highlightMidi: null } });
    expect(wrapper.find(".hand[data-hand='LH']").exists()).toBe(true);
    expect(wrapper.find(".hand[data-hand='RH']").exists()).toBe(true);
    const lhFingers = wrapper.findAll(".hand[data-hand='LH'] .finger").map((finger) => finger.text());
    const rhFingers = wrapper.findAll(".hand[data-hand='RH'] .finger").map((finger) => finger.text());
    // 左手在键盘上从左到右是 5–1（大拇指靠右），右手是 1–5（大拇指靠左）。
    expect(lhFingers).toEqual(["5", "4", "3", "2", "1"]);
    expect(rhFingers).toEqual(["1", "2", "3", "4", "5"]);
  });

  it("lights the active finger and dims the idle hand", () => {
    const wrapper = mount(KeyboardDiagram, {
      props: { highlightMidi: null, activeHand: "RH", activeFinger: 2 },
    });
    const active = wrapper.find(".hand[data-hand='RH'] .finger.is-active");
    expect(active.exists()).toBe(true);
    expect(active.text()).toBe("2");
    expect(wrapper.find(".hand[data-hand='LH']").classes()).toContain("is-dim");
    expect(wrapper.find(".hand[data-hand='RH']").classes()).not.toContain("is-dim");
  });

  it("leaves both hands undimmed when no hand is active", () => {
    const wrapper = mount(KeyboardDiagram, { props: { highlightMidi: null } });
    expect(wrapper.find(".hand[data-hand='LH']").classes()).not.toContain("is-dim");
    expect(wrapper.find(".hand[data-hand='RH']").classes()).not.toContain("is-dim");
  });

  it("moves both hands to the F and G five-finger positions", () => {
    const startOf = (wrapper: ReturnType<typeof mount>, side: "LH" | "RH") =>
      wrapper.find(`.hand[data-hand='${side}']`).attributes("style");

    const c = mount(KeyboardDiagram, { props: { highlightMidi: null, position: "C" } });
    expect(startOf(c, "LH")).toContain("--hand-start: 0");
    expect(startOf(c, "RH")).toContain("--hand-start: 7");

    const f = mount(KeyboardDiagram, { props: { highlightMidi: null, position: "F" } });
    expect(startOf(f, "LH")).toContain("--hand-start: 3");
    expect(startOf(f, "RH")).toContain("--hand-start: 10");

    const g = mount(KeyboardDiagram, { props: { highlightMidi: null, position: "G" } });
    expect(startOf(g, "LH")).toContain("--hand-start: 4");
    expect(startOf(g, "RH")).toContain("--hand-start: 11");

    // 换手位不改指序：右手仍是从左到右 1–5。
    expect(f.findAll(".hand[data-hand='RH'] .finger").map((finger) => finger.text())).toEqual([
      "1",
      "2",
      "3",
      "4",
      "5",
    ]);
  });
});
