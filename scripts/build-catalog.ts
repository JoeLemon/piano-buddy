import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Score } from "../src/domain/types";
import {
  buildCatalog,
  knownSkillIds,
  parseManifest,
  rateScore,
  type CatalogSource,
} from "../src/repertoire";
import { validateSongContent } from "../src/repertoire/contentValidation";

/**
 * 从 content 下各包的 manifest.json + score.json 生成曲库目录。
 *
 * 用法：
 *   npm run build:catalog
 *   npm run build:catalog -- content content/catalog.json
 *
 * 生成前会先跑 manifest 与内容 QA；任何 error 都不会写 catalog，
 * 避免把坏包带进曲目列表。
 */
const root = resolve(process.argv[2] ?? "content");
const outPath = resolve(process.argv[3] ?? join(root, "catalog.json"));
const skills = knownSkillIds();

function hasManifest(dir: string): boolean {
  try {
    return statSync(join(dir, "manifest.json")).isFile();
  } catch {
    return false;
  }
}

function packageDirs(dir: string): string[] {
  const out: string[] = [];
  if (hasManifest(dir)) out.push(dir);
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    try {
      if (statSync(path).isDirectory() && hasManifest(path)) out.push(path);
    } catch {
      // 忽略不可读项
    }
  }
  return out;
}

const sources: CatalogSource[] = [];
const errors: string[] = [];
let skipped = 0;

for (const dir of packageDirs(root)) {
  const manifestPath = join(dir, "manifest.json");
  const manifestResult = parseManifest(readFileSync(manifestPath, "utf8"), skills);
  if (!manifestResult.ok) {
    errors.push(`${dir}：manifest 校验失败`);
    errors.push(...manifestResult.errors.map((error) => `  ${error}`));
    continue;
  }

  const manifest = manifestResult.manifest!;
  if (manifest.type !== "song") {
    skipped += 1;
    continue;
  }

  const scoreAsset =
    manifest.assets.find((asset) => asset === "score.json" || asset.endsWith("/score.json")) ??
    manifest.assets.find((asset) => asset.endsWith(".json"));
  if (!scoreAsset) {
    errors.push(`${manifest.id}：没有 JSON 乐谱资源`);
    continue;
  }

  let score: Score;
  try {
    score = JSON.parse(readFileSync(join(dir, scoreAsset), "utf8")) as Score;
  } catch (error) {
    errors.push(`${manifest.id}：读取 ${scoreAsset} 失败：${(error as Error).message}`);
    continue;
  }

  const content = validateSongContent(score, manifest);
  if (content.errors.length > 0) {
    errors.push(`${manifest.id}：内容 QA 失败`);
    errors.push(...content.errors.map((error) => `  ${error}`));
    continue;
  }
  for (const warning of content.warnings) {
    console.warn(`! ${manifest.id}：${warning}`);
  }

  const difficulty = rateScore(score, {
    repeat: manifest.difficulty?.repeat,
    measures: manifest.difficulty?.len,
  });
  sources.push({ manifest, score, difficulty });
}

if (errors.length > 0) {
  console.error("生成 catalog 失败：");
  for (const error of errors) console.error(error);
  process.exitCode = 1;
} else {
  const result = buildCatalog(sources);
  if (!result.ok || !result.catalog) {
    console.error("生成 catalog 失败：");
    for (const error of result.errors) console.error(error);
    process.exitCode = 1;
  } else {
    writeFileSync(outPath, `${JSON.stringify(result.catalog, null, 2)}\n`, "utf8");
    const arrangements = result.catalog.songs.reduce(
      (sum, song) => sum + song.arrangements.length,
      0,
    );
    console.log(
      `已生成 ${outPath}：${result.catalog.songs.length} 首歌曲，${arrangements} 个编配` +
        (skipped > 0 ? `，跳过 ${skipped} 个非 song 包` : ""),
    );
  }
}
