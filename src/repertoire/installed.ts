import type { Score } from "../domain/types";
import {
  buildCatalog,
  type Catalog,
  type CatalogArrangement,
  type CatalogBuildOptions,
  type CatalogBuildResult,
  type CatalogSong,
  type CatalogSource,
} from "./catalog";
import { rateScore } from "./difficulty";
import type { LoadedPackage } from "./package";

/**
 * ── 已安装的外部包 ───────────────────────────────────────────
 * 内置曲库在构建时由 `content/catalog.json` 聚合；外部包在运行时安装，
 * 因此要单独生成一份 catalog，再和内置目录合并。
 *
 * 合并规则：同一 `arrangementId` 或 `packageId` 以已安装版本为准，
 * 这样包升级时不会在曲库里出现两条同名编配；其他编配按难度重新排序。
 */

export interface InstalledPackage extends LoadedPackage {
  installedAt: number;
}

/** 从包资源里找 score.json（允许 content/score.json 或 score.json）。 */
export function scoreFromPackage(pkg: LoadedPackage): Score | null {
  const asset = pkg.manifest.assets.find(
    (path) => path === "score.json" || path.endsWith("/score.json"),
  );
  if (!asset) return null;
  try {
    return JSON.parse(pkg.files[asset] ?? "") as Score;
  } catch {
    return null;
  }
}

function sortArrangements(arrangements: CatalogArrangement[]): CatalogArrangement[] {
  return arrangements.sort(
    (a, b) => a.level - b.level || a.arrangementId.localeCompare(b.arrangementId),
  );
}

function sortSongs(songs: CatalogSong[]): CatalogSong[] {
  return songs.sort(
    (a, b) => a.title.localeCompare(b.title, "zh-CN") || a.songId.localeCompare(b.songId),
  );
}

/** 把已安装的 song 包聚合成一份 catalog；非 song 包只出现在包管理列表里。 */
export function catalogFromInstalled(
  packages: readonly LoadedPackage[],
  options: CatalogBuildOptions = {},
): CatalogBuildResult {
  const sources: CatalogSource[] = [];
  const errors: string[] = [];
  const warnings: string[] = [];

  for (const pkg of packages) {
    if (pkg.manifest.type !== "song") continue;
    const score = scoreFromPackage(pkg);
    if (!score) {
      errors.push(`${pkg.manifest.id}：缺少可读取的 score.json`);
      continue;
    }
    let difficulty;
    try {
      difficulty = rateScore(score, {
        repeat: pkg.manifest.difficulty?.repeat,
        measures: pkg.manifest.difficulty?.len,
      });
    } catch (error) {
      // score.json 是 JSON 不等于它是谱面；坏结构不能把整个曲库页带崩。
      errors.push(
        `${pkg.manifest.id}：score.json 不是可读的谱面（${(error as Error).message}）`,
      );
      continue;
    }
    sources.push({ manifest: pkg.manifest, score, difficulty });
  }

  const built = buildCatalog(sources, options);
  return {
    ...built,
    ok: built.ok && errors.length === 0,
    errors: [...errors, ...built.errors],
    warnings: [...warnings, ...built.warnings],
  };
}

/** 合并内置目录与外部目录；外部包覆盖同 arrangementId / packageId 的条目。 */
export function mergeCatalogs(base: Catalog, extra: Catalog): Catalog {
  const songs = new Map<string, CatalogSong>();
  for (const song of base.songs) {
    songs.set(song.songId, { ...song, arrangements: [...song.arrangements] });
  }

  for (const song of extra.songs) {
    const target = songs.get(song.songId);
    if (!target) {
      songs.set(song.songId, {
        ...song,
        arrangements: sortArrangements([...song.arrangements]),
      });
      continue;
    }
    if (!target.composer && song.composer) target.composer = song.composer;
    for (const arrangement of song.arrangements) {
      const index = target.arrangements.findIndex(
        (item) =>
          item.arrangementId === arrangement.arrangementId ||
          item.packageId === arrangement.packageId,
      );
      if (index >= 0) target.arrangements[index] = arrangement;
      else target.arrangements.push(arrangement);
    }
    target.arrangements = sortArrangements(target.arrangements);
  }

  return { version: 1, songs: sortSongs([...songs.values()]) };
}
