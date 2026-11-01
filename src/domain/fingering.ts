/**
 * pianoplayer 指法算法（TypeScript 移植）。
 *
 * 上游项目：https://github.com/marcomusy/pianoplayer （MIT License）
 * 对应源码：pianoplayer/hand.py（Hand 求解器）+ pianoplayer/models.py（keypos 键盘坐标）。
 *
 * 算法概述
 * --------
 * 对一只手的一段音符序列，用「带剪枝的深度优先回溯搜索」在 5 根手指的赋值空间里
 * 寻找平均加权速度最小的指法方案。搜索窗口为 9 个音（深度 3–9 可调，默认按音符
 * 密度自动选择），每滑过一个音就求解一次窗口并取第一个音的指法，实现 O(n) 的
 * 滑动窗口优化。代价函数 aveVelocity 模拟「手指从当前放松位姿移动到下一音」的
 * 位移速度，并按手指力量（weights）与黑键偏好（bfactor）加权；skip() 在扩展
 * 分支前剪掉物理上不合理的指法转移（逆行穿指、拇指上黑键、和弦内指序颠倒等）。
 *
 * 与上游的两处有意适配（其余逻辑逐行对应）：
 * 1. 键盘横坐标 keyPos()：上游 keypos_midi() 用 `(pitch % 12) * k` 计算步进，
 *    在 B→C 八度边界处不单调（B3 会排到 C4 右侧），仅用于原始 MIDI 输入；
 *    其乐谱路径使用的 keypos()（按音名）是单调的。本移植统一采用与 keypos()
 *    等价的单调坐标：白键等距 k cm，黑键位于相邻白键正中。
 * 2. 时间单位用「拍」而非「秒」：本库乐谱以拍为单位（DURATION_BEATS），
 *    生成器默认 bpm=60，1 拍 = 1 秒，与上游常数（dt+0.1、duration<4、duration<2）
 *    在数值上一致；指法只依赖音符的相对密度，用拍更符合音乐语义。
 */

import { pitchToMidi } from "./pitch";
import type { Hand, Pitch, Score, Stave } from "./types";
import { noteBeats } from "./vocabulary";

// ---------------------------------------------------------------------------
// 求解器输入模型
// ---------------------------------------------------------------------------

/** 求解器的单个音符。对应上游 pianoplayer/models.py 的 INote。 */
export type SolverNote = {
  /** MIDI 音高（60 = C4）。 */
  midi: number;
  /** 键盘横向位置（cm），由 keyPos() 计算；左手求解时内部会取镜像。 */
  x: number;
  /** 起始时间（拍）。 */
  time: number;
  /** 时值（拍）。 */
  duration: number;
  /** 是否黑键。 */
  isBlack: boolean;
  /** 是否属于和弦（同一拍同手的多个音）。 */
  isChord: boolean;
  /** 和弦组编号，非和弦为 0。 */
  chordId: number;
  /** 和弦内序号，低音起 0。 */
  chordNr: number;
  /** 和弦音数，非和弦为 0。 */
  notesInChord: number;
  /** 指法：0 = 待求解；1–5 = 锚点（求解时原样保留）。 */
  finger: number;
  /** 求解后回填的平均代价。 */
  cost: number;
  /** 小节号（1 起）；0 表示不按小节过滤。 */
  measure: number;
};

export type HandSide = "right" | "left";
export type HandSize = "XXS" | "XS" | "S" | "M" | "L" | "XL" | "XXL";

/** 一个八度的白键数（键盘以 7 个白键为周期排布）。 */
const WHITE_PER_OCTAVE = 7;
/** 一个八度的键盘宽度（cm），上游 keybsize。 */
const OCTAVE_WIDTH_CM = 16.5;
/** 相邻白键间距（cm）。 */
const WHITE_KEY_CM = OCTAVE_WIDTH_CM / WHITE_PER_OCTAVE;

/** 半音 → 八度内白键序号（C=0 … B=6）。 */
const WHITE_INDEX = [0, 0, 1, 1, 2, 3, 3, 4, 4, 5, 5, 6];
/** 黑键相对其左侧白键的偏移（半个白键位），白键为 0。 */
const BLACK_OFFSET = [0, 0.5, 0, 0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0];

