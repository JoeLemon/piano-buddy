import type { Hand, NoteEvent, Score } from "./types";
import { DURATION_BEATS } from "./vocabulary";

/**
 * 三连音（3:2）的结构校验。
 *
 * `NoteEvent.tuplet` 只记一个组 id，不把时值直接改成 1/3——谱面仍写八分音符，
 * 实际拍数由 `noteBeats()` 折算。这样渲染层能把同一组交给 VexFlow 的 Tuplet，
 * 事件层、评测层和小节拍数也都能从同一份数据算出来。
 *
 * 当前只支持最简单、也最常见的一种：**同一组 3 个音、基础时值相同、连续、
 * 不跨小节**。更复杂的连音符（5:4、跨小节、混合时值）先报错，避免导入器
 * 静默产出一份「看起来对、弹起来错」的谱。
 */

export function hasTuplets(score: Score): boolean {
  for (const hand of score.hands) {
    for (const measure of score.staves[hand]?.measures ?? []) {
      if (measure.notes.some((note) => note.tuplet !== undefined)) return true;
    }
  }
  return false;
}

type GroupEntry = {
  note: NoteEvent;
  index: number;
};

export function tupletErrors(score: Score): string[] {
  const errors: string[] = [];
  /** 组 id → 第一次出现的位置，用来抓跨小节/跨手的重复。 */
  const seen = new Map<string, { hand: Hand; measure: number }>();

  for (const hand of score.hands) {
    const measures = score.staves[hand]?.measures ?? [];
    measures.forEach((measure, measureIndex) => {
      const groups = new Map<string, GroupEntry[]>();
      measure.notes.forEach((note, index) => {
        if (note.tuplet === undefined) return;
        const id = note.tuplet.trim();
        if (id === "") {
          errors.push(`第 ${measureIndex + 1} 小节（${hand}）：三连音组 id 不能为空`);
          return;
        }
        const list = groups.get(id) ?? [];
        list.push({ note, index });
        groups.set(id, list);
      });

      for (const [id, entries] of groups) {
        const where = `第 ${measureIndex + 1} 小节（${hand}）的三连音组 ${id}`;
        const first = seen.get(id);
        if (first) {
          const at = first.hand === hand && first.measure === measureIndex
            ? "同一小节内重复出现"
            : `与 ${first.hand} 第 ${first.measure + 1} 小节重复（组 id 必须唯一）`;
          errors.push(`${where}：${at}`);
          continue;
        }
        seen.set(id, { hand, measure: measureIndex });

        if (entries.length !== 3) {
          errors.push(`${where}：应有 3 个音，实际 ${entries.length} 个`);
          continue;
        }

        const from = entries[0].index;
        const to = entries[entries.length - 1].index;
        if (to - from + 1 !== entries.length) {
          errors.push(`${where}：3 个音必须连续，中间不能夹别的音`);
        }

        const base = DURATION_BEATS[entries[0].note.duration];
        const mixed = entries.find(
          (entry) => Math.abs(DURATION_BEATS[entry.note.duration] - base) > 1e-9,
        );
        if (!(base > 0)) {
          errors.push(`${where}：基础时值 ${entries[0].note.duration} 无法计算拍数`);
        } else if (mixed) {
          errors.push(
            `${where}：3 个音的基础时值必须相同（${entries[0].note.duration} vs ${mixed.note.duration}）`,
          );
        }
      }
    });
  }

  return errors;
}
