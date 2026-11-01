import { describe, expect, it } from "vitest";
import { knownSkillIds, parseManifest } from "../src/repertoire";
import {
  buildBatchManifest,
  displayWidth,
  formatRatingDelta,
  padDisplay,
  renderRatingTable,
  resolveTemplate,
  slugifyFile,
  titleFromFile,
  type BatchManifestContext,
} from "../scripts/lib/import-batch";

const CONTEXT: BatchManifestContext = {
  slug: "demo",
  title: "示例曲",
  file: "demo.musicxml",
  id: "pkg.demo",
  songId: "song.demo",
  arrangementId: "arr.demo.imported",
  level: 4,
  pitchLevel: 3,
  fingerLevel: 4,
  pitchLabel: "L3",
  fingerLabel: "L4",
  bpm: 72,
  measures: 8,
  skills: ["clef.treble", "rhythm.quarter"],
};

describe("批量导入工具", () => {
  it("从文件名生成稳定 slug 与展示标题", () => {
    expect(slugifyFile("Bach/Minuet in G.musicxml")).toBe("bach-minuet-in-g");
    expect(slugifyFile("欢乐颂.musicxml")).toBe("");
    expect(titleFromFile("Bach/Minuet_in-G.musicxml")).toBe("Minuet in G");
    expect(titleFromFile("欢乐颂.musicxml")).toBe("欢乐颂");
    expect(titleFromFile(".musicxml")).toBe("未命名曲目");
  });

  it("模板占位符保留数字/数组类型并摊平技能数组", () => {
    const resolved = resolveTemplate(
      {
        name: "{{title}} · L{{level}}",
        difficulty: { level: "{{level}}", bpm: "{{bpm}}" },
        skillDeps: ["{{skills}}"],
        composer: "{{title}}",
      },
      CONTEXT as unknown as Record<string, unknown>,
    );
    expect(resolved).toEqual({
      name: "示例曲 · L4",
      difficulty: { level: 4, bpm: 72 },
      skillDeps: ["clef.treble", "rhythm.quarter"],
      composer: "示例曲",
    });
  });

  it("默认 manifest 能通过 parseManifest，并声明可用档与技能", () => {
    const manifest = buildBatchManifest(null, CONTEXT);
    const result = parseManifest(JSON.stringify(manifest), knownSkillIds());

    expect(result.ok).toBe(true);
    expect(result.manifest).toMatchObject({
      id: "pkg.demo",
      songId: "song.demo",
      arrangementId: "arr.demo.imported",
      songTitle: "示例曲",
      type: "song",
      skillDeps: ["clef.treble", "rhythm.quarter"],
      difficulty: { level: 4, bpm: 72, len: 8 },
      assets: ["content/score.json"],
      rights: { type: "user-imported" },
    });
  });

  it("模板覆盖展示字段与 rights，但保留 difficulty 的默认 bpm/len", () => {
    const manifest = buildBatchManifest(
      {
        name: "{{title}} · 定制编配",
        composer: "测试作者",
        difficulty: { repeat: 0.4 },
        rights: { type: "original", attribution: "{{file}}" },
      },
      CONTEXT,
    );
    expect(manifest.name).toBe("示例曲 · 定制编配");
    expect(manifest.composer).toBe("测试作者");
    expect(manifest.difficulty).toEqual({ level: 4, bpm: 72, len: 8, repeat: 0.4 });
    expect(manifest.rights).toEqual({ type: "original", attribution: "demo.musicxml" });
  });

  it("评级差异表带正负号，并按中英文显示宽度对齐", () => {
    expect(formatRatingDelta(2)).toBe("+2");
    expect(formatRatingDelta(0.5)).toBe("+0.5");
    expect(formatRatingDelta(0)).toBe("0");
    expect(formatRatingDelta(-1)).toBe("-1");
    expect(displayWidth("中文")).toBe(4);
    expect(displayWidth(padDisplay("中文", 6))).toBe(6);

    const table = renderRatingTable([
      {
        file: "demo.musicxml",
        measures: 8,
        pitchLabel: "L2",
        fingerLabel: "L4",
        delta: 2,
        unfingered: 1,
        status: "!",
      },
    ]);
    expect(table).toContain("文件");
    expect(table).toContain("demo.musicxml");
    expect(table).toContain("+2");
    expect(table.split("\n")).toHaveLength(3);
  });
});
