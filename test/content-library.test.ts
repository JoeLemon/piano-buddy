import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { Score } from "../src/domain/types";
import { identifyChord } from "../src/domain/chords";
import { gradeRhythm, planForScore } from "../src/practice";
import { rateScore, requiredSkillsForScore } from "../src/repertoire";
import type { PackageManifest } from "../src/repertoire/package";
import { validateSongContent } from "../src/repertoire/contentValidation";
import { knownSkillIds, parseManifest } from "../src/repertoire";

/**
 * 曲库内容回归：`content/` 下每个包都必须过内容 QA。
 *
 * `npm run validate:content` 是作者手动跑的入口；这里把它钉在测试里，
 * 免得「改了词汇表/评级规则，曲目悄悄变不合规」只有在发版前才被发现。
 */

const CONTENT_ROOT = resolve("content");

type Package = { dir: string; manifest: PackageManifest; score: Score };

function loadPackages(): Package[] {
  const skills = knownSkillIds();
  const out: Package[] = [];
  for (const name of readdirSync(CONTENT_ROOT)) {
    const dir = join(CONTENT_ROOT, name);
    let isDir = false;
    try {
      isDir = statSync(dir).isDirectory();
    } catch {
      continue;
    }
    if (!isDir) continue;
    let raw: string;
    try {
      raw = readFileSync(join(dir, "manifest.json"), "utf8");
    } catch {
      continue;
    }
    const parsed = parseManifest(raw, skills);
    expect(parsed.ok, `${name}: ${parsed.errors.join("; ")}`).toBe(true);
    const score = JSON.parse(readFileSync(join(dir, "content", "score.json"), "utf8")) as Score;
    out.push({ dir: name, manifest: parsed.manifest!, score });
  }
  return out;
}

function scoreOf(packageName: string): Score {
  return JSON.parse(readFileSync(resolve(`content/${packageName}/content/score.json`), "utf8")) as Score;
}

const packages = loadPackages();

describe("曲库内容", () => {
  it("keeps every package inside the vocabulary and above its declared level", () => {
    expect(packages.length).toBeGreaterThanOrEqual(15);

    for (const item of packages) {
      const check = validateSongContent(item.score, item.manifest);
      expect(check.errors, `${item.dir}: ${check.errors.join("; ")}`).toEqual([]);
      expect(check.warnings, `${item.dir}: ${check.warnings.join("; ")}`).toEqual([]);
    }
  });

  it("gives every note a 1..5 fingering", () => {
    for (const item of packages) {
      for (const hand of item.score.hands) {
        for (const measure of item.score.staves[hand]!.measures) {
          for (const note of measure.notes) {
            if (note.pitches.length === 0) continue;
            expect(note.fingers, `${item.dir} ${note.id}`).toHaveLength(note.pitches.length);
            for (const finger of note.fingers!) {
              expect(finger, `${item.dir} ${note.id}`).toBeGreaterThanOrEqual(1);
              expect(finger, `${item.dir} ${note.id}`).toBeLessThanOrEqual(5);
            }
          }
        }
      }
    }
  });
});

describe("《暮色》E 小调教学曲", () => {
  const score = scoreOf("song.dusk.l4");

  it("is an E minor waltz that stays inside the L4 minor vocabulary", () => {
    expect(score.keySignature).toBe("Em");
    expect(score.meter).toEqual({ beats: 3, beatValue: 4 });
    expect(score.bpm).toBe(66);
    expect(score.staves.RH?.measures).toHaveLength(12);
    expect(rateScore(score).level).toBe(4);

    const skills = requiredSkillsForScore(score);
    // 小调曲目至少要有调式与临时升号（E 小调的 F♯）之外的调式技能
    expect(skills).toContain("key.minor");
    expect(skills).toContain("rhythm.eighth");
  });

  it("plays through end to end without a wrong note", () => {
    const plan = planForScore(score, "BOTH");
    const msPerBeat = 60000 / score.bpm;
    const hits = plan.slots.flatMap((slot, slotIndex) =>
      slot.midis.map((midi) => ({
        midi,
        slotIndex,
        atMs: (slot.startBeat + 4) * msPerBeat,
      })),
    );
    const result = gradeRhythm(plan, hits, 0, 4);

    expect(result.total).toBe(plan.slots.length);
    expect(result.onCount).toBe(result.total);
  });
});

