# L1 识谱与视奏 Web 闭环 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在本地网页里跑通 L1：自评进入识谱，过关后才能做单手视奏，视奏弹错不停，并且一条最多弹两遍。

**Architecture:** 词汇表、出题、解锁和 MIDI 比对都是纯函数，测试不打开浏览器。Vue 只负责把这些函数显示出来。识谱和视奏共用 `Score` 与 `compare`，用模式区分「弹错停下」和「弹错继续」。本计划把 L1–L6 的允许范围写进数据并测完，但生成器和界面只做 L1。

**Tech Stack:** Vite 6、Vue 3、TypeScript、Vitest、happy-dom、VexFlow 4、Web MIDI、Web Audio、idb（IndexedDB）。

**Spec:** [docs/MVP.md](../../MVP.md) 第 3–7 节、第 9–12 节。本计划对应验收标准 1–7 的 L1 部分。PDF、主题、每日目标、Flutter、L2–L6 的课和生成器不在本计划内。

## Global Constraints

- 全部本地计算，不依赖云端大模型。
- 界面不显示百分制。通过或失败只用一句白话，失败时只指出一个音或一种节奏。
- 识谱可以看键盘，弹错停下，指法始终显示。屏幕键盘图不能点按发声。
- 视奏不显示键盘图。提示文案是「眼睛尽量保持看谱，不要盯着键盘」。禁止回退，错音只标记不打断。
- 单条视奏片段最多练习 2 遍。识谱不使用这条规则。
- 自评不能直接解锁视奏。手动切换不能升到未过关的档。
- 找键、敲节奏、过关测试和视奏都要已连接的 MIDI。卡片可以先看。
- L1 过关：左右手各一条新的 4 小节，每条至少 8 个音，60 BPM。每条音高错不超过 2 个。一个音比拍点晚超过 2 拍记一次节奏中断，一条里达到 2 次则不通过。
- 同一档连续 3 次测试不通过：速度降 8 BPM，只降一次，最低 44 BPM。L1 因此从 60 降到 52。音的范围不放宽。
- 视奏生成结果只能使用该档词汇。L1 只有 C 大调、4/4、单手、C 五指、四分/二分/全音符及对应休止符。
- 中央 C 为 C4。右手 C4–G4 指法 1–5，左手 C3–G3 指法 5–1。中央 C 写在高音谱下加一线。
- 开发顺序是 L1 → L6。本计划结束后，L2 及以后仍应调用同一套 `isAllowed`，不能另写一套过滤。

## 范围

本计划做完时，用户能：回答三道自评、练完 L1 的四课、通过或未通过 L1 测试、在已解锁的那只手上视奏一条 L1，并看到不打分的复盘。错题记在本地。

明确不做，留给后续计划：

- L2–L6 的课程、过关测试和 `generate`。允许范围的数据与 `isAllowed` 在本计划里就写好。
- 三道都选「会」之后再加试两档。本计划只做 L1 测试。
- PDF、界面主题、每日练习目标分钟数。
- Flutter、蓝牙 MIDI、麦克风。

## 文件

- `package.json`、`vite.config.ts`、`tsconfig.json`、`index.html`：工程入口。
- `src/domain/types.ts`：谱面和档案的类型。
- `src/domain/pitch.ts`：音名、MIDI 号、L1 提示句。
- `src/domain/vocabulary.ts`：六档允许范围、C 五指。
- `src/domain/allowed.ts`：`isAllowed(score)`。
- `src/domain/generate.ts`：`generateL1`。
- `src/domain/profile.ts`：自评分流、课进度、解锁、两遍限制、降速。
- `src/domain/compare.ts`：音高与节奏比对。
- `src/domain/feedback.ts`：过关文案。
- `src/storage/db.ts`：IndexedDB 读写档案。
- `src/midi/access.ts`：Web MIDI 订阅。
- `src/audio/preview.ts`：节拍器与预览。
- `src/notation/renderScore.ts`：VexFlow。
- `src/ui/HomeView.vue`、`PlacementView.vue`、`ReadingView.vue`、`SightView.vue`、`ReviewView.vue`。
- `src/App.vue`、`src/main.ts`：视图切换。
- `test/*.test.ts`：与上面的纯函数一一对应。

---

### Task 1: 工程骨架与音高

**Files:**
- Create: `package.json`
- Create: `vite.config.ts`
- Create: `tsconfig.json`
- Create: `index.html`
- Create: `src/main.ts`
- Create: `src/App.vue`
- Create: `src/domain/types.ts`
- Create: `src/domain/pitch.ts`
- Test: `test/pitch.test.ts`

**Interfaces:**
- Consumes: 无。
- Produces:
  - `Pitch`: `{ step: "C"|"D"|"E"|"F"|"G"|"A"|"B"; octave: number; alteration: -1|0|1 }`
  - `pitchToMidi(pitch: Pitch): number`，C4 = 60
  - `pitchLabel(pitch: Pitch): string`，例如 `F4`、`Bb4`、`F#4`
  - `parsePitchLabel(label: string): Pitch`

- [ ] **Step 1: 写会失败的测试**

```ts
import { describe, expect, it } from "vitest";
import { parsePitchLabel, pitchLabel, pitchToMidi } from "../src/domain/pitch";

describe("pitch", () => {
  it("maps middle C and the L1 five-finger notes", () => {
    expect(pitchToMidi({ step: "C", octave: 4, alteration: 0 })).toBe(60);
    expect(pitchToMidi({ step: "D", octave: 4, alteration: 0 })).toBe(62);
    expect(pitchToMidi({ step: "E", octave: 4, alteration: 0 })).toBe(64);
    expect(pitchToMidi({ step: "F", octave: 4, alteration: 0 })).toBe(65);
    expect(pitchToMidi({ step: "G", octave: 4, alteration: 0 })).toBe(67);
    expect(pitchToMidi({ step: "C", octave: 3, alteration: 0 })).toBe(48);
    expect(pitchToMidi({ step: "B", octave: 4, alteration: -1 })).toBe(70);
  });

  it("round-trips labels used by the weak-note queue", () => {
    expect(pitchLabel({ step: "F", octave: 4, alteration: 0 })).toBe("F4");
    expect(pitchLabel({ step: "B", octave: 4, alteration: -1 })).toBe("Bb4");
    expect(parsePitchLabel("F#4")).toEqual({ step: "F", octave: 4, alteration: 1 });
  });
});
```

- [ ] **Step 2: 安装依赖并确认测试失败**

```powershell
npm install
npm test
```

