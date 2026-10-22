import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Score } from "../src/domain/types";
import { knownSkillIds, parseManifest } from "../src/repertoire";
import { validateSongContent } from "../src/repertoire/contentValidation";

/**
 * 曲目包内容 QA CLI。
 *
 * 用法：
 *   npm run validate:content
 *   npm run validate:content -- content/song.ode-to-joy.l2
 *
 * 检查 manifest 结构 + 曲目内容（词汇表/难度/技能声明/指法/bpm）。
 * 作者不需要写测试就能在提交前发现 finger=0、低评、越界资源等问题。
 */
const root = resolve(process.argv[2] ?? "content");
const skills = knownSkillIds();

function hasManifest(dir: string): boolean {
  try {
    return statSync(join(dir, "manifest.json")).isFile();
  } catch {
    return false;
  }
}

/** 支持传 content 根目录（扫描子包），也支持直接传单个包目录。 */
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

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"));
}

let failures = 0;
let packages = 0;
let warnings = 0;

for (const dir of packageDirs(root)) {
  const manifestPath = join(dir, "manifest.json");
  try {
    statSync(manifestPath);
  } catch {
    continue;
  }

  packages += 1;
  const manifestResult = parseManifest(readFileSync(manifestPath, "utf8"), skills);
  if (!manifestResult.ok) {
    failures += 1;
    console.error(`\n✗ ${dir}`);
    for (const error of manifestResult.errors) console.error(`  manifest: ${error}`);
    continue;
  }

  const manifest = manifestResult.manifest!;
  console.log(`\n● ${manifest.id} (${manifest.name})`);

  if (manifest.type !== "song") {
    console.log("  - 非 song 包，跳过内容 QA");
    continue;
  }

  const scoreAsset =
    manifest.assets.find((asset) => asset === "score.json" || asset.endsWith("/score.json")) ??
    manifest.assets.find((asset) => asset.endsWith(".json"));
  if (!scoreAsset) {
    failures += 1;
    console.error("  ✗ 没有 JSON 乐谱资源");
    continue;
  }

  let score: Score;
  try {
    score = readJson(join(dir, scoreAsset)) as Score;
  } catch (error) {
    failures += 1;
    console.error(`  ✗ 读取 ${scoreAsset} 失败：${(error as Error).message}`);
    continue;
  }

  const result = validateSongContent(score, manifest);
  if (result.errors.length > 0) {
    failures += 1;
    for (const error of result.errors) console.error(`  ✗ ${error}`);
  }
  if (result.warnings.length > 0) {
    warnings += result.warnings.length;
    for (const warning of result.warnings) console.warn(`  ! ${warning}`);
  }
  if (result.ok) console.log("  ✓ 内容 QA 通过");
}

if (packages === 0) {
  console.error(`没有在 ${root} 找到任何曲目包（需要 manifest.json）`);
  process.exitCode = 1;
} else {
  console.log(`\n检查 ${packages} 个包：${failures} 个失败，${warnings} 条警告`);
  if (failures > 0) process.exitCode = 1;
}
