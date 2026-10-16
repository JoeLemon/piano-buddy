# L2 识谱与视奏 Web 闭环 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在已跑通的 L1 之上交付完整 L2：六课识谱、双手过关测试、L2 视奏。

**Architecture:** 继续用纯函数管词汇、出题、解锁和比对。`isAllowed` / `LEVEL_SPEC[2]` 已存在，本计划只加 `generateL2`、双手时间线比对、档案字段和 L2 界面。L1 路径保持可用。双手谱用大谱表渲染；同拍时时间线按拍点排序，同拍内先 RH 后 LH。

**Tech Stack:** Vite 6、Vue 3、TypeScript、Vitest、happy-dom、VexFlow 4、Web MIDI、Web Audio、idb。

**Spec:** [docs/MVP.md](../../MVP.md) 第 4.1–4.3、5.2、5.7、5.8、6 节中与 L2 相关的部分。

## Global Constraints

- 全部本地计算，不依赖云端大模型。
- 界面不显示百分制。通过或失败只用一句白话，失败时只指出一个音或一种节奏。
- 识谱可以看键盘，弹错停下，指法始终显示。屏幕键盘图不能点按发声。
- 视奏不显示键盘图。提示文案是「眼睛尽量保持看谱，不要盯着键盘」。禁止回退，错音只标记不打断。
- 单条视奏片段最多练习 2 遍。识谱不使用这条规则。
- 自评不能直接解锁视奏。手动切换不能升到未过关的档。
- 找键、敲节奏、过关测试和视奏都要已连接的 MIDI。卡片可以先看。
- L2 过关：一条新的 4 小节，含八分音符，并且双手都出现。调只在 C、F、G 中抽一个。60 BPM。音高错不超过 2 个。一个音比拍点晚超过 2 拍记一次节奏中断，一条里达到 2 次则不通过。
- 同一档连续 3 次测试不通过：速度降 8 BPM，只降一次，最低 44 BPM。L2 因此从 60 降到 52。用 `l2FailStreak` / `l2Slowed`，不改 L1 的 `failStreak` / `slowed`。
- 视奏生成结果只能使用该档词汇，并经 `isAllowed`。L2：八分、双手、C/F/G、F/G/D-shift 五指，无附点、无和弦、无临时升降号。
- 左右手分开解锁只用于 L1。L2 视奏要求左右手 L1 都已通过，并且 `l2Passed`。
- 中央 C 为 C4。指法按词汇表固定五指。

## 范围

本计划做完时，用户能：在 L1 双手通过后进入 L2-1～L2-6、通过或未通过 L2 测试、解锁后做双手 L2 视奏并复盘。

明确不做：L3+、PDF、主题、每日目标、Flutter、蓝牙、麦克风。自评仍只分流到 L1（本计划不加 L2 加试）。

## 文件

- Modify: `src/domain/profile.ts`、`compare.ts`、`feedback.ts`、`lessonProgress.ts`
- Create: `src/domain/generateL2.ts`、`src/domain/timeline.ts`
- Modify: `src/notation/renderScore.ts`、`src/ui/KeyboardDiagram.vue`
- Create: `src/ui/L2ReadingView.vue`
- Modify: `src/ui/HomeView.vue`、`SightView.vue`、`ReviewView.vue`、`App.vue`
- Test: `test/l2-*.test.ts` 及对现有测试的增量

---

### Task 1: Profile 与 L2 解锁

**Files:**
- Modify: `src/domain/profile.ts`
- Modify: `src/domain/lessonProgress.ts`
- Test: `test/l2-profile.test.ts`

**Interfaces:**
- Consumes: existing `Profile`, `mergeProfile`, `canEnterSight`, `testBpm`
- Produces:
  - `lessonId` 增加 `"L2-1"|"L2-2"|"L2-3"|"L2-4"|"L2-5"|"L2-6"|"L2-test"`
  - `l2Passed: boolean`, `l2FailStreak: number`, `l2Slowed: boolean`
  - `canEnterL2(profile): boolean` → `l1RightPassed && l1LeftPassed`
  - `canEnterSightLevel(profile, level: 1|2, hand?: Hand): boolean` — L1 仍按手；L2 忽略 hand，要求 `canEnterL2 && l2Passed`
  - `testBpmForLevel(profile, level): number` — L2 用 `l2Slowed ? 52 : 60`
  - `applyL2TestResult(profile, result): Profile` — 通过设 `l2Passed`；失败累加 `l2FailStreak`，第三次起 `l2Slowed`
  - `startL2IfReady(profile): Profile` — 若 `canEnterL2` 且 `lessonId` 为 `L1-test` 或 L1 已双通且不在 L2，设 `lessonId: "L2-1"`
  - `mergeProfile` 为新字段填默认值

