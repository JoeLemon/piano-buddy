import type { Score } from "../domain/types";
import type { PackageManifest } from "./package";
import { rateScore } from "./difficulty";
import { requiredSkillsForScore } from "./skillGraph";
import { scoreToMotion, validateMotion } from "./motion";

/**
 * ── 曲目包内容 QA ────────────────────────────────────────────
 * manifest 校验只保证「包结构」正确；这里再检查「内容」：
 *  - 编配是否落在 MVP 词汇表内；
 *  - 声明的难度是否低于引擎评级（低评会让用户挫败，算错误）；
 *  - 声明的 skillDeps 与引擎识别结果是否一致（不一致给警告，人工确认）；
 *  - 指法是否 1..5（finger=0 会让 demo 的 Pianist 直接崩溃）。
 *
 * 这是作者工具（MusicXML/MIDI → 包）和 CI 的共用入口。
 */
export interface ContentCheck {
  ok: boolean;
  errors: string[];
  warnings: string[];
}

function countMeasures(score: Score): number {
  let max = 0;
  for (const hand of score.hands) {
    const stave = score.staves[hand];
    if (stave) max = Math.max(max, stave.measures.length);
  }
  return max;
}

export function validateSongContent(score: Score, manifest: PackageManifest): ContentCheck {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (manifest.type !== "song") {
    return { ok: false, errors: ["validateSongContent 只接受 type=song 的包"], warnings };
  }

  const declaredLevel = manifest.difficulty?.level;
  if (declaredLevel == null) errors.push("song 包必须声明 difficulty.level");

  const required = requiredSkillsForScore(score);
  const rated = rateScore(score, {
    repeat: manifest.difficulty?.repeat,
    measures: manifest.difficulty?.len,
  });

  if (rated.baseLevel >= 7) {
    errors.push("乐谱超出 MVP 词汇表（minLevel=7），需要先扩展词汇表或降级编配");
  }

  if (declaredLevel != null) {
    if (rated.level > declaredLevel) {
      errors.push(`声明难度 L${declaredLevel} 低于引擎评级 ${rated.label}，用户会挫败`);
    } else if (rated.level < declaredLevel) {
      warnings.push(`声明难度 L${declaredLevel} 高于引擎评级 ${rated.label}（保守，可接受）`);
    }
  }

  const declared = new Set(manifest.skillDeps);
  for (const id of required) {
    if (!declared.has(id)) warnings.push(`引擎识别到未声明技能：${id}`);
  }
  for (const id of declared) {
    if (!required.has(id)) warnings.push(`声明了引擎未识别的技能：${id}`);
  }

  if (manifest.difficulty && score.bpm !== manifest.difficulty.bpm) {
    warnings.push(`manifest bpm=${manifest.difficulty.bpm} 与谱面 bpm=${score.bpm} 不一致`);
  }

  const actualMeasures = countMeasures(score);
  if (manifest.difficulty?.len != null && manifest.difficulty.len !== actualMeasures) {
    warnings.push(
      `difficulty.len=${manifest.difficulty.len} 与谱面 ${actualMeasures} 小节不一致`,
    );
  }

  const motionCheck = validateMotion(scoreToMotion(score, manifest.name));
  errors.push(...motionCheck.errors);

  return { ok: errors.length === 0, errors, warnings };
}
