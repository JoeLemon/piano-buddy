import { mount } from "@vue/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import { pitchToMidi, parsePitchLabel } from "../src/domain/pitch";
import { DEFAULT_ZONE, activeZone, keyLabels, setActiveZone, setKeyLabels, setKeyboardMode } from "../src/midi/keyboard";
import KeyboardDiagram from "../src/ui/KeyboardDiagram.vue";

afterEach(() => {
  setKeyboardMode(false);
  setKeyLabels(false);
  setActiveZone(DEFAULT_ZONE);
});

describe("KeyboardDiagram", () => {
  it("highlights a black key for Bb4", () => {
    const midi = pitchToMidi(parsePitchLabel("Bb4"));
    const wrapper = mount(KeyboardDiagram, { props: { highlightMidi: midi } });
    expect(wrapper.find("[data-test=keyboard]").exists()).toBe(true);
    expect(wrapper.find(".black-key.is-target").exists()).toBe(true);
  });

  it("renders the full A0–C8 keyboard", () => {
    const wrapper = mount(KeyboardDiagram, { props: { highlightMidi: null } });
    expect(wrapper.findAll(".white-key")).toHaveLength(52);
    expect(wrapper.findAll(".black-key")).toHaveLength(36);
    // 每个 C 都写在琴键正下方的标注条里，中央 C 加重
    const labels = wrapper.findAll(".labels .c-label");
    expect(labels.map((node) => node.text())).toEqual(["C1", "C2", "C3", "C4", "C5", "C6", "C7", "C8"]);
    expect(wrapper.findAll(".c-label.is-middle-c").map((node) => node.text())).toEqual(["C4"]);
  });

  it("lays out seven zones over a miniature keyboard with a frosted viewport", () => {
    const wrapper = mount(KeyboardDiagram, { props: { highlightMidi: null } });
    const zones = wrapper.findAll(".zone");
    expect(zones).toHaveLength(7);
    expect(zones.map((zone) => zone.attributes("data-zone"))).toEqual(["1", "2", "3", "4", "5", "6", "7"]);
    // 缩略图是一条迷你 88 键琴 + 每个 C 的标注
    expect(wrapper.findAll(".mini .mini-white")).toHaveLength(52);
    expect(wrapper.findAll(".mini .mini-black")).toHaveLength(36);
    expect(wrapper.findAll(".mini-c").map((node) => node.text())).toEqual([
      "C1",
      "C2",
      "C3",
      "C4",
      "C5",
      "C6",
      "C7",
      "C8",
    ]);
    const viewport = wrapper.find("[data-test=keyboard-viewport]");
    expect(viewport.exists()).toBe(true);
    expect(viewport.attributes("style")).toContain("left:");
    // 静止时是低调滑块，还没进入「滑动中」的强调态
    expect(viewport.classes()).not.toContain("is-visible");
    expect(wrapper.find("[data-test=keyboard-zones]").classes()).not.toContain("is-active");
  });

  it("brightens the viewport while the full keyboard scrolls", async () => {
    const wrapper = mount(KeyboardDiagram, { props: { highlightMidi: null } });
    await wrapper.find("[data-test=keyboard-keys]").trigger("scroll");
    expect(wrapper.find("[data-test=keyboard-viewport]").classes()).toContain("is-visible");
    expect(wrapper.find("[data-test=keyboard-zones]").classes()).toContain("is-active");
  });

  it("marks the chosen zone for a moment, and only that zone", async () => {
    const wrapper = mount(KeyboardDiagram, { props: { highlightMidi: null } });
    const zones = wrapper.findAll(".zone");
    expect(zones[2].classes()).not.toContain("is-selected");

    await zones[2].trigger("click");
    expect(zones[2].classes()).toContain("is-selected");
    expect(zones[3].classes()).not.toContain("is-selected");
  });

  it("drops the zone selection as soon as the player scrolls by hand", async () => {
    const wrapper = mount(KeyboardDiagram, { props: { highlightMidi: null } });
    const keys = wrapper.find("[data-test=keyboard-keys]");
    await wrapper.findAll(".zone")[6].trigger("click");
    expect(wrapper.findAll(".zone")[6].classes()).toContain("is-selected");

    // 手动滚动（远离程序跳转的那一下）立刻清掉选区框
    await new Promise((resolve) => setTimeout(resolve, 200));
    await keys.trigger("scroll");
    expect(wrapper.findAll(".zone")[6].classes()).not.toContain("is-selected");
  });

  it("scrolls to a zone without playing a note", async () => {
    const wrapper = mount(KeyboardDiagram, { props: { highlightMidi: null } });
    await wrapper.findAll(".zone")[5].trigger("click");
    expect(wrapper.emitted("note")).toBeFalsy();
  });

  it("activates a zone from the thumbnail and scrolls the full keyboard", async () => {
    const wrapper = mount(KeyboardDiagram, { props: { highlightMidi: null } });
    expect(wrapper.attributes("data-zone")).toBe("4");

    await wrapper.findAll(".zone")[2].trigger("click");
    expect(activeZone.value).toBe(3);
    expect(wrapper.attributes("data-zone")).toBe("3");
    expect(wrapper.findAll(".zone")[2].classes()).toContain("is-active");

    // 缩略图滑块跟着滚到该音区（happy-dom 没有布局，这里看滑块位置而不是 scrollLeft）
    const left = wrapper.find("[data-test=keyboard-viewport]").attributes("style") ?? "";
    expect(left).not.toContain("left: 0%");

    await wrapper.findAll(".zone")[6].trigger("click");
    expect(activeZone.value).toBe(7);
    expect(wrapper.findAll(".zone")[6].classes()).toContain("is-active");
    expect(wrapper.attributes("data-zone")).toBe("7");
  });

  it("follows a highlighted note outside the current zone", async () => {
    const wrapper = mount(KeyboardDiagram, { props: { highlightMidi: 48 } }); // C3
    await wrapper.vm.$nextTick();
    expect(activeZone.value).toBe(3);
    expect(wrapper.attributes("data-zone")).toBe("3");
  });

  it("plays a note when a key is pressed with mouse or touch", async () => {
    const wrapper = mount(KeyboardDiagram, { props: { highlightMidi: null } });
    const c4 = wrapper.findAll(".white-key").find((key) => key.attributes("data-midi") === "60")!;

    await c4.trigger("pointerdown", { pointerType: "mouse", button: 0 });
    expect(wrapper.emitted("note")?.[0]?.[0]).toMatchObject({ midi: 60, kind: "on", source: "screen" });
    expect(c4.classes()).toContain("is-down");

    await c4.trigger("pointerup");
    const emitted = wrapper.emitted("note") ?? [];
    expect(emitted[1]?.[0]).toMatchObject({ midi: 60, kind: "off", source: "screen" });
    expect(c4.classes()).not.toContain("is-down");
  });

  it("keeps labels off by default even with the keyboard mounted", () => {
    expect(keyLabels.value).toBe(false);
  });
});
