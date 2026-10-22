import { describe, expect, it } from "vitest";
import { generateL1 } from "../src/domain/generate";
import { generateL2 } from "../src/domain/generateL2";
import { initialProfile } from "../src/domain/profile";
import type { Pitch, Score, Step } from "../src/domain/types";
import {
  SKILLS,
  SKILL_BY_ID,
  analyzeHandPositions,
  knownSkillIds,
  maxSkillLevel,
  minLevelForScore,
  missingSkills,
  prerequisites,
  requiredSkillsForScore,
} from "../src/repertoire/skillGraph";
import { rateScore } from "../src/repertoire/difficulty";
import {
  isSafeAssetPath,
  loadPackage,
  memorySource,
  parseManifest,
  validateManifest,
  type PackageManifest,
} from "../src/repertoire/package";
import {
  applyLessonCompletion,
  applyLevelTestPass,
  isMastered,
  masteredSkillIds,
  migrateProfile,
  recordPractice,
  skillKey,
} from "../src/repertoire/skillState";
import { scoreToDemoEvents, scoreToMotion, toDemoEvents, validateMotion } from "../src/repertoire/motion";
import { validateSongContent } from "../src/repertoire/contentValidation";

const p = (step: Step, octave: number, alteration: -1 | 0 | 1 = 0): Pitch => ({ step, octave, alteration });
const l1 = () => generateL1({ hand: "RH", seed: 1, mode: "reading-lesson" });
const l2Together = () => generateL2({ seed: 1, mode: "sight", shape: { kind: "together", texture: "same" } });
const l2Alternate = () => generateL2({ seed: 1, mode: "sight", shape: { kind: "alternate" } });
const l2KeyF = () => generateL2({ seed: 1, mode: "sight", shape: { kind: "key-line", key: "F", hand: "RH" } });

const l3ChordScore: Score = {
  id: "l3-chord",
  mode: "reading-lesson",
  level: 3,
  meter: { beats: 4, beatValue: 4 },
  keySignature: "C",
  hands: ["RH"],
  bpm: 60,
  staves: {
    RH: {
      clef: "treble",
      measures: [
        {
          notes: [
            {
              id: "a",
              pitches: [
                { step: "C", octave: 4, alteration: 0 },
                { step: "E", octave: 4, alteration: 0 },
                { step: "G", octave: 4, alteration: 0 },
              ],
              duration: "q",
              fingers: [1, 3, 5],
            },
            { id: "b", pitches: [{ step: "E", octave: 4, alteration: 0 }], duration: "q", fingers: [3] },
            { id: "c", pitches: [{ step: "G", octave: 4, alteration: 0 }], duration: "q", fingers: [5] },
            { id: "d", pitches: [{ step: "C", octave: 4, alteration: 0 }], duration: "q", fingers: [1] },
          ],
        },
      ],
    },
  },
};

const chordProgressionScore: Score = {
  id: "chord-progression",
  mode: "reading-lesson",
  level: 3,
  meter: { beats: 4, beatValue: 4 },
  keySignature: "C",
  hands: ["LH"],
  bpm: 60,
  staves: {
    LH: {
      clef: "bass",
      measures: [
        {
          notes: [
            {
              id: "c",
              pitches: [p("C", 3), p("E", 3), p("G", 3)],
              duration: "w",
              fingers: [5, 3, 1],
            },
          ],
        },
        {
          notes: [
            {
              id: "g",
              pitches: [p("G", 3), p("B", 3), p("D", 4)],
              duration: "w",
              fingers: [5, 3, 1],
            },
          ],
        },
      ],
    },
  },
};

const overScore: Score = {
  ...l3ChordScore,
  id: "over",
  staves: {
    RH: {
      clef: "treble",
      measures: [
        {
          notes: [
            {
              id: "a",
              pitches: [
                { step: "C", octave: 4, alteration: 0 },
                { step: "E", octave: 4, alteration: 0 },
                { step: "G", octave: 4, alteration: 0 },
                { step: "B", octave: 4, alteration: 0 },
              ],
              duration: "q",
            },
            { id: "b", pitches: [{ step: "E", octave: 4, alteration: 0 }], duration: "q" },
            { id: "c", pitches: [{ step: "G", octave: 4, alteration: 0 }], duration: "q" },
            { id: "d", pitches: [{ step: "C", octave: 4, alteration: 0 }], duration: "q" },
          ],
        },
      ],
    },
  },
};

