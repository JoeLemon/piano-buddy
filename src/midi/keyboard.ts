import { ref } from "vue";
import {
  canZonePlay,
  PIANO_HIGH_MIDI,
  PIANO_LOW_MIDI,
  zoneById,
  zoneForMidi,
  zoneCMidi,
  type PianoZone,
} from "../keyboard/layout";
import type { MidiNote } from "./types";

/**
 * 电脑键盘弹琴。
 *
 * 两排键按钢琴的物理位置关系摆：
 *
 *   Q  W  E  R  T  Y  U  I  O  P        ← 黑键行
 *     A  S  D  F  G  H  J  K  L  ;  '    ← 白键行
 *
 * 规则只有一条：**D 键永远是当前音区的 C**。其余按位置对应——
 * R 在 D 的右上角，所以 R 是 C#；T 在 F 右上角，是 D#；U、I、O 依次是
 * F#、G#、A#。E / Y / P 正好落在「没有黑键的豁口」上（B–C、E–F、B–C），
 * 就像真钢琴那两个缺口，不发声。
 *
 * 白键行从 A 起算，所以 D=C 时左边还有 S=B、A=A（属上一个八度），右边
 * 一直排到 '=D（下一个八度）。数字键 1–7 切换音区，D 键就换到别的 C 上。
 */

/** 每个键相对「本音区 C」的半音偏移。 */
export const ROW_OFFSETS: Readonly<Record<string, number>> = {
  // 白键行
  KeyA: -3,
  KeyS: -1,
  KeyD: 0,
  KeyF: 2,
  KeyG: 4,
  KeyH: 5,
  KeyJ: 7,
  KeyK: 9,
  KeyL: 11,
  Semicolon: 12,
  Quote: 14,
  // 黑键行
  KeyW: -2,
  KeyR: 1,
  KeyT: 3,
  KeyU: 6,
  KeyI: 8,
  KeyO: 10,
};

/** 键帽字符（白键行 / 黑键行各一串，给设置里的说明文案用）。 */
export const WHITE_ROW_CAPS = ["A", "S", "D", "F", "G", "H", "J", "K", "L", ";", "'"];
export const BLACK_ROW_CAPS = ["W", "R", "T", "U", "I", "O"];

const STORAGE_KEY = "piano-buddy-keyboard-mode";
const LABELS_KEY = "piano-buddy-key-labels";
const ZONE_KEY = "piano-buddy-key-zone";

/** 默认音区 4（C4–B4）：D 键就是中央 C。 */
export const DEFAULT_ZONE = 4;

function readFlag(key: string, fallback: boolean): boolean {
  try {
    const raw = localStorage.getItem(key);
    return raw == null ? fallback : raw === "1";
  } catch {
    return fallback;
  }
}

function writeFlag(key: string, on: boolean): void {
  try {
    localStorage.setItem(key, on ? "1" : "0");
  } catch {
    // localStorage 不可用时只保留内存状态
  }
}

function readZone(): number {
  try {
    const raw = Number(localStorage.getItem(ZONE_KEY));
    if (Number.isInteger(raw) && raw >= 1 && raw <= 7) return raw;
  } catch {
    // 忽略
  }
  return DEFAULT_ZONE;
}

/** 模拟键盘模式的开关（打开后电脑键盘可以弹琴）。 */
export const keyboardMode = ref(readFlag(STORAGE_KEY, false));

/** 琴键是否标注电脑键位。打开模拟键盘时自动打开，也可以单独关掉。 */
export const keyLabels = ref(readFlag(LABELS_KEY, false));

/** 当前激活的音区编号 1–7。 */
export const activeZone = ref(readZone());

/** 当前按住不放的键（电脑键盘 + 屏幕琴键共用，用于琴键按压态）。 */
export const heldKeyMidis = ref<number[]>([]);

export function setKeyboardMode(on: boolean): void {
  keyboardMode.value = on;
  keyLabels.value = on;
  writeFlag(STORAGE_KEY, on);
  writeFlag(LABELS_KEY, on);
}

export function toggleKeyboardMode(): void {
  setKeyboardMode(!keyboardMode.value);
}

export function setKeyLabels(on: boolean): void {
  keyLabels.value = on;
  writeFlag(LABELS_KEY, on);
}

export function toggleKeyLabels(): void {
  setKeyLabels(!keyLabels.value);
}

export function setActiveZone(id: number): void {
  const zone = zoneById(id);
  if (activeZone.value === zone.id) return;
  activeZone.value = zone.id;
  try {
    localStorage.setItem(ZONE_KEY, String(zone.id));
  } catch {
    // 忽略
  }
}

