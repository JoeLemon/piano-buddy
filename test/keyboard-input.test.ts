import { mount } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  KEY_TO_MIDI,
  attachKeyboardListener,
  keyCapFor,
  setKeyboardMode,
} from "../src/midi/keyboard";
import type { MidiNote } from "../src/midi/types";
import KeyboardDiagram from "../src/ui/KeyboardDiagram.vue";

function keyEvent(type: "keydown" | "keyup", code: string, init: KeyboardEventInit = {}) {
  return new KeyboardEvent(type, { code, bubbles: true, ...init });
}

afterEach(() => {
  setKeyboardMode(false);
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("keyboard mapping", () => {
  it("covers the C3–C5 keyboard", () => {
    expect(KEY_TO_MIDI.KeyZ).toBe(48); // C3
    expect(KEY_TO_MIDI.KeyQ).toBe(60); // C4
    expect(KEY_TO_MIDI.KeyI).toBe(72); // C5
    expect(KEY_TO_MIDI.KeyS).toBe(49); // C#3
    expect(KEY_TO_MIDI.Digit2).toBe(61); // C#4
  });

  it("labels keys for the on-screen diagram", () => {
    expect(keyCapFor(60)).toBe("Q");
    expect(keyCapFor(49)).toBe("S");
    expect(keyCapFor(61)).toBe("2");
    expect(keyCapFor(1)).toBeUndefined();
  });
});

describe("attachKeyboardListener", () => {
  it("emits nothing while simulation mode is off", () => {
    const notes: MidiNote[] = [];
    const detach = attachKeyboardListener((note) => notes.push(note));
    window.dispatchEvent(keyEvent("keydown", "KeyZ"));
    expect(notes).toHaveLength(0);
    detach();
  });

  it("emits note on/off for mapped keys when enabled", () => {
    setKeyboardMode(true);
    const notes: MidiNote[] = [];
    const detach = attachKeyboardListener((note) => notes.push(note));
    window.dispatchEvent(keyEvent("keydown", "KeyQ"));
    window.dispatchEvent(keyEvent("keyup", "KeyQ"));
    expect(notes).toHaveLength(2);
    expect(notes[0]).toMatchObject({ midi: 60, kind: "on" });
    expect(notes[1]).toMatchObject({ midi: 60, kind: "off" });
    detach();
  });

  it("ignores repeats, modifiers and unmapped keys", () => {
    setKeyboardMode(true);
    const notes: MidiNote[] = [];
    const detach = attachKeyboardListener((note) => notes.push(note));
    window.dispatchEvent(keyEvent("keydown", "KeyZ", { repeat: true }));
    window.dispatchEvent(keyEvent("keydown", "KeyZ", { ctrlKey: true }));
    window.dispatchEvent(keyEvent("keydown", "Enter"));
    expect(notes).toHaveLength(0);
    detach();
  });

  it("does not steal keys while typing in a text field, but allows the tempo slider", () => {
    setKeyboardMode(true);
    const notes: MidiNote[] = [];
    const detach = attachKeyboardListener((note) => notes.push(note));

    const input = document.createElement("input");
    input.type = "text";
    document.body.append(input);
    input.dispatchEvent(keyEvent("keydown", "KeyQ"));
    expect(notes).toHaveLength(0);

    const slider = document.createElement("input");
    slider.type = "range";
    document.body.append(slider);
    slider.dispatchEvent(keyEvent("keydown", "KeyQ"));
    expect(notes).toHaveLength(1);

    input.remove();
    slider.remove();
    detach();
  });

  it("stops delivering events after detach", () => {
    setKeyboardMode(true);
    const notes: MidiNote[] = [];
    const detach = attachKeyboardListener((note) => notes.push(note));
    detach();
    window.dispatchEvent(keyEvent("keydown", "KeyZ"));
    expect(notes).toHaveLength(0);
  });
});

describe("KeyboardDiagram key labels", () => {
  it("hides labels when simulation mode is off", () => {
    setKeyboardMode(false);
    const wrapper = mount(KeyboardDiagram, { props: { highlightMidi: null } });
    expect(wrapper.find(".key-cap").exists()).toBe(false);
    expect(wrapper.attributes("data-keyboard-mode")).toBe("false");
  });

  it("shows one label per playable key when simulation mode is on", () => {
    setKeyboardMode(true);
    const wrapper = mount(KeyboardDiagram, { props: { highlightMidi: null } });
    expect(wrapper.attributes("data-keyboard-mode")).toBe("true");
    const caps = wrapper.findAll(".key-cap").map((node) => node.text());
    expect(caps).toContain("Z");
    expect(caps).toContain("Q");
    expect(caps).toContain("I");
    expect(caps).toHaveLength(Object.keys(KEY_TO_MIDI).length);
  });
});