/** 黑键半音集合（对应 pitch % 12）。 */
const BLACK_PITCH_CLASSES = new Set([1, 3, 6, 8, 10]);

/** 键盘横向位置（cm）。单调映射：白键等距，黑键居中。 */
export function keyPos(midi: number): number {
  const octave = Math.floor(midi / 12);
  const pc = midi - octave * 12;
  return WHITE_KEY_CM * (WHITE_PER_OCTAVE * octave + WHITE_INDEX[pc] + BLACK_OFFSET[pc]);
}

export function isBlackKey(midi: number): boolean {
  return BLACK_PITCH_CLASSES.has(((midi % 12) + 12) % 12);
}

/** 手指放松位姿（cm，相对手心）。下标 0 为占位；拇指偏左、小指偏右。 */
const FREST: readonly (number | null)[] = [null, -7.0, -2.8, 0.0, 2.8, 5.6];
/** 手指力量权重（作为速度分母，越大越省力）。 */
const WEIGHTS: readonly (number | null)[] = [null, 1.1, 1.0, 1.1, 0.9, 0.8];
/** 黑键偏好（作为速度分母，拇指 0.3 强烈回避黑键）。 */
const BFACTOR: readonly (number | null)[] = [null, 0.3, 1.0, 1.1, 0.8, 0.7];
/** 可选手指。 */
const FINGERS: readonly number[] = [1, 2, 3, 4, 5];

/** 手型尺寸对应的缩放系数（上游 _SIZE_FACTORS）。 */
const SIZE_FACTORS: Record<HandSize, number> = {
  XXS: 0.33,
  XS: 0.46,
  S: 0.64,
  M: 0.82,
  L: 1.0,
  XL: 1.1,
  XXL: 1.2,
};

/** 搜索窗口长度（上游固定 9 音窗口）。 */
const WINDOW = 9;
/** 同一和弦内相邻两指允许的最大伸展（cm，按手指对查表）。 */
const CHORD_STRETCH_CM: Record<string, number> = {
  "3,4": 5,
  "4,5": 5,
  "2,3": 6,
  "2,4": 7,
  "3,5": 8,
  "2,5": 11,
  "1,2": 12,
  "1,3": 14,
  "1,4": 16,
};

// ---------------------------------------------------------------------------
// 单手求解器（对应上游 pianoplayer/hand.py 的 Hand 类）
// ---------------------------------------------------------------------------

export class FingeringSolver {
  readonly side: HandSide;
  /** 内部持有的音符副本（左手求解时 x 会被镜像，结束后恢复）。 */
  notes: SolverNote[];
  /** 手指放松位姿（cm），下标 0 占位。 */
  fingerPositions: (number | null)[];
  /** 手型缩放系数。 */
  readonly hf: number;
  /** 最大指距（cm）。 */
  readonly maxSpanCm: number;
  /** 姿态记忆模式下手指跟随滞后的上限（cm）。 */
  readonly maxFollowLagCm: number;
  /** 相邻手指最小间距（cm）。 */
  readonly minFingerGapCm: number;
  /** 搜索深度；autodepth 为 true 时按窗口音符密度在 4–9 间自动选择。 */
  depth = 9;
  autodepth = true;
  /** 姿态记忆（默认关闭：每步都回到放松位姿，与上游默认行为一致）。 */
  preservePostureMemory = false;
  /** 姿态记忆强度：0 = 完全放松，1 = 保持旧位姿。 */
  relocationAlpha = 0.3;

  private hasPositionState = false;
  /** 放松位姿查表：relaxedDelta[fi][j] = (frest[j] - frest[fi]) * hf。 */
  private readonly relaxedDelta: ((number | null)[] | undefined)[];

