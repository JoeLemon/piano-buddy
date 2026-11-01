import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { Catalog, CatalogArrangement, CatalogSong } from "../src/repertoire";
import {
  catalogFromInstalled,
  mergeCatalogs,
  scoreFromPackage,
} from "../src/repertoire";
import type { LoadedPackage, PackageManifest } from "../src/repertoire/package";

const packageDir = resolve("content/song.ode-to-joy.l2");
const manifest = JSON.parse(
  readFileSync(resolve(packageDir, "manifest.json"), "utf8"),
) as PackageManifest;
const scoreText = readFileSync(resolve(packageDir, "content/score.json"), "utf8");

function pkg(overrides: Partial<PackageManifest> = {}): LoadedPackage {
  return {
    manifest: { ...manifest, ...overrides },
    files: { "content/score.json": scoreText },
  };
}

function arrangement(overrides: Partial<CatalogArrangement> = {}): CatalogArrangement {
  return {
    arrangementId: "arr.a",
    packageId: "pkg.a",
    name: "A 编配",
    level: 2,
    label: "L2",
    bpm: 80,
    measures: 8,
    skillDeps: [],
    ...overrides,
  };
}

function song(overrides: Partial<CatalogSong> = {}): CatalogSong {
  return {
    songId: "song.a",
    title: "A 曲",
    arrangements: [arrangement()],
    ...overrides,
  };
}

describe("已安装包读取谱面", () => {
  it("从 content/score.json 或根目录 score.json 读取", () => {
    expect(scoreFromPackage(pkg())?.mode).toBe("repertoire");
    expect(
      scoreFromPackage({
        manifest: { ...manifest, assets: ["score.json"] },
        files: { "score.json": scoreText },
      })?.mode,
    ).toBe("repertoire");
  });

  it("没有 score.json 或内容坏掉时返回 null", () => {
    expect(scoreFromPackage({ manifest: { ...manifest, assets: ["content/other.json"] }, files: {} }))
      .toBeNull();
    expect(
      scoreFromPackage({
        manifest: { ...manifest, assets: ["content/score.json"] },
        files: { "content/score.json": "{ broken" },
      }),
    ).toBeNull();
  });
});

describe("外部包聚合目录", () => {
  it("把 song 包聚合成 catalog，并采用引擎评级", () => {
    const result = catalogFromInstalled([pkg()]);
    expect(result.ok).toBe(true);
    const catalog = result.catalog!;
    expect(catalog.songs).toHaveLength(1);
    expect(catalog.songs[0]!.songId).toBe("song.ode-to-joy");
    expect(catalog.songs[0]!.arrangements[0]).toMatchObject({
      arrangementId: "arr.ode-to-joy.simple",
      packageId: "pkg.ode-to-joy.simple",
      level: 2,
    });
  });

  it("非 song 包只留在包管理列表，不进入曲库", () => {
    const result = catalogFromInstalled([pkg({ type: "practice" })]);
    expect(result.ok).toBe(true);
    expect(result.catalog?.songs).toEqual([]);
  });

  it("song 包缺少可读谱面时报告错误", () => {
    const result = catalogFromInstalled([
      { manifest: { ...manifest, id: "pkg.broken" }, files: {} },
    ]);
    expect(result.ok).toBe(false);
    expect(result.errors.some((text) => text.includes("pkg.broken") && text.includes("score.json")))
      .toBe(true);
  });

  it("score.json 结构坏掉时报告错误而不是让曲库页崩溃", () => {
    const result = catalogFromInstalled([
      {
        manifest: { ...manifest, id: "pkg.bad-score" },
        files: { "content/score.json": "{}" },
      },
    ]);
    expect(result.ok).toBe(false);
    expect(
      result.errors.some((text) => text.includes("pkg.bad-score") && text.includes("不是可读的谱面")),
    ).toBe(true);
    expect(result.catalog?.songs).toEqual([]);
  });
});

describe("内置目录与外部目录合并", () => {
  it("同 arrangementId 由已安装版本覆盖，不出现重复编配", () => {
    const base: Catalog = {
      version: 1,
      songs: [song({ arrangements: [arrangement({ name: "内置" }), arrangement({ arrangementId: "arr.b", packageId: "pkg.b", name: "B" })] })],
    };
    const extra: Catalog = {
      version: 1,
      songs: [song({ arrangements: [arrangement({ name: "已安装" })] })],
    };

    const merged = mergeCatalogs(base, extra);
    expect(merged.songs).toHaveLength(1);
    expect(merged.songs[0]!.arrangements).toHaveLength(2);
    expect(merged.songs[0]!.arrangements[0]!.name).toBe("已安装");
    expect(merged.songs[0]!.arrangements[1]!.name).toBe("B");
  });

  it("同 packageId 换了 arrangementId 也算升级，旧条目被替换", () => {
    const base: Catalog = {
      version: 1,
      songs: [song({ arrangements: [arrangement({ arrangementId: "arr.old", packageId: "pkg.a", name: "旧版" })] })],
    };
    const extra: Catalog = {
      version: 1,
      songs: [
        song({
          arrangements: [
            arrangement({ arrangementId: "arr.new", packageId: "pkg.a", name: "新版", level: 3 }),
          ],
        }),
      ],
    };

    const merged = mergeCatalogs(base, extra);
    expect(merged.songs[0]!.arrangements).toHaveLength(1);
    expect(merged.songs[0]!.arrangements[0]).toMatchObject({
      arrangementId: "arr.new",
      name: "新版",
      level: 3,
    });
  });

  it("新歌追加进来，并按标题与难度稳定排序", () => {
    const base: Catalog = {
      version: 1,
      songs: [song({ songId: "song.z", title: "Z 曲" })],
    };
    const extra: Catalog = {
      version: 1,
      songs: [
        song({
          songId: "song.b",
          title: "B 曲",
          composer: "外部作者",
          arrangements: [
            arrangement({ arrangementId: "arr.b3", packageId: "pkg.b3", level: 3 }),
            arrangement({ arrangementId: "arr.b2", packageId: "pkg.b2", level: 2 }),
          ],
        }),
      ],
    };

    const merged = mergeCatalogs(base, extra);
    expect(merged.songs.map((item) => item.songId)).toEqual(["song.b", "song.z"]);
    expect(merged.songs[0]!.composer).toBe("外部作者");
    expect(merged.songs[0]!.arrangements.map((item) => item.level)).toEqual([2, 3]);
  });

  it("同歌新编配补上 composer，原有标题不变", () => {
    const base: Catalog = { version: 1, songs: [song({ title: "A 曲" })] };
    const extra: Catalog = {
      version: 1,
      songs: [song({ composer: "作者", arrangements: [arrangement({ arrangementId: "arr.c", packageId: "pkg.c" })] })],
    };

    const merged = mergeCatalogs(base, extra);
    expect(merged.songs[0]!.title).toBe("A 曲");
    expect(merged.songs[0]!.composer).toBe("作者");
    expect(merged.songs[0]!.arrangements).toHaveLength(2);
  });
});
