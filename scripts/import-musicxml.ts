import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { annotateScore } from "../src/domain/fingering";
import type { Score } from "../src/domain/types";
import { importMusicXml } from "../src/repertoire/musicxml";
import { parseManifest } from "../src/repertoire/package";
import { validateSongContent } from "../src/repertoire/contentValidation";
import { rateScore, type Difficulty } from "../src/repertoire/difficulty";
import { knownSkillIds, requiredSkillsForScore } from "../src/repertoire/skillGraph";

/**
 * MusicXML → 曲目包素材（作者工具）。
 *
 * 用法：
 *   npm run import:musicxml -- path/to/song.musicxml
 *   npm run import:musicxml -- path/to/song.musicxml --out content/song.x/content/score.json --id score.song.x --bpm 96
 *   npm run import:musicxml -- path/to/song.musicxml --manifest content/song.x/manifest.json
 *
 * 流程与《二期 §2.5》一致：转换 → 补指法 → 内容 QA。
 *
 * 一份谱会有两个评级，这是刻意的：
 *  - **按音高**（未补指法）反映谱面本身要求什么，用它写 manifest；
 *  - **按指法**（补完以后）是引擎读指法得出的位置结论，CI 的 validate:content 用这个。
 * 求解器只看局部连贯性，可能把一段 C 手位旋律判成 D-shift，从而抬高评级。
 * 两个数不一致时脚本会明确提示：**补出来的指法只是起点，需要人工校对**。
 */

type Args = {
  input?: string;
  out?: string;
  id?: string;
  bpm?: number;
  level?: number;
  voice?: number;
  manifest?: string;
  fingers: boolean;
};

const USAGE = `用法：npm run import:musicxml -- <file.musicxml> [选项]

  --out <path>        把转换结果写成 score.json（目录不存在会自动创建）
  --id <id>           Score id，默认 score.imported
  --bpm <n>           覆盖文件里的 tempo
  --level <1..6>      Score.level（词汇表档位），默认 3
  --voice <n>         一行谱有多个声部时保留第 n 个（MusicXML 的 voice 从 1 起）
  --manifest <path>   顺手跑 validateSongContent
  --no-fingers        不跑指法引擎（默认会补齐指法）`;

function readNumber(raw: string | undefined, flag: string): number {
  const value = Number(raw);
  if (raw === undefined || !Number.isFinite(value)) {
    console.error(`${flag} 需要一个数字，收到 ${raw ?? "（空）"}`);
    process.exit(1);
  }
  return value;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { fingers: true };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    switch (token) {
      case "--out":
        args.out = argv[++i];
        break;
      case "--id":
        args.id = argv[++i];
        break;
      case "--bpm":
        args.bpm = readNumber(argv[++i], "--bpm");
        break;
      case "--level":
        args.level = readNumber(argv[++i], "--level");
        break;
      case "--voice":
        args.voice = readNumber(argv[++i], "--voice");
        break;
      case "--manifest":
        args.manifest = argv[++i];
        break;
      case "--no-fingers":
        args.fingers = false;
        break;
      default:
        if (token.startsWith("--")) {
          console.error(`未知选项 ${token}\n\n${USAGE}`);
          process.exit(1);
        }
        args.input = token;
    }
  }
  return args;
}

function measureCount(score: Score): number {
  return Math.max(0, ...score.hands.map((hand) => score.staves[hand]?.measures.length ?? 0));
}

function describe(score: Score): string {
  const parts = score.hands.map((hand) => {
    const stave = score.staves[hand];
    const events = stave?.measures.flatMap((measure) => measure.notes) ?? [];
    const sounding = events.filter((note) => note.pitches.length > 0).length;
    return `${hand === "RH" ? "右手" : "左手"} ${sounding} 个音`;
  });
  return `${measureCount(score)} 小节 · ${parts.join(" / ")} · ${score.meter.beats}/${score.meter.beatValue} · ${score.keySignature} · ${score.bpm} BPM`;
}

function labelOf(rating: Difficulty): string {
  return rating.level >= 7 ? "超纲（L7）" : rating.label;
}

/** 补完指法后仍缺指法的音（求解器填不满时 demo 会崩）。 */
function countUnfingered(score: Score): number {
  let count = 0;
  for (const hand of score.hands) {
    for (const measure of score.staves[hand]?.measures ?? []) {
      for (const note of measure.notes) {
        if (note.pitches.length === 0) continue;
        const fingers = note.fingers;
        if (!fingers || fingers.length !== note.pitches.length) {
          count += 1;
          continue;
        }
        if (fingers.some((finger) => finger < 1 || finger > 5)) count += 1;
      }
    }
  }
  return count;
}

