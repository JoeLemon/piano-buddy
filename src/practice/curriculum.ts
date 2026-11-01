import {
  createPracticeQuestions,
  type PracticeChoice,
  type PracticeKind,
  type PracticeOptions,
  type PracticeQuestion,
} from "./quiz";
import { handSpanExplanation } from "./explanation";
import {
  handSpanChoices,
  HAND_SPAN_EXAMPLES,
} from "./handSpanContent";
import type { PracticeStaffPrompt } from "./practiceScore";
import type { SymbolGroup } from "./theoryContent";

/**
 * 专项题组：原来「主线闯关」的 10 组固定题量。
 *
 * 关卡顺序、解锁与进度由 `theoryPath.ts` 统一调度：基础十关按顺序解锁，
 * 通过后把最高答对数写进 `Profile.theoryPath`，和 L3 预备课共用同一份
 * 进度。这里只描述每关的题型、题量与通过线，不持有状态。
 */
export type CurriculumStage = {
  id: string;
  title: string;
  /** 卡片上的一句话目标。 */
  goal: string;
  /** 进入关卡后的学习指导（学习内容）。 */
  guidance: string;
  kind: PracticeKind;
  /** 符号关卡的组别；其它题型留空。 */
  symbolGroups?: readonly SymbolGroup[];
  /** 透传给 `createPracticeQuestions` 的题型范围。 */
  options?: PracticeOptions;
  /**
   * 手写题目。L4–L6 的转位、拍号、三连音等题型没有独立练习入口，
   * 由关卡自己组题；有它时不再按 `kind` 自动生成。
   */
  buildQuestions?: (seed: number) => PracticeQuestion[];
  questionCount: number;
  /** 通过所需答对数；专项题组只用于结果文案。 */
  passScore: number;
};

export const CURRICULUM_STAGES: readonly CurriculumStage[] = [
  {
    id: "Q1",
    title: "单音认谱",
    goal: "看谱面认出 C3–E5 的音名",
    guidance: "先看谱号，再从最近的线或间数到符头。低音谱比高音谱低一个八度记谱。",
    kind: "notes",
    questionCount: 5,
    passScore: 4,
  },
  {
    id: "Q2",
    title: "力度与速度",
    goal: "分清 pp–fff 与 rit./accel.",
    guidance: "力度记号写在谱下方，速度记号常写在乐句上方；先记 p 弱、f 强这条主轴。",
    kind: "symbols",
    symbolGroups: ["力度", "速度"],
    questionCount: 5,
    passScore: 4,
  },
  {
    id: "Q3",
    title: "发音与反复",
    goal: "认出断音、重音、D.C. 与 Fine",
    guidance: "发音记号改变音的长短与重音；反复记号决定段落要不要再来一遍。",
    kind: "symbols",
    symbolGroups: ["发音", "反复"],
    questionCount: 5,
    passScore: 4,
  },
  {
    id: "Q4",
    title: "八度与演奏法",
    goal: "看懂 8va / 8vb 与 legato / pizz.",
    guidance: "8va 与 8vb 只改变八度，不改变音名；演奏法记号改变触键方式。",
    kind: "symbols",
    symbolGroups: ["八度", "演奏法"],
    questionCount: 4,
    passScore: 3,
  },
  {
    id: "Q5",
    title: "常见音程",
    goal: "从二度到八度认出 27 种音程",
    guidance: "先数音级（字母跨几步），再看半音数判断大小/纯/增减；增四度与减五度听起来一样但要按拼写判断。",
    kind: "intervals",
    questionCount: 5,
    passScore: 4,
  },
  {
    id: "Q6",
    title: "三和弦与七和弦",
    goal: "认出大小增减三和弦与五种七和弦",
    guidance: "三和弦看根音上叠的两个三度；七和弦在最上面再加一个三度。先判断三音是大三度还是小三度，再看七音：大七 11 个半音、小七与属七 10 个、减七 9 个、半减七（三音与五音都低半音）也是 10 个。",
    kind: "chords",
    questionCount: 5,
    passScore: 4,
  },
  {
    id: "Q7",
    title: "临时升降",
    goal: "分清升、降、还原与本小节范围",
    guidance: "调号是整首曲子的默认值；临时升降只在本小节内对同一音高生效，下一小节要重新看。",
    kind: "accidentals",
    questionCount: 5,
    passScore: 4,
  },
  {
    id: "Q8",
    title: "和弦进行",
    goal: "看懂 I–IV–I、I–V–I 与大小调级数",
    guidance: "级数描述和弦在调里的位置。大调 I–IV–I 稳定，I–V–I 收束感更强；小调看 i 与 V 的大小写。",
    kind: "progressions",
    questionCount: 4,
    passScore: 3,
  },
  {
    id: "Q9",
    title: "音型走向",
    goal: "看一串音判断上行、下行与回环",
    guidance: "先看第一个音到最后一个音的方向，再看中间有没有折返；不要被个别跳进带偏。",
    kind: "patterns",
    questionCount: 5,
    passScore: 4,
  },
  {
    id: "Q10",
    title: "听调性",
    goal: "听主和弦与短旋律判断 G/E 大小调",
    guidance: "先听开头的主和弦：大三和弦偏大调，小三和弦偏小调；再听旋律里有没有升高导音。",
    kind: "melodies",
    questionCount: 5,
    passScore: 4,
  },
];

