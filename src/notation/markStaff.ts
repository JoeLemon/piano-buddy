import { flattenScore } from "../domain/timeline";
import type { Hand, Score } from "../domain/types";
import { grandRows } from "./scorePaint";

export type StaffMarkColor = string;

/** Paint stave notes that match the given id→color map. */
export function markStaffNotes(
  element: HTMLElement,
  score: Score,
  hand: Hand,
  colors: ReadonlyMap<string, StaffMarkColor>,
): void {
  const groups = Array.from(element.querySelectorAll(".vf-stavenote"));
  const notes = (score.staves[hand]?.measures ?? []).flatMap((measure) => measure.notes);
  notes.forEach((note, index) => {
    paintGroup(groups[index], colors.get(note.id));
  });
}

/** 大谱表版本：键是 `${hand}:${id}`，顺序与 grandRows 一致。 */
export function markGrandStaffNotes(
  element: HTMLElement,
  score: Score,
  colors: ReadonlyMap<string, StaffMarkColor>,
): void {
  const groups = Array.from(element.querySelectorAll(".vf-stavenote"));
  grandRows(score).forEach((row, index) => {
    paintGroup(groups[index], colors.get(`${row.hand}:${row.id}`));
  });
}

export function markMapFromIds(
  wrongPitchNoteIds: readonly string[],
  lateNoteIds: readonly string[],
): Map<string, StaffMarkColor> {
  const map = new Map<string, StaffMarkColor>();
  for (const id of wrongPitchNoteIds) map.set(id, "#8a3d12");
  for (const id of lateNoteIds) {
    if (!map.has(id)) map.set(id, "#1f5f8b");
  }
  return map;
}

/** 大谱表的标注映射：把时间线里的 id 补上手，转成 `${hand}:${id}`。 */
export function grandMarkMapFromIds(
  score: Score,
  wrongPitchNoteIds: readonly string[],
  lateNoteIds: readonly string[],
): Map<string, StaffMarkColor> {
  const handOf = new Map<string, Hand>();
  for (const note of flattenScore(score)) {
    if (!handOf.has(note.id)) handOf.set(note.id, note.hand);
  }
  const map = new Map<string, StaffMarkColor>();
  const put = (id: string, color: StaffMarkColor) => {
    const hand = handOf.get(id);
    if (!hand) return;
    const key = `${hand}:${id}`;
    if (!map.has(key)) map.set(key, color);
  };
  for (const id of wrongPitchNoteIds) put(id, "#8a3d12");
  for (const id of lateNoteIds) put(id, "#1f5f8b");
  return map;
}

function paintGroup(group: Element | undefined, color: StaffMarkColor | undefined): void {
  if (!group) return;
  if (!color) {
    group.removeAttribute("data-wrong");
    group.removeAttribute("data-late");
    return;
  }
  const isLate = color === "late" || color === "#1f5f8b";
  group.setAttribute(isLate ? "data-late" : "data-wrong", "true");
  if (!isLate) group.removeAttribute("data-late");
  if (isLate) group.removeAttribute("data-wrong");
  const fill = color === "late" ? "#1f5f8b" : color === "pitch" ? "#8a3d12" : color;
  const paths = group.querySelectorAll("path");
  for (let pathIndex = 0; pathIndex < paths.length; pathIndex += 1) {
    const path = paths.item(pathIndex);
    if (!path) continue;
    path.setAttribute("fill", fill);
    path.setAttribute("stroke", fill);
  }
}
