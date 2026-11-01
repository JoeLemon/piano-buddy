import { isHeldEnough } from "../domain/hold";
import { parsePitchLabel, pitchToMidi } from "../domain/pitch";
import { performanceMeasures } from "../domain/repeats";
import { scoreEvents } from "../domain/scoreEvents";
import type { Hand, Score } from "../domain/types";
import { DURATION_BEATS, meterQuarterBeats } from "../domain/vocabulary";
import type { PlayTarget } from "./playAnswer";
import type { PlaybackQuestion } from "./melodyTypes";
import { MELODY_BPM } from "./melodyTypes";

/**
 * 节拍网格：把「弹对了没有」从音高扩展到时间。
 *
 * 音高判对只说明「认出了这个音」，节奏是另一件事——同一串音弹得对但
 * 拖拍或抢拍，听起来就不再是那段旋律。这里把每个目标音放到时间轴上，
 * 判学生实际弹的拍点离目标有多远。
 *
 * 时间一律用「拍」而不是毫秒：换速度时容差跟着缩放，60bpm 与 120bpm
 * 下的判定口径才一致，也方便直接对照谱面上的时值。
 */

/** 一个目标音在时间轴上的位置。 */
export type RhythmSlot = {
  /** 这个位置该响的音，和弦类会有多个。 */
  midis: readonly number[];
  /** 从第 0 拍算起的起始拍。 */
  startBeat: number;
  /** 时值，单位拍。 */
  beats: number;
  /**
   * 每个音各自的目标时值（midi → 拍）。
   *
   * 同一拍上左右手的时值经常不同（低音铺满全小节、右手走四分音符），短的音
   * 本来就要先抬。不分开记的话，判定只能拿最长的那一个要求所有音，
   * 把正确的演奏说成「按得太短」。单音槽位不需要填，缺省用 `beats`。
   */
  targetBeats?: Readonly<Record<number, number>>;
};

export type RhythmPlan = {
  slots: readonly RhythmSlot[];
  bpm: number;
  /** 每小节拍数，画网格与打小节线用。 */
  beatsPerBar: number;
  /** 总拍数，等于最后一个音结束的拍点。 */
  totalBeats: number;
  /**
   * 每小节的起始拍。弱起时首小节比整小节短，`beatsPerBar` 硬乘会从小节二
   * 开始逐小节错位，所以小节线位置读这张表；音型题没有小节概念，省略。
   */
  measureStarts?: readonly number[];
  /**
   * 每个小节线对应的原始小节号（1 起算）。反复时同一小节会出现多次，
   * 光靠数组下标会把第二遍标成后面的小节。
   */
  measureNumbers?: readonly number[];
  /**
   * 弱起小节的实际拍数。首小节的音符虽然从第 0 拍起算，但在谱面上是从
   * 小节末尾几拍进来的（4/4 弱起一声进在第 4 拍），拍号标签要靠它补偏移。
   */
  pickupBeats?: number;
};

/**
 * 一次击键。`atMs` 用 `performance.now()` 的时间基准。
 *
 * `slotIndex` 由跟弹流程自己指定：弹错音时进度不会前进（和 `matchMelodyNote`
 * 一致），所以「这一次击键想打的是第几个音」只有它知道。省略时按数组下标
 * 顺序对齐，适合只管顺序、弹错即止的音型题。
 */
export type RhythmHit = {
  midi: number;
  atMs: number;
  slotIndex?: number;
  /** 抬手时刻；没有收到 note-off 时省略（屏幕琴键松手、硬件松手都会发）。 */
  offMs?: number;
};

/**
 * 判定容差：1/4 拍。
 *
 * 80bpm 下约 190ms，正好容得下初学者起手时的抖动；再放宽就分不出
 * 「四分音符」和「附点」了。
 */
export const ON_BEAT_TOLERANCE = 0.25;

// 音长尺子与视奏复盘共用，见 domain/hold.ts（这里转手导出，沿用方不用换 import）。
export { MIN_HELD_RATIO } from "../domain/hold";

/** 旋律跟弹的预备拍：一整小节，让人听清速度再进来。 */
export function countInFor(plan: RhythmPlan): number {
  return plan.beatsPerBar;
}

/** 旋律题的时间轴。主问题仍是听辨调性，这条轴只服务于跟弹。 */
export function planForMelody(question: PlaybackQuestion, bpm = MELODY_BPM): RhythmPlan {
  let cursor = 0;
  const slots = question.melody.map((note) => {
    const slot: RhythmSlot = {
      midis: [pitchToMidi(parsePitchLabel(note.pitch))],
      startBeat: cursor,
      beats: note.beats,
    };
    cursor += note.beats;
    return slot;
  });

  return {
    slots,
    bpm,
    beatsPerBar: question.meter === "3/4" ? 3 : 4,
    totalBeats: cursor,
  };
}