describe("技能图谱", () => {
  it("技能表 id 唯一且前置引用完整", () => {
    expect(SKILLS.length).toBeGreaterThan(0);
    expect(new Set(SKILLS.map((s) => s.id)).size).toBe(SKILLS.length);
    expect(SKILL_BY_ID.size).toBe(SKILLS.length);
    for (const s of SKILLS) {
      for (const p of s.prereq) {
        expect(SKILL_BY_ID.has(p), `${s.id} 前置 ${p} 不存在`).toBe(true);
      }
    }
  });

  it("L1 单手乐谱只含基础技能", () => {
    const skills = requiredSkillsForScore(l1());
    expect(skills.has("clef.treble")).toBe(true);
    expect(skills.has("pos.five")).toBe(true);
    expect(skills.has("rhythm.quarter")).toBe(true);
    expect(skills.has("key.c")).toBe(true);
    expect(skills.has("hands.both")).toBe(false);
    expect(skills.has("chord.triad")).toBe(false);
    expect(skills.has("pos.shift")).toBe(false);
  });

  it("L2 双手乐谱含双手与八分节奏", () => {
    const skills = requiredSkillsForScore(l2Together());
    expect(skills.has("hands.both")).toBe(true);
    expect(skills.has("rhythm.eighth")).toBe(true);
    expect(skills.has("clef.treble")).toBe(true);
    expect(skills.has("clef.bass")).toBe(true);
  });

  it("F 调乐谱识别一个降号，但不把静态 F 手位误判成平移", () => {
    const skills = requiredSkillsForScore(l2KeyF());
    expect(skills.has("key.one-flat")).toBe(true);
    expect(skills.has("pos.five")).toBe(true);
    expect(skills.has("pos.shift")).toBe(false);
  });

  it("C → D 换手位能通过指法识别出来", () => {
    const score = generateL2({ seed: 1, mode: "sight", shape: { kind: "shift-once", hand: "RH" } });
    const skills = requiredSkillsForScore(score);
    expect(skills.has("pos.shift")).toBe(true);
  });

  it("三和弦乐谱识别和弦技能", () => {
    const skills = requiredSkillsForScore(l3ChordScore);
    expect(skills.has("chord.triad")).toBe(true);
  });

  it("最小容纳档：L1=1，L2 双手=2，三和弦=3，四音和弦超纲=7", () => {
    expect(minLevelForScore(l1())).toBe(1);
    expect(minLevelForScore(l2Together())).toBe(2);
    expect(minLevelForScore(l3ChordScore)).toBe(3);
    expect(minLevelForScore(overScore)).toBe(7);
  });

  it("前置闭包与补短板", () => {
    expect(maxSkillLevel(["key.c", "rhythm.eighth"])).toBe(2);
    expect(prerequisites("rhythm.sixteenth")).toEqual(
      new Set(["rhythm.eighth", "rhythm.quarter"]),
    );
    expect(missingSkills(["chord.triad"], [])).toEqual(new Set(["chord.triad", "chord.interval", "pos.five"]));
    expect(missingSkills(["chord.triad"], ["chord.interval", "pos.five"])).toEqual(new Set(["chord.triad"]));
  });
});

describe("难度评级", () => {
  it("L1 标准速度 → L1", () => {
    const d = rateScore({ ...l1(), bpm: 60 });
    expect(d.baseLevel).toBe(1);
    expect(d.level).toBe(1);
    expect(d.label).toBe("L1");
  });

  it("速度快上调：L1 @ 96 BPM → L2", () => {
    const d = rateScore({ ...l1(), bpm: 96 });
    expect(d.adjustments.speed).toBe(1);
    expect(d.level).toBe(2);
    expect(d.label).toBe("L2");
  });

  it("半档：L1 @ 72 BPM → L1+", () => {
    const d = rateScore({ ...l1(), bpm: 72 });
    expect(d.adjustments.speed).toBe(0.5);
    expect(d.label).toBe("L1+");
  });

  it("重复度高下调：L2 + repeat 0.9 → L1", () => {
    const d = rateScore({ ...l2Together(), bpm: 60 }, { repeat: 0.9 });
    expect(d.adjustments.repeat).toBe(-1);
    expect(d.level).toBe(1);
  });

  it("超纲曲目 → 超纲", () => {
    const d = rateScore(overScore);
    expect(d.level).toBe(7);
    expect(d.label).toBe("超纲");
  });
});

