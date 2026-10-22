import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { Score } from "../src/domain/types";
import {
  knownSkillIds,
  loadPackage,
  memorySource,
  parseManifest,
} from "../src/repertoire";
import { validateSongContent } from "../src/repertoire/contentValidation";
import { rateScore } from "../src/repertoire/difficulty";
import { scoreToMotion, validateMotion } from "../src/repertoire/motion";
import { requiredSkillsForScore } from "../src/repertoire/skillGraph";

const packageDir = resolve("content/song.ode-to-joy.l2");
const manifestText = readFileSync(resolve(packageDir, "manifest.json"), "utf8");
const scoreText = readFileSync(resolve(packageDir, "content/score.json"), "utf8");
const score = JSON.parse(scoreText) as Score;

describe("示例曲目包", () => {
  it("manifest 合法，且声明字段完整", () => {
    const result = parseManifest(manifestText, knownSkillIds());
    expect(result.ok).toBe(true);
    expect(result.manifest?.songId).toBe("song.ode-to-joy");
    expect(result.manifest?.arrangementId).toBe("arr.ode-to-joy.simple");
    expect(result.manifest?.difficulty?.len).toBe(8);
  });

  it("内容 QA 通过，且声明难度不低于引擎评级", () => {
    expect(score.mode).toBe("repertoire");
    const manifest = parseManifest(manifestText, knownSkillIds()).manifest!;
    const result = validateSongContent(score, manifest);
    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);

    const rated = rateScore(score, {
      repeat: manifest.difficulty?.repeat,
      measures: manifest.difficulty?.len,
    });
    expect(rated.level).toBe(2);
    expect(rated.level).toBeLessThanOrEqual(manifest.difficulty!.level);
  });

  it("skillDeps 与引擎识别的技能一致", () => {
    const manifest = parseManifest(manifestText, knownSkillIds()).manifest!;
    expect([...requiredSkillsForScore(score)].sort()).toEqual([...manifest.skillDeps].sort());
  });

  it("每个音都有 1..5 指法，Motion 校验通过", () => {
    const motion = scoreToMotion(score);
    expect(validateMotion(motion).ok).toBe(true);
    expect(motion.notes.every((note) => note.finger >= 1 && note.finger <= 5)).toBe(true);
  });

  it("loadPackage 能读取声明的 score.json", async () => {
    const source = memorySource({
      "manifest.json": manifestText,
      "content/score.json": scoreText,
    });
    const result = await loadPackage(source, knownSkillIds());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.pkg.files["content/score.json"]).toBe(scoreText);
    }
  });
});

describe("欢乐颂三档编配", () => {
  it("L2/L3/L4 全部通过内容 QA，且难度/技能符合编配意图", () => {
    const dirs = readdirSync(resolve("content"))
      .filter((name) => name.startsWith("song.ode-to-joy."))
      .sort();
    expect(dirs).toEqual([
      "song.ode-to-joy.l2",
      "song.ode-to-joy.l3",
      "song.ode-to-joy.l4",
    ]);

    const rows = dirs.map((dir) => {
      const manifestResult = parseManifest(
        readFileSync(resolve("content", dir, "manifest.json"), "utf8"),
        knownSkillIds(),
      );
      expect(manifestResult.ok).toBe(true);
      const manifest = manifestResult.manifest!;
      const score = JSON.parse(
        readFileSync(resolve("content", dir, "content/score.json"), "utf8"),
      ) as Score;

      expect(validateSongContent(score, manifest).errors).toEqual([]);
      const rated = rateScore(score, {
        repeat: manifest.difficulty?.repeat,
        measures: manifest.difficulty?.len,
      });
      expect(rated.level).toBe(manifest.difficulty!.level);
      return { manifest, score, required: requiredSkillsForScore(score) };
    });

    expect(rows.map((row) => row.manifest.difficulty!.level)).toEqual([2, 3, 4]);
    expect(rows.every((row) => row.manifest.songId === "song.ode-to-joy")).toBe(true);
    expect(new Set(rows.map((row) => row.manifest.arrangementId)).size).toBe(3);

    expect(rows[0].required.has("pos.shift")).toBe(false);
    expect(rows[1].required.has("pos.shift")).toBe(true);
    expect(rows[1].required.has("chord.triad")).toBe(true);
    expect(rows[2].required.has("texture.broken")).toBe(true);
  });
});
