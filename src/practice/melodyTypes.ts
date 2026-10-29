/**
 * Shared types for the Playback exercise.
 *
 * 当前用于「听旋律判断调性」：播放主音和弦与短旋律，再由学生选择调性。
 * 还没有实现跟弹评分。
 */

/**
 * 旋律题的基准速度。
 *
 * 播放示范与跟弹判定共用这一个数：听到的速度和判你弹的速度必须是同一个，
 * 否则「跟着刚才听到的弹」这件事本身就不成立。
 */
export const MELODY_BPM = 80;

/** 慢练档：跟弹时可切到 3/4 速，初学者先跟上再谈准确。 */
export const MELODY_SLOW_BPM = 60;

/** The four supported Playback keys. */
export type PlaybackKey = 'G major' | 'E major' | 'G minor' | 'E minor';

/** The four keys in canonical display order. */
export const PLAYBACK_KEYS: readonly PlaybackKey[] = [
  'G major',
  'E major',
  'G minor',
  'E minor',
];

/** Supported meters (time signatures). */
export type Meter = '3/4' | '4/4';

/** One melody note: a spelled pitch (letter+accidental+octave) and a beat duration. */
export interface MelodyNote {
  /** Spelled pitch, e.g. "F#4", "Bb4", "G5". Source of truth for the note name. */
  pitch: string;
  /** Duration in beats (quarter = 1, eighth = 0.5, half = 2, dotted-half = 3, …). */
  beats: number;
}

/**
 * A fully-specified Playback question: everything needed to display, play, and
 * grade one exercise.
 */
export interface PlaybackQuestion {
  /** Stable id (bank questions use their source file id; generated ones a synthetic id). */
  id: string;
  /** The key of the exercise. */
  key: PlaybackKey;
  /** The meter. */
  meter: Meter;
  /** The tonic chord's four pitches (root, third, fifth, upper root), played once. */
  tonic: string[];
  /** The melody notes, in order. */
  melody: MelodyNote[];
}