Expected: FAIL，找不到 `../src/domain/pitch`。先写下面的工程文件，再跑一次；这一次仍应因没有 `pitch.ts` 而失败。

`package.json`:

```json
{
  "name": "piano-buddy",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "test": "vitest run",
    "build": "vue-tsc --noEmit && vite build"
  },
  "dependencies": {
    "idb": "^8.0.2",
    "vexflow": "^4.2.5",
    "vue": "^3.5.13"
  },
  "devDependencies": {
    "@types/node": "^22.10.2",
    "@vitejs/plugin-vue": "^5.2.1",
    "@vue/test-utils": "^2.4.6",
    "happy-dom": "^16.7.1",
    "typescript": "^5.7.2",
    "vite": "^6.0.6",
    "vitest": "^3.0.5",
    "vue-tsc": "^2.2.0"
  }
}
```

`vite.config.ts`:

```ts
import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [vue()],
  test: {
    environment: "happy-dom",
    include: ["test/**/*.test.ts"],
  },
});
```

`tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "jsx": "preserve",
    "lib": ["ES2022", "DOM"],
    "types": ["vite/client"],
    "skipLibCheck": true,
    "noEmit": true,
    "isolatedModules": true
  },
  "include": ["src", "test", "vite.config.ts"]
}
```

`index.html`:

```html
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Piano Buddy</title>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
```

`src/main.ts`:

```ts
import { createApp } from "vue";
import App from "./App.vue";

createApp(App).mount("#app");
```

`src/App.vue`:

```vue
<template>
  <main>Piano Buddy</main>
</template>
```

- [ ] **Step 3: 实现音高**

`src/domain/types.ts` 在本任务只放 `Pitch`。后面的任务往这个文件追加类型，不改 `Pitch` 的形状。

```ts
export type Step = "C" | "D" | "E" | "F" | "G" | "A" | "B";
export type Pitch = { step: Step; octave: number; alteration: -1 | 0 | 1 };
```

`src/domain/pitch.ts`:

```ts
import type { Pitch, Step } from "./types";

const SEMI: Record<Step, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

export function pitchToMidi(pitch: Pitch): number {
  return (pitch.octave + 1) * 12 + SEMI[pitch.step] + pitch.alteration;
}

export function pitchLabel(pitch: Pitch): string {
  const accidental = pitch.alteration === 1 ? "#" : pitch.alteration === -1 ? "b" : "";
  return `${pitch.step}${accidental}${pitch.octave}`;
}

export function parsePitchLabel(label: string): Pitch {
  const match = /^([A-G])([#b]?)(-?\d+)$/.exec(label);
  if (!match) throw new Error(`bad pitch label: ${label}`);
  const alteration = match[2] === "#" ? 1 : match[2] === "b" ? -1 : 0;
  return { step: match[1] as Step, octave: Number(match[3]), alteration };
}
```

- [ ] **Step 4: 确认测试通过**

```powershell
npm test
```

Expected: PASS。

- [ ] **Step 5: Commit**

```powershell
git add package.json package-lock.json vite.config.ts tsconfig.json index.html src test
git commit -m "feat: scaffold the web app and pitch mapping"
```

---

### Task 2: 六档词汇与 isAllowed

**Files:**
- Modify: `src/domain/types.ts`
- Create: `src/domain/vocabulary.ts`
- Create: `src/domain/allowed.ts`
- Test: `test/allowed.test.ts`

**Interfaces:**
- Consumes: `Pitch`、`pitchToMidi`、`pitchLabel`。
- Produces:
  - `Level = 1|2|3|4|5|6`
  - `Hand = "RH"|"LH"`
  - `Duration = "w"|"hd"|"h"|"qd"|"q"|"8"|"16"|"wr"|"hr"|"qr"|"8r"|"16r"`
  - `KeySignature = "C"|"F"|"G"|"D"|"Bb"`
  - `Score`，字段见 Step 3
  - `DURATION_BEATS: Record<Duration, number>`
  - `pitchesFor(position: PositionId, hand: Hand): Pitch[]`
  - `fingerFor(position: PositionId, hand: Hand, pitch: Pitch): number`
  - `isAllowed(score: Score): boolean`

- [ ] **Step 1: 写会失败的测试**

```ts
import { describe, expect, it } from "vitest";
import { isAllowed } from "../src/domain/allowed";
import { fingerFor } from "../src/domain/vocabulary";
import type { Score } from "../src/domain/types";

function l1(hand: "RH" | "LH" = "RH"): Score {
  const pitches = hand === "RH"
    ? [["C", 4], ["D", 4], ["E", 4], ["F", 4]]
    : [["C", 3], ["D", 3], ["E", 3], ["F", 3]];
  return {
    id: "t",
    mode: "sight",
    level: 1,
    meter: { beats: 4, beatValue: 4 },
    keySignature: "C",
    hands: [hand],
    bpm: 60,
    staves: {
      [hand]: {
        clef: hand === "RH" ? "treble" : "bass",
        measures: pitches.map(([step, octave]) => ({
          notes: [{
            id: `${step}${octave}`,
            pitches: [{ step, octave, alteration: 0 }],
            duration: "w",
            fingers: [fingerFor("C", hand, { step: step as "C", octave: octave as number, alteration: 0 })],
          }],
        })),
      },
    },
  } as Score;
}

describe("isAllowed", () => {
  it("accepts an L1 whole-note line and the C position fingers", () => {
    expect(isAllowed(l1("RH"))).toBe(true);
    expect(fingerFor("C", "RH", { step: "C", octave: 4, alteration: 0 })).toBe(1);
    expect(fingerFor("C", "LH", { step: "C", octave: 3, alteration: 0 })).toBe(5);
    expect(fingerFor("C", "RH", { step: "G", octave: 4, alteration: 0 })).toBe(5);
  });

  it("rejects eighth notes, chords, black keys, and two hands at L1", () => {
    const eighth = l1();
    eighth.staves.RH!.measures[0].notes[0].duration = "8";
    expect(isAllowed(eighth)).toBe(false);

    const chord = l1();
    chord.staves.RH!.measures[0].notes[0].pitches.push({ step: "E", octave: 4, alteration: 0 });
    expect(isAllowed(chord)).toBe(false);

    const sharp = l1();
    sharp.staves.RH!.measures[0].notes[0].pitches[0].alteration = 1;
    expect(isAllowed(sharp)).toBe(false);

    const both = l1();
    both.hands = ["RH", "LH"];
    expect(isAllowed(both)).toBe(false);
  });

  it("accepts an F major eighth-note line only from L2", () => {
    const score = l1();
    score.level = 2;
    score.keySignature = "F";
    score.staves.RH!.measures[0].notes = Array.from({ length: 8 }, (_, index) => ({
      id: `eighth-${index}`,
      pitches: [{ step: "B" as const, octave: 4, alteration: -1 as const }],
      duration: "8" as const,
      fingers: [4],
    }));
    expect(isAllowed(score)).toBe(true);
    score.level = 1;
    expect(isAllowed(score)).toBe(false);
  });
});
```

