/**
 * L3「临时升降号」练习内容。
 *
 * 这里只放纯数据：题面、选项、正确答案和解释。题目生成器在 quiz.ts 里
 * 负责打乱选项；L3 预备课和乐理练习共用同一份数据。
 */

export type AccidentalChoice = {
  id: string;
  label: string;
};

export type AccidentalExample = {
  id: string;
  prompt: string;
  hint: string;
  choices: readonly AccidentalChoice[];
  answerId: string;
  explanation: string;
};

const RAISE_OR_LOWER: readonly AccidentalChoice[] = [
  { id: "raise", label: "升高半音" },
  { id: "lower", label: "降低半音" },
  { id: "raise-whole", label: "升高全音" },
  { id: "natural", label: "回到本音" },
];

export const ACCIDENTAL_EXAMPLES: readonly AccidentalExample[] = [
  {
    id: "sharp",
    prompt: "C4 → C♯4",
    hint: "♯ 把音怎么变？",
    choices: RAISE_OR_LOWER,
    answerId: "raise",
    explanation: "♯ 是升号，把音升高半音。C♯ 比 C 高一个半音。",
  },
  {
    id: "flat",
    prompt: "E4 → E♭4",
    hint: "♭ 把音怎么变？",
    choices: RAISE_OR_LOWER,
    answerId: "lower",
    explanation: "♭ 是降号，把音降低半音。E♭ 比 E 低一个半音。",
  },
  {
    id: "natural",
    prompt: "F♯4 → F♮4",
    hint: "♮ 表示什么？",
    choices: RAISE_OR_LOWER,
    answerId: "natural",
    explanation: "♮ 是还原号，取消原来的升号或降号，回到本音 F。",
  },
  {
    id: "same-measure",
    prompt: "同一小节里，F 先写成 F♯，后面的 F 没有再写记号。",
    hint: "后面的 F 通常怎么弹？",
    choices: [
      { id: "still-sharp", label: "仍按 F♯" },
      { id: "back-natural", label: "回到 F♮" },
      { id: "become-flat", label: "降成 F♭" },
      { id: "octave-up", label: "升高八度" },
    ],
    answerId: "still-sharp",
    explanation: "临时升降号在本小节内对同一音高继续有效，直到下一小节或出现还原号。",
  },
  {
    id: "scope",
    prompt: "临时升降号通常管到哪里？",
    hint: "它不是一个永久的调号。",
    choices: [
      { id: "measure", label: "本小节内的同一音高" },
      { id: "line", label: "整行谱" },
      { id: "piece", label: "整首曲子" },
      { id: "next-note", label: "只管下一个音" },
    ],
    answerId: "measure",
    explanation: "临时升降号默认只管本小节内的同一音高；下一小节要重新看谱。",
  },
  {
    id: "key-vs-accidental",
    prompt: "C 大调里出现 B♭，它是什么？",
    hint: "C 大调的调号没有升降号。",
    choices: [
      { id: "accidental", label: "临时降号" },
      { id: "key-signature", label: "调号里的降号" },
      { id: "natural", label: "还原号" },
      { id: "octave", label: "高八度记号" },
    ],
    answerId: "accidental",
    explanation: "C 大调没有调号升降，所以这里的 B♭ 是临时降号，只在本小节内有效。",
  },
];
