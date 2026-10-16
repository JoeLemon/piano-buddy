import { isPass, type CompareResult } from "./compare";
import type { Hand, Level } from "./types";

const PASS_TEXT = "这些音可以直接认了。接下来的视奏里只会用到它们。";
const RHYTHM_TEXT = "有两处比拍子晚了超过两拍。先把速度放慢，再来一条新的。";

const SIGHT_PASS_TEXT = "完成啦！这条读下来了。可以再看一条新的，或者回首页歇一下。";
const SIGHT_RHYTHM_TEXT = "完成啦！大部分音都读对了，这几处比拍子晚了，可以降低速度再试一次。";
const SIGHT_RHYTHM_SOFT = "完成啦！有一处比拍子晚了。可以放慢一点，再看一条新的。";

const PITCH_TEXT: Record<string, string> = {
  C4: "中央 C 还要找一下。它写在高音谱下加一线，右手大拇指。再来一条新的。",
  D4: "D 还要找一下。它在中央 C 上面一个白键，右手二指。再来一条新的。",
  E4: "E 还要找一下。它在第一线上，右手三指。再来一条新的。",
  F4: "F 还要找一下。它在 E 上面一格，右手四指。再来一条新的。",
  G4: "G 还要找一下。它在第二线上，右手五指。再来一条新的。",
  C3: "低音 C 还要找一下。它在低音谱第二间，左手五指。再来一条新的。",
  D3: "D 还要找一下。它在低音谱第三线，左手四指。再来一条新的。",
  E3: "E 还要找一下。它在低音谱第三间，左手三指。再来一条新的。",
  F3: "F 还要找一下。它在低音谱第四线，左手二指。再来一条新的。",
  G3: "G 还要找一下。它在低音谱第四间，左手大拇指。再来一条新的。",
};

export function feedbackText(result: CompareResult, level: Level, hand: Hand): string {
  void hand;
  if (isPass(result, level)) return PASS_TEXT;
  if (result.rhythmBreaks >= 2) return RHYTHM_TEXT;
  if (result.firstWrongLabel) {
    const sentence = PITCH_TEXT[result.firstWrongLabel];
    if (sentence) return sentence;
  }
  return RHYTHM_TEXT;
}

/** Sight-reading review copy. Rhythm issues come before pitch. No percentages. */
export function sightFeedbackText(result: CompareResult): string {
  if (result.rhythmBreaks >= 2) return SIGHT_RHYTHM_TEXT;
  if (result.rhythmBreaks === 1) return SIGHT_RHYTHM_SOFT;
  if (result.pitchErrors === 0) return SIGHT_PASS_TEXT;
  if (result.firstWrongLabel) {
    const sentence = PITCH_TEXT[result.firstWrongLabel];
    if (sentence) return sentence.replace("再来一条新的。", "谱上已标出这个音。");
  }
  return SIGHT_PASS_TEXT;
}