const args = parseArgs(process.argv.slice(2));
if (!args.input) {
  console.error(USAGE);
  process.exit(1);
}
if (args.input.toLowerCase().endsWith(".mxl")) {
  console.error(".mxl 是压缩包；请先在 MuseScore 里另存为未压缩的 .musicxml（或手动解压）");
  process.exit(1);
}

let text: string;
try {
  text = readFileSync(resolve(args.input), "utf8");
} catch (error) {
  console.error(`读不了 ${args.input}：${(error as Error).message}`);
  process.exit(1);
}

const level =
  args.level !== undefined && args.level >= 1 && args.level <= 6
    ? (args.level as Score["level"])
    : undefined;
if (args.level !== undefined && level === undefined) {
  console.error(`--level 只能是 1..6，收到 ${args.level}`);
  process.exit(1);
}

const result = importMusicXml(text, { id: args.id, bpm: args.bpm, level, voice: args.voice });
const rawScore = result.score;
const score = rawScore && args.fingers ? annotateScore(rawScore) : rawScore;
const pitchRating = rawScore ? rateScore(rawScore) : undefined;
const fingerRating = score && score !== rawScore ? rateScore(score) : undefined;

console.log(`● 导入 ${relative(process.cwd(), resolve(args.input)) || args.input}`);

// 转换失败就直接停：拿半成品谱面去评级/写盘只会误导作者。
for (const warning of result.warnings) console.warn(`  ! ${warning}`);
for (const error of result.errors) console.error(`  ✗ ${error}`);
if (!result.ok || !rawScore) {
  console.error("\n导入失败：先按上面的错误改谱，再重跑。");
  process.exit(1);
}

if (rawScore) {
  console.log(`  ${describe(rawScore)}`);
  console.log(`  引擎评级（按音高）：${labelOf(pitchRating!)}`);
  const required = [...requiredSkillsForScore(rawScore)].sort();
  if (required.length > 0) console.log(`  需要技能：${required.join(", ")}`);
}

if (fingerRating) {
  if (fingerRating.level === pitchRating!.level) {
    console.log(`  补指法后评级不变：${labelOf(fingerRating)}`);
  } else {
    console.warn(
      `  ! 补指法后按指法评级变成 ${labelOf(fingerRating)}（按音高是 ${labelOf(pitchRating!)}）`,
    );
    console.warn(
      "    求解器只看局部连贯，可能把同一段旋律判成换手位；导入的指法只是起点，请人工校对。",
    );
  }
  const unfingered = countUnfingered(score!);
  if (unfingered > 0) {
    console.warn(`  ! ${unfingered} 个音没补上指法，demo 会因为 finger=0 崩溃`);
  }
}

let failed = !result.ok;
if (score && args.manifest) {
  let manifestResult;
  try {
    manifestResult = parseManifest(readFileSync(resolve(args.manifest), "utf8"), knownSkillIds());
  } catch (error) {
    console.error(`\n读不了 manifest：${(error as Error).message}`);
    process.exit(1);
  }
  if (!manifestResult.ok || !manifestResult.manifest) {
    failed = true;
    console.error("\n✗ manifest 校验失败：");
    for (const error of manifestResult.errors) console.error(`  ✗ ${error}`);
  } else {
    for (const warning of manifestResult.warnings) console.warn(`  ! manifest: ${warning}`);
    const check = validateSongContent(score, manifestResult.manifest);
    console.log("\n● 内容 QA（validateSongContent，按指法评级）");
    for (const error of check.errors) console.error(`  ✗ ${error}`);
    for (const warning of check.warnings) console.warn(`  ! ${warning}`);
    if (check.ok) console.log("  ✓ 通过");
    if (!check.ok) failed = true;
  }
}

if (rawScore && result.ok && !args.manifest) {
  // 没给 manifest 时给出可以直接粘进 manifest.json 的片段。
  // level 用「按音高」的评级：那才是谱面本身的要求。
  console.log("\n● 建议写进 manifest.json 的字段");
  const snippet = {
    difficulty: { level: pitchRating!.level, bpm: rawScore.bpm, len: measureCount(rawScore) },
    skillDeps: [...requiredSkillsForScore(rawScore)].sort(),
  };
  console.log(
    JSON.stringify(snippet, null, 2)
      .split("\n")
      .map((line) => `  ${line}`)
      .join("\n"),
  );
  if (fingerRating && fingerRating.level !== pitchRating!.level) {
    console.warn(
      `  ! 校对指法前，validate:content 会按指法评级 ${labelOf(fingerRating)} 判「声明难度偏低」`,
    );
  }
}

if (score && args.out) {
  const outPath = resolve(args.out);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${JSON.stringify(score, null, 2)}\n`, "utf8");
  console.log(`\n✓ 已写入 ${relative(process.cwd(), outPath)}`);
}

if (failed) {
  console.error("\n导入失败：先按上面的错误改谱，再重跑。");
  process.exitCode = 1;
}
