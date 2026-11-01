import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";
import { annotateScore } from "../src/domain/fingering";
import type { Score } from "../src/domain/types";
import { knownSkillIds, parseManifest } from "../src/repertoire";
import { validateSongContent } from "../src/repertoire/contentValidation";
import { reviewImportedScore, type ImportReview } from "../src/repertoire/importReview";
import { importMusicXml } from "../src/repertoire/musicxml";
import {
  buildBatchManifest,
  isPlainObject,
  renderRatingTable,
  slugifyFile,
  titleFromFile,
  type BatchManifestContext,
  type RatingRow,
} from "./lib/import-batch";

/**
 * 目录批量导入 MusicXML（作者工具）。
 *
 * 用法：
 *   npm run import:batch -- path/to/musicxml/
 *   npm run import:batch -- path/to/musicxml/ --out content --template content/import-template.json
 *   npm run import:batch -- path/to/musicxml/ --dry-run --json --report tmp/import-report.json
 *
 * 和单文件 `import:musicxml` 的区别：
 *  - 一次扫描目录（可递归），每首生成 `<out>/<slug>/manifest.json + content/score.json`；
 *  - 输出「按音高 / 按指法 / 差 / 未补指法」评级差异表；
 *  - 差 ≥2 档或仍有音没补上指法时，`--strict` 直接失败，适合 CI/批量收稿；
 *  - `--json` / `--report` 给自动化流水线留机器可读结果。
 */

type Args = {
  input?: string;
  out: string;
  template?: string;
  idPrefix: string;
  level?: number;
  bpm?: number;
  voice?: number;
  fingers: boolean;
  dryRun: boolean;
  force: boolean;
  json: boolean;
  report?: string;
  strict: boolean;
};

const USAGE = `用法：npm run import:batch -- <目录或 .musicxml> [选项]

  --out <dir>            输出根目录，默认 content
  --template <path>      manifest 模板（JSON，支持 {{slug}} / {{title}} / {{level}} 等占位符）
  --id-prefix <prefix>   包 id 前缀，默认 pkg
  --level <1..6>         覆盖所有文件的声明档；默认取按音高/按指法的较大值
  --bpm <n>              覆盖文件里的 tempo
  --voice <n>            一行谱多声部时保留第 n 个声部
  --no-fingers           不补指法（只做转换与评级）
  --dry-run              只输出报告，不写 manifest/score
  --force                覆盖已存在的包目录
  --strict               差 ≥2 档或仍有音没补上指法时返回非 0
  --json                 以 JSON 输出报告（人类日志走 stderr）
  --report <path>        另存 JSON 报告
  --help                 显示本帮助

模板占位符：
  {{slug}} {{title}} {{file}} {{id}} {{songId}} {{arrangementId}}
  {{level}} {{pitchLevel}} {{fingerLevel}} {{pitchLabel}} {{fingerLabel}}
  {{bpm}} {{measures}} {{skills}}
  整个字符串正好是一个占位符时保留类型，所以 "level": "{{level}}" 会变成数字，
  "skillDeps": ["{{skills}}"] 会摊平成技能数组。`;

const IGNORED_DIRS = new Set([".git", "node_modules", "dist", "coverage", ".vite", "shots"]);

