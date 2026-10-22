import type { PracticeQuestion } from "./quiz";
import { createPracticeQuestions } from "./quiz";

/**
 * L3 预备课：9 节短课。
 *
 * 前 4 节覆盖技能图谱里的 L3 技能：chord.triad、key.accidental、chord.interval、
 * chord.progression；后 4 节把单音、符号、音型、听调性作为复习课接入，
 * 最后一节做综合小测。课程只负责「认识 + 做题」，完成后 Profile 里记一节已完成；
 * 有技能映射的课只写 learning，真正掌握仍要由曲目/过关测试写 passed。
 */

export type L3PrepLesson = {
  id: string;
  title: string;
  goal: string;
  intro: string;
  /** 与技能图谱对应的 id；纯复习课为空数组，不写账本。 */
  skillIds: readonly string[];
  /** 本节固定题量，供列表直接显示。 */
  questionCount: number;
  /** 本节至少答对多少题才算完成。 */
  passScore: number;
  buildQuestions(seed: number): PracticeQuestion[];
};

const DIM_CHOICES = [
  { id: "dim", label: "减三和弦 (Dim)" },
  { id: "maj", label: "大三和弦 (Maj)" },
  { id: "min", label: "小三和弦 (min)" },
  { id: "aug", label: "增三和弦 (Aug)" },
] as const;

function dimTriadQuestion(seed: number): PracticeQuestion {
  // 用一个简单的轮转把正确答案从固定位置挪开；选项本身仍然确定。
  const offset = Math.abs(seed) % DIM_CHOICES.length;
  return {
    id: "l3:chord:dim",
    kind: "chords",
    prompt: "C4 – Eb4 – Gb4",
    hint: "以 C 为根音，这是什么三和弦？",
    choices: [
      ...DIM_CHOICES.slice(offset),
      ...DIM_CHOICES.slice(0, offset),
    ],
    answerId: "dim",
    explanation: "C–Eb 是小三度，Eb–Gb 也是小三度；两个小三度叠起来是减三和弦。",
    // 手写题也带上谱面，和生成题保持一致。
    staff: {
      clef: "treble",
      groups: [{ pitches: ["C4", "Eb4", "Gb4"], duration: "w" }],
    },
  };
}

function triadQuestions(seed: number): PracticeQuestion[] {
  // 只从三和弦里抽题，保证每节固定 3 道生成题 + 1 道减三和弦。
  const generated = createPracticeQuestions("chords", seed, {
    chordTypeIds: ["maj", "min", "aug"],
  });
  return [...generated.slice(0, 3), dimTriadQuestion(seed)];
}

function mixedQuestions(seed: number): PracticeQuestion[] {
  const triads = triadQuestions(seed + 1).slice(0, 2);
  const accidentals = createPracticeQuestions("accidentals", seed + 2).slice(0, 2);
  const intervals = createPracticeQuestions("intervals", seed + 3).slice(0, 2);
  const progressions = createPracticeQuestions("progressions", seed + 4).slice(0, 1);
  return [...triads, ...accidentals, ...intervals, ...progressions];
}

export const L3_PREP_LESSONS: readonly L3PrepLesson[] = [
  {
    id: "L3-1",
    title: "三和弦",
    goal: "认出大三、小三、增、减三和弦",
    intro: "三和弦由根音、三音、五音叠成。先听两个三度的距离，再看最上面的五音。",
    skillIds: ["chord.triad"],
    questionCount: 4,
    passScore: 3,
    buildQuestions: triadQuestions,
  },
  {
    id: "L3-2",
    title: "临时升降",
    goal: "分清升号、降号、还原号和小节范围",
    intro: "调号是整首曲子的默认值；临时升降号只在本小节内对同一音高生效。",
    skillIds: ["key.accidental"],
    questionCount: 4,
    passScore: 3,
    buildQuestions: (seed) => createPracticeQuestions("accidentals", seed).slice(0, 4),
  },
  {
    id: "L3-3",
    title: "双音音程",
    goal: "认出常见的二度到八度",
    intro: "双音是两个音同时响。先数音级，再看半音数；不要把增四度和纯四度混在一起。",
    skillIds: ["chord.interval"],
    questionCount: 4,
    passScore: 3,
    buildQuestions: (seed) => createPracticeQuestions("intervals", seed).slice(0, 4),
  },
  {
    id: "L3-4",
    title: "和弦连接",
    goal: "看懂 I–IV–I、I–V–I 与大小调级数",
    intro: "级数描述和弦在调里的位置。大调 I–IV–I 很稳定，I–V–I 有更强的收束感。",
    skillIds: ["chord.progression"],
    questionCount: 4,
    passScore: 3,
    buildQuestions: (seed) => createPracticeQuestions("progressions", seed),
  },
  {
    id: "L3-5",
    title: "单音与谱号",
    goal: "看谱面认出高音谱与低音谱的音名",
    intro: "先看谱号，再从最近的线或间数到符头；低音谱比高音谱低一个八度记谱。",
    skillIds: ["clef.treble", "clef.bass"],
    questionCount: 4,
    passScore: 3,
    buildQuestions: (seed) => createPracticeQuestions("notes", seed).slice(0, 4),
  },
  {
    id: "L3-6",
    title: "符号与表情",
    goal: "认出力度、速度、发音与反复记号",
    intro: "力度记号写在谱下方，速度记号常写在乐句上方；先记 p 弱、f 强这条主轴。",
    // 纯复习课：符号不在技能图谱里，完成本课不写技能账本。
    skillIds: [],
    questionCount: 4,
    passScore: 3,
    buildQuestions: (seed) => createPracticeQuestions("symbols", seed).slice(0, 4),
  },
  {
    id: "L3-7",
    title: "音型走向",
    goal: "看一串音判断上行、下行与回环",
    intro: "先看第一个音到最后一个音的方向，再看中间有没有折返；不要被个别跳进带偏。",
    skillIds: [],
    questionCount: 4,
    passScore: 3,
    buildQuestions: (seed) => createPracticeQuestions("patterns", seed).slice(0, 4),
  },
  {
    id: "L3-8",
    title: "听调性",
    goal: "听主和弦与短旋律判断 G/E 大小调",
    intro: "先听开头的主和弦：大三和弦偏大调，小三和弦偏小调；再听旋律里有没有升高导音。",
    skillIds: [],
    questionCount: 4,
    passScore: 3,
    buildQuestions: (seed) => createPracticeQuestions("melodies", seed).slice(0, 4),
  },
  {
    id: "L3-9",
    title: "综合小测",
    goal: "把三和弦、临时升降、音程和进行混在一起",
    intro: "这一节不教新内容，只检查能不能在混合题里认出前面的四类知识。",
    skillIds: ["chord.triad", "chord.interval", "chord.progression", "key.accidental"],
    questionCount: 7,
    passScore: 6,
    buildQuestions: mixedQuestions,
  },
];

export const L3_PREP_SKILL_MAP: Readonly<Record<string, readonly string[]>> = Object.fromEntries(
  L3_PREP_LESSONS.map((lesson) => [lesson.id, lesson.skillIds]),
);

export function createL3LessonQuestions(lessonId: string, seed: number): PracticeQuestion[] {
  const lesson = L3_PREP_LESSONS.find((item) => item.id === lessonId);
  return lesson ? lesson.buildQuestions(seed) : [];
}
