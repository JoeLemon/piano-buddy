import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { Score } from "../src/domain/types";
import {
  buildCatalog,
  knownSkillIds,
  parseManifest,
  rateScore,
  type CatalogSource,
} from "../src/repertoire";
import { validateSongContent } from "../src/repertoire/contentValidation";

function loadSources(): CatalogSource[] {
  const skills = knownSkillIds();
  return readdirSync(resolve("content"))
    .filter((name) => name.startsWith("song."))
    .sort()
    .map((dir) => {
      const manifestResult = parseManifest(
        readFileSync(resolve("content", dir, "manifest.json"), "utf8"),
        skills,
      );
      expect(manifestResult.ok).toBe(true);
      const manifest = manifestResult.manifest!;
      expect(manifest.type).toBe("song");

      const scoreAsset =
        manifest.assets.find(
          (asset) => asset === "score.json" || asset.endsWith("/score.json"),
        ) ?? manifest.assets.find((asset) => asset.endsWith(".json"));
      expect(scoreAsset).toBeTruthy();
      const score = JSON.parse(
        readFileSync(resolve("content", dir, scoreAsset!), "utf8"),
      ) as Score;
      expect(validateSongContent(score, manifest).errors).toEqual([]);

      return {
        manifest,
        score,
        difficulty: rateScore(score, {
          repeat: manifest.difficulty?.repeat,
          measures: manifest.difficulty?.len,
        }),
      };
    });
}

describe("曲库目录", () => {
  it("catalog.json 与当前包聚合结果一致", () => {
    const result = buildCatalog(loadSources());
    expect(result.ok).toBe(true);

    const onDisk = JSON.parse(readFileSync(resolve("content/catalog.json"), "utf8"));
    expect(onDisk).toEqual(result.catalog);
  });

  it("按 songId 聚合编配，并用引擎评级排序", () => {
    const catalog = buildCatalog(loadSources()).catalog!;
    expect(catalog.version).toBe(1);
    // 歌曲按标题排序；新加曲子不该打乱「同一首歌多个编配」的聚合断言。
    expect(catalog.songs.map((song) => song.songId)).toEqual([
      "song.morning-song",
      "song.ode-to-joy",
    ]);

    const song = catalog.songs.find((item) => item.songId === "song.ode-to-joy")!;
    expect(song.title).toBe("欢乐颂");
    expect(song.composer).toBe("Ludwig van Beethoven");
    expect(song.arrangements.map((arrangement) => arrangement.level)).toEqual([2, 3, 4]);
    expect(song.arrangements.map((arrangement) => arrangement.arrangementId)).toEqual([
      "arr.ode-to-joy.simple",
      "arr.ode-to-joy.standard",
      "arr.ode-to-joy.full",
    ]);
    expect(song.arrangements[0].rights?.type).toBe("public-domain");
    expect(song.arrangements[1].skillDeps).toContain("chord.triad");
    expect(song.arrangements[2].skillDeps).toContain("texture.broken");

    // 《晨歌》是原创的弱起 + 延音示范曲，评级从谱面算出来是 L5。
    const morning = catalog.songs.find((item) => item.songId === "song.morning-song")!;
    expect(morning.arrangements).toHaveLength(1);
    expect(morning.arrangements[0].level).toBe(5);
    expect(morning.arrangements[0].rights?.type).toBe("original");
  });

  it("拒绝缺 songTitle、超纲和重复 arrangementId 的包", () => {
    const sources = loadSources();
    const first = sources[0];

    const noTitle = buildCatalog([
      { ...first, manifest: { ...first.manifest, songTitle: undefined } },
    ]);
    expect(noTitle.ok).toBe(false);
    expect(noTitle.errors.some((error) => error.includes("songTitle"))).toBe(true);

    const outOfScope = buildCatalog([
      { ...first, difficulty: { ...first.difficulty, level: 7, label: "超纲" } },
    ]);
    expect(outOfScope.ok).toBe(false);
    expect(outOfScope.errors.some((error) => error.includes("超纲"))).toBe(true);

    const duplicate = buildCatalog([
      first,
      { ...sources[1], manifest: { ...sources[1].manifest, arrangementId: first.manifest.arrangementId } },
    ]);
    expect(duplicate.ok).toBe(false);
    expect(duplicate.errors.some((error) => error.includes("arrangementId 重复"))).toBe(true);
  });

  it("授权到期的编配不进目录，并留下下架警告", () => {
    const sources = loadSources();
    const expired = {
      ...sources[0],
      manifest: {
        ...sources[0].manifest,
        rights: { type: "licensed" as const, expiresAt: "2020-01-01" },
      },
    };

    const afterExpiry = buildCatalog([expired], { now: new Date("2026-10-28T00:00:00Z") });
    expect(afterExpiry.ok).toBe(true);
    expect(afterExpiry.catalog?.songs).toHaveLength(0);
    expect(afterExpiry.warnings.some((warning) => warning.includes("到期"))).toBe(true);

    // 授权期内照常上架。
    const beforeExpiry = buildCatalog([expired], { now: new Date("2019-01-01T00:00:00Z") });
    expect(beforeExpiry.ok).toBe(true);
    expect(beforeExpiry.catalog?.songs).toHaveLength(1);
  });
});
