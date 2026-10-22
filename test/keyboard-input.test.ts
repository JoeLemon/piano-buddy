import { mount } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_ZONE,
  activeZone,
  attachKeyboardListener,
  keyCapFor,
  setActiveZone,
  setKeyLabels,
  setKeyboardMode,
} from "../src/midi/keyboard";
import type { MidiNote } from "../src/midi/types";
import KeyboardDiagram from "../src/ui/KeyboardDiagram.vue";

function keyEvent(type: "keydown" | "keyup", code: string, init: KeyboardEventInit = {}) {
  return new KeyboardEvent(type, { code, bubbles: true, ...init });
}

afterEach(() => {
  setKeyboardMode(false);
  setActiveZone(DEFAULT_ZONE);
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("keyboard mapping", () => {
  it("puts D on C4 and R on C#4 by physical position", () => {
    expect(keyCapFor(60)).toBe("D"); // 中央 C
    expect(keyCapFor(61)).toBe("R"); // 升 C：R 在 D 的右上角
    expect(keyCapFor(63)).toBe("T"); // 升 D
    expect(keyCapFor(66)).toBe("U"); // 升 F
    expect(keyCapFor(71)).toBe("L"); // B
    expect(keyCapFor(58)).toBe("W"); // 低一个八度的 A#
  });

  it("labels nothing outside the active zone", () => {
    expect(keyCapFor(48)).toBeUndefined(); // C3 属音区 3
    expect(keyCapFor(1)).toBeUndefined();
  });
});

describe("attachKeyboardListener", () => {
  it("emits nothing while simulation mode is off", () => {
    const notes: MidiNote[] = [];
    const detach = attachKeyboardListener((note) => notes.push(note));
    window.dispatchEvent(keyEvent("keydown", "KeyD"));
    expect(notes).toHaveLength(0);
    detach();
  });

  it("emits note on/off for mapped keys when enabled", () => {
    setKeyboardMode(true);
    const notes: MidiNote[] = [];
    const detach = attachKeyboardListener((note) => notes.push(note));
    window.dispatchEvent(keyEvent("keydown", "KeyD"));
    window.dispatchEvent(keyEvent("keyup", "KeyD"));
    expect(notes).toHaveLength(2);
    expect(notes[0]).toMatchObject({ midi: 60, kind: "on", source: "keyboard" });
    expect(notes[1]).toMatchObject({ midi: 60, kind: "off" });
    detach();
  });

  it("switches zone with 1–7 so D plays another C", () => {
    setKeyboardMode(true);
    const notes: MidiNote[] = [];
    const detach = attachKeyboardListener((note) => notes.push(note));

    window.dispatchEvent(keyEvent("keydown", "Digit3"));
    expect(activeZone.value).toBe(3);
    window.dispatchEvent(keyEvent("keydown", "KeyD"));
    window.dispatchEvent(keyEvent("keyup", "KeyD"));
    expect(notes[0]).toMatchObject({ midi: 48, kind: "on" }); // C3

    window.dispatchEvent(keyEvent("keydown", "Digit5"));
    window.dispatchEvent(keyEvent("keydown", "KeyD"));
    expect(notes[2]).toMatchObject({ midi: 72, kind: "on" }); // C5
    detach();
  });

  it("releases held notes when the zone changes", () => {
    setKeyboardMode(true);
    const notes: MidiNote[] = [];
    const detach = attachKeyboardListener((note) => notes.push(note));
    window.dispatchEvent(keyEvent("keydown", "KeyD"));
    window.dispatchEvent(keyEvent("keydown", "Digit3"));
    expect(notes.map((note) => note.kind)).toEqual(["on", "off"]);
    expect(notes[1].midi).toBe(60);
    // 旧键位已经清空，松开时不会重复发 off
    window.dispatchEvent(keyEvent("keyup", "KeyD"));
    expect(notes).toHaveLength(2);
    detach();
  });

  it("ignores repeats, modifiers and unmapped keys", () => {
    setKeyboardMode(true);
    const notes: MidiNote[] = [];
    const detach = attachKeyboardListener((note) => notes.push(note));
    window.dispatchEvent(keyEvent("keydown", "KeyD", { repeat: true }));
    window.dispatchEvent(keyEvent("keydown", "KeyD", { ctrlKey: true }));
    window.dispatchEvent(keyEvent("keydown", "Enter"));
    window.dispatchEvent(keyEvent("keydown", "KeyE")); // 豁口键（E–F 之间没有黑键）
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
    input.dispatchEvent(keyEvent("keydown", "KeyD"));
    expect(notes).toHaveLength(0);
    // 文本框里按数字也不该切音区
    input.dispatchEvent(keyEvent("keydown", "Digit3"));
    expect(activeZone.value).toBe(DEFAULT_ZONE);

    const slider = document.createElement("input");
    slider.type = "range";
    document.body.append(slider);
    slider.dispatchEvent(keyEvent("keydown", "KeyD"));
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
    window.dispatchEvent(keyEvent("keydown", "KeyD"));
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
    expect(caps).toContain("D");
    expect(caps).toContain("R");
    expect(caps).toContain(";");
    // 白键行 11 + 黑键行 6：E / Y / P / Q 是豁口，不标注
    expect(caps).toHaveLength(17);
  });

  it("keeps the label switch independent from simulation mode", async () => {
    setKeyboardMode(true);
    const wrapper = mount(KeyboardDiagram, { props: { highlightMidi: null } });
    expect(wrapper.findAll(".key-cap").length).toBeGreaterThan(0);

    setKeyLabels(false);
    await wrapper.vm.$nextTick();
    expect(wrapper.find(".key-cap").exists()).toBe(false);

    setKeyLabels(true);
    await wrapper.vm.$nextTick();
    expect(wrapper.find(".key-cap").exists()).toBe(true);
  });
});