/**
 * L4 预备五节：分解和弦、手位读谱、和弦转位、小调与小三和弦、综合小测。
 *
 * 这些节不搞独立界面，直接复用练习页的题型机制（`kind` 就是练习题型），
 * 所以形状和基础关一样。内容对应技能图谱里的 texture.broken / pos.expand /
 * chord.inversion / key.minor / chord.minor ——曲库 L4 编配缺这些项时，
 * 缺技能清单的按钮直达这里。
 */
export const L4_PREP_STAGES: readonly CurriculumStage[] = [
  {
    id: "L4-1",
    title: "分解和弦",
    goal: "听出、看出分解和弦是什么和弦",
    guidance:
      "分解和弦是把同一个和弦的音依次弹出。先别管顺序，把听到的音拢到一块，再按三度叠回去判断类型；拿不准就点「柱式」听对照。",
    kind: "broken",
    questionCount: 5,
    passScore: 4,
  },
  {
    id: "L4-2",
    title: "手位读谱",
    goal: "数出最两端跨几度，判断要不要撑手位",
    guidance:
      "只看最两端的两个音，中间音不改变跨度。五度以内一个手位放得下；六度以上要么把两端撑开，要么提前换手位。",
    kind: "handSpan",
    questionCount: 5,
    passScore: 4,
  },
  {
    id: "L4-3",
    title: "和弦转位",
    goal: "看低音判断原位、第一转位与第二转位",
    guidance:
      "转位不改变和弦的根音与性质，只改变最低音。低音是根音就是原位，是三音就是第一转位，是五音就是第二转位；先找低音，再把音按三度叠回根音位置。",
    kind: "chords",
    buildQuestions: inversionQuestions,
    questionCount: 4,
    passScore: 3,
  },
  {
    id: "L4-4",
    title: "小调与小三和弦",
    goal: "认出 A / E / D 小调的主和弦与小三和弦",
    guidance:
      "小调的主和弦是小三和弦：根音到三音三个半音，三音到五音四个半音。A 小调是 A–C–E，E 小调是 E–G–B，D 小调是 D–F–A；先听三音比大调低半音。",
    kind: "chords",
    buildQuestions: minorChordQuestions,
    questionCount: 4,
    passScore: 3,
  },
  {
    id: "L4-5",
    title: "L4 综合小测",
    goal: "把分解和弦、手位、转位与小调连起来用",
    guidance:
      "综合题会混着出现：先判断题目在问织体、跨度、转位还是调性，再调用对应的一条规则。答错时看解析里的第一步，别急着背答案。",
    kind: "chords",
    buildQuestions: l4TestQuestions,
    questionCount: 7,
    passScore: 6,
  },
];

/**
 * L5 预备五节：七和弦、6/8、三连音、附点与切分、综合小测。
 *
 * 七和弦沿用和弦题库（只筛 maj7 / min7 / dom7）；拍号与连音符没有独立
 * 自由练习入口，所以用 `buildQuestions` 手写四题，但谱面仍走
 * `PracticeStaffPrompt` → `renderScore` 的现有管线。
 */
export const L5_PREP_STAGES: readonly CurriculumStage[] = [
  {
    id: "L5-1",
    title: "七和弦",
    goal: "认出大七、小七与属七和弦",
    guidance:
      "七和弦在三和弦上再叠一个三度。大七的七音离根音 11 个半音，小七 10 个，属七也是 10 个但三音是大三度；先听三音，再听七音。",
    kind: "chords",
    options: { chordTypeIds: ["maj7", "min7", "dom7"] },
    questionCount: 4,
    passScore: 3,
  },
  {
    id: "L5-2",
    title: "6/8 拍",
    goal: "分清 6/8 的六个八分音符与两个大拍",
    guidance:
      "6/8 每小节有六个八分音符，按 3+3 分成两个大拍；不要把它当成 3/4 的 2+2+2。附点四分音符正好等于一个大拍（三个八分音符）。",
    kind: "patterns",
    buildQuestions: meterQuestions,
    questionCount: 4,
    passScore: 3,
  },
  {
    id: "L5-3",
    title: "三连音",
    goal: "理解 3:2 三连音占两拍时值",
    guidance:
      "三连音把三个等长音塞进两个普通音的时值里，记作 3:2。三个八分三连音占一个四分音符的时值，所以每个音是 1/3 拍；一组必须连续、时值相同。",
    kind: "patterns",
    buildQuestions: tripletQuestions,
    questionCount: 4,
    passScore: 3,
  },
  {
    id: "L5-4",
    title: "附点与切分",
    goal: "算清附点时值，听出切分的重音错位",
    guidance:
      "附点把原时值延长一半：附点四分 = 1.5 拍，附点二分 = 3 拍。切分把重音从强拍挪到弱拍或弱位，八分–四分–八分是常见的两拍切分。",
    kind: "patterns",
    buildQuestions: dottedQuestions,
    questionCount: 4,
    passScore: 3,
  },
  {
    id: "L5-5",
    title: "L5 综合小测",
    goal: "把七和弦、6/8、三连音与附点连起来用",
    guidance:
      "先看拍号决定一小节几拍，再看有没有连音符或附点，最后才数和弦音。综合题不追求速度，先保证每一步的时值口径一致。",
    kind: "chords",
    buildQuestions: l5TestQuestions,
    questionCount: 7,
    passScore: 6,
  },
];