- [ ] **Step 2: 跑测试，确认失败**

```powershell
npm test -- test/allowed.test.ts
```

Expected: FAIL，`isAllowed` 未定义。

- [ ] **Step 3: 写词汇表和校验**

在 `src/domain/types.ts` 追加：

```ts
export type Level = 1 | 2 | 3 | 4 | 5 | 6;
export type Hand = "RH" | "LH";
export type Clef = "treble" | "bass";
export type Duration = "w" | "hd" | "h" | "qd" | "q" | "8" | "16" | "wr" | "hr" | "qr" | "8r" | "16r";
export type KeySignature = "C" | "F" | "G" | "D" | "Bb";
export type Mode = "reading-lesson" | "reading-test" | "sight";
export type PositionId = "C" | "D-shift" | "F" | "G" | "D-major" | "Bb";

export type NoteEvent = {
  id: string;
  pitches: Pitch[];
  duration: Duration;
  fingers?: number[];
};

export type Measure = { notes: NoteEvent[] };
export type Stave = { clef: Clef; measures: Measure[] };

export type Score = {
  id: string;
  mode: Mode;
  level: Level;
  meter: { beats: 3 | 4; beatValue: 4 };
  keySignature: KeySignature;
  hands: Hand[];
  bpm: number;
  staves: Partial<Record<Hand, Stave>>;
};
```

`src/domain/vocabulary.ts` 写出六个档的数据。`DURATION_BEATS`：`w/wr=4`，`hd=3`，`h/hr=2`，`qd=1.5`，`q/qr=1`，`8/8r=0.5`，`16/16r=0.25`。

手位与第 4.2 节一致：

| position | RH 1→5 | LH 5→1 |
|---|---|---|
| C | C4 D4 E4 F4 G4 | C3 D3 E3 F3 G3 |
| D-shift | D4 E4 F4 G4 A4 | D3 E3 F3 G3 A3 |
| F | F4 G4 A4 Bb4 C5 | F3 G3 A3 Bb3 C4 |
| G | G4 A4 B4 C5 D5 | G3 A3 B3 C4 D4 |
| D-major | D4 E4 F#4 G4 A4 | D3 E3 F#3 G3 A3 |
| Bb | Bb4 C5 D5 Eb5 F5 | Bb3 C4 D4 Eb4 F4 |

`LEVEL_SPEC`：

- L1：4/4，C，时值 `w h q wr hr qr`，和弦音数 1，无临时升降号，手位 C，加线不超过 1。
- L2：4/4，C/F/G，加上 `8 8r`，和弦音数 1，手位 C、D-shift、F、G。
- L3：在 L2 上允许临时升降号，和弦音数 3。合法和弦只有 C-E-G、F-A-C、G-B-D，八度跟该手的五指位置。
- L4：加上 3/4、D、Bb，时值不新增，手位加上 D-major 与 Bb。手位两端各扩一个全音（2 个半音）也合法。
- L5：加上 `hd qd`。
- L6：加上 `16 16r`。相邻两个发声音可以相距最多 12 个半音。音可以落到上下各两条加线以内。

`isAllowed` 规则：

1. 只用到 `score.hands` 里的谱表，每只手的谱号正确（RH treble，LH bass）。
2. 拍号、调号、时值都在该档 `LEVEL_SPEC` 里。
3. 每个发声音的 `alteration !== 0` 时，该档必须 `accidentals: true`。调号里的音（F 大调的 Bb，G 大调的 F#，D 大调的 F# 与 C#，降 B 大调的 Bb 与 Eb）写在音符上时也算临时升降号，L1/L2 直接拒绝带 `alteration` 的音符；这些音在 L2 只通过调号出现，生成器写 `alteration: 0` 以外的音高时用调号音的实际音高标签，但 L2 的 F 五指 Bb 必须能通过。实现时：L2 允许「调号所含的变音」，不允许调号之外的变音。L1 不允许任何变音。
4. 每个小节的时值之和等于 `meter.beats`。
5. 和弦音数不超过 `maxChordSize`。音数大于 1 时，音名集合必须是上述三个和弦之一。
6. 音高要么落在该档手位里，要么符合 L4 的两端扩展，要么符合 L6 的两条加线。
7. L1 的 `hands.length === 1`。L6 相邻发声音的半音距离不超过 12。

L4 扩展：某个手位里最低音再低 2 个半音，或最高音再高 2 个半音。C 右手因此可以是 B3 或 A4。

- [ ] **Step 4: 确认测试通过**

```powershell
npm test -- test/allowed.test.ts
```

Expected: PASS。

- [ ] **Step 5: Commit**

```powershell
git add src/domain/types.ts src/domain/vocabulary.ts src/domain/allowed.ts test/allowed.test.ts
git commit -m "feat: lock the six-level vocabulary allow-list"
```

---

### Task 3: L1 生成器

**Files:**
- Create: `src/domain/generate.ts`
- Test: `test/generate.test.ts`

**Interfaces:**
- Consumes: `Score`、`isAllowed`、`pitchesFor`、`fingerFor`、`DURATION_BEATS`。
- Produces: `generateL1(request: { hand: Hand; seed: number; mode: Mode }): Score`

- [ ] **Step 1: 写会失败的测试**

```ts
import { describe, expect, it } from "vitest";
import { isAllowed } from "../src/domain/allowed";
import { generateL1 } from "../src/domain/generate";

describe("generateL1", () => {
  it("builds a deterministic four-bar single-hand line with at least 8 notes", () => {
    const score = generateL1({ hand: "RH", seed: 3, mode: "reading-test" });
    expect(score.level).toBe(1);
    expect(score.hands).toEqual(["RH"]);
    expect(score.staves.RH?.measures).toHaveLength(4);
    expect(score.keySignature).toBe("C");
    expect(score.meter).toEqual({ beats: 4, beatValue: 4 });
    expect(isAllowed(score)).toBe(true);
    const sounding = score.staves.RH!.measures.flatMap((measure) =>
      measure.notes.filter((note) => note.pitches.length > 0),
    );
    expect(sounding.length).toBeGreaterThanOrEqual(8);
    expect(generateL1({ hand: "RH", seed: 3, mode: "reading-test" })).toEqual(score);
  });

  it("gives the left hand bass C3-G3", () => {
    const score = generateL1({ hand: "LH", seed: 9, mode: "sight" });
    expect(score.staves.LH?.clef).toBe("bass");
    expect(isAllowed(score)).toBe(true);
  });
});
```