/**
 * 让音区跟着某个音走：只有当前音区的键盘够不到这个音时才切。
 * 这样用户在练 C3 的课时会自动落到音区 3，但手动选过的音区不会被同一段练习打断。
 */
export function followMidi(midi: number): void {
  const zone = zoneById(activeZone.value);
  if (canZonePlay(zone, midi)) return;
  setActiveZone(zoneForMidi(midi).id);
}

/** 当前音区的中心 C（D 键弹出的 C）。 */
export function zoneCMidiFor(id: number = activeZone.value): number {
  return zoneCMidi(zoneById(id));
}

export function currentZone(): PianoZone {
  return zoneById(activeZone.value);
}

/** 电脑键 → MIDI 音。没有映射（豁口键、超出 88 键、非钢琴键）返回 undefined。 */
export function keyToMidi(code: string, zoneId: number = activeZone.value): number | undefined {
  const offset = ROW_OFFSETS[code];
  if (offset == null) return undefined;
  const midi = zoneCMidi(zoneById(zoneId)) + offset;
  if (midi < PIANO_LOW_MIDI || midi > PIANO_HIGH_MIDI) return undefined;
  return midi;
}

function capForCode(code: string): string {
  if (code.startsWith("Key")) return code.slice(3);
  if (code === "Semicolon") return ";";
  if (code === "Quote") return "'";
  return code;
}

/** MIDI 音 → 键帽字符（只在对当前音区有效时返回）。 */
export function keyCapFor(midi: number, zoneId: number = activeZone.value): string | undefined {
  for (const [code, offset] of Object.entries(ROW_OFFSETS)) {
    if (zoneCMidi(zoneById(zoneId)) + offset === midi) return capForCode(code);
  }
  return undefined;
}

/** 当前音区全部「音 → 键帽」对照表，琴键图一次算好直接用。 */
export function keyCapsFor(zoneId: number = activeZone.value): Map<number, string> {
  const caps = new Map<number, string>();
  for (const [code, offset] of Object.entries(ROW_OFFSETS)) {
    const midi = zoneCMidi(zoneById(zoneId)) + offset;
    if (midi < PIANO_LOW_MIDI || midi > PIANO_HIGH_MIDI) continue;
    caps.set(midi, capForCode(code));
  }
  return caps;
}

/** MIDI 音 → 该弹的电脑键（测试与提示文案用）。 */
export function codeForMidi(midi: number, zoneId: number = activeZone.value): string | undefined {
  for (const [code, offset] of Object.entries(ROW_OFFSETS)) {
    if (zoneCMidi(zoneById(zoneId)) + offset === midi) return code;
  }
  return undefined;
}

/**
 * 监听 window 键盘事件并转成 MIDI 音符。
 *
 * 只在模拟键盘模式打开时生效，因此可以在页面常驻监听而无需跟随开关重新订阅。
 * 切换音区时，正在按住的键先补一个 off，否则旧音区的音会一直响。
 */
export function attachKeyboardListener(onNote: (note: MidiNote) => void): () => void {
  if (typeof window === "undefined") return () => {};

  const held = new Map<string, number>();

  const releaseAll = () => {
    for (const midi of held.values()) {
      onNote({ midi, timeMs: performance.now(), kind: "off", source: "keyboard" });
    }
    held.clear();
    heldKeyMidis.value = [];
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (!keyboardMode.value) return;
    if (event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
    if (isTypingTarget(event.target)) return;

    // 1–7 切换音区（D 键随之换到另一个 C）。
    const zoneMatch = /^Digit([1-7])$/.exec(event.code);
    if (zoneMatch) {
      event.preventDefault();
      releaseAll();
      setActiveZone(Number(zoneMatch[1]));
      return;
    }

    const midi = keyToMidi(event.code);
    if (midi == null) return;
    event.preventDefault();
    held.set(event.code, midi);
    heldKeyMidis.value = [...held.values()];
    onNote({ midi, timeMs: performance.now(), kind: "on", source: "keyboard" });
  };

  const onKeyUp = (event: KeyboardEvent) => {
    const midi = held.get(event.code);
    if (midi == null) return;
    held.delete(event.code);
    heldKeyMidis.value = [...held.values()];
    onNote({ midi, timeMs: performance.now(), kind: "off", source: "keyboard" });
  };

  const onBlur = () => releaseAll();

  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  window.addEventListener("blur", onBlur);
  return () => {
    window.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("keyup", onKeyUp);
    window.removeEventListener("blur", onBlur);
    releaseAll();
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