/**
 * L6 预备：十六分音符、六度/八度跳进、离开五指位、综合视奏、减七与半减七、小测。
 *
 * 「减七与半减七」（L6-6）是后加的补充课，排在综合小测之前；id 没有跟着
 * 顺序重排，是为了不破坏已有档案里 L6-5 的完成态。
 *
 * L6 的核心是「读得更快、手位移动更早」：十六分音符先数一拍四个音，
 * 大跨度先看最两端，再决定扩张还是换位。综合视奏把单音、音程、音型、
 * 手位混在一起，模拟真实曲目里的连续判断。
 */
export const L6_PREP_STAGES: readonly CurriculumStage[] = [
  {
    id: "L6-1",
    title: "十六分音符",
    goal: "数清一拍里的四个十六分音符",
    guidance:
      "十六分音符是八分音符的一半，一拍里有四个。两条符尾是十六分，一条符尾是八分；先按四个一组读，再把组连成拍。",
    kind: "patterns",
    buildQuestions: sixteenthQuestions,
    questionCount: 4,
    passScore: 3,
  },
  {
    id: "L6-2",
    title: "六度与八度跳进",
    goal: "数出大跨度，提前准备手位",
    guidance:
      "六度以上不要临时找键：先看最两端的音，确认跨度，再决定在五指位里扩张还是提前换位。八度跳进最常见，手腕要提前带过去。",
    kind: "handSpan",
    buildQuestions: leapQuestions,
    questionCount: 4,
    passScore: 3,
  },
  {
    id: "L6-3",
    title: "离开五指位",
    goal: "七度、八度时判断扩张还是换位",
    guidance:
      "七度、八度已经超出一个五指位的舒适范围。若前后有足够时间，换手位更稳；若必须连奏，才用扩张。判断前先数最两端，不要被中间音干扰。",
    kind: "handSpan",
    buildQuestions: positionShiftQuestions,
    questionCount: 4,
    passScore: 3,
  },
  {
    id: "L6-4",
    title: "综合视奏",
    goal: "连续处理单音、音程、音型与手位",
    guidance:
      "综合视奏像真实曲目：谱号、音高、走向和跨度会连续出现。每道题只抓一个判断点——先认音，再看走向，最后看跨度。",
    kind: "notes",
    buildQuestions: sightReadingQuestions,
    questionCount: 7,
    passScore: 6,
  },
  {
    // id 取 L6-6 而不是把「综合小测」顺延成 L6-6：改 id 会让已有档案里的
    // L6-5（小测完成态）错位到新加的课上。显示顺序由数组决定，所以这节排在
    // 小测之前，用户看到的是「四节课 → 减七与半减七 → 综合小测」。
    id: "L6-6",
    title: "减七与半减七",
    goal: "认出减七与半减七，并把它们和属七分开",
    guidance:
      "减七是三个小三度叠起来（0–3–6–9），四个音等距，听上去最不稳定；半减七把最上面的小三度换回大三度（0–3–6–10），相当于小三和弦加小七度，是小调里最常见的 ii 级。两者共同点是减五度（6 个半音）：先看根音到五音，再看七音是 9 还是 10 个半音。",
    kind: "chords",
    options: { chordTypeIds: ["dim7", "halfDim7"] },
    questionCount: 4,
    passScore: 3,
  },
  {
    id: "L6-5",
    title: "L6 综合小测",
    goal: "用十六分、大跨度与综合视奏完成过关",
    guidance:
      "小测把 L6 的四类判断混在一起。遇到节奏题先数分组，遇到跨度题先看两端，遇到视奏题先认谱号；稳定比速度更重要。",
    kind: "notes",
    buildQuestions: l6TestQuestions,
    questionCount: 7,
    passScore: 6,
  },
];