- [ ] **Step 2: 跑测试，确认失败**

```powershell
npm test -- test/generate.test.ts
```

Expected: FAIL，`generateL1` 未定义。

- [ ] **Step 3: 实现生成器**

用 `mulberry32(seed)`。最多尝试 30 次：每小节用权重抽出时值直到凑满 4 拍，权重为四分 0.7、二分 0.2、四分休止 0.1。音从该手 C 五指均匀抽取。指法用 `fingerFor("C", hand, pitch)`。发声音总数不足 8 就重试。30 次仍失败则抛 `Error("failed to generate an L1 score")`。`id` 为 `l1-${hand}-${seed}`，`bpm` 为 60，`level` 为 1。

- [ ] **Step 4: 确认测试通过**

```powershell
npm test -- test/generate.test.ts
```

Expected: PASS。

- [ ] **Step 5: Commit**

```powershell
git add src/domain/generate.ts test/generate.test.ts
git commit -m "feat: generate deterministic L1 sight-reading lines"
```

---

### Task 4: 档案、分流、解锁、两遍限制

**Files:**
- Create: `src/domain/profile.ts`
- Test: `test/profile.test.ts`

**Interfaces:**
- Consumes: `Hand`、`Score`。
- Produces:
  - `Assessment = { knowsTreble: boolean; knowsBass: boolean; keepsPulse: boolean }`
  - `Profile`，字段：`assessment`、`lessonId`（`"L1-1"|"L1-2"|"L1-3"|"L1-4"|"L1-test"|null`）、`lessonPhase`（`"notes"|"lines"`）、`l1RightPassed`、`l1LeftPassed`、`failStreak`、`slowed`、`weakPitchQueue: string[]`、`findCorrect`、`linesCompleted`、`tapStreak`、`sightUses: Record<string, number>`、`errorSnippets: Score[]`、`lastSeed`
  - `initialProfile(): Profile`
  - `routeAfterAssessment(assessment: Assessment): { kind: "lesson"; lessonId: "L1-1" } | { kind: "test"; hands: Hand[] }`
  - `applyAssessment(profile, assessment): Profile`
  - `canEnterSight(profile, hand: Hand): boolean`
  - `registerSightUse(profile, scoreId: string): { profile: Profile; allowed: boolean }`
  - `testBpm(profile: Profile): number`

分流优先级，按这个顺序，不再另作解释：

1. 不认识高音谱，或跟不上拍 → `{ kind: "lesson", lessonId: "L1-1" }`
2. 认识高音谱、跟得上拍、不认识低音谱 → `{ kind: "test", hands: ["RH"] }`
3. 三道都是会 → `{ kind: "test", hands: ["RH", "LH"] }`

- [ ] **Step 1: 写会失败的测试**

```ts
import { describe, expect, it } from "vitest";
import {
  applyAssessment,
  canEnterSight,
  initialProfile,
  registerSightUse,
  routeAfterAssessment,
  testBpm,
} from "../src/domain/profile";

describe("profile", () => {
  it("does not unlock sight reading from the questionnaire", () => {
    const profile = applyAssessment(initialProfile(), {
      knowsTreble: true,
      knowsBass: true,
      keepsPulse: true,
    });
    expect(profile.lessonId).toBe("L1-test");
    expect(canEnterSight(profile, "RH")).toBe(false);
    expect(canEnterSight(profile, "LH")).toBe(false);
  });

  it("sends a complete beginner to the pulse lesson", () => {
    expect(routeAfterAssessment({
      knowsTreble: false,
      knowsBass: false,
      keepsPulse: false,
    })).toEqual({ kind: "lesson", lessonId: "L1-1" });
  });

  it("tests only the right hand when the bass clef is unknown", () => {
    expect(routeAfterAssessment({
      knowsTreble: true,
      knowsBass: false,
      keepsPulse: true,
    })).toEqual({ kind: "test", hands: ["RH"] });
  });

  it("allows a sight line twice and blocks the third play", () => {
    let profile = initialProfile();
    profile = { ...profile, l1RightPassed: true };
    const first = registerSightUse(profile, "l1-RH-1");
    const second = registerSightUse(first.profile, "l1-RH-1");
    const third = registerSightUse(second.profile, "l1-RH-1");
    expect(first.allowed).toBe(true);
    expect(second.allowed).toBe(true);
    expect(third.allowed).toBe(false);
  });

  it("drops the test tempo by 8 bpm once after three failures", () => {
    const profile = { ...initialProfile(), failStreak: 3, slowed: true };
    expect(testBpm(initialProfile())).toBe(60);
    expect(testBpm(profile)).toBe(52);
  });
});
```

- [ ] **Step 2: 跑测试，确认失败**

```powershell
npm test -- test/profile.test.ts
```

Expected: FAIL，模块不存在。

- [ ] **Step 3: 实现档案函数**

`initialProfile` 的计数字段都是 0 或 `false`，`lessonId` 和 `assessment` 为 `null`，队列和错题是空数组，`lastSeed` 为 1，`lessonPhase` 为 `"notes"`。

`applyAssessment` 写入答案。路由是 lesson 时 `lessonId` 为 `L1-1`。路由是 test 时 `lessonId` 为 `L1-test`。两种情况都不把 `l1RightPassed` 或 `l1LeftPassed` 设为 true。

`canEnterSight` 只看对应手的 L1 旗标。

`registerSightUse`：`sightUses[id] >= 2` 时 `allowed: false` 且不增加次数；否则次数加 1 并 `allowed: true`。

`testBpm`：`slowed` 为 true 时返回 `Math.max(44, 52)`，否则 60。

- [ ] **Step 4: 确认测试通过**

```powershell
npm test -- test/profile.test.ts
```

Expected: PASS。

- [ ] **Step 5: Commit**

```powershell
git add src/domain/profile.ts test/profile.test.ts
git commit -m "feat: route assessment without unlocking sight reading"
```

---

### Task 5: L1 四课的进度

**Files:**
- Modify: `src/domain/profile.ts`
- Test: `test/lessons.test.ts`