- [ ] **Step 1: 写会失败的测试**

```ts
import { describe, expect, it } from "vitest";
import {
  applyL2TestResult,
  canEnterL2,
  canEnterSightLevel,
  initialProfile,
  mergeProfile,
  startL2IfReady,
  testBpmForLevel,
} from "../src/domain/profile";

describe("L2 profile gates", () => {
  it("blocks L2 until both L1 hands passed", () => {
    const one = { ...initialProfile(), l1RightPassed: true };
    expect(canEnterL2(one)).toBe(false);
    const both = { ...one, l1LeftPassed: true };
    expect(canEnterL2(both)).toBe(true);
    expect(canEnterSightLevel(both, 2)).toBe(false);
    const passed = applyL2TestResult(both, {
      pitchErrors: 0, rhythmBreaks: 0, firstWrongLabel: null,
      wrongPitchNoteIds: [], lateNoteIds: [],
    });
    expect(passed.l2Passed).toBe(true);
    expect(canEnterSightLevel(passed, 2)).toBe(true);
  });

  it("slows L2 only after three fails and merges missing fields", () => {
    let p = { ...initialProfile(), l1RightPassed: true, l1LeftPassed: true };
    const fail = {
      pitchErrors: 3, rhythmBreaks: 0, firstWrongLabel: "C4",
      wrongPitchNoteIds: ["a"], lateNoteIds: [],
    };
    p = applyL2TestResult(p, fail);
    p = applyL2TestResult(p, fail);
    expect(p.l2Slowed).toBe(false);
    p = applyL2TestResult(p, fail);
    expect(p.l2Slowed).toBe(true);
    expect(testBpmForLevel(p, 2)).toBe(52);
    expect(mergeProfile({ l1RightPassed: true }).l2Passed).toBe(false);
    expect(startL2IfReady({ ...initialProfile(), l1RightPassed: true, l1LeftPassed: true, lessonId: "L1-test" }).lessonId).toBe("L2-1");
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```powershell
npm test -- test/l2-profile.test.ts
```

Expected: FAIL，符号不存在。

- [ ] **Step 3: 实现**

按 Interfaces 扩展 `profile.ts`。`lessonProgress` 增加 L2 步骤与目标文案（L2-1「短句」、L2-4「找键」等）。`canEnterSight` 保持 L1 行为不变。

- [ ] **Step 4: 确认通过并提交**

```powershell
npm test -- test/l2-profile.test.ts
git add src/domain/profile.ts src/domain/lessonProgress.ts test/l2-profile.test.ts
git commit -m "feat: gate L2 behind both L1 hands and a level pass"
```

---

### Task 2: 黑键键盘图

**Files:**
- Modify: `src/ui/KeyboardDiagram.vue`
- Modify: `src/notation/renderScore.ts`（导出黑键 MIDI 列表若需要）
- Test: `test/keyboard.test.ts`

**Interfaces:**
- Produces: 键盘图在 C3–C5 白键之间插入黑键；`highlightMidi` 可为 Bb3/Bb4/F#3/F#4 等；根节点仍 `data-test="keyboard"`；不可点击发声。

- [ ] **Step 1: 写会失败的测试**

```ts
import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import { pitchToMidi, parsePitchLabel } from "../src/domain/pitch";
import KeyboardDiagram from "../src/ui/KeyboardDiagram.vue";