/** 全部关卡（基础十关 + L4–L6 预备）：练习页的 preset 查找用这一份。 */
export const ALL_STAGES: readonly CurriculumStage[] = [
  ...CURRICULUM_STAGES,
  ...L4_PREP_STAGES,
  ...L5_PREP_STAGES,
  ...L6_PREP_STAGES,
];

/** 按 id 找关卡；空 id 或找不到返回 undefined。 */
export function findStage(stageId: string | null): CurriculumStage | undefined {
  if (!stageId) return undefined;
  return ALL_STAGES.find((stage) => stage.id === stageId);
}

/** preset 属于哪一份关卡表；「下一关」只在同一张表里找，不跨章。 */
export function stageListFor(stageId: string): readonly CurriculumStage[] {
  return (
    STAGE_LISTS.find((list) => list.some((stage) => stage.id === stageId)) ??
    CURRICULUM_STAGES
  );
}

const STAGE_LISTS: readonly (readonly CurriculumStage[])[] = [
  CURRICULUM_STAGES,
  L4_PREP_STAGES,
  L5_PREP_STAGES,
  L6_PREP_STAGES,
];

/** 专项题组题目：固定题量，按 seed 生成后截取，保证每次重练换题序。 */
export function createCurriculumStageQuestions(
  stageId: string,
  seed: number,
): PracticeQuestion[] {
  const stage = findStage(stageId);
  if (!stage) return [];
  if (stage.buildQuestions) return stage.buildQuestions(seed).slice(0, stage.questionCount);
  return createPracticeQuestions(stage.kind, seed, {
    ...stage.options,
    ...(stage.symbolGroups ? { symbolGroups: stage.symbolGroups } : {}),
  }).slice(0, stage.questionCount);
}

/* ── L4 手写题 ─────────────────────────────────────────────── */

type InversionExample = {
  id: string;
  pitches: readonly string[];
  answer: "root" | "first" | "second";
  chord: string;
  bass: string;
  tone: string;
};

const INVERSION_CHOICES: readonly PracticeChoice[] = [
  { id: "root", label: "原位（根音在低音）" },
  { id: "first", label: "第一转位（三音在低音）" },
  { id: "second", label: "第二转位（五音在低音）" },
  { id: "third", label: "第三转位（七音在低音）" },
];

const INVERSION_EXAMPLES: readonly InversionExample[] = [
  {
    id: "c-root",
    pitches: ["C4", "E4", "G4"],
    answer: "root",
    chord: "C 大三和弦",
    bass: "C",
    tone: "根音",
  },
  {
    id: "c-first",
    pitches: ["E4", "G4", "C5"],
    answer: "first",
    chord: "C 大三和弦",
    bass: "E",
    tone: "三音",
  },
  {
    id: "c-second",
    pitches: ["G4", "C5", "E5"],
    answer: "second",
    chord: "C 大三和弦",
    bass: "G",
    tone: "五音",
  },
  {
    id: "a-second",
    pitches: ["E4", "A4", "C5"],
    answer: "second",
    chord: "A 小三和弦",
    bass: "E",
    tone: "五音",
  },
];

function inversionQuestions(seed: number): PracticeQuestion[] {
  return INVERSION_EXAMPLES.map((item, index) => ({
    id: `l4:inversion:${item.id}`,
    kind: "chords",
    prompt: item.pitches.join(" – "),
    hint: "先看最低音，再判断它是根音、三音还是五音。",
    choices: rotateChoices(INVERSION_CHOICES, seed + index),
    answerId: item.answer,
    explanation: `${item.chord}的低音是 ${item.bass}，也就是${item.tone}，所以是${inversionName(item.answer)}。`,
    explanationSteps: [
      "把三个音按三度叠回根音位置，确认根音。",
      "看最低音是根音、三音还是五音。",
      "低音是根音=原位，三音=第一转位，五音=第二转位。",
    ],
    staff: chordStaff(item.pitches),
  }));
}

function minorChordQuestions(seed: number): PracticeQuestion[] {
  const generated = createPracticeQuestions("chords", seed, {
    chordTypeIds: ["min"],
  }).slice(0, 3);
  return [...generated, minorKeyQuestion(seed)];
}

