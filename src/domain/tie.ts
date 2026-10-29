import { pitchToMidi } from "./pitch";
import type { NoteEvent, Pitch, Score } from "./types";

/**
 * 连音线的判定口径。
 *
 * `NoteEvent.tie` 是记谱信息，真正「怎么弹」由派生层合并时值来实现：
 * stop/continue 音不重新击键。这里只放最小的共享判断，让 scoreEvents、
 * flattenScore、isAllowed 用的是同一套规则——三处各写一遍迟早会打架。
 */

/** 这个音要承接前面同音高的音（不重新击键）。 */
export function tiesFrom(note: Pick<NoteEvent, "tie">): boolean {
  return note.tie === "stop" || note.tie === "continue";
}

/** 这个音后面还有连音线要继续（next 段会并到这个音上）。 */
export function tiesTo(note: Pick<NoteEvent, "tie">): boolean {
  return note.tie === "start" || note.tie === "continue";
}

/**
 * 两组音高是否完全相同（含八度与升降号，顺序无关）。
 *
 * 连音线只能接同音高的音——差一个八度或一个半音就不是同一条线了，
 * 那是记谱错误而不是连奏。
 */
export function samePitches(a: readonly Pitch[], b: readonly Pitch[]): boolean {
  if (a.length !== b.length || a.length === 0) return false;
  return sameMidis(a.map(pitchToMidi), b.map(pitchToMidi));
}

/** 同一组 MIDI（顺序无关）。派生层已经算好 MIDI，不必再退回音高比较。 */
export function sameMidis(a: readonly number[], b: readonly number[]): boolean {
  if (a.length !== b.length || a.length === 0) return false;
  const left = [...a].sort((x, y) => x - y);
  const right = [...b].sort((x, y) => x - y);
  return left.every((midi, index) => midi === right[index]);
}

/**
 * 检查整套谱面的连音线是否自洽，返回可直接展示给作者的问题列表。
 *
 * 分「分级校验」和「内容 QA」两个入口共用：识谱关卡要求谱面在词汇表内，
 * 曲库只要求记谱本身说得通——但「start 接不上、stop 没起点、音高对不上、
 * 被休止符打断」这几种在两边都是错的。
 */
export function tieErrors(score: Score): string[] {
  const errors: string[] = [];
  for (const hand of score.hands) {
    const stave = score.staves[hand];
    if (!stave) continue;
    let pending: { pitches: Pitch[]; id: string } | null = null;

    for (let measureIndex = 0; measureIndex < stave.measures.length; measureIndex += 1) {
      for (const note of stave.measures[measureIndex].notes) {
        const where = `${hand} 第 ${measureIndex + 1} 小节（${note.id}）`;
        if (note.pitches.length === 0 || note.duration.endsWith("r")) {
          if (pending) {
            errors.push(`${where}：连音线被休止符打断`);
            pending = null;
          }
          continue;
        }
        if (tiesFrom(note)) {
          if (!pending) errors.push(`${where}：连音线没有起点`);
          else if (!samePitches(pending.pitches, note.pitches)) {
            errors.push(`${where}：连音线两端不是同一个音高`);
          }
        } else if (pending) {
          errors.push(`${where}：上一处连音线没有接续（起点 ${pending.id}）`);
        }
        pending = tiesTo(note) ? { pitches: note.pitches, id: note.id } : null;
      }
    }

    if (pending) errors.push(`${hand}：末尾的连音线没有接续（起点 ${pending.id}）`);
  }
  return errors;
}