**Interfaces:**
- Consumes: `Profile`、`pitchLabel`。
- Produces:
  - `recordTap(profile, gapMs: number | null): Profile`。`gapMs === null` 表示这一下是起点。
  - `recordFindKey(profile, targetLabel: string, correct: boolean): Profile`
  - `recordLineFinished(profile): Profile`
  - 课完成时推进 `lessonId`：L1-1 → L1-2 → L1-3 → L1-4 → L1-test。换课时把 `findCorrect`、`linesCompleted`、`tapStreak` 清零，`lessonPhase` 回到 `"notes"`。

课内标准：

- L1-1：连续 8 个间隔都在 800–1200ms。超出则 `tapStreak` 归零。起点那一下不计。
- L1-2：找对 8 次后进入 L1-3。找错时把目标音标签推进 `weakPitchQueue` 两次。
- L1-3：弹完 2 条后进入 L1-4。
- L1-4：先找对 8 次（`lessonPhase` 从 `"notes"` 变成 `"lines"`），再弹完 2 条，然后 `lessonId` 为 `L1-test`。

- [ ] **Step 1: 写会失败的测试**

```ts
import { describe, expect, it } from "vitest";
import { initialProfile, recordFindKey, recordLineFinished, recordTap } from "../src/domain/profile";

describe("L1 lessons", () => {
  it("advances after eight steady gaps", () => {
    let profile = { ...initialProfile(), lessonId: "L1-1" as const };
    profile = recordTap(profile, null);
    for (let i = 0; i < 7; i += 1) profile = recordTap(profile, 1000);
    expect(profile.lessonId).toBe("L1-1");
    profile = recordTap(profile, 1000);
    expect(profile.lessonId).toBe("L1-2");
    expect(profile.tapStreak).toBe(0);
  });

  it("resets the tap streak when a gap is outside 800-1200ms", () => {
    let profile = { ...initialProfile(), lessonId: "L1-1" as const };
    profile = recordTap(profile, null);
    profile = recordTap(profile, 1000);
    profile = recordTap(profile, 1400);
    expect(profile.tapStreak).toBe(0);
    expect(profile.lessonId).toBe("L1-1");
  });

  it("queues a missed pitch twice and advances after eight correct finds", () => {
    let profile = { ...initialProfile(), lessonId: "L1-2" as const };
    profile = recordFindKey(profile, "F4", false);
    expect(profile.weakPitchQueue).toEqual(["F4", "F4"]);
    for (let i = 0; i < 8; i += 1) profile = recordFindKey(profile, "C4", true);
    expect(profile.lessonId).toBe("L1-3");
  });

  it("teaches left-hand notes before the left-hand lines", () => {
    let profile = { ...initialProfile(), lessonId: "L1-4" as const };
    for (let i = 0; i < 8; i += 1) profile = recordFindKey(profile, "C3", true);
    expect(profile.lessonId).toBe("L1-4");
    expect(profile.lessonPhase).toBe("lines");
    profile = recordLineFinished(profile);
    profile = recordLineFinished(profile);
    expect(profile.lessonId).toBe("L1-test");
  });
});
```

- [ ] **Step 2: 跑测试，确认失败**

```powershell
npm test -- test/lessons.test.ts
```

Expected: FAIL，`recordTap` 未导出。

- [ ] **Step 3: 实现三个记录函数**

只在 `lessonId` 匹配的课里改变进度。例如在 L1-3 调用 `recordFindKey` 不增加 `findCorrect`。`recordLineFinished` 只在 L1-3，以及 L1-4 且 `lessonPhase === "lines"` 时把 `linesCompleted` 加 1。

- [ ] **Step 4: 确认测试通过**

```powershell
npm test -- test/lessons.test.ts test/profile.test.ts
```

Expected: PASS。

- [ ] **Step 5: Commit**

```powershell
git add src/domain/profile.ts test/lessons.test.ts
git commit -m "feat: advance the four L1 reading lessons"
```

---

### Task 6: 比对与过关文案

**Files:**
- Create: `src/domain/compare.ts`
- Create: `src/domain/feedback.ts`
- Modify: `src/domain/profile.ts`
- Test: `test/compare.test.ts`

**Interfaces:**
- Consumes: `Score`、`pitchToMidi`、`DURATION_BEATS`、`Profile`。
- Produces:
  - `PlayedNote = { midi: number; timeMs: number }`
  - `CompareResult = { pitchErrors: number; rhythmBreaks: number; firstWrongLabel: string | null }`
  - `compare(score: Score, hand: Hand, played: PlayedNote[], bpm: number): CompareResult`
  - `passLimit(level: Level): number`。L1 返回 2。
  - `isPass(result: CompareResult, level: Level): boolean`
  - `feedbackText(result, level, hand: Hand): string`
  - `applyTestResult(profile, hands: Hand[], results: CompareResult[]): Profile`

比对是按顺序贪心，不回溯：

1. 把休止算进拍位，但不要待匹配音。
2. 下一个演奏音配给下一个应弹音。
3. MIDI 不同，或已经没有演奏音：`pitchErrors += 1`。第一个错音记入 `firstWrongLabel`。
4. `演奏拍 - 应弹拍 > 2`：`rhythmBreaks += 1`。演奏拍 = `timeMs / (60000 / bpm)`。提前不算中断。
5. 一个音可以同时计入音高错误和节奏中断。

`isPass`：`pitchErrors <= passLimit(level)` 且 `rhythmBreaks < 2`。调用方对左右手各算一次，两只手都通过才算这只手过关。

`applyTestResult`：每只手单独判断。通过则把该手旗标设为 true。全部要求的手都通过时 `failStreak = 0`。有一只手没通过则 `failStreak += 1`；当 `failStreak >= 3` 且 `slowed` 仍是 false，把 `slowed` 设为 true。没通过的手不解锁。右手通过、左手没要求时，`lessonId` 设为 `"L1-4"`，`lessonPhase` 设为 `"notes"`。两只手都通过时 `lessonId` 保持 `"L1-test"`，视奏由旗标解锁。

文案按 `isPass` 决定。通过时只返回「这些音可以直接认了。接下来的视奏里只会用到它们。」`rhythmBreaks >= 2` 时返回「有两处比拍子晚了超过两拍。先把速度放慢，再来一条新的。」否则按 `firstWrongLabel` 返回下面这一句，没有对应标签时返回节奏句：

