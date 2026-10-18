import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import AppShell from "../src/ui/AppShell.vue";
import ScoreProgress from "../src/ui/ScoreProgress.vue";

function shell(metronomeOn: boolean, bpm = 80) {
  return mount(AppShell, {
    props: {
      midiConnected: true,
      metronomeOn,
      metronomeBpm: bpm,
    },
  });
}

describe("AppShell metronome control", () => {
  it("toggles the metronome", async () => {
    const wrapper = shell(false);
    const toggle = wrapper.get("[data-test=toggle-metronome]");
    expect(toggle.text()).toContain("关");
    await toggle.trigger("click");
    expect(wrapper.emitted("toggle-metronome")).toHaveLength(1);
  });

  it("shows bpm controls and emits bpm changes", async () => {
    const wrapper = shell(true, 80);
    expect(wrapper.get("[data-test=toggle-metronome]").text()).toContain("开");
    const range = wrapper.get("[data-test=metronome-bpm]");
    (range.element as HTMLInputElement).value = "120";
    await range.trigger("input");
    expect(wrapper.emitted("metronome-bpm")).toEqual([[120]]);

    await wrapper.get("[data-test=metronome-faster]").trigger("click");
    expect(wrapper.emitted("metronome-bpm")?.at(-1)).toEqual([84]);

    await wrapper.get("[data-test=metronome-slower]").trigger("click");
    expect(wrapper.emitted("metronome-bpm")?.at(-1)).toEqual([76]);
    expect(wrapper.get("[data-test=metronome-value]").text()).toBe("80");
  });

  it("hides bpm controls when off", () => {
    const wrapper = shell(false);
    expect(wrapper.find("[data-test=metronome-bpm]").exists()).toBe(false);
  });
});

describe("ScoreProgress", () => {
  it("renders fill width and clamps out-of-range values", () => {
    expect(mount(ScoreProgress, { props: { value: 0.4 } }).get(".fill").attributes("style"))
      .toContain("40%");
    expect(mount(ScoreProgress, { props: { value: 3 } }).get(".fill").attributes("style"))
      .toContain("100%");
    expect(mount(ScoreProgress, { props: { value: -1 } }).get(".fill").attributes("style"))
      .toContain("0%");
    expect(mount(ScoreProgress, { props: { value: Number.NaN } }).get(".fill").attributes("style"))
      .toContain("0%");
  });
});