/**
 * 音型题的按拍时间轴。
 *
 * 只有顺序弹奏的题型有意义：单音就一个音、和弦同时按下，节奏不成立。
 * 时值来自谱面本身（`PracticeStaffGroup.duration`），所以听到的和看到的
 * 是同一份数据，不需要另存一张节奏表。
 */
export function planForPattern(target: PlayTarget, bpm = 72): RhythmPlan | null {
  if (target.kind !== "patterns" || !target.beats?.length) return null;

  let cursor = 0;
  const slots = target.midis.map((midi, index) => {
    const beats = target.beats?.[index] ?? DURATION_BEATS.q;
    const slot: RhythmSlot = {
      midis: [midi],
      startBeat: cursor,
      beats,
    };
    cursor += beats;
    return slot;
  });

  return { slots, bpm, beatsPerBar: 4, totalBeats: cursor };
}

/**
 * 曲库跟弹的时间轴：直接读乐谱，不另存一份节奏表。
 *
 * 与 `planForMelody` 的差别是槽位来自谱面而不是旋律数组：起始拍由前面的
 * 音符累加而来，时值取谱面时值，所以听到的、看到的、判的是同一份数据。
 *
 * 同一拍上的左手、右手与和弦合并成一个槽位——它们必须一起按下，拆成两个
 * 槽位会把「和弦弹齐了」说成「两个音各抢了半拍」。
 */
export function planForScore(
  score: Score,
  hand: Hand | "BOTH" = "BOTH",
  bpm = score.bpm,
): RhythmPlan {
  const merged = new Map<number, { midis: number[]; beats: number; targets: Map<number, number> }>();
  for (const event of scoreEvents(score, hand)) {
    const beats = event.beats;
    const slot = merged.get(event.beat);
    if (!slot) {
      merged.set(event.beat, { midis: [...event.midis], beats, targets: new Map() });
    } else {
      // 同一拍上两件乐器可能弹同一个音（齐奏），去重后只要按一次。
      for (const midi of event.midis) {
        if (!slot.midis.includes(midi)) slot.midis.push(midi);
      }
      slot.beats = Math.max(slot.beats, beats);
    }
    // 每个音记自己的时值，别被同拍上更长的音拖累（见 RhythmSlot.targetBeats）。
    for (const midi of event.midis) {
      const entry = merged.get(event.beat)!;
      entry.targets.set(midi, Math.max(entry.targets.get(midi) ?? 0, beats));
    }
  }

  const slots: RhythmSlot[] = [...merged.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([startBeat, slot]) => ({
      midis: [...slot.midis].sort((a, b) => a - b),
      startBeat,
      beats: slot.beats,
      targetBeats: Object.fromEntries(slot.targets),
    }));

  const totalBeats = slots.reduce(
    (max, slot) => Math.max(max, slot.startBeat + slot.beats),
    0,
  );

  const layout = performanceMeasures(score, hand);
  return {
    slots,
    bpm,
    // 网格以四分音符为一格：6/8 的一小节是 3 格（6 个八分音符）。
    beatsPerBar: meterQuarterBeats(score.meter),
    totalBeats,
    measureStarts: layout.map((measure) => measure.startBeat),
    measureNumbers: layout.map((measure) => measure.number),
    ...(score.pickup === undefined ? {} : { pickupBeats: score.pickup }),
  };
}

/**
 * 某个拍坐标落在第几小节、该小节第几拍（都从 1 起算）。
 *
 * 有 `measureStarts` 就照它查——弱起曲子的首小节只有一两拍，硬除
 * `beatsPerBar` 会从第二小节起整体偏一拍，报错定位就会指到隔壁小节。
 * 首小节还要补上弱起偏移：4/4 里 1 拍的弱起，那个音在谱面上是第 4 拍。
 */
export function barOfBeat(plan: RhythmPlan, beat: number): { bar: number; inBar: number } {
  const starts = plan.measureStarts;
  if (!starts || starts.length === 0) {
    return {
      bar: Math.floor(beat / plan.beatsPerBar) + 1,
      inBar: Math.round(beat % plan.beatsPerBar) + 1,
    };
  }
  let index = 0;
  for (let i = 0; i < starts.length; i += 1) {
    if (beat >= starts[i] - 0.001) index = i;
    else break;
  }
  const number = plan.measureNumbers?.[index] ?? index + 1;
  const offset =
    number === 1 && plan.pickupBeats !== undefined ? plan.beatsPerBar - plan.pickupBeats : 0;
  return { bar: number, inBar: Math.round(beat - starts[index] + offset) + 1 };
}