- `C4`：中央 C 还要找一下。它写在高音谱下加一线，右手大拇指。再来一条新的。
- `D4`：D 还要找一下。它在中央 C 上面一个白键，右手二指。再来一条新的。
- `E4`：E 还要找一下。它在第一线上，右手三指。再来一条新的。
- `F4`：F 还要找一下。它在 E 上面一格，右手四指。再来一条新的。
- `G4`：G 还要找一下。它在第二线上，右手五指。再来一条新的。
- `C3`：低音 C 还要找一下。它在低音谱第二间，左手五指。再来一条新的。
- `D3`：D 还要找一下。它在低音谱第三线，左手四指。再来一条新的。
- `E3`：E 还要找一下。它在低音谱第三间，左手三指。再来一条新的。
- `F3`：F 还要找一下。它在低音谱第四线，左手二指。再来一条新的。
- `G3`：G 还要找一下。它在低音谱第四间，左手大拇指。再来一条新的。

- [ ] **Step 1: 写会失败的测试**

```ts
import { describe, expect, it } from "vitest";
import { compare } from "../src/domain/compare";
import { feedbackText } from "../src/domain/feedback";
import { applyTestResult, initialProfile } from "../src/domain/profile";
import type { Score } from "../src/domain/types";

const quarters = ["C", "D", "E", "F", "C", "D", "E", "G"] as const;

function eightQuarters(): Score {
  return {
    id: "fixed",
    mode: "reading-test",
    level: 1,
    meter: { beats: 4, beatValue: 4 },
    keySignature: "C",
    hands: ["RH"],
    bpm: 60,
    staves: {
      RH: {
        clef: "treble",
        measures: [0, 1].map((measure) => ({
          notes: quarters.slice(measure * 4, measure * 4 + 4).map((step, index) => ({
            id: `${measure}-${index}`,
            pitches: [{ step, octave: 4, alteration: 0 as const }],
            duration: "q" as const,
            fingers: [1],
          })),
        })),
      },
    },
  };
}

describe("compare", () => {
  it("counts a wrong pitch and ignores an early note", () => {
    const played = quarters.map((step, index) => ({
      midi: index === 1 ? 67 : ({ C: 60, D: 62, E: 64, F: 65, G: 67 })[step],
      timeMs: index * 1000 - 50,
    }));
    const result = compare(eightQuarters(), "RH", played, 60);
    expect(result.pitchErrors).toBe(1);
    expect(result.rhythmBreaks).toBe(0);
    expect(result.firstWrongLabel).toBe("D4");
  });

  it("counts a note more than two beats late as a rhythm break", () => {
    const played = quarters.map((step, index) => ({
      midi: ({ C: 60, D: 62, E: 64, F: 65, G: 67 })[step],
      timeMs: index === 1 ? 3500 : index * 1000,
    }));
    expect(compare(eightQuarters(), "RH", played, 60).rhythmBreaks).toBe(1);
  });

  it("uses the spec copy and slows the test only on the third consecutive failure", () => {
    const failed = { pitchErrors: 3, rhythmBreaks: 0, firstWrongLabel: "F4" };
    expect(feedbackText(failed, 1, "RH")).toBe(
      "F 还要找一下。它在 E 上面一格，右手四指。再来一条新的。",
    );
    const passed = { pitchErrors: 1, rhythmBreaks: 0, firstWrongLabel: "D4" };
    expect(feedbackText(passed, 1, "RH")).toBe(
      "这些音可以直接认了。接下来的视奏里只会用到它们。",
    );
    let profile = initialProfile();
    profile = applyTestResult(profile, ["RH"], [failed]);
    profile = applyTestResult(profile, ["RH"], [failed]);
    expect(profile.slowed).toBe(false);
    profile = applyTestResult(profile, ["RH"], [failed]);
    expect(profile.slowed).toBe(true);
    expect(profile.l1RightPassed).toBe(false);
    expect(profile.lessonId).not.toBe("L1-4");
  });

  it("sends a passed right-hand-only test to the left-hand lesson", () => {
    const passed = { pitchErrors: 0, rhythmBreaks: 0, firstWrongLabel: null };
    const profile = applyTestResult(initialProfile(), ["RH"], [passed]);
    expect(profile.l1RightPassed).toBe(true);
    expect(profile.l1LeftPassed).toBe(false);
    expect(profile.lessonId).toBe("L1-4");
    expect(profile.lessonPhase).toBe("notes");
  });
});
```

- [ ] **Step 2: 跑测试，确认失败**

```powershell
npm test -- test/compare.test.ts
```

Expected: FAIL，`compare` 未定义。

- [ ] **Step 3: 实现比对、文案和测试结果**

`feedback.ts` 用一张表保存 L1 十个音的句子。通过时忽略错误明细，只返回通过句。节奏中断达到 2 次时先返回节奏句，即使同时有错音。

右手通过且本次手只有 RH：进入 L1-4 的找键阶段，并清零课内计数。左手单独通过只把 `l1LeftPassed` 设为 true。

- [ ] **Step 4: 确认测试通过**

```powershell
npm test
```

Expected: PASS。

- [ ] **Step 5: Commit**

```powershell
git add src/domain/compare.ts src/domain/feedback.ts src/domain/profile.ts test/compare.test.ts
git commit -m "feat: score L1 tests without showing a percentage"
```

---

### Task 7: 本地档案

**Files:**
- Create: `src/storage/db.ts`
- Test: `test/db.test.ts`

**Interfaces:**
- Consumes: `Profile`、`initialProfile`。
- Produces: `loadProfile(): Promise<Profile>`、`saveProfile(profile: Profile): Promise<void>`

- [ ] **Step 1: 写会失败的测试**

```ts
import { describe, expect, it } from "vitest";
import { initialProfile } from "../src/domain/profile";
import { loadProfile, saveProfile } from "../src/storage/db";

describe("profile store", () => {
  it("returns a new profile and then the saved one", async () => {
    expect(await loadProfile()).toEqual(initialProfile());
    const saved = { ...initialProfile(), l1RightPassed: true };
    await saveProfile(saved);
    expect(await loadProfile()).toEqual(saved);
  });
});
```

- [ ] **Step 2: 跑测试，确认失败**

```powershell
npm test -- test/db.test.ts
```

Expected: FAIL，模块不存在。

- [ ] **Step 3: 用 idb 实现**

数据库名 `piano-buddy`，版本 1，object store 名 `profile`，键为 `"main"`。`loadProfile` 在缺记录时返回 `initialProfile()`。happy-dom 提供 `indexedDB`。不要把档案送到网络。

- [ ] **Step 4: 确认测试通过**

```powershell
npm test -- test/db.test.ts
```

Expected: PASS。

- [ ] **Step 5: Commit**

```powershell
git add src/storage/db.ts test/db.test.ts
git commit -m "feat: store the practice profile in IndexedDB"
```

---

### Task 8: 谱面与键盘图数据