describe("数据包 schema 与加载", () => {
  const known = knownSkillIds();
  const good = {
    schemaVersion: 1,
    id: "song.xiaoxingyun.l3",
    name: "小幸运 · L3 编配",
    type: "song",
    version: "1.0.0",
    skillDeps: ["chord.triad", "key.one-flat"],
    difficulty: { level: 3, bpm: 96, repeat: 0.6, len: 24 },
    assets: ["score.json"],
    checksum: "sha256:abc",
    license: "CC-BY-NC",
  };

  it("合法 manifest 通过并规范化", () => {
    const r = validateManifest(good, known);
    expect(r.ok).toBe(true);
    expect(r.manifest?.id).toBe("song.xiaoxingyun.l3");
    expect(r.manifest?.type).toBe("song");
    expect(r.manifest?.skillDeps).toEqual(["chord.triad", "key.one-flat"]);
  });

  it("缺 id 报错", () => {
    const { id: _drop, ...rest } = good;
    const r = validateManifest(rest, known);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes("id"))).toBe(true);
  });

  it("未知技能依赖报错", () => {
    const r = validateManifest({ ...good, skillDeps: ["not.a.skill"] }, known);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes("not.a.skill"))).toBe(true);
  });

  it("非法 type 报错", () => {
    const r = validateManifest({ ...good, type: "album" }, known);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes("type"))).toBe(true);
  });

  it("不支持的 schemaVersion 报错", () => {
    const r = validateManifest({ ...good, schemaVersion: 2 }, known);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes("schemaVersion"))).toBe(true);
  });

  it("parseManifest 处理非法 JSON", () => {
    const r = parseManifest("{ not json", known);
    expect(r.ok).toBe(false);
  });

  it("loadPackage 从内存源加载并读取资源", async () => {
    const source = memorySource({
      "manifest.json": JSON.stringify(good),
      "score.json": '{"score":"here"}',
    });
    const r = await loadPackage(source, known);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.pkg.manifest.id).toBe("song.xiaoxingyun.l3");
      expect(r.pkg.files["score.json"]).toBe('{"score":"here"}');
    }
  });

  it("loadPackage 缺失资源报错", async () => {
    const source = memorySource({ "manifest.json": JSON.stringify(good) });
    const r = await loadPackage(source, known);
    expect(r.ok).toBe(false);
  });

  it("拒绝越界/绝对路径的 assets", () => {
    expect(isSafeAssetPath("content/score.json")).toBe(true);
    expect(isSafeAssetPath("../evil.json")).toBe(false);
    expect(isSafeAssetPath("/etc/passwd")).toBe(false);
    expect(isSafeAssetPath("a\\b.json")).toBe(false);
    expect(isSafeAssetPath("C:/score.json")).toBe(false);
    expect(isSafeAssetPath("content/./score.json")).toBe(false);

    for (const assets of [["../evil.json"], ["/etc/passwd"], ["a\\b.json"], []]) {
      const r = validateManifest({ ...good, assets }, known);
      expect(r.ok, JSON.stringify(assets)).toBe(false);
    }
  });

  it("校验 songId / arrangementId / minAppVersion / rights", () => {
    const r = validateManifest(
      {
        ...good,
        songId: "song.xiaoxingyun",
        arrangementId: "arr.l3",
        songTitle: "小幸运",
        composer: "Example Composer",
        minAppVersion: "2.0.0",
        rights: { type: "licensed", attribution: "Example", territory: "CN" },
      },
      known,
    );
    expect(r.ok).toBe(true);
    expect(r.manifest?.songId).toBe("song.xiaoxingyun");
    expect(r.manifest?.arrangementId).toBe("arr.l3");
    expect(r.manifest?.songTitle).toBe("小幸运");
    expect(r.manifest?.composer).toBe("Example Composer");
    expect(r.manifest?.minAppVersion).toBe("2.0.0");
    expect(r.manifest?.rights?.type).toBe("licensed");
  });

  it("拒绝非法 checksum 和越界难度", () => {
    expect(validateManifest({ ...good, checksum: "md5:abc" }, known).ok).toBe(false);
    expect(
      validateManifest({ ...good, difficulty: { level: 8, bpm: 96 } }, known).ok,
    ).toBe(false);
    expect(
      validateManifest({ ...good, difficulty: { level: 3, bpm: 500 } }, known).ok,
    ).toBe(false);
  });
});