/** 某个绝对时刻落在第几拍（可为负：还在预备拍里）。 */
export function beatAt(plan: RhythmPlan, startedAtMs: number, atMs: number, countIn: number): number {
  return ((atMs - startedAtMs) / 60000) * plan.bpm - countIn;
}

export type RhythmStep = {
  slotIndex: number;
  /** 实际弹的音；漏掉时为 null。 */
  midi: number | null;
  /** 音高是否落在目标里（节奏与音高分开看，反馈才说得清）。 */
  pitchMatched: boolean;
  /** 实际落点（拍）；漏掉时为 null。 */
  atBeat: number | null;
  /** 偏差（拍）：正数=晚，负数=早。漏掉时为 null。 */
  offsetBeat: number | null;
  /**
   * 位置持续了多久（拍）：取最早松手的那个目标音——任何一个音提前断，
   * 这一拍的音响就有了缺口。判定 `length` 时则逐音按各自的目标时值比。
   */
  heldBeats: number | null;
  /**
   * 时值是否按足。
   *
   * `unknown` 表示没有 note-off 记录（设备不发、或松手发生在收尾之后）。
   * 音长只是**附加观察**，不影响 `quality` 与 `accuracy`——连音、保持音
   * 在不同教材里口径不一，拿它判对错会误伤正确的演奏。
   */
  length: "held" | "short" | "unknown";
  quality: "on" | "off" | "missed";
};

export type RhythmResult = {
  steps: RhythmStep[];
  /** 音高对且在拍上的音数。 */
  onCount: number;
  /** 实际弹到的音数（漏掉的不算）。 */
  playedCount: number;
  total: number;
  /** 0–1：音高与时间都对的占比。 */
  accuracy: number;
  /** 平均偏差（拍），正数=整体偏晚；一个音都没弹时为 null。 */
  meanOffset: number | null;
  /** 按足时值的位置数（只统计有 note-off 的）。 */
  heldCount: number;
  /** 明显弹短的位置数。 */
  shortCount: number;
};

/**
 * 判定一次跟弹。
 *
 * 每个击键归到它想打的那个音（见 `RhythmHit.slotIndex`）；同一个音被弹多次
 * 只认第一次，因为反复试按不该被当成「越弹越准」。没有落键的音就是漏掉，
 * 不能把后面的音往前顶——那样错位会被悄悄摊平。
 *
 * 时间与音高分两个维度记，所以「音对了但抢了半拍」和「拍子对但音弹错」
 * 在结果里是两件不同的事，反馈可以分别说出来。
 */
export function gradeRhythm(
  plan: RhythmPlan,
  hits: readonly RhythmHit[],
  startedAtMs: number,
  countIn = 0,
): RhythmResult {
  /**
   * 一个槽位可能要被按好几下（和弦、双手同拍），所以先按槽位分组，
   * 再按音去重：同一个音反复试按只认第一次，越按越准不该被算成「凑够了」。
   * 去重保留数组里的第一次而不是时间最早的——调用方按击键先后顺序追加，
   * 两者平时一致，但测试会故意把顺序倒过来验证「先发生的事实不会被覆盖」。
   */
  const grouped = new Map<number, { first: RhythmHit; midis: Map<number, RhythmHit> }>();
  hits.forEach((hit, order) => {
    const index = hit.slotIndex ?? order;
    let entry = grouped.get(index);
    if (!entry) {
      entry = { first: hit, midis: new Map() };
      grouped.set(index, entry);
    }
    if (!entry.midis.has(hit.midi)) entry.midis.set(hit.midi, hit);
  });

  const steps: RhythmStep[] = plan.slots.map((slot, index) => {
    const entry = grouped.get(index);
    if (!entry) {
      return {
        slotIndex: index,
        midi: null,
        pitchMatched: false,
        atBeat: null,
        offsetBeat: null,
        heldBeats: null,
        length: "unknown",
        quality: "missed",
      };
    }

    const atBeat = beatAt(plan, startedAtMs, entry.first.atMs, countIn);
    const offsetBeat = atBeat - slot.startBeat;
    // 和弦要弹齐且不多余：漏一个音或混进一个不属于它的音都不算这个位置弹对。
    const pitchMatched =
      slot.midis.every((midi) => entry.midis.has(midi)) &&
      entry.midis.size === slot.midis.length;

    // 音长按每个音自己的目标时值判：同拍上低音铺满全小节、右手走四分音符，
    // 短的音本来就要先抬。多弹的音不参与——它不属于这个位置。
    let earliestOff: number | null = null;
    let anyOff = false;
    let anyShort = false;
    for (const midi of slot.midis) {
      const hit = entry.midis.get(midi);
      if (!hit || hit.offMs == null) continue;
      anyOff = true;
      if (earliestOff == null || hit.offMs < earliestOff) earliestOff = hit.offMs;
      const target = slot.targetBeats?.[midi] ?? slot.beats;
      const heldBeats = ((hit.offMs - hit.atMs) / 60000) * plan.bpm;
      if (!isHeldEnough(heldBeats, target)) anyShort = true;
    }

    const heldBeats =
      earliestOff == null ? null : ((earliestOff - entry.first.atMs) / 60000) * plan.bpm;

    return {
      slotIndex: index,
      midi: entry.first.midi,
      pitchMatched,
      atBeat,
      offsetBeat,
      heldBeats,
      length: !anyOff ? "unknown" : anyShort ? "short" : "held",
      quality: Math.abs(offsetBeat) <= ON_BEAT_TOLERANCE ? "on" : "off",
    };
  });

  const played = steps.filter((step) => step.offsetBeat !== null);
  const onCount = steps.filter((step) => step.quality === "on" && step.pitchMatched).length;
  const total = plan.slots.length;

  const meanOffset = played.length
    ? played.reduce((sum, step) => sum + (step.offsetBeat ?? 0), 0) / played.length
    : null;

  return {
    steps,
    onCount,
    playedCount: played.length,
    total,
    accuracy: total > 0 ? onCount / total : 0,
    meanOffset,
    heldCount: steps.filter((step) => step.length === "held").length,
    shortCount: steps.filter((step) => step.length === "short").length,
  };
}