function minorKeyQuestion(seed: number): PracticeQuestion {
  const choices: readonly PracticeChoice[] = [
    { id: "Am", label: "A 小三和弦 (Am)" },
    { id: "C", label: "C 大三和弦 (C)" },
    { id: "Em", label: "E 小三和弦 (Em)" },
    { id: "G", label: "G 大三和弦 (G)" },
  ];
  return {
    id: "l4:minor-key",
    kind: "chords",
    prompt: "A4 – C5 – E5",
    hint: "这是 A 小调的主和弦，先看根音到三音有几个半音。",
    choices: rotateChoices(choices, seed),
    answerId: "Am",
    explanation: "A 小调的主和弦是 A–C–E：根音 A 到三音 C 三个半音，是小三和弦。",
    explanationSteps: [
      "A 小调的主音是 A，主和弦以 A 为根音。",
      "A–C 是小三度，C–E 是大三度。",
      "所以 A–C–E 是 A 小三和弦（Am）。",
    ],
    staff: {
      clef: "treble",
      keySignature: "Am",
      groups: [{ pitches: ["A4", "C5", "E5"], duration: "w" }],
    },
  };
}

function l4TestQuestions(seed: number): PracticeQuestion[] {
  return [
    ...createPracticeQuestions("broken", seed).slice(0, 2),
    ...createPracticeQuestions("handSpan", seed + 1).slice(0, 2),
    ...inversionQuestions(seed + 2).slice(0, 2),
    ...minorChordQuestions(seed + 3).slice(0, 1),
  ];
}

/* ── L5 手写题 ─────────────────────────────────────────────── */

const SIX_EIGHT = { beats: 6, beatValue: 8 } as const;

function sixEightStaff(): PracticeStaffPrompt {
  return {
    clef: "treble",
    meter: SIX_EIGHT,
    groups: ["C4", "D4", "E4", "F4", "G4", "A4"].map((pitch) => ({
      pitches: [pitch],
      duration: "8",
    })),
  };
}

function meterQuestions(seed: number): PracticeQuestion[] {
  const staff = sixEightStaff();
  return [
    {
      id: "l5:meter:count",
      kind: "patterns",
      prompt: "6/8 一小节有几个八分音符？",
      hint: "看拍号的上方数字。",
      choices: rotateChoices(
        [
          { id: "4", label: "4 个" },
          { id: "6", label: "6 个" },
          { id: "8", label: "8 个" },
          { id: "3", label: "3 个" },
        ],
        seed,
      ),
      answerId: "6",
      explanation: "6/8 的上方数字 6 表示每小节有 6 个八分音符。",
      explanationSteps: [
        "拍号上方是每小节的拍数单位，下方是单位时值。",
        "6/8 = 6 个八分音符。",
      ],
      staff,
    },
    {
      id: "l5:meter:beats",
      kind: "patterns",
      prompt: "6/8 每小节有几个大拍？",
      hint: "六个八分音符按 3+3 分组。",
      choices: rotateChoices(
        [
          { id: "2", label: "2 个大拍" },
          { id: "3", label: "3 个大拍" },
          { id: "4", label: "4 个大拍" },
          { id: "6", label: "6 个大拍" },
        ],
        seed,
      ),
      answerId: "2",
      explanation: "6/8 是复拍子：六个八分音符按 3+3 分成两个大拍，每拍是附点四分音符。",
      explanationSteps: [
        "先按 3 个八分音符一组分组。",
        "6 个八分音符分成两组，所以是 2 个大拍。",
      ],
      staff,
    },
    {
      id: "l5:meter:grouping",
      kind: "patterns",
      prompt: "3/4 与 6/8 都写 6 个八分音符时，强弱分组是？",
      hint: "一个按 2 分组，一个按 3 分组。",
      choices: rotateChoices(
        [
          { id: "3-4-222-68-33", label: "3/4：2+2+2；6/8：3+3" },
          { id: "3-4-33-68-222", label: "3/4：3+3；6/8：2+2+2" },
          { id: "both-222", label: "两者都是 2+2+2" },
          { id: "both-333", label: "两者都是 3+3" },
        ],
        seed,
      ),
      answerId: "3-4-222-68-33",
      explanation: "3/4 是单拍子，按 2+2+2 分组；6/8 是复拍子，按 3+3 分成两个大拍。",
      explanationSteps: [
        "3/4 的强拍在每两个八分音符后出现。",
        "6/8 的强拍在每三个八分音符后出现。",
      ],
      staff,
    },
    {
      id: "l5:meter:dotted",
      kind: "patterns",
      prompt: "6/8 里附点四分音符等于几个八分音符？",
      hint: "附点把四分音符延长一半。",
      choices: rotateChoices(
        [
          { id: "2", label: "2 个" },
          { id: "3", label: "3 个" },
          { id: "4", label: "4 个" },
          { id: "6", label: "6 个" },
        ],
        seed,
      ),
      answerId: "3",
      explanation: "附点四分音符 = 四分音符 + 八分音符 = 3 个八分音符，正好是 6/8 的一个大拍。",
      explanationSteps: [
        "四分音符 = 2 个八分音符。",
        "附点再延长一半 = 1 个八分音符。",
        "2 + 1 = 3 个八分音符。",
      ],
      staff: {
        clef: "treble",
        meter: SIX_EIGHT,
        groups: [{ pitches: ["C4"], duration: "qd" }],
      },
    },
  ];
}

