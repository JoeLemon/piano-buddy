import { describe, expect, it } from "vitest";
import { annotateScore } from "../src/domain/fingering";
import { importMusicXml, parseXml } from "../src/repertoire/musicxml";
import { minLevelForScore } from "../src/repertoire/skillGraph";
import { scoreToMotion, validateMotion } from "../src/repertoire/motion";

/**
 * MusicXML 导入器的契约：能无损转换的子集要转对，转不了的要报错而不是猜。
 * 这些用例同时是作者工具的说明书——每条失败分支都对应一个真实会遇到的导出。
 */

const HEADER = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>`;

function wrap(body: string): string {
  return `${HEADER}\n${body}\n</score-partwise>`;
}

type AttrOptions = {
  divisions?: number;
  fifths?: number;
  beats?: number;
  beatValue?: number;
  staves?: number;
  clefs?: Array<{ number: number; sign: "G" | "F"; line: number }>;
};

function attributes(options: AttrOptions = {}): string {
  const clefs = options.clefs ?? [{ number: 1, sign: "G", line: 2 }];
  return [
    "<attributes>",
    `<divisions>${options.divisions ?? 2}</divisions>`,
    `<key><fifths>${options.fifths ?? 0}</fifths></key>`,
    `<time><beats>${options.beats ?? 4}</beats><beat-type>${options.beatValue ?? 4}</beat-type></time>`,
    options.staves ? `<staves>${options.staves}</staves>` : "",
    ...clefs.map(
      (clef) => `<clef number="${clef.number}"><sign>${clef.sign}</sign><line>${clef.line}</line></clef>`,
    ),
    "</attributes>",
  ].join("");
}

/** 一个发声音；`extra` 用来塞 <staff>/<tie>/<time-modification> 之类的子元素。 */
function note(step: string, octave: number, duration: number, extra = ""): string {
  return [
    "<note>",
    `<pitch><step>${step}</step><octave>${octave}</octave></pitch>`,
    `<duration>${duration}</duration>`,
    "<voice>1</voice>",
    extra,
    "</note>",
  ].join("");
}

function rest(duration: number): string {
  return `<note><rest/><duration>${duration}</duration><voice>1</voice></note>`;
}

function measure(inner: string, index = 1): string {
  return `<measure number="${index}">${inner}</measure>`;
}

function part(inner: string): string {
  return `<part id="P1">${inner}</part>`;
}

describe("XML 解析", () => {
  it("认得自闭合标签、属性、实体、注释与 CDATA", () => {
    const root = parseXml(
      `<?xml version="1.0"?><!-- 注释 --><root a="1 &amp; 2"><child/><empty></empty><![CDATA[原样 <b>]]>文本 &lt; ok</root>`,
    );
    expect(root.name).toBe("root");
    expect(root.attrs.a).toBe("1 & 2");
    expect(root.children.map((item) => item.name)).toEqual(["child", "empty"]);
    expect(root.text).toContain("原样 <b>");
    expect(root.text).toContain("文本 < ok");
  });

  it("结构错误会带原因抛出，不会静默吞掉", () => {
    expect(() => parseXml("<a><b></a>")).toThrow(/不匹配/);
    expect(() => parseXml("<a><b>")).toThrow(/未闭合/);
    expect(() => parseXml("没有标签")).toThrow(/元素之外/);
  });
});

describe("MusicXML → Score：能无损转换的子集", () => {
  it("单行 4/4 四个四分音符 → 一只右手、一小节四拍", () => {
    const xml = wrap(
      part(
        measure(
          attributes({ divisions: 2 }) +
            note("C", 4, 2) +
            note("D", 4, 2) +
            note("E", 4, 2) +
            note("F", 4, 2),
        ),
      ),
    );

    const result = importMusicXml(xml);
    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);

    const score = result.score!;
    expect(score.hands).toEqual(["RH"]);
    expect(score.staves.RH?.clef).toBe("treble");
    expect(score.meter).toEqual({ beats: 4, beatValue: 4 });
    expect(score.keySignature).toBe("C");
    expect(score.staves.RH?.measures).toHaveLength(1);

    const notes = score.staves.RH!.measures[0].notes;
    expect(notes.map((item) => item.duration)).toEqual(["q", "q", "q", "q"]);
    expect(notes.map((item) => item.pitches[0].step)).toEqual(["C", "D", "E", "F"]);
    expect(notes.map((item) => item.id)).toEqual(["rh-1-1", "rh-1-2", "rh-1-3", "rh-1-4"]);
    // 没有 tempo 标记时给默认值，并且要说出来。
    expect(score.bpm).toBe(72);
    expect(result.warnings.some((text) => text.includes("72 BPM"))).toBe(true);
  });

  it("3/4 附点二分填满小节，tempo 从 <sound> 读取", () => {
    const xml = wrap(
      part(
        measure(
          attributes({ divisions: 4, beats: 3 }) +
            `<direction><sound tempo="96"/></direction>` +
            note("G", 4, 12),
        ),
      ),
    );

    const result = importMusicXml(xml);
    expect(result.errors).toEqual([]);
    const score = result.score!;
    expect(score.meter).toEqual({ beats: 3, beatValue: 4 });
    expect(score.bpm).toBe(96);
    expect(score.staves.RH!.measures[0].notes.map((item) => item.duration)).toEqual(["hd"]);
  });

  it("钢琴大谱表：<staves>2</staves> + backup + 和弦 → 左右手各一份", () => {
    const xml = wrap(
      part(
        measure(
          attributes({
            divisions: 2,
            staves: 2,
            clefs: [
              { number: 1, sign: "G", line: 2 },
              { number: 2, sign: "F", line: 4 },
            ],
          }) +
            note("C", 4, 8, "<staff>1</staff>") +
            "<backup><duration>8</duration></backup>" +
            note("C", 3, 4, "<staff>2</staff>") +
            `<note><chord/><pitch><step>E</step><octave>3</octave></pitch><duration>4</duration><voice>1</voice><staff>2</staff></note>` +
            `<note><chord/><pitch><step>G</step><octave>3</octave></pitch><duration>4</duration><voice>1</voice><staff>2</staff></note>` +
            `<note><rest/><duration>4</duration><voice>1</voice><staff>2</staff></note>`,
        ),
      ),
    );

    const result = importMusicXml(xml);
    expect(result.errors).toEqual([]);
    const score = result.score!;
    expect(score.hands).toEqual(["RH", "LH"]);
    expect(score.staves.RH?.clef).toBe("treble");
    expect(score.staves.LH?.clef).toBe("bass");

    const right = score.staves.RH!.measures[0].notes;
    expect(right).toHaveLength(1);
    expect(right[0].duration).toBe("w");

    const left = score.staves.LH!.measures[0].notes;
    expect(left).toHaveLength(2);
    // 和弦合成一个事件，三个音同拍。
    expect(left[0].pitches.map((pitch) => pitch.step)).toEqual(["C", "E", "G"]);
    expect(left[0].duration).toBe("h");
    expect(left[1]).toMatchObject({ pitches: [], duration: "hr" });
  });

  it("小节不满时补休止符，并在警告里说清楚补了几拍", () => {
    const xml = wrap(
      part(
        measure(
          attributes({ divisions: 2 }) +
            note("C", 4, 2) +
            note("D", 4, 2) +
            note("E", 4, 2) +
            note("F", 4, 2),
          1,
        ) + measure(note("E", 4, 2) + note("F", 4, 2), 2),
      ),
    );

    const result = importMusicXml(xml);
    expect(result.errors).toEqual([]);
    const second = result.score!.staves.RH!.measures[1].notes;
    expect(second.map((item) => item.duration)).toEqual(["q", "q", "hr"]);
    expect(result.warnings.some((text) => text.includes("已补 2 拍休止"))).toBe(true);
  });

  it("小节内连音线保留成两个音 + tie，谱面与原谱一致", () => {
    const xml = wrap(
      part(
        measure(
          attributes({ divisions: 2 }) +
            note("C", 4, 2, '<tie type="start"/>') +
            note("C", 4, 2, '<tie type="stop"/>') +
            note("D", 4, 4),
        ),
      ),
    );

    const result = importMusicXml(xml);
    expect(result.errors).toEqual([]);
    const notes = result.score!.staves.RH!.measures[0].notes;
    expect(notes.map((item) => item.duration)).toEqual(["q", "q", "h"]);
    expect(notes[0].tie).toBe("start");
    expect(notes[1].tie).toBe("stop");
    // 保留成两个音才能画连线；合并成 h 会丢掉谱面上的连音线。
    expect(result.warnings.some((text) => text.includes("合并"))).toBe(false);
  });

  it("低音谱号单行谱会落到左手", () => {
    const xml = wrap(
      part(
        measure(
          attributes({ divisions: 2, clefs: [{ number: 1, sign: "F", line: 4 }] }) +
            note("C", 3, 2) +
            note("D", 3, 2) +
            note("E", 3, 2) +
            note("F", 3, 2),
        ),
      ),
    );

    const result = importMusicXml(xml);
    expect(result.errors).toEqual([]);
    expect(result.score!.hands).toEqual(["LH"]);
    expect(result.score!.staves.LH?.clef).toBe("bass");
  });

  it("转出来的谱面能过指法引擎与 Motion 校验", () => {
    const xml = wrap(
      part(
        measure(attributes({ divisions: 2 }) + note("C", 4, 2) + note("D", 4, 2) + note("E", 4, 2) + note("F", 4, 2)) +
          measure(note("E", 4, 2) + note("D", 4, 2) + note("C", 4, 4), 2),
      ),
    );

    const result = importMusicXml(xml);
    expect(result.ok).toBe(true);
    const score = result.score!;
    const fingered = annotateScore(score);
    const motion = scoreToMotion(fingered);
    expect(motion.notes).toHaveLength(7);
    expect(validateMotion(motion)).toEqual({ ok: true, errors: [] });
    expect(minLevelForScore(score)).toBeLessThanOrEqual(6);
  });
});

describe("MusicXML → Score：超出能力要报错，不能猜", () => {
  it("6/8 拍号", () => {
    const xml = wrap(
      part(measure(attributes({ beats: 6, beatValue: 8 }) + note("C", 4, 2))),
    );
    const result = importMusicXml(xml);
    expect(result.ok).toBe(false);
    expect(result.errors.some((text) => text.includes("拍号 6/8"))).toBe(true);
  });

  it("两个升号以上的调号", () => {
    const xml = wrap(part(measure(attributes({ fifths: 3 }) + note("C", 4, 8))));
    const result = importMusicXml(xml);
    expect(result.ok).toBe(false);
    expect(result.errors.some((text) => text.includes("调号 A"))).toBe(true);
  });

  it("三十二分音符", () => {
    const xml = wrap(
      part(measure(attributes({ divisions: 8 }) + note("C", 4, 1))),
    );
    const result = importMusicXml(xml);
    expect(result.ok).toBe(false);
    expect(result.errors.some((text) => text.includes("0.125 拍"))).toBe(true);
  });

  it("三连音（time-modification）", () => {
    const xml = wrap(
      part(
        measure(
          attributes({ divisions: 3 }) +
            note(
              "C",
              4,
              2,
              "<time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes></time-modification>",
            ),
        ),
      ),
    );
    const result = importMusicXml(xml);
    expect(result.ok).toBe(false);
    expect(result.errors.some((text) => text.includes("三连音"))).toBe(true);
  });

  it("跨小节连音线变成 tie 链，而不是报错", () => {
    const xml = wrap(
      part(
        measure(
          attributes({ divisions: 2 }) + note("C", 4, 2) + note("D", 4, 2) + note("E", 4, 2) + note("F", 4, 2, '<tie type="start"/>'),
          1,
        ) +
          measure(note("F", 4, 2, '<tie type="stop"/>') + note("G", 4, 2) + note("A", 4, 4), 2),
      ),
    );
    const result = importMusicXml(xml);
    expect(result.errors).toEqual([]);
    const score = result.score!;
    const first = score.staves.RH!.measures[0].notes;
    const second = score.staves.RH!.measures[1].notes;
    expect(first[first.length - 1].tie).toBe("start");
    expect(second[0].tie).toBe("stop");
    // 中间那个音不该被连累。
    expect(second[1].tie).toBeUndefined();
  });

  it("连音线接不上时仍然报错", () => {
    const xml = wrap(
      part(
        measure(
          attributes({ divisions: 2 }) + note("C", 4, 2) + note("D", 4, 2) + note("E", 4, 2) + note("F", 4, 2),
          1,
        ) +
          // 上一小节没有开着连线，这里的 stop 是悬空的。
          measure(note("G", 4, 2, '<tie type="stop"/>') + note("A", 4, 2) + note("B", 4, 4), 2),
      ),
    );
    const result = importMusicXml(xml);
    expect(result.ok).toBe(false);
    expect(result.errors.some((text) => text.includes("连音线在这里接不上"))).toBe(true);
  });

  it("首小节不满拍按弱起导入，拍数写进 Score.pickup", () => {
    const xml = wrap(
      part(
        measure(attributes({ divisions: 2 }) + note("G", 4, 2), 0) +
          measure(note("C", 5, 2) + note("B", 4, 2) + note("A", 4, 2) + note("G", 4, 2), 1),
      ),
    );
    const result = importMusicXml(xml);
    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
    const score = result.score!;
    expect(score.pickup).toBe(1);
    // 弱起小节只有 1 拍，不补休止符——补了就把「从第 4 拍进来」画成「第 1 拍起音」。
    expect(score.staves.RH!.measures[0].notes).toHaveLength(1);
    expect(score.staves.RH!.measures[1].notes).toHaveLength(4);
    expect(result.warnings.some((text) => text.includes("弱起"))).toBe(true);
  });

  it("两手首小节拍数不一致时报错，不猜弱起拍数", () => {
    const xml = wrap(
      part(
        measure(
          attributes({
            divisions: 2,
            staves: 2,
            clefs: [
              { number: 1, sign: "G", line: 2 },
              { number: 2, sign: "F", line: 4 },
            ],
          }) +
            note("G", 4, 2, "<staff>1</staff>") +
            "<backup><duration>2</duration></backup>" +
            note("C", 3, 2, "<staff>2</staff>") +
            `<note><rest/><duration>6</duration><voice>1</voice><staff>2</staff></note>`,
          0,
        ) +
          measure(
            note("C", 5, 2, "<staff>1</staff>") +
              note("B", 4, 2, "<staff>1</staff>") +
              note("A", 4, 2, "<staff>1</staff>") +
              note("G", 4, 2, "<staff>1</staff>") +
              "<backup><duration>8</duration></backup>" +
              note("C", 3, 8, "<staff>2</staff>"),
            1,
          ),
      ),
    );
    const result = importMusicXml(xml);
    expect(result.ok).toBe(false);
    expect(result.errors.some((text) => text.includes("首小节拍数两手不一致"))).toBe(true);
  });

  it("一行谱里的两个声部：默认报错，指定 --voice 后只保留一个", () => {
    const xml = wrap(
      part(
        measure(
          attributes({ divisions: 2 }) +
            note("C", 4, 8) +
            "<backup><duration>8</duration></backup>" +
            `<note><pitch><step>C</step><octave>5</octave></pitch><duration>4</duration><voice>2</voice></note>`,
        ),
      ),
    );

    const blocked = importMusicXml(xml);
    expect(blocked.ok).toBe(false);
    expect(blocked.errors.some((text) => text.includes("多个声部"))).toBe(true);

    const kept = importMusicXml(xml, { voice: 1 });
    expect(kept.errors).toEqual([]);
    expect(kept.ok).toBe(true);
    expect(kept.score!.staves.RH!.measures[0].notes).toHaveLength(1);
    expect(kept.warnings.some((text) => text.includes("保留了声部 1"))).toBe(true);
  });

  it("右手落在低音谱号上", () => {
    const xml = wrap(
      part(
        measure(
          attributes({
            divisions: 2,
            staves: 2,
            clefs: [
              { number: 1, sign: "F", line: 4 },
              { number: 2, sign: "G", line: 2 },
            ],
          }) +
            note("C", 4, 8, "<staff>1</staff>") +
            "<backup><duration>8</duration></backup>" +
            note("C", 3, 8, "<staff>2</staff>"),
        ),
      ),
    );
    const result = importMusicXml(xml);
    expect(result.ok).toBe(false);
    expect(result.errors.some((text) => text.includes("右手谱表是低音谱号"))).toBe(true);
  });

  it("score-timewise 直接拒绝并给出去向", () => {
    const result = importMusicXml(
      `<?xml version="1.0"?><score-timewise version="4.0"><measure number="1"/></score-timewise>`,
    );
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toContain("partwise");
  });
});
