import { parsePitchLabel, pitchToMidi } from "../domain/pitch";
import { DURATION_BEATS } from "../domain/vocabulary";
import type { PracticeKind, PracticeQuestion } from "./quiz";

/**
 * 弹奏作答：把「认谱」这件事练在琴上。
 *
 * 选项作答考的是名词（这是 C4、这是大三度），弹奏作答考的是动作
 * （看到音符，手就落在这个键上）。两者的答案其实是同一份数据——
 * 谱面上画了什么，就该弹什么，所以判题直接从 `question.staff` 推导，
 * 不在题库里再存一份答案，避免两处各说一套。
 *
 * 只有「谱面本身就是答案」的题型能弹：单音、音程、和弦、音型。
 * 符号题问的是含义、旋律题问的是调性、进行题一次四个小节——
 * 这些没有唯一该弹的音，硬套会让判题变成猜谜。
 */

export type PlayTarget = {
  kind: PracticeKind;
  /** 目标音高，按谱面顺序展开成 MIDI 编号。 */
  midis: readonly number[];
  /** true = 顺序也要对（音型）；false = 集合相等即可（音程、和弦）。 */
  ordered: boolean;
  /**
   * 顺序弹奏时每个音的时值（拍），与 `midis` 一一对应。
   *
   * 只给音型题填：一串音本来就有节奏，弹对音高却乱掉时值，
   * 听到的就不是谱子上那串音。单音、音程、和弦没有节奏可言。
   */
  beats?: readonly number[];
};

const PLAYABLE: readonly PracticeKind[] = ["notes", "intervals", "chords", "patterns"];

/** 一次最多弹几个音。超过就不是「看一眼弹出来」，而是背谱了。 */
const MAX_PLAYABLE_NOTES = 4;

/** 题目对应的弹奏目标；不能弹的题型返回 null。 */
export function playTargetFor(question: PracticeQuestion): PlayTarget | null {
  if (!PLAYABLE.includes(question.kind)) return null;
  const staff = question.staff;
  // 和弦进行用 measures 分小节，四小节十几个音，不适合一次弹完。
  if (!staff || staff.measures?.length) return null;

  const midis = staff.groups.flatMap((group) =>
    group.pitches.map((pitch) => pitchToMidi(parsePitchLabel(pitch))),
  );
  if (midis.length === 0 || midis.length > MAX_PLAYABLE_NOTES) return null;

  // 时值取谱面本身，不另存一张节奏表；同组多音（和弦）时值相同，逐个摊开。
  const beats =
    question.kind === "patterns"
      ? staff.groups.flatMap((group) =>
          group.pitches.map(() => DURATION_BEATS[group.duration ?? "q"]),
        )
      : undefined;

  return {
    kind: question.kind,
    midis,
    ordered: question.kind === "patterns",
    beats,
  };
}

export type PlayState = "pending" | "correct" | "wrong";

export type PlayJudge = {
  state: PlayState;
  /** 已弹对的音数：顺序模式是正确前缀，集合模式是不重复计数。 */
  matched: number;
  /** 第一个弹错的音（MIDI）；state 为 wrong 时才有值。 */
  stray: number | null;
};

/**
 * 判定当前这一串音。
 *
 * 每弹一个音判一次，所以「弹到一半」是 pending：和弦三个音总有先后，
 * 不能第一个音对就判对。只要出现不属于答案的音，或顺序模式下位置错了，
 * 立刻判错——继续等下只会让人不知道自己错在哪。
 */
export function judgePlay(target: PlayTarget, played: readonly number[]): PlayJudge {
  if (target.ordered) {
    let matched = 0;
    for (let index = 0; index < played.length; index += 1) {
      if (played[index] !== target.midis[index]) {
        return { state: "wrong", matched, stray: played[index] };
      }
      matched = index + 1;
    }
    return {
      state: matched >= target.midis.length ? "correct" : "pending",
      matched,
      stray: null,
    };
  }

  const pool = new Set(target.midis);
  const heard = new Set<number>();
  for (const midi of played) {
    if (!pool.has(midi)) return { state: "wrong", matched: heard.size, stray: midi };
    heard.add(midi);
  }
  return {
    state: heard.size >= pool.size ? "correct" : "pending",
    matched: heard.size,
    stray: null,
  };
}

const STEP_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

/** MIDI → 音名（与 `pitchLabel` 同格式：C4 / C#4），反馈里要念给学生听。 */
export function midiLabel(midi: number): string {
  const name = STEP_NAMES[((midi % 12) + 12) % 12];
  return `${name}${Math.floor(midi / 12) - 1}`;
}

/** 音名（不含八度），用来判断「音名对了、八度不对」这种最常见的错法。 */
export function pitchClassName(midi: number): string {
  return STEP_NAMES[((midi % 12) + 12) % 12];
}

/** 目标音的文字形式：「C4 · E4 · G4」。 */
export function playTargetText(target: PlayTarget): string {
  return target.midis.map(midiLabel).join(" · ");
}

/** 弹奏区的操作提示：说清「弹什么、先后要不要紧」。 */
export function playHintFor(target: PlayTarget): string {
  switch (target.kind) {
    case "intervals":
      return "把谱面上的两个音在琴上弹出来，先弹哪个都行。";
    case "chords":
      return "把谱面上的和弦音全部弹出来，先后不限。";
    case "patterns":
      return "按谱面上的顺序，把这串音一个个弹出来。";
    default:
      return "在琴上弹出谱面上的这个音。";
  }
}
