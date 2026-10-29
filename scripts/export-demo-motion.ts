import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { Score } from "../src/domain/types";
import { annotateScore, type FingeringMode } from "../src/domain/fingering";
import {
  motionDurationSeconds,
  scoreToMotion,
  toDemoEvents,
  validateMotion,
} from "../src/repertoire/motion";

/**
 * 把主项目的 L2《欢乐颂》导出成 demo 能直接消费的 Motion JSON。
 *
 * 主项目仍是「拍」模型；demo 的 adapter 只读这个中立文件，
 * 不把 3D 手模型或绝对秒带进内容包。
 *
 * P1：导出前强制过指法引擎（pianoplayer 移植）。内容包里的手位指法是
 * 锚点原样保留，缺口由求解器补；如果仍有 finger=0，直接失败——那是 demo
 * `Pianist.loadScore` 访问 `fingers[-1]` 的崩溃点。
 */
const source = resolve("content/song.ode-to-joy.l2/content/score.json");
const demoDir = resolve(process.env.DEMO_DIR ?? "../piano-buddy-demo");
const output = resolve(demoDir, "src/data/ode-to-joy.l2.motion.json");

const fingeringMode: FingeringMode = process.env.FINGERING_MODE === "auto" ? "auto" : "fill-gaps";

const score = JSON.parse(readFileSync(source, "utf8")) as Score;
const annotated = annotateScore(score, fingeringMode);
const motion = scoreToMotion(annotated, "欢乐颂 · L2 编配");

const missingFingers = motion.notes.filter(
  (note) => !Number.isInteger(note.finger) || note.finger < 1 || note.finger > 5,
);
if (missingFingers.length > 0) {
  console.error("指法标注未覆盖以下音符（finger 必须为 1..5）：");
  for (const note of missingFingers) console.error(`- ${note.id}: finger=${note.finger}`);
  process.exit(1);
}

const validation = validateMotion(motion);
if (!validation.ok) {
  console.error("Motion 校验失败：");
  for (const error of validation.errors) console.error(`- ${error}`);
  process.exit(1);
}

const payload = {
  motion,
  events: toDemoEvents(motion),
  duration: +(motionDurationSeconds(motion) + 1.2).toFixed(3),
};

mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
console.log(`已导出 ${motion.notes.length} 个音 → ${output}`);
console.log(`时长 ${payload.duration}s，BPM ${motion.bpm}，拍数 ${motion.totalBeats}`);
console.log(`指法：${fingeringMode}（手位锚点保留，缺口由 pianoplayer 求解）`);