function tripletStaff(): PracticeStaffPrompt {
  return {
    clef: "treble",
    meter: { beats: 4, beatValue: 4 },
    groups: ["C4", "D4", "E4"].map((pitch) => ({
      pitches: [pitch],
      duration: "8",
      tuplet: "l5-triplet",
    })),
  };
}

function tripletQuestions(seed: number): PracticeQuestion[] {
  const staff = tripletStaff();
  return [
    {
      id: "l5:triplet:beats",
      kind: "patterns",
      prompt: "三个八分三连音占几拍？",
      hint: "3:2 表示三个音占两个普通八分音符的时值。",
      choices: rotateChoices(
        [
          { id: "1", label: "1 拍" },
          { id: "2", label: "2 拍" },
          { id: "3", label: "3 拍" },
          { id: "1.5", label: "1.5 拍" },
        ],
        seed,
      ),
      answerId: "1",
      explanation: "三个八分三连音占两个普通八分音符的时值，也就是一个四分音符（1 拍）。",
      explanationSteps: [
        "普通两个八分音符 = 1 拍。",
        "三连音 3:2 把三个音塞进这 1 拍。",
      ],
      staff,
    },
    {
      id: "l5:triplet:ratio",
      kind: "patterns",
      prompt: "三连音记号 3:2 里的 2 表示什么？",
      hint: "2 是「占几个普通音」的意思。",
      choices: rotateChoices(
        [
          { id: "two-eighths", label: "占两个普通八分音符的时值" },
          { id: "two-bars", label: "占两个小节" },
          { id: "twice", label: "每个音弹两次" },
          { id: "two-voices", label: "两个声部同时弹" },
        ],
        seed,
      ),
      answerId: "two-eighths",
      explanation: "3:2 读作「三对二」：三个三连音音占两个普通同基础时值音的时长。",
      explanationSteps: [
        "前面的 3 是连音个数。",
        "后面的 2 是被占用的普通音个数。",
      ],
      staff,
    },
    {
      id: "l5:triplet:each",
      kind: "patterns",
      prompt: "一拍里三个等长三连音，每个音占几拍？",
      hint: "把 1 拍平均分成 3 份。",
      choices: rotateChoices(
        [
          { id: "1/2", label: "1/2 拍" },
          { id: "1/3", label: "1/3 拍" },
          { id: "1/4", label: "1/4 拍" },
          { id: "2/3", label: "2/3 拍" },
        ],
        seed,
      ),
      answerId: "1/3",
      explanation: "三个音平分 1 拍，所以每个音是 1/3 拍；三个 1/3 合起来正好 1 拍。",
      explanationSteps: ["1 拍 ÷ 3 个音 = 1/3 拍/音。"],
      staff,
    },
    {
      id: "l5:triplet:group",
      kind: "patterns",
      prompt: "三连音的三个音必须满足什么条件？",
      hint: "三连音是一组，不是三个独立的音。",
      choices: rotateChoices(
        [
          { id: "same-contiguous", label: "时值相同、连续在同一组" },
          { id: "cross-bar", label: "可以跨小节任意组合" },
          { id: "first-long", label: "第一个音必须延长" },
          { id: "six-eight-only", label: "只能用在 6/8" },
        ],
        seed,
      ),
      answerId: "same-contiguous",
      explanation: "3:2 三连音要求三个音基础时值相同、连续排列，并共用同一个连音组。",
      explanationSteps: [
        "时值不同就不是同一组三连音。",
        "中间夹了别的音或跨小节，组就断了。",
      ],
      staff,
    },
  ];
}