  constructor(notes: SolverNote[], side: HandSide = "right", size: HandSize = "M") {
    this.side = side;
    this.notes = notes.map((note) => ({ ...note }));
    this.hf = SIZE_FACTORS[size] ?? SIZE_FACTORS.M;
    this.maxSpanCm = 21.0 * this.hf;
    this.maxFollowLagCm = 2.5 * this.hf;
    this.minFingerGapCm = 0.15 * this.hf;
    this.fingerPositions = scaledFrest(this.hf);
    this.relaxedDelta = buildRelaxedDelta(this.hf);
  }

  /**
   * 求解整段序列的指法。
   * 返回与 this.notes 等长对齐的手指数组；同时回填每音的 cost。
   * 对应上游 Hand.generate()。
   */
  generate(startMeasure = 1, nMeasures = 1000): number[] {
    const initialAutodepth = this.autodepth;
    const initialDepth = this.depth;
    let originalX: number[] | null = null;

    if (this.side === "left") {
      // 左手复用右手的几何与代价模型：镜像 x 坐标。
      originalX = this.notes.map((note) => note.x);
      for (const note of this.notes) note.x = -note.x;
    }

    try {
      this.fingerPositions = scaledFrest(this.hf);
      this.hasPositionState = false;
      let startFinger = 0;
      let out: number[] = [];
      const nTotal = this.notes.length;
      const maxMeasure = startMeasure + nMeasures - 1;
      this.depth = Math.max(3, Math.min(this.depth, 9));

      for (let i = 0; i < nTotal; i += 1) {
        const note = this.notes[i];
        if (note.measure) {
          if (note.measure < startMeasure) continue;
          if (note.measure > maxMeasure) break;
        }

        if (i > nTotal - 11) {
          // 接近尾部：关闭自动深度，避免对重复填充音做无意义的长搜索。
          if (this.autodepth) {
            this.autodepth = false;
            this.depth = Math.max(3, Math.min(9, nTotal - i));
          }
        }

        // 固定 9 音前瞻窗口，尾部用最后一个音填充。
        const window = this.notes.slice(i, i + WINDOW);
        if (window.length === 0) break;
        while (window.length < WINDOW) window.push(window[window.length - 1]);

        const anchoredFinger = anchorFinger(note.finger);
        if (anchoredFinger) {
          // 已有指法标注：原样保留，并以其为约束继续优化后续音。
          note.finger = anchoredFinger;
          const solved = this.optimizeSeq(window, anchoredFinger);
          out = solved.fingers;
          note.cost = solved.cost;
          startFinger = out.length > 1 ? out[1] : anchoredFinger;
          this.setFingerPositions(out, window, 0);
          continue;
        }

        let bestFinger: number;
        let cost = 0;
        if (i > nTotal - 10 && out.length > 1) {
          // 尾部直接消费上一个窗口已算出的指法，不再重新搜索。
          bestFinger = out.splice(1, 1)[0];
          out[0] = bestFinger;
          startFinger = out.length > 1 ? out[1] : bestFinger;
        } else {
          const solved = this.optimizeSeq(window, startFinger);
          out = solved.fingers;
          cost = solved.cost;
          bestFinger = out[0];
          startFinger = out.length > 1 ? out[1] : out[0];
        }

        bestFinger = this.enforceChordGroupConsistency(i, bestFinger);
        out[0] = bestFinger;
        note.finger = bestFinger;
        note.cost = cost;
        this.setFingerPositions(out, window, 0);
      }
    } finally {
      this.autodepth = initialAutodepth;
      this.depth = initialDepth;
      if (originalX) {
        this.notes.forEach((note, index) => {
          note.x = originalX[index];
        });
      }
    }

    return this.notes.map((note) => note.finger);
  }

