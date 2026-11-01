import { APP_VERSION } from "../../src/version";

/**
 * 批量 MusicXML 导入的纯函数部分。
 *
 * 文件扫描、写盘和 CLI 参数留在 `scripts/import-batch.ts`；这里只做
 * 「文件名 → 包 id」「模板占位符 → manifest」「评级差异表」三件事，
 * 方便单元测试，也避免作者工具把业务规则散落在 console.log 里。
 */

export interface BatchManifestContext {
  slug: string;
  title: string;
  file: string;
  id: string;
  songId: string;
  arrangementId: string;
  /** 最终写进 manifest 的声明档（默认取按音高与按指法的较大值）。 */
  level: number;
  pitchLevel: number;
  fingerLevel: number;
  pitchLabel: string;
  fingerLabel: string;
  bpm: number;
  measures: number;
  skills: string[];
}

export interface RatingRow {
  file: string;
  measures: number;
  pitchLabel: string;
  fingerLabel: string;
  delta: number;
  unfingered: number;
  status: string;
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 文件名转包 id 片段：只保留 ASCII 小写、数字、点、下划线、连字符。 */
export function slugifyFile(file: string): string {
  const base = file.replace(/\\/g, "/").replace(/\.[^./]+$/, "");
  return base
    .normalize("NFKD")
    .replace(/[^\x00-\x7F]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** 文件名转展示标题；保留中文，去掉扩展名并把下划线/连字符变成空格。 */
export function titleFromFile(file: string): string {
  const base = file.replace(/\\/g, "/").split("/").pop() ?? file;
  const title = base
    .replace(/\.[^.]+$/, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return title || "未命名曲目";
}

/**
 * 解析模板里的 `{{key}}` 占位符。
 *
 * 整个字符串正好是一个占位符时保留原始类型（数字/数组），否则做字符串替换。
 * 数组会摊平一层，所以 `"skillDeps": ["{{skills}}"]` 会变成字符串数组，
 * 而不是嵌套数组。
 */
export function resolveTemplate(value: unknown, context: Record<string, unknown>): unknown {
  if (typeof value === "string") {
    const exact = value.match(/^\{\{\s*([a-zA-Z0-9_]+)\s*\}\}$/);
    if (exact) return context[exact[1]];
    return value.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key: string) => {
      const replacement = context[key];
      return replacement == null ? "" : String(replacement);
    });
  }
  if (Array.isArray(value)) {
    return value.flatMap((item) => {
      const resolved = resolveTemplate(item, context);
      return Array.isArray(resolved) ? resolved : [resolved];
    });
  }
  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, resolveTemplate(item, context)]),
    );
  }
  return value;
}

/**
 * 生成 manifest：先写一套能通过 `validate:content` 的默认值，再用模板覆盖。
 *
 * 默认声明档取「按音高」与「按指法」的较大值，保证不会因为补指法后的评级
 * 高于声明档而被内容 QA 拒绝；差异表仍会把真实差值打出来，提示人工校对。
 * `skillDeps` 默认用补指法后的识别结果，因为 `validate:content` 也是按指法检查。
 */
export function buildBatchManifest(
  template: unknown,
  context: BatchManifestContext,
): Record<string, unknown> {
  const generated: Record<string, unknown> = {
    schemaVersion: 1,
    id: context.id,
    name: `${context.title} · 导入编配`,
    type: "song",
    version: "1.0.0",
    songId: context.songId,
    arrangementId: context.arrangementId,
    songTitle: context.title,
    composer: "待填写",
    minAppVersion: APP_VERSION,
    skillDeps: [...context.skills],
    difficulty: {
      level: context.level,
      bpm: context.bpm,
      len: context.measures,
    },
    assets: ["content/score.json"],
    license: "user-imported",
    rights: { type: "user-imported" },
  };

  const resolved = isPlainObject(template)
    ? (resolveTemplate(template, context as unknown as Record<string, unknown>) as Record<string, unknown>)
    : {};
  const merged: Record<string, unknown> = { ...generated, ...resolved };

  const generatedDifficulty = generated.difficulty as Record<string, unknown>;
  merged.difficulty = {
    ...generatedDifficulty,
    ...(isPlainObject(merged.difficulty) ? merged.difficulty : {}),
  };
  if (!Array.isArray(merged.skillDeps) || merged.skillDeps.length === 0) {
    merged.skillDeps = [...context.skills];
  }
  if (!Array.isArray(merged.assets) || merged.assets.length === 0) {
    merged.assets = ["content/score.json"];
  }
  return merged;
}

export function formatRatingDelta(delta: number): string {
  if (delta > 0) return `+${delta}`;
  return String(delta);
}

/** 终端表格按显示宽度对齐，中文按 2 列计算。 */
export function displayWidth(text: string): number {
  let width = 0;
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    if (code === 0) continue;
    if (code < 32 || (code >= 0x7f && code < 0xa0)) continue;
    width += isWideCodePoint(code) ? 2 : 1;
  }
  return width;
}

function isWideCodePoint(code: number): boolean {
  return (
    code >= 0x1100 &&
    (code <= 0x115f ||
      code === 0x2329 ||
      code === 0x232a ||
      (code >= 0x2e80 && code <= 0xa4cf && code !== 0x303f) ||
      (code >= 0xac00 && code <= 0xd7a3) ||
      (code >= 0xf900 && code <= 0xfaff) ||
      (code >= 0xfe10 && code <= 0xfe19) ||
      (code >= 0xfe30 && code <= 0xfe6f) ||
      (code >= 0xff00 && code <= 0xff60) ||
      (code >= 0xffe0 && code <= 0xffe6) ||
      (code >= 0x1f300 && code <= 0x1f64f) ||
      (code >= 0x1f900 && code <= 0x1f9ff) ||
      (code >= 0x20000 && code <= 0x3fffd))
  );
}

export function padDisplay(text: string, width: number): string {
  const clean = text.replace(/\s*\n\s*/g, " ");
  return clean + " ".repeat(Math.max(0, width - displayWidth(clean)));
}

export function renderRatingTable(rows: readonly RatingRow[]): string {
  const headers = ["文件", "小节", "按音高", "按指法", "差", "未补指法", "状态"];
  const cells = rows.map((row) => [
    row.file,
    String(row.measures),
    row.pitchLabel,
    row.fingerLabel,
    formatRatingDelta(row.delta),
    String(row.unfingered),
    row.status,
  ]);
  const widths = headers.map((header, index) =>
    Math.max(displayWidth(header), ...cells.map((row) => displayWidth(row[index] ?? ""))),
  );
  const line = widths.map((width) => "-".repeat(width)).join("-+-");
  const format = (row: readonly string[]) =>
    row.map((cell, index) => padDisplay(cell, widths[index] ?? 0)).join(" | ");
  return [format(headers), line, ...cells.map(format)].join("\n");
}
