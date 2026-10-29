import type {
  Clef,
  Duration,
  Hand,
  KeySignature,
  Measure,
  NoteEvent,
  Pitch,
  Score,
  Stave,
  Step,
  TieMark,
} from "../domain/types";
import { minLevelForScore } from "./skillGraph";

/**
 * ── MusicXML → Score 导入器（作者工具）──────────────────────
 * 《二期 §2.5》承诺的「MuseScore 导出 → 规范化 → Score JSON」这一段。
 *
 * 只做 P0.5 说清楚的那部分能力：单声部 + 简单和弦、4/4 与 3/4、
 * C/F/G/D/♭B 大调、全到十六分音符（含附点）。
 *
 * 设计取舍：
 *  - **不引第三方 XML 库**。主项目只有 3 个运行期依赖，这里用 120 行的
 *    极简解析器换掉 sax/xmldom；它只认元素/属性/文本/实体/注释/CDATA，
 *    对 MusicXML 足够，出问题会带偏移量报错。
 *  - **超纲一律报错，不静默降级**。三连音、跨小节连线、6/8、非常用调号
 *    这些「改成近似值听感就变了」的情况必须让作者知道，否则会产出一份
 *    看起来成功、实际弹错的编配。
 *  - **小节内能无损合并的连线就合并**（两个四分连成二分），合并后仍无法
 *    用单个时值表示时才报错；跨小节的连线必然无法表示，直接报错。
 *  - 输出的 `Score` 没有指法，交给 `annotateScore()` 补；导入器不猜指法。
 */

/* ── 极简 XML 解析 ─────────────────────────────────────────── */

export type XmlNode = {
  name: string;
  attrs: Record<string, string>;
  children: XmlNode[];
  text: string;
};

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};

function decodeEntities(raw: string): string {
  if (!raw.includes("&")) return raw;
  return raw.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[A-Za-z][A-Za-z0-9]*);/g, (all, body: string) => {
    if (body.startsWith("#x") || body.startsWith("#X")) {
      const code = Number.parseInt(body.slice(2), 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : all;
    }
    if (body.startsWith("#")) {
      const code = Number.parseInt(body.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : all;
    }
    return NAMED_ENTITIES[body] ?? all;
  });
}

