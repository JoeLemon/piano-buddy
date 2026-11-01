import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { Score } from "../src/domain/types";
import {
  checksumPayload,
  MAX_ASSET_BYTES,
  knownSkillIds,
  loadPackage,
  memorySource,
  parseManifest,
  validateManifest,
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

  it("反复段落写不闭合时内容 QA 直接报错", () => {
    const manifest = parseManifest(manifestText, knownSkillIds()).manifest!;
    const broken: Score = { ...score, repeats: [{ from: 0, to: 99 }] };
    const result = validateSongContent(broken, manifest);
    expect(result.ok).toBe(false);
    expect(result.errors.some((text) => text.includes("超出全曲"))).toBe(true);
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

/** 一个字段齐全的最小 song manifest；各用例在此基础上增删字段。 */
const BASE_MANIFEST = {
  schemaVersion: 1,
  id: "pkg.test",
  name: "测试包",
  type: "song",
  version: "1.0.0",
  songId: "song.test",
  arrangementId: "arr.test",
  songTitle: "测试曲目",
  skillDeps: [] as string[],
  assets: ["content/score.json"],
};

describe("数据包校验加固", () => {
  it("未知顶层字段给警告而不是报错", () => {
    const result = validateManifest({ ...BASE_MANIFEST, bpm: 120 }, knownSkillIds());
    expect(result.ok).toBe(true);
    expect(result.warnings.some((w) => w.includes("未知字段") && w.includes("bpm"))).toBe(true);
  });

  it("difficulty / rights 里的未知字段也逐层点名", () => {
    const difficulty = validateManifest(
      { ...BASE_MANIFEST, difficulty: { level: 2, bpm: 80, tempo: 80 } },
      knownSkillIds(),
    );
    expect(difficulty.warnings.some((w) => w.includes("difficulty.tempo"))).toBe(true);

    const rights = validateManifest(
      { ...BASE_MANIFEST, rights: { type: "original", foo: "bar" } },
      knownSkillIds(),
    );
    expect(rights.warnings.some((w) => w.includes("rights.foo"))).toBe(true);
  });

  it("授权已过期给警告，未到期不提示", () => {
    const now = new Date("2026-10-28T00:00:00Z");
    const expired = validateManifest(
      { ...BASE_MANIFEST, rights: { type: "licensed", expiresAt: "2020-01-01" } },
      knownSkillIds(),
      { now },
    );
    expect(expired.ok).toBe(true);
    expect(expired.warnings.some((w) => w.includes("过期"))).toBe(true);

    const future = validateManifest(
      { ...BASE_MANIFEST, rights: { type: "licensed", expiresAt: "2030-01-01" } },
      knownSkillIds(),
      { now },
    );
    expect(future.warnings.some((w) => w.includes("过期"))).toBe(false);
  });

  it("非法日期是错误，不是警告", () => {
    const result = validateManifest(
      { ...BASE_MANIFEST, rights: { type: "licensed", expiresAt: "不是日期" } },
      knownSkillIds(),
    );
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("不是合法日期"))).toBe(true);
  });

  it("checksum 与资源一致时通过，被改动时报错", async () => {
    const payload = checksumPayload(["content/score.json"], { "content/score.json": scoreText });
    const digest = createHash("sha256").update(payload, "utf8").digest("hex");

    const okSource = memorySource({
      "manifest.json": JSON.stringify({ ...BASE_MANIFEST, checksum: `sha256:${digest}` }),
      "content/score.json": scoreText,
    });
    const ok = await loadPackage(okSource, knownSkillIds());
    expect(ok.ok).toBe(true);

    // 同一个 checksum，内容被替换：必须拒绝。
    const tampered = memorySource({
      "manifest.json": JSON.stringify({ ...BASE_MANIFEST, checksum: `sha256:${digest}` }),
      "content/score.json": scoreText + " ",
    });
    const bad = await loadPackage(tampered, knownSkillIds());
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.errors.some((e) => e.includes("checksum 不匹配"))).toBe(true);
  });

  it("资源超出单文件上限时拒绝加载", async () => {
    const oversized = "x".repeat(MAX_ASSET_BYTES + 1);
    const source = memorySource({
      "manifest.json": JSON.stringify(BASE_MANIFEST),
      "content/score.json": oversized,
    });
    const result = await loadPackage(source, knownSkillIds());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((e) => e.includes("单文件上限"))).toBe(true);
  });

  it("manifest 警告（如未知字段）透传到加载结果", async () => {
    const source = memorySource({
      "manifest.json": JSON.stringify({ ...BASE_MANIFEST, unknownField: 1 }),
      "content/score.json": scoreText,
    });
    const result = await loadPackage(source, knownSkillIds());
    expect(result.ok).toBe(true);
    expect(result.warnings.some((w) => w.includes("未知字段"))).toBe(true);
  });
});