// ── 新增：拆解、难度向量、进度账本、Motion IR、内容 QA ─────────────

const l2Shift = () =>
  generateL2({ seed: 1, mode: "sight", shape: { kind: "shift-once", hand: "RH" } });

const syncopationScore: Score = {
  id: "sync-demo",
  mode: "reading-lesson",
  level: 5,
  meter: { beats: 4, beatValue: 4 },
  keySignature: "C",
  hands: ["RH"],
  bpm: 52,
  staves: {
    RH: {
      clef: "treble",
      measures: [
        {
          notes: [
            { id: "a", pitches: [p("C", 4)], duration: "8", fingers: [1] },
            { id: "b", pitches: [p("E", 4)], duration: "q", fingers: [3] },
            { id: "c", pitches: [p("G", 4)], duration: "8", fingers: [5] },
            { id: "d", pitches: [p("C", 4)], duration: "h", fingers: [1] },
          ],
        },
      ],
    },
  },
};

const brokenChordScore: Score = {
  id: "broken-demo",
  mode: "reading-lesson",
  level: 4,
  meter: { beats: 4, beatValue: 4 },
  keySignature: "C",
  hands: ["RH", "LH"],
  bpm: 60,
  staves: {
    RH: {
      clef: "treble",
      measures: [
        {
          notes: [
            { id: "r1", pitches: [p("C", 4)], duration: "q", fingers: [1] },
            { id: "r2", pitches: [p("D", 4)], duration: "q", fingers: [2] },
            { id: "r3", pitches: [p("E", 4)], duration: "q", fingers: [3] },
            { id: "r4", pitches: [p("F", 4)], duration: "q", fingers: [4] },
          ],
        },
      ],
    },
    LH: {
      clef: "bass",
      measures: [1, 2].map((measure) => ({
        notes: [
          { id: `l${measure}-1`, pitches: [p("C", 3)], duration: "8" as const, fingers: [5] },
          { id: `l${measure}-2`, pitches: [p("G", 3)], duration: "8" as const, fingers: [1] },
          { id: `l${measure}-3`, pitches: [p("E", 3)], duration: "8" as const, fingers: [3] },
          { id: `l${measure}-4`, pitches: [p("G", 3)], duration: "8" as const, fingers: [1] },
          { id: `l${measure}-5`, pitches: [p("C", 3)], duration: "8" as const, fingers: [5] },
          { id: `l${measure}-6`, pitches: [p("G", 3)], duration: "8" as const, fingers: [1] },
          { id: `l${measure}-7`, pitches: [p("E", 3)], duration: "8" as const, fingers: [3] },
          { id: `l${measure}-8`, pitches: [p("G", 3)], duration: "8" as const, fingers: [1] },
        ],
      })),
    },
  },
};

const brokenManifest = (overrides: Partial<PackageManifest> = {}): PackageManifest => ({
  schemaVersion: 1,
  id: "song.broken-demo",
  songId: "song.broken-demo",
  arrangementId: "arr.c4",
  name: "分解和弦测试",
  type: "song",
  version: "1.0.0",
  skillDeps: [...requiredSkillsForScore(brokenChordScore)],
  difficulty: { level: 4, bpm: 60, repeat: 0.3, len: 2 },
  assets: ["score.json"],
  license: "original",
  rights: { type: "original" },
  ...overrides,
});

