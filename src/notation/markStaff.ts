import type { Hand, Score } from "../domain/types";

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
    const group = groups[index];
    if (!group) return;
    const color = colors.get(note.id);
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