**Files:**
- Create: `src/notation/renderScore.ts`
- Create: `src/ui/KeyboardDiagram.vue`
- Test: `test/renderScore.test.ts`

**Interfaces:**
- Consumes: `Score`、`pitchToMidi`。
- Produces:
  - `renderScore(element: HTMLElement, score: Score, hand: Hand, showFingers: boolean): void`
  - `whiteKeyMidis(): number[]`，C3 到 C5 的白键 MIDI 号
  - KeyboardDiagram props：`highlightMidi: number | null`

- [ ] **Step 1: 写会失败的测试**

```ts
import { describe, expect, it } from "vitest";
import { generateL1 } from "../src/domain/generate";
import { renderScore } from "../src/notation/renderScore";

describe("renderScore", () => {
  it("draws an L1 staff into the element", () => {
    const element = document.createElement("div");
    renderScore(element, generateL1({ hand: "RH", seed: 4, mode: "sight" }), "RH", true);
    expect(element.querySelector("svg")).not.toBeNull();
  });
});
```

- [ ] **Step 2: 跑测试，确认失败**

```powershell
npm test -- test/renderScore.test.ts
```

Expected: FAIL，模块不存在。

- [ ] **Step 3: 实现渲染和键盘图**

用 VexFlow 的 `Factory` 把当前手的小节画成五线谱。`showFingers` 为 true 时，在音符上方写 `fingers[0]`。每次渲染前清空元素。

键盘图是一排白键按钮样式的 `div`，没有 click 发声。`highlightMidi` 对应的键加上 class `is-target`。视奏页面不挂这个组件。

- [ ] **Step 4: 确认测试通过**

```powershell
npm test -- test/renderScore.test.ts
```

Expected: PASS，元素里有 svg。

- [ ] **Step 5: Commit**

```powershell
git add src/notation/renderScore.ts src/ui/KeyboardDiagram.vue test/renderScore.test.ts
git commit -m "feat: render an L1 staff and a non-playable keyboard map"
```

---

### Task 9: MIDI 与预览声音

**Files:**
- Create: `src/midi/access.ts`
- Create: `src/audio/preview.ts`
- Test: `test/preview.test.ts`

**Interfaces:**
- Consumes: `Score`、`pitchToMidi`、`DURATION_BEATS`。
- Produces:
  - `subscribeMidi(onNote: (note: { midi: number; timeMs: number; kind: "on"|"off" }) => void): Promise<() => void>`
  - `previewScore(score: Score, hand: Hand, bpm: number): { stop: () => void }`
  - `startMetronome(bpm: number): { stop: () => void }`

- [ ] **Step 1: 写会失败的测试**

```ts
import { describe, expect, it } from "vitest";
import { previewScore } from "../src/audio/preview";
import { generateL1 } from "../src/domain/generate";

describe("previewScore", () => {
  it("returns a stop handle without throwing when audio is unavailable", () => {
    const score = generateL1({ hand: "RH", seed: 5, mode: "sight" });
    const playback = previewScore(score, "RH", 60);
    expect(typeof playback.stop).toBe("function");
    playback.stop();
  });
});
```

- [ ] **Step 2: 跑测试，确认失败**

```powershell
npm test -- test/preview.test.ts
```

Expected: FAIL，模块不存在。

- [ ] **Step 3: 实现 MIDI 订阅和声音**

`subscribeMidi` 调用 `navigator.requestMIDIAccess()`。没有 Web MIDI 时抛 `Error("midi-unavailable")`。把 note-on（velocity > 0）和 note-off 转成回调，`timeMs` 用 `performance.now()`。返回的函数移除监听。

`previewScore` 和 `startMetronome` 使用 `AudioContext`。环境没有 `AudioContext` 时，`previewScore` 仍返回可调用的 `stop`，不抛错。有 AudioContext 时，按拍点用振荡器播放发声音，休止留空。`stop` 停掉已安排的音。

- [ ] **Step 4: 确认测试通过**

```powershell
npm test -- test/preview.test.ts
```

Expected: PASS。

- [ ] **Step 5: Commit**

```powershell
git add src/midi/access.ts src/audio/preview.ts test/preview.test.ts
git commit -m "feat: subscribe to Web MIDI and preview a score"
```

---

### Task 10: 首页与自评

**Files:**
- Create: `src/ui/HomeView.vue`
- Create: `src/ui/PlacementView.vue`
- Test: `test/home.test.ts`

**Interfaces:**
- Consumes: `canEnterSight`、`routeAfterAssessment`。
- Produces:
  - HomeView props：`rightUnlocked: boolean`、`leftUnlocked: boolean`。事件：`open-reading`、`open-sight`、`open-placement`。
  - PlacementView 事件：`submit`，载荷是 `Assessment`。

- [ ] **Step 1: 写会失败的测试**

```ts
import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import HomeView from "../src/ui/HomeView.vue";

describe("HomeView", () => {
  it("opens reading when neither hand is unlocked", async () => {
    const wrapper = mount(HomeView, {
      props: { rightUnlocked: false, leftUnlocked: false },
    });
    await wrapper.get("[data-test=sight]").trigger("click");
    expect(wrapper.emitted("open-reading")).toBeTruthy();
    expect(wrapper.text()).toContain("先认识这五个音，视奏里只会用到它们。");
  });

  it("opens sight reading after the right hand has passed", async () => {
    const wrapper = mount(HomeView, {
      props: { rightUnlocked: true, leftUnlocked: false },
    });
    await wrapper.get("[data-test=sight]").trigger("click");
    expect(wrapper.emitted("open-sight")).toBeTruthy();
  });
});
```

- [ ] **Step 2: 跑测试，确认失败**

```powershell
npm test -- test/home.test.ts
```

Expected: FAIL，组件不存在。

- [ ] **Step 3: 实现两个页面**

首页两个按钮，`data-test` 为 `reading` 和 `sight`。视奏按钮在两只手都没解锁时发出 `open-reading`，并显示「先认识这五个音，视奏里只会用到它们。」至少一只手解锁时发出 `open-sight`。

自评是三道题，每道两个按钮：「会」「还不会」。提交时发出 `{ knowsTreble, knowsBass, keepsPulse }`。不在这个组件里解锁视奏。

- [ ] **Step 4: 确认测试通过**

```powershell
npm test -- test/home.test.ts
```

Expected: PASS。

- [ ] **Step 5: Commit**

```powershell
git add src/ui/HomeView.vue src/ui/PlacementView.vue test/home.test.ts
git commit -m "feat: add the home screen and the three-question placement"
```

---

### Task 11: 识谱课界面

