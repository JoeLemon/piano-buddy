import { describe, expect, it } from "vitest";
import { routeForSkill } from "../src/domain/skillRoutes";

describe("skillRoutes", () => {
  it("maps L1/L2 skills to reading lessons", () => {
    expect(routeForSkill("rhythm.quarter")).toMatchObject({ kind: "reading", lessonId: "L1-1" });
    expect(routeForSkill("clef.bass")).toMatchObject({ kind: "reading", lessonId: "L1-4" });
    expect(routeForSkill("rhythm.eighth")).toMatchObject({ kind: "reading", lessonId: "L2-1" });
    expect(routeForSkill("pos.shift")).toMatchObject({ kind: "reading", lessonId: "L2-6" });
  });

  it("maps L3 chord skills to the L3 chord course", () => {
    expect(routeForSkill("chord.interval")).toMatchObject({ kind: "l3", lessonId: "L3R-1" });
    expect(routeForSkill("chord.triad")).toMatchObject({ kind: "l3", lessonId: "L3R-2" });
    expect(routeForSkill("key.accidental")).toMatchObject({ kind: "l3", lessonId: "L3R-4" });
  });

  it("sends theory gaps to the concrete L3 prep lesson", () => {
    expect(routeForSkill("chord.progression")).toMatchObject({ kind: "theory", lessonId: "L3-4" });
    expect(routeForSkill("chord.progression")?.label).toContain("和弦连接");
  });

  it("returns null for skills without a micro lesson", () => {
    expect(routeForSkill("texture.broken")).toBeNull();
    expect(routeForSkill("")).toBeNull();
  });
});
