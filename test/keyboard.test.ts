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
});
