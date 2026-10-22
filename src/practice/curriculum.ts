import {
  createPracticeQuestions,
  type PracticeKind,
  type PracticeQuestion,
} from "./quiz";
import type { SymbolGroup } from "./theoryContent";

/**
 * 专项题组：原来「主线闯关」的 10 组固定题量。
 *
 * 主线闯关和 L3 预备课曾经是两套独立进度，同一个知识点要在两个地方各完成一次，
 * 档案里也存了两份“学到哪”的数组。现在只保留 L3 预备课作为有先后顺序的理论课；
 * 这里的关卡退化成「专项题组」入口：点开就练，不锁定、不写进度、不要求在
 * 另一条线里再通关一次。题目仍由 `createPracticeQuestions` 按 seed 生成。
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
    goal: "认出大小增减三和弦与四种七和弦",
    guidance: "三和弦看根音上叠的两个三度；七和弦在最上面再加一个三度。先判断三音是大三度还是小三度。",
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

/** 专项题组题目：固定题量，按 seed 生成后截取，保证每次重练换题序。 */
export function createCurriculumStageQuestions(
  stageId: string,
  seed: number,
): PracticeQuestion[] {
  const stage = CURRICULUM_STAGES.find((item) => item.id === stageId);
  if (!stage) return [];
  return createPracticeQuestions(stage.kind, seed, {
    symbolGroups: stage.symbolGroups,
  }).slice(0, stage.questionCount);
}
