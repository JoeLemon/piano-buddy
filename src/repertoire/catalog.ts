import type { Score } from "../domain/types";
import type { Difficulty } from "./difficulty";
import type { PackageManifest, PackageRights } from "./package";
import { requiredSkillsForScore } from "./skillGraph";

/**
 * ── 曲库目录 ─────────────────────────────────────────────────
 * catalog 是曲目列表的稳定索引，不靠扫描目录顺序或包名猜难度。
 * 它由每个 song 包的 manifest + 乐谱评级聚合生成；构建脚本写
 * content/catalog.json，App 只读目录，不直接遍历安装目录。
 *
 * 约定：
 * - 一个 songId 下可以有多个 arrangement（L2/L3/L4…）；
 * - catalog 的 level 用引擎评级，不直接采用作者声明；
 * - 超纲（7）包不进目录，避免把当前词汇表弹不了的曲子展示给用户。
 */

export interface CatalogArrangement {
  arrangementId: string;
  packageId: string;
  name: string;
  /** 引擎评级 1..6；7 超纲，不应出现在 catalog */
  level: number;
  /** 体感标签，如 L2 / L3+ */
  label: string;
  bpm: number;
  /** 小节数，不是秒 */
  measures: number;
  skillDeps: string[];
  rights?: PackageRights;
}

export interface CatalogSong {
  songId: string;
  title: string;
  composer?: string;
  arrangements: CatalogArrangement[];
}

export interface Catalog {
  version: 1;
  songs: CatalogSong[];
}

export interface CatalogSource {
  manifest: PackageManifest;
  score: Score;
  /** 引擎评级结果；由构建脚本用 rateScore 计算后传入 */
  difficulty: Difficulty;
}

export interface CatalogBuildResult {
  ok: boolean;
  errors: string[];
  catalog?: Catalog;
}

function countMeasures(score: Score): number {
  let max = 0;
  for (const hand of score.hands) {
    const stave = score.staves[hand];
    if (stave) max = Math.max(max, stave.measures.length);
  }
  return max;
}

/**
 * 把多个已校验的 song 包聚合成 catalog。纯函数，不读文件系统；
 * 构建脚本和测试共用同一套规则。
 */
export function buildCatalog(sources: CatalogSource[]): CatalogBuildResult {
  const errors: string[] = [];
  const packageIds = new Set<string>();
  const arrangementIds = new Set<string>();
  const songs = new Map<
    string,
    { title: string; composer?: string; arrangements: CatalogArrangement[] }
  >();

  for (const { manifest, score, difficulty } of sources) {
    const label = manifest.id || "(缺 id)";
    if (manifest.type !== "song") {
      errors.push(`${label}：只有 song 包能进入曲库`);
      continue;
    }
    if (!manifest.songId) {
      errors.push(`${label}：缺少 songId，无法归入歌曲`);
      continue;
    }
    if (!manifest.arrangementId) {
      errors.push(`${label}：缺少 arrangementId，无法区分编配`);
      continue;
    }
    if (!manifest.songTitle) {
      errors.push(`${label}：缺少 songTitle，曲库没有可展示的歌曲名`);
      continue;
    }
    if (difficulty.level >= 7) {
      errors.push(`${label}：超纲（level 7），当前词汇表不能上架`);
      continue;
    }
    if (packageIds.has(manifest.id)) {
      errors.push(`${label}：packageId 重复`);
      continue;
    }
    if (arrangementIds.has(manifest.arrangementId)) {
      errors.push(`${label}：arrangementId 重复：${manifest.arrangementId}`);
      continue;
    }
    packageIds.add(manifest.id);
    arrangementIds.add(manifest.arrangementId);

    let song = songs.get(manifest.songId);
    if (!song) {
      song = {
        title: manifest.songTitle,
        composer: manifest.composer,
        arrangements: [],
      };
      songs.set(manifest.songId, song);
    } else {
      if (song.title !== manifest.songTitle) {
        errors.push(
          `${label}：同一 songId 的 songTitle 不一致（${song.title} / ${manifest.songTitle}）`,
        );
        continue;
      }
      if (manifest.composer && song.composer && song.composer !== manifest.composer) {
        errors.push(
          `${label}：同一 songId 的 composer 不一致（${song.composer} / ${manifest.composer}）`,
        );
        continue;
      }
      if (!song.composer && manifest.composer) song.composer = manifest.composer;
    }

    song.arrangements.push({
      arrangementId: manifest.arrangementId,
      packageId: manifest.id,
      name: manifest.name,
      level: difficulty.level,
      label: difficulty.label,
      bpm: difficulty.bpm,
      measures: countMeasures(score),
      skillDeps: [...requiredSkillsForScore(score)].sort(),
      rights: manifest.rights ? { ...manifest.rights } : undefined,
    });
  }

  if (errors.length > 0) return { ok: false, errors };

  const catalog: Catalog = {
    version: 1,
    songs: [...songs.entries()]
      .map(([songId, song]) => ({
        songId,
        title: song.title,
        composer: song.composer,
        arrangements: song.arrangements.sort(
          (a, b) => a.level - b.level || a.arrangementId.localeCompare(b.arrangementId),
        ),
      }))
      .sort(
        (a, b) =>
          a.title.localeCompare(b.title, "zh-CN") || a.songId.localeCompare(b.songId),
      ),
  };

  return { ok: true, errors: [], catalog };
}