/** 网格上要画的一次落点。 */
export type RhythmMark = {
  slotIndex: number;
  /** 实际弹的拍点，可能落在格子之外（拖得很厉害时）。 */
  atBeat: number;
  quality: "on" | "off";
};

/** 从判定结果里挑出要画在网格上的落点；漏掉的音不画，空格本身就是信息。 */
export function rhythmMarks(result: RhythmResult): RhythmMark[] {
  const marks: RhythmMark[] = [];
  for (const step of result.steps) {
    if (step.atBeat === null || step.quality === "missed") continue;
    marks.push({
      slotIndex: step.slotIndex,
      atBeat: step.atBeat,
      quality: step.quality === "on" ? "on" : "off",
    });
  }
  return marks;
}

/** 拍数写成便于读的形式：「半拍」「一拍」「1.5 拍」。 */
export function beatText(beats: number): string {
  const rounded = Math.round(Math.abs(beats) * 4) / 4;
  if (rounded === 0.25) return "四分之一拍";
  if (rounded === 0.5) return "半拍";
  if (rounded === 0.75) return "四分之三拍";
  if (Number.isInteger(rounded)) return `${rounded} 拍`;
  return `${rounded.toFixed(2).replace(/0$/, "")} 拍`;
}

/** 「晚了半拍」这样的单句，用于逐音反馈。 */
export function offsetText(offsetBeat: number): string {
  if (offsetBeat > 0) return `晚了${beatText(offsetBeat)}`;
  if (offsetBeat < 0) return `早了${beatText(offsetBeat)}`;
  return "正好在拍上";
}

/**
 * 整条跟弹的结论。
 *
 * 只说两件事：整体准不准、以及系统性的偏早/偏晚。逐音偏差不在这里
 * 罗列——网格上已经画出来了，再用文字重复一遍是噪声。
 */
export function rhythmSummary(result: RhythmResult): string {
  if (result.total === 0) return "这段没有可跟的音。";

  const percent = Math.round(result.accuracy * 100);
  const parts = [`音高与节拍都对了 ${result.onCount} / ${result.total} 音（${percent}%）`];

  if (result.playedCount < result.total) {
    parts.push(`还有 ${result.total - result.playedCount} 个音没弹到`);
  }

  const mean = result.meanOffset;
  if (mean !== null && Math.abs(mean) > ON_BEAT_TOLERANCE) {
    parts.push(mean > 0 ? "整体偏晚，可以早一点起手" : "整体偏早，等一拍再弹");
  } else if (mean !== null) {
    parts.push("整体没有系统性偏移");
  }

  // 音长是附加观察：说「有几个音弹短了」，不折算进上面的百分比。
  if (result.shortCount > 0) {
    parts.push(`${result.shortCount} 个音按得太短，长音符要按住不放`);
  }

  return `${parts.join("；")}。`;
}