  /**
   * 在 depth 个音的窗口上搜索最优指法。
   * 对应上游 Hand.optimize_seq()：首音受 u_start 约束（衔接上一窗或锚点），
   * 其余音枚举 1–5，skip() 剪枝，叶节点用 aveVelocity 评估。
   */
  optimizeSeq(nseq: SolverNote[], istart: number): { fingers: number[]; cost: number } {
    if (this.autodepth) {
      if (nseq[0].isChord) {
        this.depth = Math.max(3, nseq[0].notesInChord - nseq[0].chordNr + 1);
      } else {
        const t0 = nseq[0].time;
        for (const i of [4, 5, 6, 7, 8, 9]) {
          if (i - 1 >= nseq.length) break;
          this.depth = i;
          if (nseq[i - 1].time - t0 > 3.5) break;
        }
      }
    }

    const depth = this.depth;
    const uStart: number[] = istart === 0 ? [...FINGERS] : [istart];
    let bestFingering = new Array<number>(WINDOW).fill(0);
    let minvel = 1e10;
    const candidate = new Array<number>(WINDOW).fill(0);
    // skip() 只依赖 (level, fa, fb)：同一窗口内大量重复调用，按 level 缓存。
    const skipCache = new Map<number, boolean>();

    const backtrack = (level: number): void => {
      if (level === depth) {
        const velocity = this.aveVelocity(candidate, nseq);
        if (velocity < minvel) {
          bestFingering = candidate.slice();
          minvel = velocity;
        }
        return;
      }
      const choices = level === 0 ? uStart : FINGERS;
      const prev = nseq[level - 1];
      const current = nseq[level];
      const prevFinger = level > 0 ? candidate[level - 1] : 0;
      for (const finger of choices) {
        if (level > 0) {
          const cacheKey = level * 100 + prevFinger * 10 + finger;
          let invalid = skipCache.get(cacheKey);
          if (invalid === undefined) {
            invalid = this.skip(prevFinger, finger, prev, current);
            skipCache.set(cacheKey, invalid);
          }
          if (invalid) continue;
        }
        candidate[level] = finger;
        backtrack(level + 1);
      }
    };

    backtrack(0);

    if (minvel >= 1e10) {
      // 全部分支被剪掉时的确定性回退（上游行为）。
      const fallbackFinger = uStart.length > 0 ? uStart[0] : 3;
      bestFingering = new Array<number>(WINDOW).fill(fallbackFinger);
      minvel = this.aveVelocity(bestFingering, nseq);
    }
    return { fingers: bestFingering, cost: minvel };
  }

  /**
   * 候选指法的平均加权速度（越小越好）。
   * 对应上游 Hand.ave_velocity()：从放松位姿出发，逐音累加
   * 「手指位移 / 时间间隔」并按手指力量与黑键偏好加权；
   * 和弦内重复手指、指序与音高方向矛盾会被重罚。
   */
  aveVelocity(fingering: number[], notes: SolverNote[]): number {
    let chordPenalty = 0;
    const chordSeen = new Map<number, Array<{ pitch: number; finger: number }>>();
    for (let i = 0; i < this.depth; i += 1) {
      const note = notes[i];
      if (!note.isChord) continue;
      const finger = fingering[i];
      if (finger < 1 || finger > 5) {
        chordPenalty += 1e6;
        continue;
      }
      const prior = chordSeen.get(note.chordId) ?? [];
      for (const peer of prior) {
        // 同和弦内不同音不允许复用同一手指。
        if (finger === peer.finger && note.midi !== peer.pitch) {
          chordPenalty += 1e6;
          continue;
        }
        // 和弦内指序必须与音高方向一致（右手升音升指，左手相反）。
        if (this.side === "right") {
          if (note.midi > peer.pitch && finger <= peer.finger) chordPenalty += 2e5;
          else if (note.midi < peer.pitch && finger >= peer.finger) chordPenalty += 2e5;
        } else {
          if (note.midi > peer.pitch && finger >= peer.finger) chordPenalty += 2e5;
          else if (note.midi < peer.pitch && finger <= peer.finger) chordPenalty += 2e5;
        }
      }
      prior.push({ pitch: note.midi, finger });
      chordSeen.set(note.chordId, prior);
    }

    // 从当前位姿的副本出发评估，不污染求解器状态。
    const positions = this.fingerPositions.slice();
    this.setFingerPositions(fingering, notes, 0, positions, false);

    let vmean = 0;
    for (let i = 1; i < this.depth; i += 1) {
      const prev = notes[i - 1];
      const next = notes[i];
      const finger = fingering[i];
      const from = positions[finger];
      if (from == null) continue;

      const dx = Math.abs(next.x - from);
      const dt = Math.abs(next.time - prev.time) + 0.1;
      let v = dx / dt;

      const weight = WEIGHTS[finger] ?? 1;
      v /= next.isBlack ? weight * (BFACTOR[finger] ?? 1) : weight;

      vmean += v;
      this.setFingerPositions(fingering, notes, i, positions, false);
    }

    return vmean / (this.depth - 1) + chordPenalty;
  }