**Files:**
- Create: `src/ui/ReadingView.vue`
- Test: `test/reading-view.test.ts`

**Interfaces:**
- Consumes: `generateL1`、`renderScore`、`recordTap`、`recordFindKey`、`recordLineFinished`、`subscribeMidi`、KeyboardDiagram、`weakPitchQueue`。
- Produces: props `profile`、`midiConnected: boolean`。事件 `update-profile`。

界面按 `lessonId` 显示：

- L1-1 卡片：「跟着节拍器敲任何一个键。只看间隔稳不稳。」不画五线谱。
- L1-2 卡片：「D 在中央 C 上面一个白键，高音谱下加一间，右手二指。」其他四个音各写两句以内，包含位置和手指。画谱，画键盘图，标出目标键。
- L1-3：生成一条右手 4 小节，弹错时停住并说出该音的提示。这个音弹对才进入下一音。
- L1-4：先单音，再一条左手 4 小节。谱号用低音谱。

没有 MIDI 时显示「请连接 MIDI 键盘」，不调用进度函数。键盘图没有点击发声。

下一题优先弹出 `weakPitchQueue` 的第一项，并在出题后从队列移除一项。

- [ ] **Step 1: 写会失败的测试**

```ts
import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import { initialProfile } from "../src/domain/profile";
import ReadingView from "../src/ui/ReadingView.vue";

describe("ReadingView", () => {
  it("shows the keyboard map and does not advance without MIDI", async () => {
    const wrapper = mount(ReadingView, {
      props: {
        profile: { ...initialProfile(), lessonId: "L1-2" },
        midiConnected: false,
      },
    });
    expect(wrapper.text()).toContain("请连接 MIDI 键盘");
    expect(wrapper.find("[data-test=keyboard]").exists()).toBe(true);
    expect(wrapper.emitted("update-profile")).toBeFalsy();
  });
});
```

- [ ] **Step 2: 跑测试，确认失败**

```powershell
npm test -- test/reading-view.test.ts
```

Expected: FAIL，组件不存在。

- [ ] **Step 3: 实现识谱页**

把 MIDI note-on 交给对应的 `recordTap` 或 `recordFindKey`。目标音用 `pitchToMidi` 比较。进度变化时发出整个新档案。L1-3 和 L1-4 的短句在弹完后调用 `recordLineFinished`，然后换一个新的 seed。

- [ ] **Step 4: 确认测试通过**

```powershell
npm test -- test/reading-view.test.ts
```

Expected: PASS。

- [ ] **Step 5: Commit**

```powershell
git add src/ui/ReadingView.vue test/reading-view.test.ts
git commit -m "feat: practice the four L1 reading lessons"
```

---

### Task 12: 视奏、复盘和存档接线

**Files:**
- Create: `src/ui/SightView.vue`
- Create: `src/ui/ReviewView.vue`
- Modify: `src/App.vue`
- Test: `test/sight-view.test.ts`

**Interfaces:**
- Consumes: `generateL1`、`compare`、`feedbackText`、`registerSightUse`、`canEnterSight`、`loadProfile`、`saveProfile`、`startMetronome`、`previewScore`。
- Produces: App 在 `home`、`placement`、`reading`、`sight`、`review` 之间切换，并在每次档案变化后 `saveProfile`。

视奏流程：

1. 准备 25 秒。谱面可见，MIDI note-on 不记入比对。文案：「先不要动手。看看调号、拍号，左右手大概在哪一块，心里数一下节奏。」
2. 25 秒后节拍器开始，时间从这一刻算起。
3. 没有暂停按钮，也没有重弹按钮。
4. 总拍数结束后调用 `compare`。音高错的音符在谱上保持标记。
5. 进入复盘。显示 `feedbackText`。音高没全对，或有节奏中断时，把该 `Score` 放进 `errorSnippets`。视奏不因为错而锁回识谱。
6. `registerSightUse` 在演奏开始时调用。同一条达到 2 次后，视奏和错题重练都不再打开它，并改用新的 seed。错题重练占用的就是这两次里面的剩余次数。

复盘页按钮：「再看一条新的」。它回到视奏并生成新题，不重开刚弹完的那条。

App 启动时 `loadProfile`。没有 `assessment` 时从自评开始。

- [ ] **Step 1: 写会失败的测试**

```ts
import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import { initialProfile } from "../src/domain/profile";
import SightView from "../src/ui/SightView.vue";

describe("SightView", () => {
  it("hides the keyboard map and tells the player to keep looking at the staff", () => {
    const wrapper = mount(SightView, {
      props: {
        profile: { ...initialProfile(), l1RightPassed: true },
        midiConnected: true,
      },
    });
    expect(wrapper.find("[data-test=keyboard]").exists()).toBe(false);
    expect(wrapper.text()).toContain("眼睛尽量保持看谱，不要盯着键盘");
    expect(wrapper.find("[data-test=rewind]").exists()).toBe(false);
  });
});
```

- [ ] **Step 2: 跑测试，确认失败**

```powershell
npm test -- test/sight-view.test.ts
```

Expected: FAIL，组件不存在。

- [ ] **Step 3: 实现视奏、复盘和 App**

`SightView` 在准备阶段渲染谱面和 25 秒倒计时，并提供「听一遍」按钮调用 `previewScore`。L1 整条 4 小节就是一句，这个按钮就是分句预览。速度滑条范围 40–120，默认 `testBpm(profile)`。

`ReviewView` 只显示一句反馈和错音标记，不显示百分比。

`App.vue` 把首页、自评、识谱、视奏、复盘接起来。视奏入口在未解锁时进入当前 `lessonId`；档案还没有课号时进入自评。

- [ ] **Step 4: 确认测试通过**

```powershell
npm test
npm run build
```

Expected: 测试 PASS，`vue-tsc` 和 Vite build 都通过。

- [ ] **Step 5: 手工核对**

```powershell
npm run dev
```

在 Chrome 里用 USB MIDI 键盘核对：

1. 三道都选「还不会」，进入跟拍，不能打开视奏。
2. 识谱页能看见键盘图；弹错会停住。
3. 右手测试错 3 个音时不解锁，句子里没有百分数。
4. 右手通过后可以视奏右手；准备的 25 秒里弹琴不记错。
5. 视奏没有重弹按钮。同一条第三次不再出现。
6. 刷新页面后，解锁状态还在。

- [ ] **Step 6: Commit**

```powershell
git add src/ui/SightView.vue src/ui/ReviewView.vue src/App.vue test/sight-view.test.ts
git commit -m "feat: run the L1 sight-reading loop after the reading gate"
```
