import { afterEach, describe, expect, it } from "vitest";
import {
  PIANO_HIGH_MIDI,
  PIANO_LOW_MIDI,
  WHITE_KEYS,
  ZONES,
  canZonePlay,
  clampScroll,
  cMarks,
  midiOctave,
  slotForMidi,
  whiteKeys,
  zoneById,
  zoneCMidi,
  zoneForMidi,
  zoneKeyRange,
  zoneScrollTarget,
} from "../src/keyboard/layout";
import {
  DEFAULT_ZONE,
  activeZone,
  codeForMidi,
  followMidi,
  keyCapFor,
  keyCapsFor,
  keyToMidi,
  setActiveZone,
} from "../src/midi/keyboard";

afterEach(() => {
  setActiveZone(DEFAULT_ZONE);
});

describe("88 键与 7 个音区", () => {
  it("covers A0–C8 without gaps", () => {
    expect(PIANO_LOW_MIDI).toBe(21); // A0
    expect(PIANO_HIGH_MIDI).toBe(108); // C8
    expect(ZONES).toHaveLength(7);
    expect(ZONES[0].midiStart).toBe(21);
    expect(ZONES[6].midiEnd).toBe(108);
    for (let i = 1; i < ZONES.length; i += 1) {
      expect(ZONES[i].midiStart).toBe(ZONES[i - 1].midiEnd + 1);
      expect(ZONES[i].firstWhite).toBe(ZONES[i - 1].firstWhite + ZONES[i - 1].whiteCount);
    }
  });

  it("splits the keyboard exactly as the thumbnail does", () => {
    expect(ZONES.map((zone) => zone.name)).toEqual([
      "A0–B1",
      "C2–B2",
      "C3–B3",
      "C4–B4",
      "C5–B5",
      "C6–B6",
      "C7–C8",
    ]);
    // 首尾两段不是整八度：A0–B1 有 9 个白键，C7–C8 有 8 个。
    expect(ZONES.map((zone) => zone.whiteCount)).toEqual([9, 7, 7, 7, 7, 7, 8]);
    expect(ZONES.reduce((sum, zone) => sum + zone.whiteCount, 0)).toBe(52);
    expect(WHITE_KEYS).toHaveLength(52);
    expect(whiteKeys()).toEqual([...WHITE_KEYS]);
  });

  it("anchors the five-finger range on each zone's own C", () => {
    expect(zoneCMidi(zoneById(4))).toBe(60); // C4
    expect(zoneCMidi(zoneById(3))).toBe(48); // C3
    expect(zoneForMidi(48).id).toBe(3);
    expect(zoneForMidi(35).id).toBe(1);
    expect(zoneForMidi(36).id).toBe(2);
    expect(zoneForMidi(108).id).toBe(7);
    // 超出 88 键时夹到两端，避免缩略图出现空区
    expect(zoneForMidi(10).id).toBe(1);
    expect(zoneForMidi(120).id).toBe(7);
    expect(zoneKeyRange(zoneById(4))).toEqual({ low: 57, high: 74 });
  });

  it("knows which notes the computer keyboard can reach", () => {
    const zone4 = zoneById(4);
    expect(canZonePlay(zone4, 60)).toBe(true);
    expect(canZonePlay(zone4, 74)).toBe(true);
    expect(canZonePlay(zone4, 57)).toBe(true);
    expect(canZonePlay(zone4, 56)).toBe(false);
    expect(canZonePlay(zone4, 75)).toBe(false);
  });

  it("marks every C on the thumbnail and on the keys", () => {    const marks = cMarks();
    expect(marks.map((mark) => mark.label)).toEqual(["C1", "C2", "C3", "C4", "C5", "C6", "C7", "C8"]);
    for (const mark of marks) {
      expect(mark.pct).toBeGreaterThan(0);
      expect(mark.pct).toBeLessThan(100);
      expect(zoneForMidi(mark.midi).id).toBe(mark.zoneId);
    }
    // C4 是音区 4 的第一个白键，落在该段最左侧
    const c4 = marks.find((mark) => mark.label === "C4")!;
    expect(c4.whiteIndex).toBe(23);
    expect(slotForMidi(60)).toBe(23);
    expect(midiOctave(60)).toBe(4);
  });

  it("computes where to scroll so a zone lands in view", () => {
    const keyPitch = 30; // 白键 28 + 键缝 2
    const viewport = 700;
    const content = 52 * keyPitch;

    // 第一段在最左边，不需要滚动；越往右目标值越大，且都被夹在合法范围内
    expect(clampScroll(zoneScrollTarget(zoneById(1), keyPitch, viewport), content, viewport)).toBe(0);
    const far = clampScroll(zoneScrollTarget(zoneById(7), keyPitch, viewport), content, viewport);
    expect(far).toBe(content - viewport);
    const mid = clampScroll(zoneScrollTarget(zoneById(4), keyPitch, viewport), content, viewport);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(far);
    // 音区 4 的 C4 在这个位置应该正好落在可视区里
    expect(mid).toBeLessThanOrEqual(23 * keyPitch);
    expect(mid + viewport).toBeGreaterThanOrEqual(23 * keyPitch);
  });
});