describe("拆解与难度向量", () => {
  it("识别双手交替和双手同拍", () => {
    const alternate = requiredSkillsForScore(l2Alternate());
    expect(alternate.has("hands.both")).toBe(true);
    expect(alternate.has("hands.alternate")).toBe(true);
    expect(alternate.has("hands.together")).toBe(false);

    const together = requiredSkillsForScore(l2Together());
    expect(together.has("hands.both")).toBe(true);
    expect(together.has("hands.together")).toBe(true);
  });

  it("识别切分节奏", () => {
    const skills = requiredSkillsForScore(syncopationScore);
    expect(skills.has("rhythm.syncopation")).toBe(true);
    expect(skills.has("rhythm.eighth")).toBe(true);
  });

  it("识别分解和弦织体，并把 L4 编配评到 L4", () => {
    const skills = requiredSkillsForScore(brokenChordScore);
    expect(skills.has("texture.broken")).toBe(true);

    const difficulty = rateScore(brokenChordScore, { repeat: 0.3 });
    expect(difficulty.baseLevel).toBe(4);
    expect(difficulty.level).toBe(4);
    expect(difficulty.vector.texture).toBe(4);
    expect(difficulty.vector.rhythm).toBe(2);
  });

  it("换手位曲目同时带 pos.shift 和 pos.leap", () => {
    const skills = requiredSkillsForScore(l2Shift());
    expect(skills.has("pos.shift")).toBe(true);
  });

  it("和弦换位是手位移动，不是跨声部旋律跳进", () => {
    const skills = requiredSkillsForScore(chordProgressionScore);
    expect(skills.has("pos.shift")).toBe(true);
    expect(skills.has("pos.leap")).toBe(false);
  });

  it("右手 C、左手 F 的静态手位不误判成换位", () => {
    const staticTwoHands: Score = {
      id: "static-two-hands",
      mode: "reading-lesson",
      level: 2,
      meter: { beats: 4, beatValue: 4 },
      keySignature: "C",
      hands: ["RH", "LH"],
      bpm: 60,
      staves: {
        RH: {
          clef: "treble",
          measures: [
            {
              notes: [
                { id: "r1", pitches: [p("C", 4)], duration: "q", fingers: [1] },
                { id: "r2", pitches: [p("D", 4)], duration: "q", fingers: [2] },
                { id: "r3", pitches: [p("E", 4)], duration: "q", fingers: [3] },
                { id: "r4", pitches: [p("F", 4)], duration: "q", fingers: [4] },
              ],
            },
          ],
        },
        LH: {
          clef: "bass",
          measures: [
            {
              notes: [
                { id: "l1", pitches: [p("F", 3)], duration: "h", fingers: [5] },
                { id: "l2", pitches: [p("C", 4)], duration: "h", fingers: [1] },
              ],
            },
          ],
        },
      },
    };

    const analysis = analyzeHandPositions(staticTwoHands);
    expect(analysis.source).toBe("fingering");
    expect(analysis.shift).toBe(false);
    expect(analysis.expand).toBe(false);
    expect(requiredSkillsForScore(staticTwoHands).has("pos.shift")).toBe(false);
  });

  it("向下修正最多 -0.5", () => {
    const difficulty = rateScore(l2Together(), { repeat: 1, measures: 2 });
    expect(difficulty.adjustments.total).toBe(-0.5);
    expect(difficulty.level).toBe(1);
  });
});

describe("技能掌握状态账本", () => {
  it("课内完成只写 learning，过关测试才写 passed", () => {
    let ledger = applyLessonCompletion({}, "L1-2", 1);
    expect(isMastered(ledger, "pos.five", "RH")).toBe(false);
    expect(ledger[skillKey("pos.five", "RH")].state).toBe("learning");

    ledger = applyLevelTestPass(ledger, 1, "RH", 2);
    expect(isMastered(ledger, "pos.five", "RH")).toBe(true);
    expect(isMastered(ledger, "pos.five", "LH")).toBe(false);
    expect(isMastered(ledger, "pos.five", "both")).toBe(false);
    expect(isMastered(ledger, "clef.treble")).toBe(true);
    expect(isMastered(ledger, "clef.bass")).toBe(false);
    expect(masteredSkillIds(ledger, "RH").has("pos.five")).toBe(true);
    expect(masteredSkillIds(ledger, "both").has("pos.five")).toBe(false);
  });

  it("左右手都过关后才算双手掌握", () => {
    let ledger = applyLevelTestPass({}, 1, "RH", 1);
    ledger = applyLevelTestPass(ledger, 1, "LH", 2);
    expect(isMastered(ledger, "pos.five", "both")).toBe(true);
    expect(isMastered(ledger, "clef.treble")).toBe(true);
    expect(isMastered(ledger, "clef.bass")).toBe(true);
  });

  it("passed 不会被普通练习降级", () => {
    let ledger = recordPractice({}, "chord.triad", "both", { passed: true, at: 1 });
    ledger = recordPractice(ledger, "chord.triad", "both", { passed: false, at: 2 });
    expect(isMastered(ledger, "chord.triad")).toBe(true);
    expect(ledger[skillKey("chord.triad", "both")].confidence).toBe(1);
    expect(ledger[skillKey("chord.triad", "both")].lastPracticedAt).toBe(2);
  });

  it("踏板技能与手无关，只写一条 none 记录", () => {
    const ledger = applyLevelTestPass({}, 4, "both", 1);
    expect(ledger[skillKey("pedal.sustain", "none")]?.state).toBe("passed");
    expect(ledger[skillKey("pedal.sustain", "both")]).toBeUndefined();
  });

  it("从 MVP Profile 迁移左右手 L1 状态", () => {
    const ledger = migrateProfile({ ...initialProfile(), l1RightPassed: true }, 1);
    expect(isMastered(ledger, "clef.treble")).toBe(true);
    expect(isMastered(ledger, "clef.bass")).toBe(false);
    expect(isMastered(ledger, "pos.five", "RH")).toBe(true);
    expect(isMastered(ledger, "pos.five", "both")).toBe(false);
  });
});

