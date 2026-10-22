/**
 * 全尺寸钢琴键盘的几何模型（A0–C8，88 键）与 7 个音区。
 *
 * 为什么单独成模块：屏幕琴键要「全尺寸 + 横向滚动」，而电脑键盘一次只能弹
 * 十来个音，两者需要一个公共坐标系——白键槽位（slot）。音区、缩略图、
 * 电脑键盘映射、双手示意都按同一套 slot 计算，才不会各写一套。
 *
 * 音区按用户使用习惯从低到高切成 7 段（奇数段是五线谱的中央区附近）：
 *   1 A0–B1 · 2 C2–B2 · 3 C3–B3 · 4 C4–B4 · 5 C5–B5 · 6 C6–B6 · 7 C7–C8
 * 第 1 段与第 7 段长度不同（钢琴最低音是 A0、最高音是 C8），缩略图按白键
 * 数等比分配宽度，因此这两段看起来会窄一些——和真琴一致。
 */

/** 最低音 A0。 */
export const PIANO_LOW_MIDI = 21;
/** 最高音 C8。 */
export const PIANO_HIGH_MIDI = 108;

const WHITE_PITCH_CLASSES = new Set([0, 2, 4, 5, 7, 9, 11]);

export type PianoZone = {
  /** 音区编号 1–7，同时是数字键。 */
  id: number;
  /** 展示用音域文本，例如「C4–B4」。 */
  name: string;
  midiStart: number;
  midiEnd: number;
  /** 该音区里「D 键」对应的 C 的八度：音区 4 → C4。 */
  cOctave: number;
  /** 音区第一个白键在全局白键序列里的下标。 */
  firstWhite: number;
  /** 音区包含的白键数量（缩略图宽度按它等比分配）。 */
  whiteCount: number;
  /** 音区包含的键数（白 + 黑）。 */
  keyCount: number;
};

/** 音区边界：用 MIDI 直接写，避免再算八度表。 */
const ZONE_SPANS: readonly { name: string; midiStart: number; midiEnd: number; cOctave: number }[] = [
  { name: "A0–B1", midiStart: 21, midiEnd: 35, cOctave: 1 },
  { name: "C2–B2", midiStart: 36, midiEnd: 47, cOctave: 2 },
  { name: "C3–B3", midiStart: 48, midiEnd: 59, cOctave: 3 },
  { name: "C4–B4", midiStart: 60, midiEnd: 71, cOctave: 4 },
  { name: "C5–B5", midiStart: 72, midiEnd: 83, cOctave: 5 },
  { name: "C6–B6", midiStart: 84, midiEnd: 95, cOctave: 6 },
  { name: "C7–C8", midiStart: 96, midiEnd: 108, cOctave: 7 },
];

export function isWhiteMidi(midi: number): boolean {
  return WHITE_PITCH_CLASSES.has(((midi % 12) + 12) % 12);
}

/** MIDI → 科学音高八度号（C4 = 60）。 */
export function midiOctave(midi: number): number {
  return Math.floor(midi / 12) - 1;
}

/** 全部白键（从 A0 到 C8，共 52 个）。 */
export function whiteKeys(): number[] {
  const midis: number[] = [];
  for (let midi = PIANO_LOW_MIDI; midi <= PIANO_HIGH_MIDI; midi += 1) {
    if (isWhiteMidi(midi)) midis.push(midi);
  }
  return midis;
}

export const WHITE_KEYS: readonly number[] = whiteKeys();

/**
 * 全部黑键及其槽位：slot 是它左侧那个白键的下标。
 * 黑键画在两个白键的接缝上，slot 与键盘图的 CSS 定位一一对应。
 */
export function blackKeys(): { midi: number; slot: number }[] {
  const keys: { midi: number; slot: number }[] = [];
  let whiteIndex = -1;
  for (let midi = PIANO_LOW_MIDI; midi <= PIANO_HIGH_MIDI; midi += 1) {
    if (isWhiteMidi(midi)) whiteIndex += 1;
    else keys.push({ midi, slot: whiteIndex });
  }
  return keys;
}

export const BLACK_KEYS: readonly { midi: number; slot: number }[] = blackKeys();