function readNumber(raw: string | undefined, flag: string): number {
  const value = Number(raw);
  if (raw === undefined || !Number.isFinite(value)) {
    console.error(`${flag} 需要一个数字，收到 ${raw ?? "（空）"}`);
    process.exit(1);
  }
  return value;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    out: "content",
    idPrefix: "pkg",
    fingers: true,
    dryRun: false,
    force: false,
    json: false,
    strict: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    switch (token) {
      case "--out":
        args.out = argv[++i] ?? args.out;
        break;
      case "--template":
        args.template = argv[++i];
        break;
      case "--id-prefix":
        args.idPrefix = argv[++i] ?? args.idPrefix;
        break;
      case "--level":
        args.level = readNumber(argv[++i], "--level");
        break;
      case "--bpm":
        args.bpm = readNumber(argv[++i], "--bpm");
        break;
      case "--voice":
        args.voice = readNumber(argv[++i], "--voice");
        break;
      case "--no-fingers":
        args.fingers = false;
        break;
      case "--dry-run":
        args.dryRun = true;
        break;
      case "--force":
        args.force = true;
        break;
      case "--strict":
        args.strict = true;
        break;
      case "--json":
        args.json = true;
        break;
      case "--report":
        args.report = argv[++i];
        break;
      case "--help":
      case "-h":
        console.log(USAGE);
        process.exit(0);
        break;
      default:
        if (token.startsWith("--")) {
          console.error(`未知选项 ${token}\n\n${USAGE}`);
          process.exit(1);
        }
        if (args.input) {
          console.error(`只能指定一个输入，已经收到 ${args.input}，又收到 ${token}`);
          process.exit(1);
        }
        args.input = token;
    }
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
if (!args.input) {
  console.error(USAGE);
  process.exit(1);
}
if (args.level !== undefined && (args.level < 1 || args.level > 6)) {
  console.error(`--level 只能是 1..6，收到 ${args.level}`);
  process.exit(1);
}

const inputPath = resolve(args.input);
let inputStats;
try {
  inputStats = statSync(inputPath);
} catch (error) {
  console.error(`读不了 ${args.input}：${(error as Error).message}`);
  process.exit(1);
}
const inputRoot = inputStats.isDirectory() ? inputPath : dirname(inputPath);
const outRoot = resolve(args.out);
const skills = knownSkillIds();

let template: unknown = null;
if (args.template) {
  try {
    template = JSON.parse(readFileSync(resolve(args.template), "utf8"));
  } catch (error) {
    console.error(`读不了模板 ${args.template}：${(error as Error).message}`);
    process.exit(1);
  }
  if (!isPlainObject(template)) {
    console.error("模板必须是一个 JSON 对象");
    process.exit(1);
  }
}

type SkippedFile = { file: string; reason: string };
type FileResult = {
  file: string;
  slug: string;
  status: "written" | "written-with-errors" | "failed" | "skipped" | "dry-run";
  packageDir?: string;
  manifest?: unknown;
  measures?: number;
  pitch?: ImportReview["pitch"];
  fingered?: ImportReview["fingered"];
  delta?: number;
  unfingered?: number;
  required?: string[];
  addedSkills?: string[];
  removedSkills?: string[];
  positions?: { pitch: ImportReview["positionsPitch"]; fingered: ImportReview["positionsFingered"] };
  errors: string[];
  warnings: string[];
  strictFailures: string[];
};

function collectMusicXml(root: string): { files: string[]; skipped: SkippedFile[] } {
  const files: string[] = [];
  const skipped: SkippedFile[] = [];
  const visit = (path: string) => {
    const stats = statSync(path);
    if (stats.isDirectory()) {
      for (const name of readdirSync(path).sort()) {
        if (IGNORED_DIRS.has(name)) continue;
        visit(join(path, name));
      }
      return;
    }
    if (!stats.isFile()) return;
    const ext = extname(path).toLowerCase();
    if (ext === ".musicxml" || ext === ".xml") {
      files.push(path);
    } else if (ext === ".mxl") {
      skipped.push({
        file: displayFile(path),
        reason: ".mxl 是压缩包，请先在 MuseScore 里另存为未压缩的 .musicxml",
      });
    }
  };
  visit(root);
  return { files, skipped };
}

function displayFile(path: string): string {
  return relative(inputRoot, path).replace(/\\/g, "/") || path;
}

function log(message = ""): void {
  if (args.json) console.error(message);
  else console.log(message);
}

function warn(message: string): void {
  if (args.json) console.error(message);
  else console.log(message);
}

/** `--json` 走 stdout 时转成 ASCII 转义，避免 Windows 控制台/管道按 GBK 转码把 JSON 弄坏。 */
function asciiJson(value: unknown): string {
  return JSON.stringify(value, null, 2).replace(/[\u007f-\uffff]/g, (char) => {
    return `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`;
  });
}

const collected = collectMusicXml(inputPath);
if (collected.files.length === 0) {
  console.error(
    `没有在 ${args.input} 找到 .musicxml / .xml 文件` +
      (collected.skipped.length > 0 ? `（另有 ${collected.skipped.length} 个 .mxl 被跳过）` : ""),
  );
  process.exit(1);
}

const usedSlugs = new Set<string>();
function uniqueSlug(file: string, index: number): string {
  const base = slugifyFile(displayFile(file)) || `track-${String(index + 1).padStart(2, "0")}`;
  let slug = base;
  let suffix = 2;
  while (usedSlugs.has(slug)) {
    slug = `${base}-${suffix}`;
    suffix += 1;
  }
  usedSlugs.add(slug);
  return slug;
}

const results: FileResult[] = [];
const ratingRows: RatingRow[] = [];

log(`● 批量导入 ${collected.files.length} 个 MusicXML`);
log(`  输入：${relative(process.cwd(), inputPath) || inputPath}`);
log(`  输出：${relative(process.cwd(), outRoot) || outRoot}`);
log(`  指法：${args.fingers ? "自动补齐（需人工校对）" : "不补"}${args.dryRun ? " · 试运行" : ""}`);
for (const skippedFile of collected.skipped) {
  warn(`  ! 跳过 ${skippedFile.file}：${skippedFile.reason}`);
}
log("");

collected.files.forEach((file, index) => {
  const display = displayFile(file);
  const slug = uniqueSlug(file, index);
  const title = titleFromFile(display);
  const result: FileResult = {
    file: display,
    slug,
    status: "failed",
    errors: [],
    warnings: [],
    strictFailures: [],
  };
  results.push(result);

  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch (error) {
    result.errors.push(`读取失败：${(error as Error).message}`);
    ratingRows.push(failedRow(display, "读取失败"));
    return;
  }

  const imported = importMusicXml(text, {
    id: `score.${slug}`,
    bpm: args.bpm,
    level: args.level as Score["level"] | undefined,
    voice: args.voice,
  });
  result.warnings.push(...imported.warnings);
  if (!imported.ok || !imported.score) {
    result.errors.push(...(imported.errors.length > 0 ? imported.errors : ["导入失败"]));
    ratingRows.push(failedRow(display, "导入失败"));
    return;
  }

  const rawScore = imported.score;
  const fingeredScore = args.fingers ? annotateScore(rawScore) : rawScore;
  const review = reviewImportedScore(rawScore, fingeredScore);
  const declaredLevel = args.level ?? Math.max(review.pitch.level, review.fingered.level);
  result.measures = review.measures;
  result.pitch = review.pitch;
  result.fingered = review.fingered;
  result.delta = review.delta;
  result.unfingered = review.unfingered;
  result.required = review.requiredFingered;
  result.addedSkills = review.addedSkills;
  result.removedSkills = review.removedSkills;
  result.positions = { pitch: review.positionsPitch, fingered: review.positionsFingered };

  if (review.delta > 0) {
    result.warnings.push(
      `补指法后评级 ${review.pitch.label} → ${review.fingered.label}（+${review.delta} 档）`,
    );
  } else if (review.delta < 0) {
    result.warnings.push(
      `补指法后评级 ${review.pitch.label} → ${review.fingered.label}（${review.delta} 档）`,
    );
  }
  if (review.addedSkills.length > 0) {
    result.warnings.push(`指法引入技能：${review.addedSkills.join(", ")}`);
  }
  if (review.removedSkills.length > 0) {
    result.warnings.push(`指法后不再需要：${review.removedSkills.join(", ")}`);
  }
  if (review.unfingered > 0) {
    result.warnings.push(`${review.unfingered} 个音没有合法指法，demo 会因 finger=0 崩溃`);
  }
  if (review.delta >= 2) {
    result.strictFailures.push("补指法后评级抬高 ≥2 档，求解器可能误判手位");
  }
  if (review.unfingered > 0) {
    result.strictFailures.push("仍有音没有合法指法");
  }

  const context: BatchManifestContext = {
    slug,
    title,
    file: display,
    id: `${args.idPrefix}.${slug}`,
    songId: `song.${slug}`,
    arrangementId: `arr.${slug}.imported`,
    level: declaredLevel,
    pitchLevel: review.pitch.level,
    fingerLevel: review.fingered.level,
    pitchLabel: review.pitch.label,
    fingerLabel: review.fingered.label,
    bpm: fingeredScore.bpm,
    measures: review.measures,
    skills: review.requiredFingered,
  };
  const manifestObject = buildBatchManifest(template, context);
  const manifestResult = parseManifest(JSON.stringify(manifestObject), skills);
  result.warnings.push(...manifestResult.warnings);
  if (!manifestResult.ok || !manifestResult.manifest) {
    result.errors.push(...manifestResult.errors.map((error) => `manifest: ${error}`));
    ratingRows.push(failedRow(display, "manifest 失败", review));
    return;
  }

  const manifest = manifestResult.manifest;
  result.manifest = manifest;
  const content = validateSongContent(fingeredScore, manifest);
  result.warnings.push(...content.warnings);
  result.errors.push(...content.errors);

  const packageDir = resolve(outRoot, slug);
  result.packageDir = relative(process.cwd(), packageDir) || packageDir;
  if (existsSync(packageDir) && !args.force) {
    result.status = "skipped";
    result.warnings.push(`目录已存在：${result.packageDir}（用 --force 覆盖）`);
    ratingRows.push(ratingRow(display, review, "跳过"));
    return;
  }

  if (args.dryRun) {
    result.status = "dry-run";
  } else {
    try {
      mkdirSync(join(packageDir, "content"), { recursive: true });
      writeFileSync(
        join(packageDir, "content", "score.json"),
        `${JSON.stringify(fingeredScore, null, 2)}\n`,
        "utf8",
      );
      writeFileSync(
        join(packageDir, "manifest.json"),
        `${JSON.stringify(manifest, null, 2)}\n`,
        "utf8",
      );
      result.status = content.ok ? "written" : "written-with-errors";
    } catch (error) {
      result.status = "failed";
      result.errors.push(`写入失败：${(error as Error).message}`);
      ratingRows.push(failedRow(display, "写入失败", review));
      return;
    }
  }
  ratingRows.push(ratingRow(display, review, content.ok ? (args.dryRun ? "试运行" : "✓") : "!"));
});

function ratingRow(file: string, review: ImportReview, status: string): RatingRow {
  return {
    file,
    measures: review.measures,
    pitchLabel: review.pitch.label,
    fingerLabel: review.fingered.label,
    delta: review.delta,
    unfingered: review.unfingered,
    status,
  };
}

function failedRow(file: string, status: string, review?: ImportReview): RatingRow {
  return {
    file,
    measures: review?.measures ?? 0,
    pitchLabel: review?.pitch.label ?? "—",
    fingerLabel: review?.fingered.label ?? "—",
    delta: review?.delta ?? 0,
    unfingered: review?.unfingered ?? 0,
    status,
  };
}

log(renderRatingTable(ratingRows));
log("");

for (const result of results) {
  if (
    result.errors.length === 0 &&
    result.warnings.length === 0 &&
    result.strictFailures.length === 0
  ) {
    continue;
  }
  log(`● ${result.file} → ${result.slug}`);
  for (const error of result.errors) warn(`  ✗ ${error}`);
  for (const warning of result.warnings) warn(`  ! ${warning}`);
  for (const failure of result.strictFailures) warn(`  !! ${failure}`);
}

const written = results.filter(
  (result) => result.status === "written" || result.status === "written-with-errors",
).length;
const writtenWithErrors = results.filter((result) => result.status === "written-with-errors").length;
const skipped = results.filter((result) => result.status === "skipped").length;
const failed = results.filter((result) => result.status === "failed").length;
const dryRun = results.filter((result) => result.status === "dry-run").length;
const errorFiles = results.filter((result) => result.errors.length > 0).length;
const warningCount =
  results.reduce((sum, result) => sum + result.warnings.length, 0) + collected.skipped.length;
const strictFailures = results.reduce((sum, result) => sum + result.strictFailures.length, 0);

const summary = {
  files: results.length,
  written,
  writtenWithErrors,
  skipped,
  failed,
  dryRun,
  errorFiles,
  warnings: warningCount,
  strictFailures,
};
const report = {
  root: relative(process.cwd(), inputRoot).replace(/\\/g, "/") || inputRoot,
  out: relative(process.cwd(), outRoot).replace(/\\/g, "/") || outRoot,
  fingers: args.fingers,
  strict: args.strict,
  dryRun: args.dryRun,
  files: results,
  skippedFiles: collected.skipped,
  summary,
};

if (args.report) {
  const reportPath = resolve(args.report);
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  log(`报告已写入 ${relative(process.cwd(), reportPath)}`);
}

if (args.json) {
  console.log(asciiJson(report));
} else {
  const writtenText = args.dryRun
    ? `${dryRun} 个试运行`
    : `${written} 写入${writtenWithErrors > 0 ? `（${writtenWithErrors} 含内容错误）` : ""}`;
  log(
    `完成：${writtenText}，${skipped} 跳过，${failed} 导入/manifest 失败，` +
      `${errorFiles} 个文件有错误，${warningCount} 条警告` +
      (strictFailures > 0 ? `，${strictFailures} 项严格检查未过` : ""),
  );
  if (written > 0) {
    const outArg = relative(process.cwd(), outRoot).replace(/\\/g, "/") || outRoot;
    log(`\n下一步：npm run validate:content -- ${outArg} && npm run build:catalog -- ${outArg} ${join(outArg, "catalog.json")}`);
  }
}

if (errorFiles > 0 || failed > 0 || (args.strict && strictFailures > 0)) {
  process.exitCode = 1;
}