  /**
   * 局部指法转移是否不可行（剪枝规则）。
   * 对应上游 Hand.skip()。
   */
  skip(fa: number, fb: number, na: SolverNote, nb: SolverNote): boolean {
    const xba = nb.x - na.x;

    if (!na.isChord && !nb.isChord) {
      // 短音上同指换音不被鼓励（长音 ≥4 拍可接受，类似保持音换指）。
      if (fa === fb && xba !== 0 && na.duration < 4) return true;
      if (fa > 1) {
        // 非拇指手指逆着旋律方向穿行不允许（拇指穿越 fb=1 除外）。
        if (fb > 1 && (fb - fa) * xba < 0) return true;
        // 上行时拇指钻入黑键不允许。
        if (fb === 1 && nb.isBlack && xba > 0) return true;
      } else if (na.isBlack && xba < 0 && fb > 1 && na.duration < 2) {
        // 黑键上的拇指快速下移交给其他手指不被鼓励。
        return true;
      }
    } else if (na.isChord && nb.isChord && na.chordId === nb.chordId) {
      const axba = (Math.abs(xba) * this.hf) / 0.8;
      // 和弦内指序必须遵循手的方向性。
      if (fa === fb) return true;
      if (fa < fb && this.side === "left") return true;
      if (fa > fb && this.side === "right") return true;

      // 同和弦内相邻两指的最大伸展限制。
      const pair = `${Math.min(fa, fb)},${Math.max(fa, fb)}`;
      const threshold = CHORD_STRETCH_CM[pair];
      if (threshold !== undefined && axba > threshold) return true;
    }
    return false;
  }

  /**
   * 赋值第 i 音后更新手指位姿。
   * 对应上游 Hand.set_fingers_positions()。
   * 传入外部 positions 时只更新副本（供 aveVelocity 试评估用）。
   */
  setFingerPositions(
    fingering: number[],
    notes: SolverNote[],
    i: number,
    positions?: (number | null)[],
    forceRelaxed = false,
  ): void {
    let fingerPositions = positions;
    let relaxed = forceRelaxed;
    if (!fingerPositions) {
      fingerPositions = this.fingerPositions;
      relaxed = !this.hasPositionState;
    }

    const fi = fingering[i];
    const noteX = notes[i].x;

    if (relaxed || !this.preservePostureMemory) {
      // 放松路径（默认行为，热路径）：各手指落在以本音为中心的放松位姿上。
      const delta = this.relaxedDelta[fi];
      if (!delta) return;
      for (let j = 1; j <= 5; j += 1) {
        const offset = delta[j];
        fingerPositions[j] = offset == null ? null : noteX + offset;
      }
      fingerPositions[fi] = noteX;
      if (fingerPositions === this.fingerPositions) this.hasPositionState = true;
      return;
    }

    // 姿态记忆路径（preservePostureMemory = true 时启用）。
    const targets = this.relaxedTargets(fi, noteX);
    if (Object.keys(targets).length === 0) return;

    for (let j = 1; j <= 5; j += 1) {
      const target = targets[j];
      if (target === undefined) {
        fingerPositions[j] = null;
        continue;
      }
      if (j === fi) {
        // 当前发声手指必须精确落在本音上。
        fingerPositions[j] = noteX;
        continue;
      }
      const prev = fingerPositions[j];
      fingerPositions[j] =
        prev == null ? target : this.relocationAlpha * prev + (1 - this.relocationAlpha) * target;
    }
    this.applyPositionConstraints(fingerPositions, fi, noteX, targets);
    if (fingerPositions === this.fingerPositions) this.hasPositionState = true;
  }