describe("电脑键盘：A 行白键 / Q 行黑键 / D 键永远是 C", () => {
  /** 音区 4（C4–B4）下的完整键位表，按物理位置排列。 */
  const ZONE_4: Record<string, number> = {
    KeyA: 57, // A3
    KeyS: 59, // B3
    KeyD: 60, // C4（中央 C）
    KeyF: 62, // D4
    KeyG: 64, // E4
    KeyH: 65, // F4
    KeyJ: 67, // G4
    KeyK: 69, // A4
    KeyL: 71, // B4
    Semicolon: 72, // C5
    Quote: 74, // D5
    KeyW: 58, // A#3
    KeyR: 61, // C#4：R 在 D 的右上角
    KeyT: 63, // D#4
    KeyU: 66, // F#4
    KeyI: 68, // G#4
    KeyO: 70, // A#4
  };

  it("maps the two rows by keyboard position", () => {
    for (const [code, midi] of Object.entries(ZONE_4)) {
      expect(keyToMidi(code, 4)).toBe(midi);
    }
    expect(codeForMidi(60, 4)).toBe("KeyD");
    expect(codeForMidi(61, 4)).toBe("KeyR");
  });

  it("leaves the gaps (no black key) silent", () => {
    // E / Y / P 落在 B–C、E–F、B–C 的豁口上；Q 最低音左边没有黑键。
    for (const code of ["KeyE", "KeyY", "KeyP", "KeyQ", "Digit1", "Space"]) {
      expect(keyToMidi(code, 4)).toBeUndefined();
    }
  });

  it("keeps D on the C of whichever zone is active", () => {
    for (const zone of ZONES) {
      const c = keyToMidi("KeyD", zone.id);
      if (zone.id === 1) {
        // 音区 1 的 C1 在键盘范围内，D 键照样弹 C1
        expect(c).toBe(24);
      } else {
        expect(c).toBe(zoneCMidi(zone));
      }
      expect(keyToMidi("KeyR", zone.id)).toBe((c ?? 0) + 1);
    }
  });

  it("uses the active zone by default and not beyond 88 keys", () => {
    setActiveZone(3);
    expect(keyToMidi("KeyD")).toBe(48);
    expect(keyToMidi("KeyA")).toBe(45); // A2
    setActiveZone(1);
    // 音区 1 的 D 键 = C1（24），再往下的 A0 也还能弹
    expect(keyToMidi("KeyA", 1)).toBe(21);
    expect(keyToMidi("KeyD", 1)).toBe(24);
    setActiveZone(7);
    // 音区 7 的 D 键 = C7，上排 ' 键到 D8（超出 88 键）就被挡掉
    expect(keyToMidi("KeyD", 7)).toBe(96);
    expect(keyToMidi("Semicolon", 7)).toBe(108); // C8
    expect(keyToMidi("Quote", 7)).toBeUndefined();
  });

  it("labels caps for the active zone only", () => {
    expect(keyCapFor(60, 4)).toBe("D");
    expect(keyCapFor(61, 4)).toBe("R");
    expect(keyCapFor(58, 4)).toBe("W");
    expect(keyCapFor(72, 4)).toBe(";");
    expect(keyCapFor(69, 3)).toBeUndefined(); // A4 不在音区 3 的键盘上
    expect([...keyCapsFor(4).keys()].sort((a, b) => a - b)).toEqual(
      Object.values(ZONE_4).sort((a, b) => a - b),
    );
  });

  it("follows a note that the current zone cannot reach", () => {
    setActiveZone(4);
    followMidi(64); // E4 在音区 4 里，不动
    expect(activeZone.value).toBe(4);
    followMidi(48); // C3 够不到，切到音区 3
    expect(activeZone.value).toBe(3);
    followMidi(60); // C4 还在音区 3 的范围内（音区 3 键盘到 D4），不来回跳
    expect(activeZone.value).toBe(3);
    followMidi(69); // A4 超出音区 3，切到音区 4
    expect(activeZone.value).toBe(4);
  });
});
