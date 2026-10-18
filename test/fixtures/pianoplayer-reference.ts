/**
 * pianoplayer 移植保真度对照基准。
 *
 * 由 test/fixtures/pianoplayer_harness.py 对上游 pianoplayer
 * （https://github.com/marcomusy/pianoplayer ，pianoplayer/hand.py 的
 * Hand.generate()）实际运行生成，请勿手改；重新生成见 harness 头部注释。
 *
 * - notes[].finger 是输入锚点（0 = 待求解）；
 * - fingers 是上游求解结果，test/fingering.test.ts 逐条比对移植输出；
 * - x 坐标用与上游 keypos() 等价的单调键盘映射（非 keypos_midi）。
 */

export type ReferenceNote = {
  midi: number;
  time: number;
  duration: number;
  isChord: boolean;
  chordId: number;
  chordNr: number;
  notesInChord: number;
  /** 输入锚点指法，0 表示待求解。 */
  finger: number;
};

export type ReferenceScenario = {
  name: string;
  side: "right" | "left";
  notes: ReferenceNote[];
  fingers: number[];
  /** 上游对每个音给出的平均代价（保留 3 位小数），仅作参考。 */
  cost: number[];
};

export const PIANOPLAYER_REFERENCE: ReferenceScenario[] = [
  {
    name: "scale-rh-quarters",
    side: "right",
    notes: [
      {
        midi: 60,
        time: 0.0,
        duration: 1.0,
        isChord: false,
        chordId: 0,
        chordNr: 0,
        notesInChord: 0,
        finger: 0
      },
      {
        midi: 62,
        time: 1.0,
        duration: 1.0,
        isChord: false,
        chordId: 0,
        chordNr: 0,
        notesInChord: 0,
        finger: 0
      },
      {
        midi: 64,
        time: 2.0,
        duration: 1.0,
        isChord: false,
        chordId: 0,
        chordNr: 0,
        notesInChord: 0,
        finger: 0
      },
      {
        midi: 65,
        time: 3.0,
        duration: 1.0,
        isChord: false,
        chordId: 0,
        chordNr: 0,
        notesInChord: 0,
        finger: 0
      },
      {
        midi: 67,
        time: 4.0,
        duration: 1.0,
        isChord: false,
        chordId: 0,
        chordNr: 0,
        notesInChord: 0,
        finger: 0
      },
      {
        midi: 69,
        time: 5.0,
        duration: 1.0,
        isChord: false,
        chordId: 0,
        chordNr: 0,
        notesInChord: 0,
        finger: 0
      },
      {
        midi: 71,
        time: 6.0,
        duration: 1.0,
        isChord: false,
        chordId: 0,
        chordNr: 0,
        notesInChord: 0,
        finger: 0
      },
      {
        midi: 72,
        time: 7.0,
        duration: 1.0,
        isChord: false,
        chordId: 0,
        chordNr: 0,
        notesInChord: 0,
        finger: 0
      }
    ],
    fingers: [
      1,
      2,
      3,
      1,
      2,
      3,
      4,
      5
    ],
    cost: [
      1.271,
      1.271,
      1.271,
      1.271,
      1.271,
      1.271,
      1.271,
      1.271
    ]
  },
  {
    name: "scale-rh-eighths",
    side: "right",
    notes: [
      {
        midi: 60,
        time: 0.0,
        duration: 0.5,
        isChord: false,
        chordId: 0,
        chordNr: 0,
        notesInChord: 0,
        finger: 0
      },
      {
        midi: 62,
        time: 0.5,
        duration: 0.5,
        isChord: false,
        chordId: 0,
        chordNr: 0,
        notesInChord: 0,
        finger: 0
      },
      {
        midi: 64,
        time: 1.0,
        duration: 0.5,
        isChord: false,
        chordId: 0,
        chordNr: 0,
        notesInChord: 0,
        finger: 0
      },
      {
        midi: 65,
        time: 1.5,
        duration: 0.5,
        isChord: false,
        chordId: 0,
        chordNr: 0,
        notesInChord: 0,
        finger: 0
      },
      {
        midi: 67,
        time: 2.0,
        duration: 0.5,
        isChord: false,
        chordId: 0,
        chordNr: 0,
        notesInChord: 0,
        finger: 0
      },
      {
        midi: 69,
        time: 2.5,
        duration: 0.5,
        isChord: false,
        chordId: 0,
        chordNr: 0,
        notesInChord: 0,
        finger: 0
      },
      {
        midi: 71,
        time: 3.0,
        duration: 0.5,
        isChord: false,
        chordId: 0,
        chordNr: 0,
        notesInChord: 0,
        finger: 0
      },
      {
        midi: 72,
        time: 3.5,
        duration: 0.5,
        isChord: false,
        chordId: 0,
        chordNr: 0,
        notesInChord: 0,
        finger: 0
      }
    ],
    fingers: [
      1,
      2,
      3,
      1,
      2,
      3,
      4,
      5
    ],
    cost: [
      2.331,
      2.331,
      2.331,
      2.331,
      2.331,
      2.331,
      2.331,
      2.331
    ]
  },
  {
    name: "scale-lh-descending-quarters",
    side: "left",
    notes: [
      {
        midi: 72,
        time: 0.0,
        duration: 1.0,
        isChord: false,
        chordId: 0,
        chordNr: 0,
        notesInChord: 0,
        finger: 0
      },
      {
        midi: 71,
        time: 1.0,
        duration: 1.0,
        isChord: false,
        chordId: 0,
        chordNr: 0,
        notesInChord: 0,
        finger: 0
      },
      {
        midi: 69,
        time: 2.0,
        duration: 1.0,
        isChord: false,
        chordId: 0,
        chordNr: 0,
        notesInChord: 0,
        finger: 0
      },
      {
        midi: 67,
        time: 3.0,
        duration: 1.0,
        isChord: false,
        chordId: 0,
        chordNr: 0,
        notesInChord: 0,
        finger: 0
      },
      {
        midi: 65,
        time: 4.0,
        duration: 1.0,
        isChord: false,
        chordId: 0,
        chordNr: 0,
        notesInChord: 0,
        finger: 0
      },
      {
        midi: 64,
        time: 5.0,
        duration: 1.0,
        isChord: false,
        chordId: 0,
        chordNr: 0,
        notesInChord: 0,
        finger: 0
      },
      {
        midi: 62,
        time: 6.0,
        duration: 1.0,
        isChord: false,
        chordId: 0,
        chordNr: 0,
        notesInChord: 0,
        finger: 0
      },
      {
        midi: 60,
        time: 7.0,
        duration: 1.0,
        isChord: false,
        chordId: 0,
        chordNr: 0,
        notesInChord: 0,
        finger: 0
      }
    ],
    fingers: [
      1,
      2,
      3,
      1,
      2,
      3,
      4,
      5
    ],
    cost: [
      1.271,
      1.271,
      1.271,
      1.271,
      1.271,
      1.271,
      1.271,
      1.271
    ]
  },
  {
    name: "chords-rh-triad-progression",
    side: "right",
    notes: [
      {
        midi: 60,
        time: -0.1,
        duration: 1.1,
        isChord: true,
        chordId: 0,
        chordNr: 0,
        notesInChord: 3,
        finger: 0
      },
      {
        midi: 64,
        time: -0.05,
        duration: 1.1,
        isChord: true,
        chordId: 0,
        chordNr: 1,
        notesInChord: 3,
        finger: 0
      },
      {
        midi: 67,
        time: 0.0,
        duration: 1.1,
        isChord: true,
        chordId: 0,
        chordNr: 2,
        notesInChord: 3,
        finger: 0
      },
      {
        midi: 62,
        time: 0.9,
        duration: 1.1,
        isChord: true,
        chordId: 1,
        chordNr: 0,
        notesInChord: 3,
        finger: 0
      },
      {
        midi: 65,
        time: 0.95,
        duration: 1.1,
        isChord: true,
        chordId: 1,
        chordNr: 1,
        notesInChord: 3,
        finger: 0
      },
      {
        midi: 69,
        time: 1.0,
        duration: 1.1,
        isChord: true,
        chordId: 1,
        chordNr: 2,
        notesInChord: 3,
        finger: 0
      },
      {
        midi: 64,
        time: 1.9,
        duration: 1.1,
        isChord: true,
        chordId: 2,
        chordNr: 0,
        notesInChord: 3,
        finger: 0
      },
      {
        midi: 67,
        time: 1.95,
        duration: 1.1,
        isChord: true,
        chordId: 2,
        chordNr: 1,
        notesInChord: 3,
        finger: 0
      },
      {
        midi: 71,
        time: 2.0,
        duration: 1.1,
        isChord: true,
        chordId: 2,
        chordNr: 2,
        notesInChord: 3,
        finger: 0
      },
      {
        midi: 65,
        time: 2.9,
        duration: 1.1,
        isChord: true,
        chordId: 3,
        chordNr: 0,
        notesInChord: 3,
        finger: 0
      },
      {
        midi: 69,
        time: 2.95,
        duration: 1.1,
        isChord: true,
        chordId: 3,
        chordNr: 1,
        notesInChord: 3,
        finger: 0
      },
      {
        midi: 72,
        time: 3.0,
        duration: 1.1,
        isChord: true,
        chordId: 3,
        chordNr: 2,
        notesInChord: 3,
        finger: 0
      }
    ],
    fingers: [
      1,
      3,
      5,
      1,
      3,
      5,
      1,
      3,
      5,
      2,
      4,
      5
    ],
    cost: [
      2.473,
      0.601,
      2.686,
      2.686,
      2.686,
      2.686,
      2.686,
      2.686,
      2.686,
      2.686,
      2.686,
      0.0
    ]
  },
  {
    name: "chords-lh-triad-progression",
    side: "left",
    notes: [
      {
        midi: 48,
        time: -0.1,
        duration: 1.1,
        isChord: true,
        chordId: 0,
        chordNr: 0,
        notesInChord: 3,
        finger: 0
      },
      {
        midi: 52,
        time: -0.05,
        duration: 1.1,
        isChord: true,
        chordId: 0,
        chordNr: 1,
        notesInChord: 3,
        finger: 0
      },
      {
        midi: 55,
        time: 0.0,
        duration: 1.1,
        isChord: true,
        chordId: 0,
        chordNr: 2,
        notesInChord: 3,
        finger: 0
      },
      {
        midi: 50,
        time: 0.9,
        duration: 1.1,
        isChord: true,
        chordId: 1,
        chordNr: 0,
        notesInChord: 3,
        finger: 0
      },
      {
        midi: 53,
        time: 0.95,
        duration: 1.1,
        isChord: true,
        chordId: 1,
        chordNr: 1,
        notesInChord: 3,
        finger: 0
      },
      {
        midi: 57,
        time: 1.0,
        duration: 1.1,
        isChord: true,
        chordId: 1,
        chordNr: 2,
        notesInChord: 3,
        finger: 0
      },
      {
        midi: 55,
        time: 1.9,
        duration: 1.1,
        isChord: true,
        chordId: 2,
        chordNr: 0,
        notesInChord: 3,
        finger: 0
      },
      {
        midi: 59,
        time: 1.95,
        duration: 1.1,
        isChord: true,
        chordId: 2,
        chordNr: 1,
        notesInChord: 3,
        finger: 0
      },
      {
        midi: 62,
        time: 2.0,
        duration: 1.1,
        isChord: true,
        chordId: 2,
        chordNr: 2,
        notesInChord: 3,
        finger: 0
      }
    ],
    fingers: [
      5,
      3,
      1,
      4,
      2,
      1,
      4,
      2,
      1
    ],
    cost: [
      3.921,
      3.921,
      3.921,
      3.921,
      3.921,
      3.921,
      3.921,
      3.921,
      3.921
    ]
  },
  {
    name: "anchor-first-finger-2",
    side: "right",
    notes: [
      {
        midi: 60,
        time: 0.0,
        duration: 1.0,
        isChord: false,
        chordId: 0,
        chordNr: 0,
        notesInChord: 0,
        finger: 2
      },
      {
        midi: 62,
        time: 1.0,
        duration: 1.0,
        isChord: false,
        chordId: 0,
        chordNr: 0,
        notesInChord: 0,
        finger: 0
      },
      {
        midi: 64,
        time: 2.0,
        duration: 1.0,
        isChord: false,
        chordId: 0,
        chordNr: 0,
        notesInChord: 0,
        finger: 0
      },
      {
        midi: 65,
        time: 3.0,
        duration: 1.0,
        isChord: false,
        chordId: 0,
        chordNr: 0,
        notesInChord: 0,
        finger: 0
      },
      {
        midi: 67,
        time: 4.0,
        duration: 1.0,
        isChord: false,
        chordId: 0,
        chordNr: 0,
        notesInChord: 0,
        finger: 0
      },
      {
        midi: 69,
        time: 5.0,
        duration: 1.0,
        isChord: false,
        chordId: 0,
        chordNr: 0,
        notesInChord: 0,
        finger: 0
      },
      {
        midi: 71,
        time: 6.0,
        duration: 1.0,
        isChord: false,
        chordId: 0,
        chordNr: 0,
        notesInChord: 0,
        finger: 0
      },
      {
        midi: 72,
        time: 7.0,
        duration: 1.0,
        isChord: false,
        chordId: 0,
        chordNr: 0,
        notesInChord: 0,
        finger: 0
      }
    ],
    fingers: [
      2,
      3,
      4,
      1,
      2,
      3,
      4,
      5
    ],
    cost: [
      1.41,
      1.41,
      1.41,
      1.41,
      1.41,
      1.41,
      1.41,
      1.41
    ]
  },
  {
    name: "black-keys-rh",
    side: "right",
    notes: [
      {
        midi: 60,
        time: 0.0,
        duration: 1.0,
        isChord: false,
        chordId: 0,
        chordNr: 0,
        notesInChord: 0,
        finger: 0
      },
      {
        midi: 61,
        time: 1.0,
        duration: 1.0,
        isChord: false,
        chordId: 0,
        chordNr: 0,
        notesInChord: 0,
        finger: 0
      },
      {
        midi: 62,
        time: 2.0,
        duration: 1.0,
        isChord: false,
        chordId: 0,
        chordNr: 0,
        notesInChord: 0,
        finger: 0
      },
      {
        midi: 63,
        time: 3.0,
        duration: 1.0,
        isChord: false,
        chordId: 0,
        chordNr: 0,
        notesInChord: 0,
        finger: 0
      },
      {
        midi: 64,
        time: 4.0,
        duration: 1.0,
        isChord: false,
        chordId: 0,
        chordNr: 0,
        notesInChord: 0,
        finger: 0
      },
      {
        midi: 65,
        time: 5.0,
        duration: 1.0,
        isChord: false,
        chordId: 0,
        chordNr: 0,
        notesInChord: 0,
        finger: 0
      },
      {
        midi: 66,
        time: 6.0,
        duration: 1.0,
        isChord: false,
        chordId: 0,
        chordNr: 0,
        notesInChord: 0,
        finger: 0
      },
      {
        midi: 67,
        time: 7.0,
        duration: 1.0,
        isChord: false,
        chordId: 0,
        chordNr: 0,
        notesInChord: 0,
        finger: 0
      }
    ],
    fingers: [
      1,
      2,
      1,
      2,
      1,
      2,
      3,
      4
    ],
    cost: [
      2.102,
      2.102,
      2.102,
      2.102,
      2.102,
      2.102,
      2.102,
      2.102
    ]
  },
  {
    name: "two-octave-run-rh",
    side: "right",
    notes: [
      {
        midi: 60,
        time: 0.0,
        duration: 1.0,
        isChord: false,
        chordId: 0,
        chordNr: 0,
        notesInChord: 0,
        finger: 0
      },
      {
        midi: 61,
        time: 1.0,
        duration: 1.0,
        isChord: false,
        chordId: 0,
        chordNr: 0,
        notesInChord: 0,
        finger: 0
      },
      {
        midi: 62,
        time: 2.0,
        duration: 1.0,
        isChord: false,
        chordId: 0,
        chordNr: 0,
        notesInChord: 0,
        finger: 0
      },
      {
        midi: 63,
        time: 3.0,
        duration: 1.0,
        isChord: false,
        chordId: 0,
        chordNr: 0,
        notesInChord: 0,
        finger: 0
      },
      {
        midi: 64,
        time: 4.0,
        duration: 1.0,
        isChord: false,
        chordId: 0,
        chordNr: 0,
        notesInChord: 0,
        finger: 0
      },
      {
        midi: 65,
        time: 5.0,
        duration: 1.0,
        isChord: false,
        chordId: 0,
        chordNr: 0,
        notesInChord: 0,
        finger: 0
      },
      {
        midi: 66,
        time: 6.0,
        duration: 1.0,
        isChord: false,
        chordId: 0,
        chordNr: 0,
        notesInChord: 0,
        finger: 0
      },
      {
        midi: 67,
        time: 7.0,
        duration: 1.0,
        isChord: false,
        chordId: 0,
        chordNr: 0,
        notesInChord: 0,
        finger: 0
      },
      {
        midi: 68,
        time: 8.0,
        duration: 1.0,
        isChord: false,
        chordId: 0,
        chordNr: 0,
        notesInChord: 0,
        finger: 0
      },
      {
        midi: 69,
        time: 9.0,
        duration: 1.0,
        isChord: false,
        chordId: 0,
        chordNr: 0,
        notesInChord: 0,
        finger: 0
      },
      {
        midi: 70,
        time: 10.0,
        duration: 1.0,
        isChord: false,
        chordId: 0,
        chordNr: 0,
        notesInChord: 0,
        finger: 0
      },
      {
        midi: 71,
        time: 11.0,
        duration: 1.0,
        isChord: false,
        chordId: 0,
        chordNr: 0,
        notesInChord: 0,
        finger: 0
      },
      {
        midi: 72,
        time: 12.0,
        duration: 1.0,
        isChord: false,
        chordId: 0,
        chordNr: 0,
        notesInChord: 0,
        finger: 0
      },
      {
        midi: 73,
        time: 13.0,
        duration: 1.0,
        isChord: false,
        chordId: 0,
        chordNr: 0,
        notesInChord: 0,
        finger: 0
      },
      {
        midi: 74,
        time: 14.0,
        duration: 1.0,
        isChord: false,
        chordId: 0,
        chordNr: 0,
        notesInChord: 0,
        finger: 0
      }
    ],
    fingers: [
      1,
      2,
      1,
      2,
      1,
      2,
      3,
      1,
      2,
      1,
      2,
      3,
      4,
      5,
      5
    ],
    cost: [
      1.416,
      1.716,
      1.215,
      1.694,
      1.193,
      2.162,
      2.162,
      2.162,
      2.162,
      2.162,
      2.162,
      2.162,
      2.162,
      2.162,
      0.0
    ]
  },
  {
    name: "l2-like-eighths-rh",
    side: "right",
    notes: [
      {
        midi: 60,
        time: 0.0,
        duration: 0.5,
        isChord: false,
        chordId: 0,
        chordNr: 0,
        notesInChord: 0,
        finger: 0
      },
      {
        midi: 64,
        time: 0.5,
        duration: 0.5,
        isChord: false,
        chordId: 0,
        chordNr: 0,
        notesInChord: 0,
        finger: 0
      },
      {
        midi: 67,
        time: 1.0,
        duration: 0.5,
        isChord: false,
        chordId: 0,
        chordNr: 0,
        notesInChord: 0,
        finger: 0
      },
      {
        midi: 64,
        time: 1.5,
        duration: 0.5,
        isChord: false,
        chordId: 0,
        chordNr: 0,
        notesInChord: 0,
        finger: 0
      },
      {
        midi: 60,
        time: 2.0,
        duration: 0.5,
        isChord: false,
        chordId: 0,
        chordNr: 0,
        notesInChord: 0,
        finger: 0
      },
      {
        midi: 62,
        time: 2.5,
        duration: 0.5,
        isChord: false,
        chordId: 0,
        chordNr: 0,
        notesInChord: 0,
        finger: 0
      },
      {
        midi: 65,
        time: 3.0,
        duration: 0.5,
        isChord: false,
        chordId: 0,
        chordNr: 0,
        notesInChord: 0,
        finger: 0
      },
      {
        midi: 62,
        time: 3.5,
        duration: 0.5,
        isChord: false,
        chordId: 0,
        chordNr: 0,
        notesInChord: 0,
        finger: 0
      },
      {
        midi: 60,
        time: 4.0,
        duration: 0.5,
        isChord: false,
        chordId: 0,
        chordNr: 0,
        notesInChord: 0,
        finger: 0
      },
      {
        midi: 64,
        time: 4.5,
        duration: 0.5,
        isChord: false,
        chordId: 0,
        chordNr: 0,
        notesInChord: 0,
        finger: 0
      },
      {
        midi: 67,
        time: 5.0,
        duration: 0.5,
        isChord: false,
        chordId: 0,
        chordNr: 0,
        notesInChord: 0,
        finger: 0
      },
      {
        midi: 72,
        time: 5.5,
        duration: 0.5,
        isChord: false,
        chordId: 0,
        chordNr: 0,
        notesInChord: 0,
        finger: 0
      }
    ],
    fingers: [
      1,
      3,
      5,
      3,
      1,
      2,
      4,
      2,
      1,
      3,
      5,
      5
    ],
    cost: [
      0.832,
      0.666,
      0.93,
      0.93,
      0.93,
      0.93,
      0.93,
      0.93,
      0.93,
      0.93,
      0.93,
      0.0
    ]
  },
  {
    name: "repeated-notes-rh",
    side: "right",
    notes: [
      {
        midi: 60,
        time: 0.0,
        duration: 1.0,
        isChord: false,
        chordId: 0,
        chordNr: 0,
        notesInChord: 0,
        finger: 0
      },
      {
        midi: 60,
        time: 1.0,
        duration: 1.0,
        isChord: false,
        chordId: 0,
        chordNr: 0,
        notesInChord: 0,
        finger: 0
      },
      {
        midi: 60,
        time: 2.0,
        duration: 1.0,
        isChord: false,
        chordId: 0,
        chordNr: 0,
        notesInChord: 0,
        finger: 0
      },
      {
        midi: 62,
        time: 3.0,
        duration: 1.0,
        isChord: false,
        chordId: 0,
        chordNr: 0,
        notesInChord: 0,
        finger: 0
      },
      {
        midi: 62,
        time: 4.0,
        duration: 1.0,
        isChord: false,
        chordId: 0,
        chordNr: 0,
        notesInChord: 0,
        finger: 0
      },
      {
        midi: 64,
        time: 5.0,
        duration: 1.0,
        isChord: false,
        chordId: 0,
        chordNr: 0,
        notesInChord: 0,
        finger: 0
      },
      {
        midi: 64,
        time: 6.0,
        duration: 1.0,
        isChord: false,
        chordId: 0,
        chordNr: 0,
        notesInChord: 0,
        finger: 0
      },
      {
        midi: 65,
        time: 7.0,
        duration: 1.0,
        isChord: false,
        chordId: 0,
        chordNr: 0,
        notesInChord: 0,
        finger: 0
      }
    ],
    fingers: [
      2,
      2,
      2,
      3,
      3,
      4,
      4,
      5
    ],
    cost: [
      0.026,
      0.026,
      0.026,
      0.026,
      0.026,
      0.026,
      0.026,
      0.026
    ]
  },
  {
    name: "mixed-single-chord-single",
    side: "right",
    notes: [
      {
        midi: 60,
        time: 0.0,
        duration: 1.0,
        isChord: false,
        chordId: 0,
        chordNr: 0,
        notesInChord: 0,
        finger: 0
      },
      {
        midi: 64,
        time: 0.95,
        duration: 1.05,
        isChord: true,
        chordId: 1,
        chordNr: 0,
        notesInChord: 2,
        finger: 0
      },
      {
        midi: 67,
        time: 1.0,
        duration: 1.05,
        isChord: true,
        chordId: 1,
        chordNr: 1,
        notesInChord: 2,
        finger: 0
      },
      {
        midi: 72,
        time: 2.0,
        duration: 1.0,
        isChord: false,
        chordId: 0,
        chordNr: 0,
        notesInChord: 0,
        finger: 0
      }
    ],
    fingers: [
      1,
      2,
      4,
      5
    ],
    cost: [
      2.514,
      2.514,
      2.514,
      2.514
    ]
  },
  {
    name: "scale-rh-sixteenths",
    side: "right",
    notes: [
      {
        midi: 60,
        time: 0.0,
        duration: 0.25,
        isChord: false,
        chordId: 0,
        chordNr: 0,
        notesInChord: 0,
        finger: 0
      },
      {
        midi: 62,
        time: 0.25,
        duration: 0.25,
        isChord: false,
        chordId: 0,
        chordNr: 0,
        notesInChord: 0,
        finger: 0
      },
      {
        midi: 64,
        time: 0.5,
        duration: 0.25,
        isChord: false,
        chordId: 0,
        chordNr: 0,
        notesInChord: 0,
        finger: 0
      },
      {
        midi: 65,
        time: 0.75,
        duration: 0.25,
        isChord: false,
        chordId: 0,
        chordNr: 0,
        notesInChord: 0,
        finger: 0
      },
      {
        midi: 67,
        time: 1.0,
        duration: 0.25,
        isChord: false,
        chordId: 0,
        chordNr: 0,
        notesInChord: 0,
        finger: 0
      },
      {
        midi: 69,
        time: 1.25,
        duration: 0.25,
        isChord: false,
        chordId: 0,
        chordNr: 0,
        notesInChord: 0,
        finger: 0
      },
      {
        midi: 71,
        time: 1.5,
        duration: 0.25,
        isChord: false,
        chordId: 0,
        chordNr: 0,
        notesInChord: 0,
        finger: 0
      },
      {
        midi: 72,
        time: 1.75,
        duration: 0.25,
        isChord: false,
        chordId: 0,
        chordNr: 0,
        notesInChord: 0,
        finger: 0
      }
    ],
    fingers: [
      1,
      2,
      3,
      1,
      2,
      3,
      4,
      5
    ],
    cost: [
      3.996,
      3.996,
      3.996,
      3.996,
      3.996,
      3.996,
      3.996,
      3.996
    ]
  },
  {
    name: "scale-rh-5-quarters",
    side: "right",
    notes: [
      {
        midi: 60,
        time: 0.0,
        duration: 1.0,
        isChord: false,
        chordId: 0,
        chordNr: 0,
        notesInChord: 0,
        finger: 0
      },
      {
        midi: 62,
        time: 1.0,
        duration: 1.0,
        isChord: false,
        chordId: 0,
        chordNr: 0,
        notesInChord: 0,
        finger: 0
      },
      {
        midi: 64,
        time: 2.0,
        duration: 1.0,
        isChord: false,
        chordId: 0,
        chordNr: 0,
        notesInChord: 0,
        finger: 0
      },
      {
        midi: 65,
        time: 3.0,
        duration: 1.0,
        isChord: false,
        chordId: 0,
        chordNr: 0,
        notesInChord: 0,
        finger: 0
      },
      {
        midi: 67,
        time: 4.0,
        duration: 1.0,
        isChord: false,
        chordId: 0,
        chordNr: 0,
        notesInChord: 0,
        finger: 0
      }
    ],
    fingers: [
      1,
      2,
      3,
      4,
      5
    ],
    cost: [
      0.292,
      0.292,
      0.292,
      0.292,
      0.292
    ]
  },
  {
    name: "anchor-5-quarters",
    side: "right",
    notes: [
      {
        midi: 60,
        time: 0.0,
        duration: 1.0,
        isChord: false,
        chordId: 0,
        chordNr: 0,
        notesInChord: 0,
        finger: 2
      },
      {
        midi: 62,
        time: 1.0,
        duration: 1.0,
        isChord: false,
        chordId: 0,
        chordNr: 0,
        notesInChord: 0,
        finger: 0
      },
      {
        midi: 64,
        time: 2.0,
        duration: 1.0,
        isChord: false,
        chordId: 0,
        chordNr: 0,
        notesInChord: 0,
        finger: 0
      },
      {
        midi: 65,
        time: 3.0,
        duration: 1.0,
        isChord: false,
        chordId: 0,
        chordNr: 0,
        notesInChord: 0,
        finger: 0
      },
      {
        midi: 67,
        time: 4.0,
        duration: 1.0,
        isChord: false,
        chordId: 0,
        chordNr: 0,
        notesInChord: 0,
        finger: 0
      }
    ],
    fingers: [
      2,
      1,
      2,
      3,
      4
    ],
    cost: [
      1.474,
      1.474,
      1.474,
      1.474,
      1.474
    ]
  },
  {
    name: "single-chord-c4e4g4-single",
    side: "right",
    notes: [
      {
        midi: 60,
        time: 0.0,
        duration: 1.0,
        isChord: false,
        chordId: 0,
        chordNr: 0,
        notesInChord: 0,
        finger: 0
      },
      {
        midi: 60,
        time: 0.9,
        duration: 1.1,
        isChord: true,
        chordId: 1,
        chordNr: 0,
        notesInChord: 3,
        finger: 0
      },
      {
        midi: 64,
        time: 0.95,
        duration: 1.1,
        isChord: true,
        chordId: 1,
        chordNr: 1,
        notesInChord: 3,
        finger: 0
      },
      {
        midi: 67,
        time: 1.0,
        duration: 1.1,
        isChord: true,
        chordId: 1,
        chordNr: 2,
        notesInChord: 3,
        finger: 0
      },
      {
        midi: 72,
        time: 2.0,
        duration: 1.0,
        isChord: false,
        chordId: 0,
        chordNr: 0,
        notesInChord: 0,
        finger: 0
      }
    ],
    fingers: [
      1,
      1,
      2,
      4,
      5
    ],
    cost: [
      3.7,
      3.7,
      3.7,
      3.7,
      3.7
    ]
  }
];