function dottedQuestions(seed: number): PracticeQuestion[] {
  return [
    {
      id: "l5:dotted:quarter",
      kind: "patterns",
      prompt: "附点四分音符占几拍？",
      hint: "附点 = 原时值 + 原时值的一半。",
      choices: rotateChoices(
        [
          { id: "1", label: "1 拍" },
          { id: "1.5", label: "1.5 拍" },
          { id: "2", label: "2 拍" },
          { id: "2.5", label: "2.5 拍" },
        ],
        seed,
      ),
      answerId: "1.5",
      explanation: "四分音符 1 拍，附点延长一半（0.5 拍），所以是 1.5 拍。",
      explanationSteps: ["1 + 0.5 = 1.5 拍。"],
      staff: {
        clef: "treble",
        groups: [
          { pitches: ["C4"], duration: "qd" },
          { pitches: ["D4"], duration: "8" },
        ],
      },
    },
    {
      id: "l5:dotted:half",
      kind: "patterns",
      prompt: "附点二分音符占几拍？",
      hint: "二分音符是 2 拍。",
      choices: rotateChoices(
        [
          { id: "2", label: "2 拍" },
          { id: "2.5", label: "2.5 拍" },
          { id: "3", label: "3 拍" },
          { id: "4", label: "4 拍" },
        ],
        seed,
      ),
      answerId: "3",
      explanation: "二分音符 2 拍，附点延长 1 拍，所以附点二分音符是 3 拍。",
      explanationSteps: ["2 + 1 = 3 拍。"],
      staff: {
        clef: "treble",
        groups: [
          { pitches: ["C4"], duration: "hd" },
          { pitches: ["D4"], duration: "q" },
        ],
      },
    },
    {
      id: "l5:dotted:syncopation",
      kind: "patterns",
      prompt: "切分节奏的重音通常落在哪里？",
      hint: "切分就是把重音从强拍挪开。",
      choices: rotateChoices(
        [
          { id: "weak", label: "弱拍或弱位" },
          { id: "strong", label: "每小节第一拍" },
          { id: "last", label: "每小节最后一拍" },
          { id: "none", label: "完全没有重音" },
        ],
        seed,
      ),
      answerId: "weak",
      explanation: "切分让弱拍或弱位上的音被强调，形成重音错位。",
      explanationSteps: [
        "正常重音在强拍。",
        "切分把长音或重音移到弱拍/弱位。",
      ],
      staff: {
        clef: "treble",
        groups: [
          { pitches: ["C4"], duration: "8" },
          { pitches: ["D4"], duration: "q" },
          { pitches: ["E4"], duration: "8" },
        ],
      },
    },
    {
      id: "l5:dotted:syncopation-beats",
      kind: "patterns",
      prompt: "八分–四分–八分（切分）总共几拍？",
      hint: "0.5 + 1 + 0.5。",
      choices: rotateChoices(
        [
          { id: "1", label: "1 拍" },
          { id: "1.5", label: "1.5 拍" },
          { id: "2", label: "2 拍" },
          { id: "3", label: "3 拍" },
        ],
        seed,
      ),
      answerId: "2",
      explanation: "八分 0.5 拍 + 四分 1 拍 + 八分 0.5 拍 = 2 拍。",
      explanationSteps: ["0.5 + 1 + 0.5 = 2。"],
      staff: {
        clef: "treble",
        groups: [
          { pitches: ["C4"], duration: "8" },
          { pitches: ["D4"], duration: "q" },
          { pitches: ["E4"], duration: "8" },
        ],
      },
    },
  ];
}

function l5TestQuestions(seed: number): PracticeQuestion[] {
  return [
    ...createPracticeQuestions("chords", seed, {
      chordTypeIds: ["maj7", "min7", "dom7"],
    }).slice(0, 2),
    ...meterQuestions(seed + 1).slice(0, 2),
    ...tripletQuestions(seed + 2).slice(0, 2),
    ...dottedQuestions(seed + 3).slice(0, 1),
  ];
}

/* ── L6 手写题 ─────────────────────────────────────────────── */

function sixteenthStaff(): PracticeStaffPrompt {
  return {
    clef: "treble",
    meter: { beats: 4, beatValue: 4 },
    groups: ["C4", "D4", "E4", "F4"].map((pitch) => ({
      pitches: [pitch],
      duration: "16",
    })),
  };
}

function sixteenthQuestions(seed: number): PracticeQuestion[] {
  const staff = sixteenthStaff();
  return [
    {
      id: "l6:sixteenth:count",
      kind: "patterns",
      prompt: "一拍里几个十六分音符？",
      hint: "十六分是八分的一半。",
      choices: rotateChoices(
        [
          { id: "2", label: "2 个" },
          { id: "3", label: "3 个" },
          { id: "4", label: "4 个" },
          { id: "8", label: "8 个" },
        ],
        seed,
      ),
      answerId: "4",
      explanation: "八分音符一拍两个，十六分再细分一半，所以一拍有 4 个十六分音符。",
      explanationSteps: ["1 拍 = 2 个八分 = 4 个十六分。"],
      staff,
    },
    {
      id: "l6:sixteenth:half",
      kind: "patterns",
      prompt: "十六分音符是八分音符时值的？",
      hint: "十六分比八分更短。",
      choices: rotateChoices(
        [
          { id: "double", label: "两倍" },
          { id: "half", label: "一半" },
          { id: "quarter", label: "四分之一" },
          { id: "same", label: "相同" },
        ],
        seed,
      ),
      answerId: "half",
      explanation: "一个八分音符可以拆成两个十六分音符，所以十六分是八分的一半。",
      explanationSteps: ["八分 = 2 个十六分。"],
      staff,
    },
    {
      id: "l6:sixteenth:total",
      kind: "patterns",
      prompt: "四个十六分音符加一个四分音符，共几拍？",
      hint: "四个十六分先合成一拍。",
      choices: rotateChoices(
        [
          { id: "1", label: "1 拍" },
          { id: "1.5", label: "1.5 拍" },
          { id: "2", label: "2 拍" },
          { id: "3", label: "3 拍" },
        ],
        seed,
      ),
      answerId: "2",
      explanation: "四个十六分 = 1 拍，四分音符 = 1 拍，共 2 拍。",
      explanationSteps: ["4 × 0.25 = 1；1 + 1 = 2。"],
      staff,
    },
    {
      id: "l6:sixteenth:flags",
      kind: "patterns",
      prompt: "十六分音符有几条符尾？",
      hint: "符尾数量跟着时值细分增加。",
      choices: rotateChoices(
        [
          { id: "1", label: "1 条" },
          { id: "2", label: "2 条" },
          { id: "3", label: "3 条" },
          { id: "4", label: "4 条" },
        ],
        seed,
      ),
      answerId: "2",
      explanation: "八分音符 1 条符尾，十六分音符 2 条符尾。",
      explanationSteps: ["每细分一半，多一条符尾。"],
      staff,
    },
  ];
}

