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

  it("sends the two L4 skills to the L4 prep stages", () => {
    expect(routeForSkill("texture.broken")).toMatchObject({ kind: "stage", stageId: "L4-1" });
    expect(routeForSkill("texture.broken")?.label).toContain("分解和弦");
    expect(routeForSkill("pos.expand")).toMatchObject({ kind: "stage", stageId: "L4-2" });
    expect(routeForSkill("pos.expand")?.label).toContain("手位读谱");
  });

  it("returns null for skills without a micro lesson", () => {
    // pedal.sustain 仍是只有规则、没有内容的 L4 技能。
    expect(routeForSkill("pedal.sustain")).toBeNull();
    expect(routeForSkill("")).toBeNull();
  });
});