  /** 以发声指 fi 为中心，各手指的相对放松目标位姿。对应上游 _relaxed_targets()。 */
  private relaxedTargets(fi: number, noteX: number): Record<number, number> {
    const ifx = FREST[fi] != null ? FREST[fi]! * this.hf : null;
    if (ifx == null) return {};
    const targets: Record<number, number> = {};
    for (let j = 1; j <= 5; j += 1) {
      const jfx = FREST[j];
      if (jfx == null) continue;
      targets[j] = jfx * this.hf - ifx + noteX;
    }
    return targets;
  }

  /** 姿态记忆的物理约束（跟随滞后、指序不交叉、最大指距）。对应上游 _apply_position_constraints()。 */
  private applyPositionConstraints(
    positions: (number | null)[],
    fi: number,
    noteX: number,
    targets: Record<number, number>,
  ): void {
    for (let j = 1; j <= 5; j += 1) {
      if (j === fi) continue;
      const pos = positions[j];
      const target = targets[j];
      if (pos == null || target == null) continue;
      const lag = pos - target;
      if (lag > this.maxFollowLagCm) positions[j] = target + this.maxFollowLagCm;
      else if (lag < -this.maxFollowLagCm) positions[j] = target - this.maxFollowLagCm;
    }

    // 保持 1→5 的手指顺序，避免交叉。
    for (let j = 2; j <= 5; j += 1) {
      const a = positions[j - 1];
      const b = positions[j];
      if (a == null || b == null) continue;
      const minAllowed = a + this.minFingerGapCm;
      if (b < minAllowed) positions[j] = minAllowed;
    }

    // 拇指–小指最大伸展限制。
    if (positions[1] != null && positions[5] != null) {
      const span = positions[5] - positions[1];
      if (span > this.maxSpanCm) {
        const limit = this.maxSpanCm / 2;
        for (let j = 1; j <= 5; j += 1) {
          if (j === fi) continue;
          const pos = positions[j];
          if (pos == null) continue;
          const off = pos - noteX;
          if (off > limit) positions[j] = noteX + limit;
          else if (off < -limit) positions[j] = noteX - limit;
        }
      }
    }

    positions[fi] = noteX;
  }

  /**
   * 和弦组一致性校正：与同和弦已定音的指法保持方向一致且不重复。
   * 对应上游 Hand._enforce_chord_group_consistency()。
   */
  private enforceChordGroupConsistency(index: number, finger: number): number {
    if (finger < 1 || finger > 5) return finger;
    const note = this.notes[index];
    if (!note.isChord) return finger;

    const peers: Array<{ pitch: number; finger: number }> = [];
    for (const prev of this.notes.slice(0, index)) {
      if (!prev.isChord || prev.chordId !== note.chordId) continue;
      const prevFinger = Math.abs(prev.finger);
      if (prevFinger < 1 || prevFinger > 5) continue;
      peers.push({ pitch: prev.midi, finger: prevFinger });
    }
    if (peers.length === 0) return finger;

    const used = new Set(peers.map((peer) => peer.finger));
    let candidates = FINGERS.filter((f) => !used.has(f));
    if (candidates.length === 0) candidates = [finger];

    // 与上游 min((penalty, |cand-finger|, cand)) 的字典序一致。
    let best = finger;
    let bestPenalty = Number.POSITIVE_INFINITY;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const cand of candidates) {
      let penalty = 0;
      for (const peer of peers) {
        if (this.side === "right") {
          if (note.midi > peer.pitch && cand <= peer.finger) penalty += 100 + (peer.finger - cand);
          else if (note.midi < peer.pitch && cand >= peer.finger) penalty += 100 + (cand - peer.finger);
        } else {
          if (note.midi > peer.pitch && cand >= peer.finger) penalty += 100 + (cand - peer.finger);
          else if (note.midi < peer.pitch && cand <= peer.finger) penalty += 100 + (peer.finger - cand);
        }
      }
      const distance = Math.abs(cand - finger);
      if (
        penalty < bestPenalty ||
        (penalty === bestPenalty && (distance < bestDistance || (distance === bestDistance && cand < best)))
      ) {
        best = cand;
        bestPenalty = penalty;
        bestDistance = distance;
      }
    }
    return best;
  }
}