function leapQuestions(seed: number): PracticeQuestion[] {
  const pool = HAND_SPAN_EXAMPLES.filter((item) => item.spanDegrees >= 6);
  return spanQuestions(pool, seed, "l6:leap");
}

function positionShiftQuestions(seed: number): PracticeQuestion[] {
  const pool = HAND_SPAN_EXAMPLES.filter((item) => item.spanDegrees >= 7);
  const example = pool[Math.abs(seed) % pool.length];
  const strategy: PracticeQuestion = {
    id: "l6:position:strategy",
    kind: "handSpan",
    prompt: "七度/八度跳进，前后有时间时优先怎么做？",
    hint: "换位比硬撑更稳。",
    choices: rotateChoices(
      [
        { id: "shift", label: "提前换手位" },
        { id: "stretch", label: "始终扩张五指位" },
        { id: "ignore", label: "忽略跨度直接弹" },
        { id: "middle", label: "只看中间音" },
      ],
      seed,
    ),
    answerId: "shift",
    explanation: "七度/八度已超出五指位的舒适范围；前后有时间就提前换位，只有必须连奏时才用扩张。",
    explanationSteps: [
      "先数最两端，确认是七度还是八度。",
      "看前后有没有时间移动手掌。",
      "有时间就换位，没时间才扩张。",
    ],
    staff: example.staff,
  };
  return [strategy, ...spanQuestions(pool, seed, "l6:position").slice(0, 3)];
}

function spanQuestions(
  pool: readonly (typeof HAND_SPAN_EXAMPLES)[number][],
  seed: number,
  prefix: string,
): PracticeQuestion[] {
  const start = Math.abs(seed) % pool.length;
  return Array.from({ length: 4 }, (_, index) => pool[(start + index) % pool.length]).map(
    (item, index) => {
      const explained = handSpanExplanation(item);
      return {
        id: `${prefix}:${item.id}`,
        kind: "handSpan",
        prompt: item.notes,
        hint: "先看最两端，中间音不改变跨度。",
        choices: rotateChoices(handSpanChoices(item.spanDegrees), seed + index),
        answerId: String(item.spanDegrees),
        explanation: explained.summary,
        explanationSteps: explained.steps,
        staff: item.staff,
      };
    },
  );
}

function sightReadingQuestions(seed: number): PracticeQuestion[] {
  return [
    ...createPracticeQuestions("notes", seed).slice(0, 2),
    ...createPracticeQuestions("intervals", seed + 1).slice(0, 2),
    ...createPracticeQuestions("patterns", seed + 2).slice(0, 2),
    ...createPracticeQuestions("handSpan", seed + 3).slice(0, 1),
  ];
}

function l6TestQuestions(seed: number): PracticeQuestion[] {
  return [
    ...sixteenthQuestions(seed).slice(0, 2),
    ...leapQuestions(seed + 1).slice(0, 2),
    ...createPracticeQuestions("notes", seed + 2).slice(0, 1),
    ...createPracticeQuestions("intervals", seed + 3).slice(0, 1),
    ...createPracticeQuestions("patterns", seed + 4).slice(0, 1),
  ];
}

/* ── 共用小工具 ───────────────────────────────────────────── */

function chordStaff(pitches: readonly string[]): PracticeStaffPrompt {
  return {
    clef: "treble",
    groups: [{ pitches, duration: "w" }],
  };
}

function inversionName(answer: InversionExample["answer"]): string {
  return answer === "root" ? "原位" : answer === "first" ? "第一转位" : "第二转位";
}

function rotateChoices(
  choices: readonly PracticeChoice[],
  seed: number,
): PracticeChoice[] {
  const offset = Math.abs(seed) % choices.length;
  return [...choices.slice(offset), ...choices.slice(0, offset)];
}
