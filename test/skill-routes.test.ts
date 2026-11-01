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

  it("sends L4–L6 skills to the matching prep stages", () => {
    expect(routeForSkill("texture.broken")).toMatchObject({ kind: "stage", stageId: "L4-1" });
    expect(routeForSkill("texture.broken")?.label).toContain("分解和弦");
    expect(routeForSkill("pos.expand")).toMatchObject({ kind: "stage", stageId: "L4-2" });
    expect(routeForSkill("pos.expand")?.label).toContain("手位读谱");
    expect(routeForSkill("chord.inversion")).toMatchObject({ kind: "stage", stageId: "L4-3" });
    expect(routeForSkill("chord.minor")).toMatchObject({ kind: "stage", stageId: "L4-4" });
    expect(routeForSkill("key.minor")).toMatchObject({ kind: "stage", stageId: "L4-4" });
    expect(routeForSkill("chord.seventh")).toMatchObject({ kind: "stage", stageId: "L5-1" });
    expect(routeForSkill("meter.six-eight")).toMatchObject({ kind: "stage", stageId: "L5-2" });
    expect(routeForSkill("rhythm.triplet")).toMatchObject({ kind: "stage", stageId: "L5-3" });
    expect(routeForSkill("rhythm.dotted")).toMatchObject({ kind: "stage", stageId: "L5-4" });
    expect(routeForSkill("rhythm.syncopation")).toMatchObject({ kind: "stage", stageId: "L5-4" });
    expect(routeForSkill("rhythm.sixteenth")).toMatchObject({ kind: "stage", stageId: "L6-1" });
    expect(routeForSkill("pos.leap")).toMatchObject({ kind: "stage", stageId: "L6-2" });
  });

  it("returns null for skills without a micro lesson", () => {
    // pedal.sustain 仍是只有规则、没有内容的 L4 技能。
    expect(routeForSkill("pedal.sustain")).toBeNull();
    expect(routeForSkill("")).toBeNull();
  });
});