describe("KeyboardDiagram", () => {
  it("highlights a black key for Bb4", () => {
    const midi = pitchToMidi(parsePitchLabel("Bb4"));
    const wrapper = mount(KeyboardDiagram, { props: { highlightMidi: midi } });
    expect(wrapper.find("[data-test=keyboard]").exists()).toBe(true);
    expect(wrapper.find(".black-key.is-target").exists()).toBe(true);
  });
});
```

- [ ] **Step 2–5:** RED → 实现黑键布局与赭石高亮 → GREEN → commit `feat: show black keys on the practice keyboard`

---

### Task 3: 大谱表渲染

**Files:**
- Modify: `src/notation/renderScore.ts`
- Test: `test/render-grand.test.ts`

**Interfaces:**
- Produces: `renderGrandScore(element, score, showFingers): void` — 要求 `score.hands` 含 RH 与 LH；上高音下低音；指法仍用 Annotation。

- [ ] **Step 1: 测试**

用最小双手 `Score`（每手一小节一个四分音）调用 `renderGrandScore`，断言 SVG 中同时出现 treble 与 bass 相关内容（或两个 `.vf-stave`）。

- [ ] **Step 2–5:** 实现 → commit `feat: render a grand staff for two-hand scores`

---

### Task 4: 双手比对时间线

**Files:**
- Create: `src/domain/timeline.ts`
- Modify: `src/domain/compare.ts`
- Test: `test/l2-compare.test.ts`

**Interfaces:**
- Produces:
  - `flattenScore(score): { id: string; midi: number; beat: number; hand: Hand; label: string }[]` — 按 `beat` 升序；同拍先 RH 后 LH；跳过休止。
  - `compare(score, hand | "BOTH", played, bpm)` — 当 `hand === "BOTH"` 或 `score.hands.length === 2` 时用整条时间线；单手行为与现有一致。
  - `passLimit(2) === 2`

- [ ] **Step 1: 测试**

构造 1 小节双手同拍：RH C4、LH C3 各四分。完美弹奏两键 → `pitchErrors === 0`。只弹错 RH → `wrongPitchNoteIds` 含 RH 音 id。LH 晚超过 2 拍 → `lateNoteIds` 含 LH 音 id。

- [ ] **Step 2–5:** 实现 → commit `feat: score two-hand lines on one beat timeline`

---

### Task 5: generateL2

**Files:**
- Create: `src/domain/generateL2.ts`
- Test: `test/generate-l2.test.ts`

**Interfaces:**
- Produces:

```ts
export type L2Shape =
  | { kind: "eighths-single"; hand: Hand }
  | { kind: "alternate" }
  | { kind: "together"; texture: "same" | "hold" }
  | { kind: "key-find"; key: "F" | "G"; hand: Hand }
  | { kind: "key-line"; key: "F" | "G"; hand: Hand }
  | { kind: "shift-once"; hand: Hand }
  | { kind: "test" }
  | { kind: "sight" };