/** 按手型缩放后的放松位姿（下标 0 为占位 null）。 */
function scaledFrest(hf: number): (number | null)[] {
  const positions: (number | null)[] = [null];
  for (let i = 1; i <= 5; i += 1) {
    const rest = FREST[i];
    positions.push(rest == null ? null : rest * hf);
  }
  return positions;
}

/** 放松位姿偏移查表：relaxedDelta[fi][j] = (frest[j] - frest[fi]) * hf。 */
function buildRelaxedDelta(hf: number): ((number | null)[] | undefined)[] {
  const table: ((number | null)[] | undefined)[] = [];
  for (let fi = 0; fi <= 5; fi += 1) {
    const ifx = FREST[fi];
    if (ifx == null) continue;
    const row: (number | null)[] = [];
    for (let j = 0; j <= 5; j += 1) {
      const jfx = FREST[j];
      row.push(jfx == null ? null : (jfx - ifx) * hf);
    }
    table[fi] = row;
  }
  return table;
}

/** 取出合法锚点指法（1–5），否则返回 0。 */
function anchorFinger(finger: number): number {
  if (!Number.isInteger(finger)) return 0;
  const normalized = Math.abs(finger);
  return normalized >= 1 && normalized <= 5 ? normalized : 0;
}

// ---------------------------------------------------------------------------
// 便捷入口
// ---------------------------------------------------------------------------

/**
 * 求解一段音符序列的指法（不会修改入参）。
 * 返回与入参等长对齐的结果数组，finger / cost 已回填。
 */
export function solveFingering(
  notes: SolverNote[],
  side: HandSide,
  size: HandSize = "M",
): SolverNote[] {
  const solver = new FingeringSolver(notes, side, size);
  solver.generate();
  return solver.notes;
}

/** 构造单个（非和弦）求解音符，便于测试与直接调用。 */
export function singleNote(midi: number, time: number, duration: number, finger = 0, measure = 0): SolverNote {
  return {
    midi,
    x: keyPos(midi),
    time,
    duration,
    isBlack: isBlackKey(midi),
    isChord: false,
    chordId: 0,
    chordNr: 0,
    notesInChord: 0,
    finger,
    cost: 0,
    measure,
  };
}

// ---------------------------------------------------------------------------
// piano-buddy 乐谱适配器
// ---------------------------------------------------------------------------

/**
 * 指法标注模式：
 * - "fill-gaps"（默认）：乐谱上已有的手位指法作为锚点原样保留，求解器只补
 *   没有指法的音（越出手位的音、和弦音）。当前 L1/L2 生成器全部有手位指法，
 *   行为与此前完全一致。
 * - "auto"：忽略既有指法，整段交给求解器决定。
 */
export type FingeringMode = "fill-gaps" | "auto";

/** 和弦内相邻音的微小时间错开（拍），对应上游 chord_note_stagger_s=0.05。 */
const CHORD_STAGGER = 0.05;

type HandEntry = {
  /** 全局起始拍（跨小节连续）。 */
  beat: number;
  midi: number;
  /** 小节序号（0 起）。 */
  measureIndex: number;
  /** 小节内事件序号（0 起）。 */
  eventIndex: number;
  /** 事件内音高序号（0 起）。 */
  pitchIndex: number;
  durationBeats: number;
  finger: number;
};

/**
 * 为整份乐谱标注指法，返回新 Score（不修改入参）。
 * 按手独立求解：右手用正向键盘坐标，左手内部镜像。
 */