/** 从 `start` 起找到当前标签的 `>`（跳过属性值里的引号）。 */
function findTagEnd(source: string, start: number): number {
  let quote: string | null = null;
  for (let i = start; i < source.length; i += 1) {
    const char = source[i];
    if (quote) {
      if (char === quote) quote = null;
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (char === ">") {
      return i;
    }
  }
  return -1;
}

function parseStartTag(raw: string): { name: string; attrs: Record<string, string> } {
  const nameMatch = /^([^\s/>]+)/.exec(raw);
  if (!nameMatch) throw new Error(`标签格式错误：<${raw.slice(0, 40)}>`);
  const attrs: Record<string, string> = {};
  const attrPattern = /([^\s=/]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let match: RegExpExecArray | null;
  while ((match = attrPattern.exec(raw)) !== null) {
    attrs[match[1]] = decodeEntities(match[2] ?? match[3] ?? "");
  }
  return { name: nameMatch[1], attrs };
}

/**
 * 解析 XML 文本，返回根元素。
 * 只支持导入器需要的东西；遇到结构错误抛 `Error`（带字符偏移，便于定位）。
 */
export function parseXml(source: string): XmlNode {
  const stack: XmlNode[] = [];
  let root: XmlNode | null = null;
  let i = source.charCodeAt(0) === 0xfeff ? 1 : 0;

  const fail = (message: string): never => {
    throw new Error(`XML 解析失败（偏移 ${i}）：${message}`);
  };

  const appendText = (raw: string): void => {
    if (stack.length === 0) {
      if (raw.trim() !== "") fail("元素之外出现文本");
      return;
    }
    stack[stack.length - 1].text += decodeEntities(raw);
  };

  while (i < source.length) {
    const open = source.indexOf("<", i);
    if (open < 0) {
      appendText(source.slice(i));
      break;
    }
    if (open > i) appendText(source.slice(i, open));
    i = open;

    if (source.startsWith("<!--", i)) {
      const end = source.indexOf("-->", i + 4);
      if (end < 0) fail("注释未闭合");
      i = end + 3;
      continue;
    }
    if (source.startsWith("<![CDATA[", i)) {
      const end = source.indexOf("]]>", i + 9);
      if (end < 0) fail("CDATA 未闭合");
      if (stack.length === 0) fail("CDATA 出现在元素之外");
      stack[stack.length - 1].text += source.slice(i + 9, end);
      i = end + 3;
      continue;
    }
    if (source.startsWith("<?", i)) {
      const end = source.indexOf("?>", i + 2);
      if (end < 0) fail("处理指令未闭合");
      i = end + 2;
      continue;
    }
    if (source.startsWith("<!", i)) {
      // DOCTYPE 可能带内部子集 [...]，跳过整段。
      const bracket = source.indexOf("[", i);
      const gt = source.indexOf(">", i);
      if (gt < 0) fail("声明未闭合");
      const end = bracket >= 0 && bracket < gt ? source.indexOf("]>", bracket) : -1;
      i = end >= 0 ? end + 2 : gt + 1;
      continue;
    }
    if (source.startsWith("</", i)) {
      const end = findTagEnd(source, i + 2);
      if (end < 0) fail("结束标签未闭合");
      const name = source.slice(i + 2, end).trim();
      const top = stack.pop();
      if (!top) fail(`多余的结束标签 </${name}>`);
      if (top!.name !== name) fail(`结束标签 </${name}> 与开始标签 <${top!.name}> 不匹配`);
      i = end + 1;
      continue;
    }

    const end = findTagEnd(source, i + 1);
    if (end < 0) fail("开始标签未闭合");
    let raw = source.slice(i + 1, end);
    const selfClosing = raw.trimEnd().endsWith("/");
    if (selfClosing) raw = raw.trimEnd().slice(0, -1);
    const { name, attrs } = parseStartTag(raw);
    const node: XmlNode = { name, attrs, children: [], text: "" };
    if (stack.length === 0) {
      if (root) fail("存在多个根元素");
      root = node;
    } else {
      stack[stack.length - 1].children.push(node);
    }
    if (!selfClosing) stack.push(node);
    i = end + 1;
  }

  if (stack.length > 0) {
    throw new Error(`XML 解析失败：<${stack[stack.length - 1].name}> 未闭合`);
  }
  if (!root) throw new Error("XML 解析失败：没有根元素");
  return root;
}

/* ── 节点读取小工具 ───────────────────────────────────────── */

function child(node: XmlNode | undefined, name: string): XmlNode | undefined {
  return node?.children.find((item) => item.name === name);
}

function childrenNamed(node: XmlNode | undefined, name: string): XmlNode[] {
  return node ? node.children.filter((item) => item.name === name) : [];
}

function textIn(node: XmlNode | undefined, name: string): string | undefined {
  const raw = child(node, name)?.text.trim();
  return raw === undefined || raw === "" ? undefined : raw;
}

function numberIn(node: XmlNode | undefined, name: string): number | undefined {
  const raw = textIn(node, name);
  if (raw === undefined) return undefined;
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
}

/* ── MusicXML → Score ─────────────────────────────────────── */

export type MusicXmlOptions = {
  /** 输出 Score 的 id；默认 `score.imported`。 */
  id?: string;
  /** 覆盖文件里的 tempo；都没给时用 72。 */
  bpm?: number;
  /** Score.level（词汇表档位），默认 3。 */
  level?: Score["level"];
  /**
   * 一行谱有多个声部时保留哪个声部；不指定则直接报错。
   * MusicXML 的 `<voice>` 从 1 开始。
   */
  voice?: number;
};

export type MusicXmlImportResult = {
  ok: boolean;
  errors: string[];
  warnings: string[];
  score?: Score;
};

/** 拍数与 Score 时值的一一对应；不在表里就是 Score 表达不了的值。 */
const DURATION_BY_BEATS: ReadonlyArray<readonly [number, Duration]> = [
  [4, "w"],
  [3, "hd"],
  [2, "h"],
  [1.5, "qd"],
  [1, "q"],
  [0.5, "8"],
  [0.25, "16"],
];

/** 休止符只有这些时值（Score 没有附点休止符）。 */
const REST_DURATION_BY_BEATS: ReadonlyArray<readonly [number, Duration]> = [
  [4, "wr"],
  [2, "hr"],
  [1, "qr"],
  [0.5, "8r"],
  [0.25, "16r"],
];

const STEPS: ReadonlySet<string> = new Set(["C", "D", "E", "F", "G", "A", "B"]);

const FIFTHS_TO_KEY: Record<number, KeySignature> = {
  [-2]: "Bb",
  [-1]: "F",
  0: "C",
  1: "G",
  2: "D",
};

const KEY_NAMES: ReadonlyArray<string> = [
  "Cb",
  "Gb",
  "Db",
  "Ab",
  "Eb",
  "Bb",
  "F",
  "C",
  "G",
  "D",
  "A",
  "E",
  "B",
  "F#",
  "C#",
];

const EPSILON = 1e-6;

/** 把 `duration / divisions` 的浮点噪声收回到 1/64 拍栅格上，其余原样保留。 */
function roundBeats(value: number): number {
  const scaled = value * 64;
  const rounded = Math.round(scaled);
  return Math.abs(scaled - rounded) < 1e-3 ? rounded / 64 : value;
}

function formatBeats(beats: number): string {
  return Number.isInteger(beats) ? String(beats) : String(Math.round(beats * 1000) / 1000);
}

function keyNameOf(fifths: number): string {
  return KEY_NAMES[fifths + 7] ?? `fifths=${fifths}`;
}

function durationForBeats(beats: number): Duration | null {
  for (const [value, duration] of DURATION_BY_BEATS) {
    if (Math.abs(beats - value) < EPSILON) return duration;
  }
  return null;
}

function restDurationsFor(beats: number): { durations: Duration[]; remainder: number } {
  const durations: Duration[] = [];
  let left = roundBeats(beats);
  for (const [value, duration] of REST_DURATION_BY_BEATS) {
    while (left + EPSILON >= value) {
      durations.push(duration);
      left = roundBeats(left - value);
    }
  }
  return { durations, remainder: left < EPSILON ? 0 : left };
}

function samePitch(left: Pitch, right: Pitch): boolean {
  return left.step === right.step && left.octave === right.octave && left.alteration === right.alteration;
}

/** 一次 `<note>` 解析出来的中间结果。 */
type RawGroup = {
  onset: number;
  beats: number;
  pitches: Pitch[];
  voice: number;
  staff: number;
  tieStart: boolean;
  tieStop: boolean;
};

type PartState = {
  divisions: number;
  beats: number;
  beatValue: number;
  fifths: number;
  staves: number;
  clefs: Map<number, Clef>;
  tempo?: number;
};

type ParsedPart = {
  staffCount: number;
  clefs: Clef[];
  /** 每小节的所有音组（含休止符组）。 */
  measures: RawGroup[][];
  keyFifths: number;
  meter: { beats: number; beatValue: number };
  /** MusicXML 里的 `<sound tempo>`；没有标记就是 undefined。 */
  tempo?: number;
};

function tieFlags(note: XmlNode): { start: boolean; stop: boolean } {
  let start = false;
  let stop = false;
  const collect = (node: XmlNode): void => {
    if (node.attrs.type === "start") start = true;
    if (node.attrs.type === "stop") stop = true;
  };
  childrenNamed(note, "tie").forEach(collect);
  for (const notations of childrenNamed(note, "notations")) {
    childrenNamed(notations, "tied").forEach(collect);
  }
  return { start, stop };
}

function parsePitches(note: XmlNode, label: string, errors: string[]): Pitch[] {
  const pitchNode = child(note, "pitch");
  if (!pitchNode) {
    errors.push(`${label}：note 既不是 rest 也没有 pitch`);
    return [];
  }
  const step = textIn(pitchNode, "step");
  const octave = numberIn(pitchNode, "octave");
  const alter = numberIn(pitchNode, "alter") ?? 0;
  if (!step || !STEPS.has(step)) {
    errors.push(`${label}：音名 ${step ?? "?"} 不是 C–B`);
    return [];
  }
  if (octave === undefined) {
    errors.push(`${label}：pitch 缺少 octave`);
    return [];
  }
  if (alter !== -1 && alter !== 0 && alter !== 1) {
    errors.push(`${label}：alter=${alter} 超出 Score 的 -1/0/1（重升重降暂不支持）`);
    return [];
  }
  return [{ step: step as Step, octave, alteration: alter }];
}

function applyAttributes(
  node: XmlNode,
  state: PartState,
  measureIndex: number,
  label: string,
  errors: string[],
  warnings: string[],
): void {
  const divisions = numberIn(node, "divisions");
  if (divisions !== undefined) {
    if (!(divisions > 0)) errors.push(`${label}：divisions 必须是正数`);
    else state.divisions = divisions;
  }

  const keyNode = child(node, "key");
  if (keyNode) {
    const fifths = numberIn(keyNode, "fifths") ?? 0;
    if (measureIndex > 0 && fifths !== state.fifths) {
      warnings.push(
        `${label}：调号在第 ${measureIndex + 1} 小节变化，Score 全曲只有一个调号，已按首次调号处理`,
      );
    }
    state.fifths = fifths;
  }

  const timeNode = child(node, "time");
  if (timeNode) {
    if (child(timeNode, "senza-misura")) {
      errors.push(`${label}：自由拍（senza-misura）不在 Score 支持范围`);
    } else {
      const beats = numberIn(timeNode, "beats");
      const beatValue = numberIn(timeNode, "beat-type");
      if (beats === undefined || beatValue === undefined) {
        errors.push(`${label}：time 缺少 beats / beat-type`);
      } else {
        if (measureIndex > 0 && (beats !== state.beats || beatValue !== state.beatValue)) {
          warnings.push(
            `${label}：拍号在第 ${measureIndex + 1} 小节变成 ${beats}/${beatValue}，Score 全曲只有一个拍号，已按首次拍号处理`,
          );
        }
        state.beats = beats;
        state.beatValue = beatValue;
      }
    }
  }

  const staves = numberIn(node, "staves");
  if (staves !== undefined && staves > state.staves) state.staves = staves;

  for (const clefNode of childrenNamed(node, "clef")) {
    const number = Number(clefNode.attrs.number ?? "1");
    const sign = textIn(clefNode, "sign");
    if (sign === "G") state.clefs.set(Number.isFinite(number) ? number : 1, "treble");
    else if (sign === "F") state.clefs.set(Number.isFinite(number) ? number : 1, "bass");
    else errors.push(`${label}：谱号 ${sign ?? "?"} 不支持（只支持 G 高音谱号 / F 低音谱号）`);
  }
}

function parsePart(
  partNode: XmlNode,
  errors: string[],
  warnings: string[],
): ParsedPart {
  const state: PartState = {
    divisions: 1,
    beats: 4,
    beatValue: 4,
    fifths: 0,
    staves: 1,
    clefs: new Map([[1, "treble"]]),
  };

  const measures: RawGroup[][] = [];
  let maxStaff = 1;
  let graceNotes = 0;
  let cueNotes = 0;

  const measureNodes = childrenNamed(partNode, "measure");
  measureNodes.forEach((measureNode, measureIndex) => {
    const label = `第 ${measureIndex + 1} 小节`;
    const groups: RawGroup[] = [];
    const lastByStaff = new Map<number, RawGroup>();
    let cursor = 0;

    for (const node of measureNode.children) {
      switch (node.name) {
        case "attributes":
          applyAttributes(node, state, measureIndex, label, errors, warnings);
          break;
        case "sound": {
          const tempo = Number(node.attrs.tempo);
          if (Number.isFinite(tempo) && tempo > 0) state.tempo = tempo;
          break;
        }
        case "direction": {
          const sound = child(node, "sound");
          const tempo = Number(sound?.attrs.tempo);
          if (Number.isFinite(tempo) && tempo > 0) state.tempo = tempo;
          break;
        }
        case "backup": {
          const divisor = numberIn(node, "duration") ?? 0;
          cursor = Math.max(0, cursor - roundBeats(divisor / state.divisions));
          lastByStaff.clear();
          break;
        }
        case "forward": {
          const divisor = numberIn(node, "duration") ?? 0;
          cursor += roundBeats(divisor / state.divisions);
          lastByStaff.clear();
          break;
        }
        case "note": {
          if (child(node, "grace")) {
            graceNotes += 1;
            break;
          }
          if (child(node, "cue")) {
            cueNotes += 1;
            break;
          }
          const durationDivisions = numberIn(node, "duration");
          if (durationDivisions === undefined) {
            errors.push(`${label}：note 缺少 <duration>，无法确定时值`);
            break;
          }
          if (child(node, "time-modification")) {
            errors.push(`${label}：三连音等连音符暂不支持，请先在 MuseScore 里改成普通时值`);
            break;
          }
          const beats = roundBeats(durationDivisions / state.divisions);
          if (!(beats > 0)) {
            errors.push(`${label}：时值 ${formatBeats(beats)} 拍必须大于 0`);
            break;
          }
          const staff = numberIn(node, "staff") ?? 1;
          maxStaff = Math.max(maxStaff, staff);
          const voice = numberIn(node, "voice") ?? 1;
          const isRest = child(node, "rest") !== undefined;
          const isChord = child(node, "chord") !== undefined;
          const pitches = isRest ? [] : parsePitches(node, label, errors);
          if (!isRest && pitches.length === 0) break;
          const { start, stop } = tieFlags(node);

          if (isChord) {
            const base = lastByStaff.get(staff);
            if (!base) {
              errors.push(`${label}：和弦音 <chord/> 前没有基础音`);
              break;
            }
            base.pitches.push(...pitches);
            base.tieStart = base.tieStart || start;
            base.tieStop = base.tieStop || stop;
            break;
          }

          const group: RawGroup = {
            onset: cursor,
            beats,
            pitches,
            voice,
            staff,
            tieStart: start,
            tieStop: stop,
          };
          groups.push(group);
          lastByStaff.set(staff, group);
          cursor += beats;
          break;
        }
        default:
          break;
      }
    }

    measures.push(groups);
  });

  if (graceNotes > 0) warnings.push(`已跳过 ${graceNotes} 个装饰音（不参与本工具的时值模型）`);
  if (cueNotes > 0) warnings.push(`已跳过 ${cueNotes} 个提示音（cue）`);

  const clefs: Clef[] = [];
  for (let staff = 1; staff <= state.staves; staff += 1) {
    clefs.push(state.clefs.get(staff) ?? (staff === 1 ? "treble" : "bass"));
  }

  return {
    staffCount: Math.max(state.staves, maxStaff),
    clefs,
    measures,
    keyFifths: state.fifths,
    meter: { beats: state.beats, beatValue: state.beatValue },
    tempo: state.tempo,
  };
}

type BuildContext = {
  hand: Hand;
  /** 这份 MusicXML 里对应的谱表号（part/staff 拍平后的 staff）。 */
  sourceStaff: number;
  meterBeats: number;
  voice: number | undefined;
  errors: string[];
  warnings: string[];
};

/**
 * 把一行的音组装配成 `Measure[]`：标记连音线、补休止符、校验小节满拍。
 *
 * 连音线不再合并成单个长音——`Score` 现在有 `tie` 字段，保留原谱的
 * 「两个音符 + 一条线」既更忠实，也不受「单个时值必须落在 4/3/2/1.5/1… 里」
 * 的限制（5 拍、7 拍的延音也能表达）。
 *
 * 首小节不满拍时不当错误、也不补休止符，而是回报成 `pickup`（弱起的实际
 * 拍数）——补上休止符会把弱起画成「第一拍起音」，听到的位置就变了。
 * 双手的首小节拍数是否一致由调用方统一判。
 */
function buildMeasures(
  groupsPerMeasure: RawGroup[][],
  ctx: BuildContext,
): { measures: Measure[]; pickup: number | null } {
  const measures: Measure[] = [];
  /** 上一小节留下的开口连音线（音高快照）；下一小节的第一个音必须接上。 */
  let pending: Pitch[] | null = null;
  let pickup: number | null = null;

  groupsPerMeasure.forEach((allGroups, measureIndex) => {
    const label = `第 ${measureIndex + 1} 小节`;
    const groups = allGroups.filter(
      (group) =>
        group.staff === ctx.sourceStaff && (ctx.voice === undefined || group.voice === ctx.voice),
    );

    groups.sort((a, b) => a.onset - b.onset);

    const notes: NoteEvent[] = [];
    let filled = 0;
    let counter = 0;
    const gaps: string[] = [];

    const pushRests = (beats: number, reason: string): boolean => {
      const { durations, remainder } = restDurationsFor(beats);
      if (remainder > 0) {
        ctx.errors.push(
          `${label}：${formatBeats(remainder)} 拍休止无法用 4/2/1/0.5/0.25 拍表示（${reason}）`,
        );
        return false;
      }
      for (const duration of durations) {
        counter += 1;
        notes.push({
          id: `${ctx.hand.toLowerCase()}-${measureIndex + 1}-${counter}`,
          pitches: [],
          duration,
        });
      }
      return true;
    };

    for (const group of groups) {
      if (group.onset > filled + EPSILON) {
        const gap = roundBeats(group.onset - filled);
        if (!pushRests(gap, "小节内有空白")) break;
        gaps.push(`拍 ${formatBeats(filled)}`);
        filled = roundBeats(filled + gap);
        // 中间空了拍，连音线已经断了。
        pending = null;
      }
      if (group.onset < filled - EPSILON) {
        ctx.errors.push(
          `${label}：同一时刻出现多个音（拍 ${formatBeats(group.onset)}），Score 只支持单声部，请用 <chord/> 表示和弦`,
        );
        continue;
      }
      if (group.pitches.length === 0) {
        if (!pushRests(group.beats, "休止符")) break;
        pending = null;
      } else {
        const duration = durationForBeats(group.beats);
        if (!duration) {
          ctx.errors.push(
            `${label}：时值 ${formatBeats(group.beats)} 拍无法用 Score 的时值表示` +
              `（支持 4/3/2/1.5/1/0.5/0.25 拍；三连音、32 分音符请先在 MuseScore 里改写）`,
          );
          break;
        }

        const tie = tieMarkFor(group, pending, label, ctx);
        // 无条件覆盖：这条音要么把线接下去，要么把它闭合（含断线的情况）。
        pending = group.tieStart ? group.pitches : null;
        counter += 1;
        notes.push({
          id: `${ctx.hand.toLowerCase()}-${measureIndex + 1}-${counter}`,
          pitches: group.pitches,
          duration,
          ...(tie ? { tie } : {}),
        });
      }
      filled = roundBeats(filled + group.beats);
    }

    if (gaps.length > 0) {
      ctx.warnings.push(`${label}：${gaps.join("、")} 处有空拍，已补休止符`);
    }

    if (filled > ctx.meterBeats + EPSILON) {
      ctx.errors.push(
        `${label}：共 ${formatBeats(filled)} 拍，超过每小节 ${formatBeats(ctx.meterBeats)} 拍`,
      );
    } else if (filled < ctx.meterBeats - EPSILON) {
      const short = roundBeats(ctx.meterBeats - filled);
      if (measureIndex === 0) {
        if (filled <= 0) {
          ctx.errors.push(`${label}：首小节没有任何音符，无法判断弱起小节`);
        } else {
          pickup = roundBeats(filled);
          ctx.warnings.push(
            `${label}只有 ${formatBeats(filled)} 拍，按弱起小节导入（Score.pickup=${formatBeats(filled)}）`,
          );
        }
      } else if (pushRests(short, "小节不满")) {
        ctx.warnings.push(`${label}：只有 ${formatBeats(filled)} 拍，已补 ${formatBeats(short)} 拍休止`);
      }
    }

    measures.push({ notes });
  });

  return { measures, pickup };
}

/**
 * 一个音组的连音线标记，顺带校验「接得上」。
 *
 * - 带 `tieStop`：必须紧跟在一条开着的线上且音高相同；自己还 `tieStart`
 *   就是中间段（continue），否则是末段（stop）。
 * - 不带 `tieStop` 但上一小节还开着线：那条线断了，报错。
 */
function tieMarkFor(
  group: RawGroup,
  pending: readonly Pitch[] | null,
  label: string,
  ctx: BuildContext,
): TieMark | undefined {
  if (group.tieStop) {
    const matches =
      pending !== null &&
      group.pitches.length === 1 &&
      pending.length === 1 &&
      samePitch(pending[0], group.pitches[0]);
    if (!matches) {
      ctx.errors.push(`${label}：连音线在这里接不上（上一个音不是同一个音高或中间隔了别的音）`);
      return group.tieStart ? "start" : undefined;
    }
    return group.tieStart ? "continue" : "stop";
  }
  if (pending) {
    ctx.errors.push(`${label}：上一小节的连音线没有接上（下一个音不是同一个音高）`);
  }
  return group.tieStart ? "start" : undefined;
}

/**
 * 把 MusicXML 文本转成 `Score`。
 *
 * 返回的 `ok=false` 时 `errors` 里是必须修的问题（不是「部分成功」），
 * `score` 仍然给出——CLI 会打印它做参考，但不要拿去用。
 */
export function importMusicXml(text: string, options: MusicXmlOptions = {}): MusicXmlImportResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  let root: XmlNode;
  try {
    root = parseXml(text);
  } catch (error) {
    return { ok: false, errors: [(error as Error).message], warnings };
  }

  if (root.name !== "score-partwise") {
    return {
      ok: false,
      errors: [
        root.name === "score-timewise"
          ? "暂不支持 score-timewise（按时间组织的 MusicXML），请用 MuseScore 另存为 partwise"
          : `根元素是 <${root.name}>，不是 MusicXML 的 <score-partwise>`,
      ],
      warnings,
    };
  }

  const partNodes = childrenNamed(root, "part");
  if (partNodes.length === 0) {
    return { ok: false, errors: ["MusicXML 里没有 <part>"], warnings };
  }

  const parts: ParsedPart[] = [];
  partNodes.forEach((partNode) => {
    parts.push(parsePart(partNode, errors, warnings));
  });

  // 调号/拍号必须全曲一致（Score 只有一个）。
  const keyFifths = parts[0].keyFifths;
  const meter = parts[0].meter;
  for (const part of parts.slice(1)) {
    if (part.keyFifths !== keyFifths) {
      errors.push(
        `各声部调号不一致（${keyNameOf(keyFifths)} vs ${keyNameOf(part.keyFifths)}），Score 只支持一个调号`,
      );
    }
    if (part.meter.beats !== meter.beats || part.meter.beatValue !== meter.beatValue) {
      errors.push(
        `各声部拍号不一致（${meter.beats}/${meter.beatValue} vs ${part.meter.beats}/${part.meter.beatValue}），Score 只支持一个拍号`,
      );
    }
  }

  if (meter.beatValue !== 4 || (meter.beats !== 3 && meter.beats !== 4)) {
    errors.push(
      `拍号 ${meter.beats}/${meter.beatValue} 不在 Score 支持范围（只有 4/4、3/4）`,
    );
  }
  const keySignature = FIFTHS_TO_KEY[keyFifths];
  if (!keySignature) {
    errors.push(
      `调号 ${keyNameOf(keyFifths)}（fifths=${keyFifths}）不在 Score 支持范围（C/F/G/D/♭B）`,
    );
  }

  // 一个 part 里两行谱（钢琴谱的常见导出）或两个 part 各一行，都映射成左右手。
  const candidates: Array<{ part: ParsedPart; staff: number }> = [];
  for (const part of parts) {
    for (let staff = 1; staff <= part.staffCount; staff += 1) candidates.push({ part, staff });
  }
  if (candidates.length > 2) {
    errors.push(`只支持最多两只手，当前 MusicXML 有 ${candidates.length} 个谱表`);
  }

  const firstClef = candidates[0] ? candidates[0].part.clefs[candidates[0].staff - 1] ?? "treble" : "treble";
  const hands: Hand[] = candidates.length <= 1 ? [firstClef === "bass" ? "LH" : "RH"] : ["RH", "LH"];

  const meterBeats = meter.beats === 3 || meter.beats === 4 ? meter.beats : 4;
  const bpm = options.bpm ?? parts[0].tempo ?? 72;
  if (options.bpm === undefined && parts[0].tempo === undefined) {
    warnings.push("MusicXML 里没有 tempo 标记，已用默认 72 BPM，请用 --bpm 覆盖");
  }

  const staves: Partial<Record<Hand, Stave>> = {};
  const usedHands: Hand[] = [];
  /** 每只手首小节的弱起拍数（null = 满小节）。 */
  const pickups = new Map<Hand, number | null>();

  candidates.slice(0, 2).forEach((candidate, index) => {
    const hand = hands[index];
    const clef = candidate.part.clefs[candidate.staff - 1] ?? (hand === "RH" ? "treble" : "bass");
    const staffLabel = hand === "RH" ? "右手" : "左手";
    if (hand === "RH" && clef !== "treble") {
      errors.push(`右手谱表是低音谱号；Score 要求右手高音谱号、左手低音谱号`);
    }
    if (hand === "LH" && clef !== "bass") {
      errors.push(`左手谱表是高音谱号；Score 要求右手高音谱号、左手低音谱号`);
    }

    // 多声部：Score 一个谱表只有一条时间线。
    const voices = new Set<number>();
    for (const groups of candidate.part.measures) {
      for (const group of groups) {
        // 只数「发声音」的声部：另一声部只有休止符时不构成冲突。
        if (group.staff === candidate.staff && group.pitches.length > 0) voices.add(group.voice);
      }
    }
    let voice = options.voice;
    const listed = [...voices].sort((a, b) => a - b).join(" / ");
    if (voice !== undefined && voices.size > 0 && !voices.has(voice)) {
      errors.push(`${staffLabel}没有声部 ${voice}（实际有 ${listed || "无"}）`);
      voice = undefined;
    }
    if (voices.size > 1) {
      if (voice === undefined) {
        errors.push(
          `${staffLabel}有多个声部（${listed}），Score 只支持单声部；可用 --voice 指定保留哪一声部`,
        );
        voice = Math.min(...voices);
      } else {
        let dropped = 0;
        for (const groups of candidate.part.measures) {
          for (const group of groups) {
            if (group.staff === candidate.staff && group.voice !== voice && group.pitches.length > 0) {
              dropped += 1;
            }
          }
        }
        warnings.push(`${staffLabel}保留了声部 ${voice}，丢弃其他声部的 ${dropped} 个音`);
      }
    }

    const built = buildMeasures(candidate.part.measures, {
      hand,
      sourceStaff: candidate.staff,
      meterBeats,
      voice,
      errors,
      warnings,
    });

    const hasSound = built.measures.some((measure) =>
      measure.notes.some((note) => note.pitches.length > 0),
    );
    if (!hasSound) {
      warnings.push(`${staffLabel}全谱都是休止符，已省略该谱表`);
      return;
    }
    staves[hand] = { clef, measures: built.measures };
    usedHands.push(hand);
    pickups.set(hand, built.pickup);
  });

  if (usedHands.length === 0) {
    errors.push("没有找到任何发声音（全谱都是休止符）");
  }

  // 两只手的小节数对齐（后加的手少一节时补全休止）。
  const measureCount = Math.max(
    0,
    ...usedHands.map((hand) => staves[hand]?.measures.length ?? 0),
  );
  for (const hand of usedHands) {
    const stave = staves[hand];
    if (!stave) continue;
    while (stave.measures.length < measureCount) {
      const { durations } = restDurationsFor(meterBeats);
      stave.measures.push({
        notes: durations.map((duration, index) => ({
          id: `${hand.toLowerCase()}-${stave.measures.length + 1}-${index + 1}`,
          pitches: [],
          duration,
        })),
      });
      warnings.push(`${hand === "RH" ? "右手" : "左手"}比另一只手少一小节，已补全休止符`);
    }
  }

  // 弱起：两手首小节必须一样短——一手短一手满说明两只手在小节线上没对齐，
  // 硬导进来会让「第 2 小节」在两只手上指向不同的位置。
  let pickup: number | undefined;
  if (usedHands.length > 0) {
    const values = usedHands.map((hand) => pickups.get(hand) ?? null);
    const effective = values.map((value) => value ?? meterBeats);
    const distinct = new Set(effective);
    if (distinct.size > 1) {
      const detail = usedHands
        .map((hand, index) => `${hand === "RH" ? "右手" : "左手"} ${formatBeats(effective[index]!)} 拍`)
        .join("、");
      errors.push(
        `首小节拍数两手不一致（${detail}）；弱起小节必须两只手一样短，请在 MuseScore 里改一致`,
      );
    } else {
      const declared = values.find((value) => value !== null);
      if (declared !== null && declared !== undefined) pickup = declared;
    }
  }

  const score: Score = {
    id: options.id ?? "score.imported",
    mode: "repertoire",
    level: options.level ?? 3,
    meter: { beats: meterBeats, beatValue: 4 },
    keySignature: keySignature ?? "C",
    hands: usedHands,
    bpm,
    staves,
    ...(pickup === undefined ? {} : { pickup }),
  };

  if (errors.length === 0) {
    const minLevel = minLevelForScore(score);
    if (minLevel >= 7) {
      warnings.push(
        "这份谱面落不到 L1–L6 任何一档（音域/跳进/和弦形状超纲），validate:content 会报错，需要降级编配",
      );
    }
  }

  return { ok: errors.length === 0, errors, warnings, score };
}