describe("《薄雾》减七 / 半减七 / 重复根音", () => {
  const score = scoreOf("song.mist.l6");

  it("keeps the new chord vocabulary inside the L6 vocabulary", () => {
    expect(score.keySignature).toBe("Am");
    expect(score.staves.RH?.measures).toHaveLength(8);
    expect(rateScore(score).level).toBe(6);

    const skills = requiredSkillsForScore(score);
    expect(skills.has("chord.diminished")).toBe(true);
    expect(skills.has("chord.seventh")).toBe(true);

    // 每小节第一个音是柱式和弦：这首必须同时用上半减七、减七与八度重复根音
    const chords = score.staves.RH!.measures.map((measure) => measure.notes[0]);
    const infos = chords.map((note) => identifyChord(note.pitches));
    const qualities = infos.map((info) => info?.quality);
    expect(qualities).toContain("halfDim7");
    expect(qualities).toContain("dim7");
    expect(infos.some((info) => info?.doubled)).toBe(true);
  });

  it("plays through end to end without a wrong note", () => {
    const plan = planForScore(score, "BOTH");
    const msPerBeat = 60000 / score.bpm;
    const hits = plan.slots.flatMap((slot, slotIndex) =>
      slot.midis.map((midi) => ({ midi, slotIndex, atMs: (slot.startBeat + 4) * msPerBeat })),
    );
    const result = gradeRhythm(plan, hits, 0, 4);
    expect(result.total).toBe(plan.slots.length);
    expect(result.onCount).toBe(plan.slots.length);
  });
});

describe("《灯影》d 小调教学曲", () => {
  const score = scoreOf("song.lantern.l4");

  it("is a d minor piece with blocked left-hand chords", () => {
    expect(score.keySignature).toBe("Dm");
    expect(score.meter).toEqual({ beats: 4, beatValue: 4 });
    expect(score.staves.RH?.measures).toHaveLength(12);
    expect(rateScore(score).level).toBe(4);

    const skills = requiredSkillsForScore(score);
    expect(skills).toContain("key.minor");
    expect(skills).toContain("chord.minor");
    expect(skills).toContain("rhythm.eighth");

    // 左手每个和弦都必须是这个词表里能写的三和弦（不允许重复根音的四音和弦）
    const chords = score.staves.LH!.measures.flatMap((measure) => measure.notes);
    expect(chords.every((note) => note.pitches.length === 3)).toBe(true);
  });
});

describe("《回廊》L6 一个降号曲", () => {
  const score = scoreOf("song.corridor.l6");

  it("is an F major L6 study with sixteenth runs", () => {
    expect(score.keySignature).toBe("F");
    expect(rateScore(score).level).toBe(6);
    expect(score.staves.RH?.measures).toHaveLength(12);

    const skills = requiredSkillsForScore(score);
    expect(skills).toContain("key.one-flat");
    expect(skills).toContain("rhythm.sixteenth");
    expect(skills).toContain("pos.leap");
  });

  it("can be played end to end on a sixteenth grid", () => {
    const plan = planForScore(score, "BOTH");
    expect(plan.beatsPerBar).toBe(4);
    expect(plan.slots.filter((slot) => slot.startBeat < 44)).toHaveLength(176);
    expect(plan.slots[0]?.midis).toEqual([53, 65]);

    const msPerBeat = 60000 / score.bpm;
    const hits = plan.slots.flatMap((slot, slotIndex) =>
      slot.midis.map((midi) => ({ midi, slotIndex, atMs: (slot.startBeat + 4) * msPerBeat })),
    );
    const result = gradeRhythm(plan, hits, 0, 4);
    expect(result.onCount).toBe(plan.slots.length);
  });
});

describe("《疾风》L6 跑动曲", () => {
  const score = scoreOf("song.gust.l6");

  it("keeps the L6 demands: sixteenths, leaps and a 12-measure span", () => {
    expect(rateScore(score).level).toBe(6);
    expect(score.staves.RH?.measures).toHaveLength(12);

    const skills = requiredSkillsForScore(score);
    expect(skills).toContain("rhythm.sixteenth");
    expect(skills).toContain("pos.leap");
    expect(skills).toContain("pos.shift");
  });

  it("merges both hands into one sixteenth grid that can be played end to end", () => {
    const plan = planForScore(score, "BOTH");
    expect(plan.beatsPerBar).toBe(4);

    // 前 11 小节是满的十六分跑动：每小节 4 拍 × 4 个十六分 = 16 个起音点。
    expect(plan.slots.filter((slot) => slot.startBeat < 44)).toHaveLength(176);
    // 第一拍右手 C4 与左手 C3 必须合并成一个「一起按」的位置。
    expect(plan.slots[0]?.midis).toEqual([48, 60]);

    const msPerBeat = 60000 / score.bpm;
    const hits = plan.slots.flatMap((slot, slotIndex) =>
      slot.midis.map((midi) => ({ midi, slotIndex, atMs: (slot.startBeat + 4) * msPerBeat })),
    );
    const result = gradeRhythm(plan, hits, 0, 4);
    expect(result.total).toBe(plan.slots.length);
    expect(result.onCount).toBe(plan.slots.length);
  });
});