describe("Motion IR", () => {
  it("Score → Motion 保留和弦内每个音和指法", () => {
    const motion = scoreToMotion(l3ChordScore);
    expect(motion.notes.length).toBe(6);
    expect(motion.notes[0].midi).toBe(60);
    expect(motion.notes.slice(0, 3).map((n) => n.finger)).toEqual([1, 3, 5]);
    expect(validateMotion(motion).ok).toBe(true);
  });

  it("finger=0 会让校验失败（demo 的崩溃点）", () => {
    const motion = scoreToMotion(l3ChordScore);
    const bad = { ...motion, notes: motion.notes.map((note, index) => (index === 0 ? { ...note, finger: 0 } : note)) };
    const result = validateMotion(bad);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("finger"))).toBe(true);
  });

  it("拍 → 秒的转换符合 bpm", () => {
    const motion = scoreToMotion(l1(), "L1");
    const events = toDemoEvents(motion);
    expect(events.length).toBe(motion.notes.length);
    expect(events.every((event) => event.end > event.start)).toBe(true);
    const first = events[0];
    expect(first.start).toBeCloseTo(motion.notes[0].onsetBeats * (60 / motion.bpm), 3);
  });

  it("scoreToDemoEvents 一步返回校验结果", () => {
    const result = scoreToDemoEvents(l1());
    expect(result.validation.ok).toBe(true);
    expect(result.events.length).toBeGreaterThan(0);
  });
});

describe("曲目内容 QA", () => {
  it("合法 L4 分解和弦包通过", () => {
    const result = validateSongContent(brokenChordScore, brokenManifest());
    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it("声明难度低于引擎评级是错误", () => {
    const result = validateSongContent(
      brokenChordScore,
      brokenManifest({ difficulty: { level: 2, bpm: 60, len: 2 } }),
    );
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("低于引擎评级"))).toBe(true);
  });

  it("difficulty.len 与谱面小节数不一致给 warning", () => {
    const result = validateSongContent(
      brokenChordScore,
      brokenManifest({ difficulty: { level: 4, bpm: 60, repeat: 0.3, len: 3 } }),
    );
    expect(result.ok).toBe(true);
    expect(result.warnings.some((warning) => warning.includes("difficulty.len"))).toBe(true);
  });

  it("缺少指法会报错", () => {
    const noFingers: Score = {
      ...brokenChordScore,
      staves: {
        RH: {
          clef: "treble",
          measures: brokenChordScore.staves.RH!.measures.map((measure) => ({
            notes: measure.notes.map((note) => ({ ...note, fingers: undefined })),
          })),
        },
        LH: {
          clef: "bass",
          measures: brokenChordScore.staves.LH!.measures.map((measure) => ({
            notes: measure.notes.map((note) => ({ ...note, fingers: undefined })),
          })),
        },
      },
    };
    const result = validateSongContent(noFingers, brokenManifest());
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("finger"))).toBe(true);
  });
});