export function annotateScore(score: Score, mode: FingeringMode = "fill-gaps"): Score {
  const staves: Score["staves"] = { ...score.staves };
  for (const hand of score.hands) {
    const stave = score.staves[hand];
    if (!stave) continue;
    const entries = collectHandEntries(stave);
    if (entries.length === 0) continue;

    const hasGap = entries.some((entry) => anchorFinger(entry.finger) === 0);
    if (mode === "fill-gaps" && !hasGap) continue;

    // auto 模式忽略既有指法（不作为锚点）；fill-gaps 模式保留为锚点。
    const solverNotes = buildSolverNotes(entries, mode === "auto");
    const solved = solveFingering(solverNotes, hand === "RH" ? "right" : "left");
    staves[hand] = { clef: stave.clef, measures: writeBack(stave, entries, solved, mode) };
  }
  return { ...score, staves };
}

/** 遍历一只手的五线谱，按全局拍收集所有发声音（含和弦内的每个音）。 */
function collectHandEntries(stave: Stave): HandEntry[] {
  const entries: HandEntry[] = [];
  let beat = 0;
  stave.measures.forEach((measure, measureIndex) => {
    measure.notes.forEach((event, eventIndex) => {
      if (event.pitches.length > 0) {
        event.pitches.forEach((pitch, pitchIndex) => {
          entries.push({
            beat,
            midi: pitchToMidi(pitch),
            measureIndex,
            eventIndex,
            pitchIndex,
            durationBeats: noteBeats(event),
            finger: event.fingers?.[pitchIndex] ?? 0,
          });
        });
      }
      beat += noteBeats(event);
    });
  });
  // 按（拍, 音高）排序：和弦内低音在前，与上游 reader 的和弦展开一致。
  entries.sort((a, b) => a.beat - b.beat || a.midi - b.midi);
  return entries;
}

/** 把收集结果转成求解器输入，同拍同手的多个音构成一个和弦组。 */
function buildSolverNotes(entries: HandEntry[], ignoreAnchors = false): SolverNote[] {
  const notes: SolverNote[] = [];
  let chordId = 0;
  let index = 0;
  while (index < entries.length) {
    let end = index + 1;
    while (end < entries.length && entries[end].beat === entries[index].beat) end += 1;
    const group = entries.slice(index, end);
    const inChord = group.length > 1;
    if (inChord) chordId += 1;
    group.forEach((entry, chordNr) => {
      const stagger = inChord ? CHORD_STAGGER * (group.length - 1 - chordNr) : 0;
      notes.push({
        midi: entry.midi,
        x: keyPos(entry.midi),
        time: entry.beat - stagger,
        duration: entry.durationBeats + (inChord ? CHORD_STAGGER * (group.length - 1) : 0),
        isBlack: isBlackKey(entry.midi),
        isChord: inChord,
        chordId: inChord ? chordId : 0,
        chordNr: inChord ? chordNr : 0,
        notesInChord: inChord ? group.length : 0,
        finger: ignoreAnchors ? 0 : entry.finger,
        cost: 0,
        measure: entry.measureIndex + 1,
      });
    });
    index = end;
  }
  return notes;
}

/** 把求解结果写回乐谱副本（返回新的 measures 数组）。 */
function writeBack(
  stave: Stave,
  entries: HandEntry[],
  solved: SolverNote[],
  mode: FingeringMode,
): Stave["measures"] {
  const fingersByKey = new Map<string, number>();
  entries.forEach((entry, index) => {
    const finger = solved[index]?.finger ?? 0;
    if (finger >= 1 && finger <= 5) fingersByKey.set(entryKey(entry), finger);
  });

  return stave.measures.map((measure, measureIndex) => ({
    notes: measure.notes.map((event, eventIndex) => {
      if (event.pitches.length === 0) return event;
      const fingers: number[] = [];
      event.pitches.forEach((pitch: Pitch, pitchIndex: number) => {
        const kept = mode === "fill-gaps" ? event.fingers?.[pitchIndex] : undefined;
        const solvedFinger = fingersByKey.get(entryKey({ measureIndex, eventIndex, pitchIndex }));
        fingers.push(kept ?? solvedFinger ?? 0);
      });
      return { ...event, fingers };
    }),
  }));
}

function entryKey(entry: { measureIndex: number; eventIndex: number; pitchIndex: number }): string {
  return `${entry.measureIndex}:${entry.eventIndex}:${entry.pitchIndex}`;
}