/** 某个音的键盘横向槽位（白键下标 + 余量）；黑键返回它左侧白键的槽位。 */
export function slotForMidi(midi: number): number {
  const index = WHITE_KEYS.indexOf(midi);
  if (index >= 0) return index;
  return BLACK_KEYS.find((key) => key.midi === midi)?.slot ?? 0;
}

export const ZONES: readonly PianoZone[] = (() => {
  let firstWhite = 0;
  return ZONE_SPANS.map((span, index) => {
    const whiteCount = WHITE_KEYS.filter(
      (midi) => midi >= span.midiStart && midi <= span.midiEnd,
    ).length;
    const zone: PianoZone = {
      id: index + 1,
      name: span.name,
      midiStart: span.midiStart,
      midiEnd: span.midiEnd,
      cOctave: span.cOctave,
      firstWhite,
      whiteCount,
      keyCount: span.midiEnd - span.midiStart + 1,
    };
    firstWhite += whiteCount;
    return zone;
  });
})();

export const ZONE_COUNT = ZONES.length;

/** 该音区「D 键」对应的 C（音区 4 → C4 = 60）。 */
export function zoneCMidi(zone: PianoZone): number {
  return (zone.cOctave + 1) * 12;
}

/**
 * 电脑键盘在某个音区能弹到的音域。
 *
 * A 行 11 个白键从 C 下方的小三度起（A、B 属于上一个八度），到 C 上方的大二度
 * 结束；Q 行的黑键覆盖 A# 一格。所以音域是 [C-3, C+14]。
 */
export function zoneKeyRange(zone: PianoZone): { low: number; high: number } {
  const c = zoneCMidi(zone);
  return { low: c - 3, high: c + 14 };
}

/** 这个音是否落在该音区的电脑键盘可弹范围内（同时受 88 键边界限制）。 */
export function canZonePlay(zone: PianoZone, midi: number): boolean {
  const { low, high } = zoneKeyRange(zone);
  return midi >= Math.max(low, PIANO_LOW_MIDI) && midi <= Math.min(high, PIANO_HIGH_MIDI);
}

/** 包住某个音的音区；超出 88 键时夹到两端。 */
export function zoneForMidi(midi: number): PianoZone {
  const found = ZONES.find((zone) => midi >= zone.midiStart && midi <= zone.midiEnd);
  if (found) return found;
  return midi < PIANO_LOW_MIDI ? ZONES[0] : ZONES[ZONES.length - 1];
}

export function zoneById(id: number): PianoZone {
  return ZONES.find((zone) => zone.id === id) ?? ZONES[3];
}

/**
 * 全部 C 键标注（C1–C8）。
 * whiteIndex 是全局白键下标，pct 是它在所属音区内的位置（0–100），
 * 缩略图直接把 pct 当 left 用。
 */
export function cMarks(): { midi: number; label: string; whiteIndex: number; zoneId: number; pct: number }[] {
  return WHITE_KEYS.flatMap((midi, whiteIndex) => {
    if (midi % 12 !== 0) return [];
    const zone = zoneForMidi(midi);
    const offset = whiteIndex - zone.firstWhite;
    return [
      {
        midi,
        label: `C${midiOctave(midi)}`,
        whiteIndex,
        zoneId: zone.id,
        pct: ((offset + 0.5) / zone.whiteCount) * 100,
      },
    ];
  });
}

export const C_MARKS: readonly { midi: number; label: string; whiteIndex: number; zoneId: number; pct: number }[] =
  cMarks();

/**
 * 让某个音区落在横向可视区中间所需的 scrollLeft（未夹到合法范围）。
 * keyPitch 是一个白键连同键缝的宽度。
 */
export function zoneScrollTarget(zone: PianoZone, keyPitch: number, viewportWidth: number): number {
  const zoneWidth = zone.whiteCount * keyPitch;
  return zone.firstWhite * keyPitch - (viewportWidth - zoneWidth) / 2;
}

/** 把 scrollLeft 夹到 [0, 内容宽 - 可视宽]。 */
export function clampScroll(left: number, contentWidth: number, viewportWidth: number): number {
  const max = Math.max(0, contentWidth - viewportWidth);
  return Math.min(max, Math.max(0, left));
}