export function generateL2(request: { seed: number; mode: Mode; shape: L2Shape }): Score;
```

规则：
- `level: 2`，`bpm: 60`，4 小节，经 `isAllowed`。
- `eighths-single`：C 五指、单手、含至少一组八分。
- `alternate`：双手，奇数小节只有 RH，偶数只有 LH（或相反），不同时发声。
- `together`：双手同拍；`same` 节奏相同；`hold` 一只手拉长、另一只走四分/八分。
- `key-find` / `key-line`：调号 F 或 G，对应五指。
- `shift-once`：C 大调，一条内从 C 五指挪到 D-shift 恰好一次。
- `test` / `sight`：双手都出现、含八分、`keySignature` ∈ C|F|G，发声音 ≥ 8（两手合计）。
- id：`l2-${shape.kind}-${seed}`（可带 hand/key 后缀）。最多试 30 次。

- [ ] **Step 1: 测试** 每种 shape 至少一个种子：`isAllowed(score)===true`，并断言上述硬条件。
- [ ] **Step 2–5:** 实现 → commit `feat: generate deterministic L2 reading and sight lines`

---

### Task 6: L2-1 八分音符课

**Files:**
- Create: `src/ui/L2ReadingView.vue`（本任务先支持 L2-1）
- Modify: `src/App.vue`（`lessonId` 以 `L2` 开头时挂 L2ReadingView）
- Test: `test/l2-reading.test.ts`

**Interfaces:**
- Props: `profile`, `midiConnected`。事件 `update-profile`。
- L2-1：卡片「一拍里有两个八分音，仍用这五个白键。」生成 `eighths-single`（默认 RH，可在完成后再练 LH 或固定先 RH 两条）。弹错停下。弹完 2 条 → `L2-2`。

- [ ] **Step 1: 测试** 无 MIDI 时显示连接提示且不推进；有进度条含「八分」。
- [ ] **Step 2–5:** 实现最小 L2ReadingView + App 路由 → commit `feat: practice L2-1 eighth-note lines`

---

### Task 7: L2-2 与 L2-3 双手课

**Files:**
- Modify: `src/ui/L2ReadingView.vue`
- Test: `test/l2-hands.test.ts`

**Interfaces:**
- L2-2：`alternate`，大谱表，弹错停，2 条 → L2-3。
- L2-3：`together`，纹理在 same/hold 间轮换或按 seed，2 条 → L2-4。
- MIDI 用双手时间线匹配当前目标音（与识谱「弹对才进下一音」一致：按 flatten 顺序）。

- [ ] **Step 1–5:** TDD → commit `feat: practice alternating and together-hand L2 lines`

---

### Task 8: L2-4 F 与 L2-5 G 找键

**Files:**
- Modify: `src/ui/L2ReadingView.vue`
- Test: `test/l2-keys.test.ts`

**Interfaces:**
- L2-4：调号一个降号。卡片说明 B 弹黑键。先 RH 找对 8，再 LH 找对 8 → L2-5。高亮可用黑键。
- L2-5：一个升号，F 弹黑键。同样每手 8 次 → L2-6。
- 弱项队列仍只保留当前手五指标签。

- [ ] **Step 1–5:** TDD → commit `feat: teach F and G five-finger positions with key signatures`

---

### Task 9: L2-6 五指平移

**Files:**
- Modify: `src/ui/L2ReadingView.vue`
- Test: `test/l2-shift.test.ts`

**Interfaces:**
- `shift-once` 线，大谱表或单手（规格为一条里挪一次；默认 RH 两条或按 seed 换手）。2 条 → `L2-test`。

- [ ] **Step 1–5:** TDD → commit `feat: practice one five-finger shift in L2-6`

---

### Task 10: L2 过关测试

**Files:**
- Modify: `src/App.vue`
- Modify: `src/domain/feedback.ts`（若需 L2 通过句，可复用 L1 通过句）
- Test: `test/l2-pass-test.test.ts`

**Interfaces:**
- `lessonId === "L2-test"` 时开一条 `generateL2({ shape: { kind: "test" }, ...})`，`compare` 双手，`applyL2TestResult`。
- 三错不通过；两错及以内且节奏中断 &lt; 2 通过。无百分数。
- 通过后回首页，视奏可进 L2。

- [ ] **Step 1–5:** TDD → commit `feat: run the L2 pass test on a two-hand line`

---

### Task 11: L2 视奏与首页接线

**Files:**
- Modify: `src/ui/HomeView.vue`、`SightView.vue`、`App.vue`、`lessonProgress.ts`
- Test: `test/l2-sight.test.ts`

**Interfaces:**
- 首页：L1 双通后「先认谱」→ 当前 L2 课或 `startL2IfReady`；未过 L2 时视奏若仅 L1 解锁仍可 L1 视奏；`l2Passed` 后视奏默认 L2 双手（`generateL2` sight）。
- SightView：`level` 或从 score.level 决定单手/大谱表；准备 25 秒、两遍限制、复盘、错题本不变。
- 进度条含 L2 六课 + 过关。

- [ ] **Step 1–5:** TDD → commit `feat: unlock two-hand L2 sight reading after the L2 gate`

---

### Task 12: 全分支复审

**Files:** 修复波次涉及的文件

- [ ] **Step 1:** `review-package` from merge-base with `feat/l1-reading-sight` 或 `main` 到 HEAD
- [ ] **Step 2:** 最终 code review（最强可用模型）
- [ ] **Step 3:** 一轮修复 + scoped re-review
- [ ] **Step 4:** `npm test` 与 `npm run build` 全绿
- [ ] **Step 5:** finishing-a-development-branch（不擅自 push）

---

## Spec coverage check

| Spec 项 | Task |
|---|---|
| L2-1 八分 | 5, 6 |
| L2-2 交替 | 5, 7 |
| L2-3 同拍 | 5, 7 |
| L2-4 F / L2-5 G | 2, 5, 8 |
| L2-6 平移 | 5, 9 |
| L2 测试双手+八分+C/F/G | 5, 10 |
| L2 视奏需 L1 双手+本档通过 | 1, 11 |
| 降速独立于 L1 | 1, 10 |
| isAllowed 复用 | 5 |
| 无百分数 / 识谱停 / 视奏不停 | 6–11 |
