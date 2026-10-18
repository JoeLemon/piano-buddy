import { ref } from "vue";
import type { MidiNote } from "./types";

/**
 * 模拟键盘输入：没有 MIDI 键盘时，用电脑键盘弹奏。
 *
 * 键位按两排白键 + 上排黑键布置，覆盖 C3–C5（与本应用的琴键图一致）：
 *
 *   黑键  S D   G H J        2 3   5 6 7
 *   白键  Z X C V B N M      Q W E R T Y U I
 *         C D E F G A B      C D E F G A B C
 *         低八度 (C3–B3)     高八度 (C4–C5)
 */
export const KEY_TO_MIDI: Readonly<Record<string, number>> = {
  KeyZ: 48, // C3
  KeyS: 49, // C#3
  KeyX: 50, // D3
  KeyD: 51, // D#3
  KeyC: 52, // E3
  KeyV: 53, // F3
  KeyG: 54, // F#3
  KeyB: 55, // G3
  KeyH: 56, // G#3
  KeyN: 57, // A3
  KeyJ: 58, // A#3
  KeyM: 59, // B3
  KeyQ: 60, // C4
  Digit2: 61, // C#4
  KeyW: 62, // D4
  Digit3: 63, // D#4
  KeyE: 64, // E4
  KeyR: 65, // F4
  Digit5: 66, // F#4
  KeyT: 67, // G4
  Digit6: 68, // G#4
  KeyY: 69, // A4
  Digit7: 70, // A#4
  KeyU: 71, // B4
  KeyI: 72, // C5
};

const STORAGE_KEY = "piano-buddy-keyboard-mode";

/** midi → 键帽显示字符（给屏幕琴键标注键位）。 */
export const MIDI_TO_KEY: ReadonlyMap<number, string> = new Map(
  Object.entries(KEY_TO_MIDI).map(([code, midi]) => [midi, keyCap(code)]),
);

function keyCap(code: string): string {
  if (code.startsWith("Key")) return code.slice(3);
  if (code.startsWith("Digit")) return code.slice(5);
  return code;
}

function readInitial(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

/** 模拟键盘模式的开关状态（全局共享，琴键图据此显示键位标注）。 */
export const keyboardMode = ref(readInitial());

export function setKeyboardMode(on: boolean): void {
  keyboardMode.value = on;
  try {
    localStorage.setItem(STORAGE_KEY, on ? "1" : "0");
  } catch {
    // localStorage 不可用时只保留内存状态
  }
}

export function toggleKeyboardMode(): void {
  setKeyboardMode(!keyboardMode.value);
}

/** midi 音对应的电脑键帽；没有映射返回 undefined。 */
export function keyCapFor(midi: number): string | undefined {
  return MIDI_TO_KEY.get(midi);
}

/**
 * 监听 window 的键盘事件并转成 MIDI 音符。仅当模拟键盘模式打开时生效，
 * 因此可以在页面常驻监听而无需跟随开关重新订阅。
 */
export function attachKeyboardListener(onNote: (note: MidiNote) => void): () => void {
  if (typeof window === "undefined") return () => {};

  const held = new Set<string>();

  const onKeyDown = (event: KeyboardEvent) => {
    if (!keyboardMode.value) return;
    // 输入框里打字、或按住 Ctrl/Cmd 时不要抢键。
    if (event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
    if (isTypingTarget(event.target)) return;
    const midi = KEY_TO_MIDI[event.code];
    if (midi == null) return;
    event.preventDefault();
    held.add(event.code);
    onNote({ midi, timeMs: performance.now(), kind: "on" });
  };

  const onKeyUp = (event: KeyboardEvent) => {
    const midi = KEY_TO_MIDI[event.code];
    if (midi == null || !held.delete(event.code)) return;
    onNote({ midi, timeMs: performance.now(), kind: "off" });
  };

  const onBlur = () => held.clear();

  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  window.addEventListener("blur", onBlur);
  return () => {
    window.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("keyup", onKeyUp);
    window.removeEventListener("blur", onBlur);
    held.clear();
  };
}

/** 文本类输入控件（滑块等操作型控件不算，方便调完速度直接弹）。 */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  if (tag === "TEXTAREA" || tag === "SELECT") return true;
  if (tag !== "INPUT") return false;
  const type = (target as HTMLInputElement).type;
  return type !== "range" && type !== "checkbox" && type !== "radio" && type !== "button";
}
