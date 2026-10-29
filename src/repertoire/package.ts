/**
 * ── 数据包 schema + 校验 + 加载 ───────────────────────────────
 * 内容以数据包形式接入：App 提供能力骨架，课程/曲目/编配作为数据包加载。
 *
 * manifest.json 是包的入口，声明 id / type / 版本 / 技能依赖(skillDeps) /
 * 难度 / 资源列表 / 校验和 / 版权。解析器把数据包当作未信任输入：
 * 只认已知字段、逐项校验、拒绝坏数据，不做任何执行。
 */

export type PackageType = "course" | "song" | "practice";

export type RightsType = "public-domain" | "licensed" | "original" | "user-imported";

/** 音乐权利比一个 license 字符串复杂：作曲、编曲、录音可能分别授权。 */
export interface PackageRights {
  type: RightsType;
  attribution?: string;
  territory?: string;
  /** ISO 日期；授权到期后加载器应提示下架 */
  expiresAt?: string;
}

export interface PackageManifest {
  schemaVersion: number;
  id: string;
  name: string;
  type: PackageType;
  version: string;
  /** song 包指向的歌曲稳定 id；一个歌曲可以有多个编配包 */
  songId?: string;
  /** 编配稳定 id；不要把难度写进 id，重新评级时 id 不应变化 */
  arrangementId?: string;
  /** 歌曲标题（catalog 聚合用；不要把编配难度写进来） */
  songTitle?: string;
  /** 作曲者/来源，catalog 展示用 */
  composer?: string;
  /** 旧 App 读到新包时的最低版本；缺省视为不限制 */
  minAppVersion?: string;
  /** 技能依赖：引用技能图谱 id，加载器据此判定「能否学/弹」并生成补短板清单 */
  skillDeps: string[];
  /** 难度元数据（供曲目列表展示；缺省时可交由 difficulty.rateScore 计算） */
  difficulty?: {
    level: number;
    bpm: number;
    repeat?: number;
    /** 小节数，不是秒 */
    len?: number;
  };
  assets: string[];
  checksum?: string;
  license?: string;
  rights?: PackageRights;
}

export interface ValidationResult {
  ok: boolean;
  errors: string[];
  /** 不阻止加载、但值得作者注意的问题（未知字段、授权过期、无法校验 checksum…）。 */
  warnings: string[];
  manifest?: PackageManifest;
}

export interface ValidateOptions {
  /** 判断授权是否到期的「现在」；默认取当前时间，测试可注入固定值。 */
  now?: Date;
}

const PACKAGE_TYPES: readonly PackageType[] = ["course", "song", "practice"];
const RIGHTS_TYPES: readonly RightsType[] = ["public-domain", "licensed", "original", "user-imported"];
const MAX_ASSETS = 64;
const MAX_ASSET_PATH = 200;
/** 单个资源文本上限（UTF-8 字节）。 */
export const MAX_ASSET_BYTES = 512 * 1024;
/** 包内所有资源合计上限（UTF-8 字节）。 */
export const MAX_TOTAL_BYTES = 4 * 1024 * 1024;
const ID_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;
const SEMVER_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

/** manifest 已知字段；出现未知字段时给警告，帮作者发现拼写错误。 */
const KNOWN_MANIFEST_KEYS = new Set<string>([
  "schemaVersion",
  "id",
  "name",
  "type",
  "version",
  "songId",
  "arrangementId",
  "songTitle",
  "composer",
  "minAppVersion",
  "skillDeps",
  "difficulty",
  "assets",
  "checksum",
  "license",
  "rights",
]);
const KNOWN_DIFFICULTY_KEYS = new Set<string>(["level", "bpm", "repeat", "len"]);
const KNOWN_RIGHTS_KEYS = new Set<string>(["type", "attribution", "territory", "expiresAt"]);

/**
 * 数据包是未信任输入：assets 必须是包内相对 POSIX 路径。
 * 拒绝绝对路径、盘符、反斜杠、`.`/`..` 段，防止 zip-slip / 路径越界。
 */
export function isSafeAssetPath(path: string): boolean {
  if (!path || path.length > MAX_ASSET_PATH) return false;
  if (path.includes("\0") || path.includes("\\")) return false;
  if (path.startsWith("/") || path.startsWith("~") || /^[a-zA-Z]:/.test(path)) return false;
  const segments = path.split("/");
  return segments.every((segment) => segment.length > 0 && segment !== "." && segment !== "..");
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 校验并规范化一个未知的 manifest 原始值（防御坏输入）。 */
export function validateManifest(
  raw: unknown,
  knownSkillIds: Iterable<string>,
  options: ValidateOptions = {},
): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ok: false, errors: ["manifest 必须是 JSON 对象"], warnings };
  }
  const m = raw as Record<string, unknown>;
  for (const key of Object.keys(m)) {
    if (!KNOWN_MANIFEST_KEYS.has(key)) warnings.push(`未知字段已忽略：${key}`);
  }
  const known = new Set(knownSkillIds);
  const str = (key: string): string | null =>
    typeof m[key] === "string" && (m[key] as string).length > 0 ? (m[key] as string) : null;

  if (m.schemaVersion !== 1) {
    errors.push(`不支持的 schemaVersion：${String(m.schemaVersion)}（当前仅支持 1）`);
  }
  const id = str("id");
  const name = str("name");
  const version = str("version");
  if (!id) errors.push("缺少 id（非空字符串）");
  else if (!ID_PATTERN.test(id)) errors.push("id 只能包含小写字母、数字、点、下划线、短横线，且不能以符号开头");
  if (!name) errors.push("缺少 name（非空字符串）");
  if (!version) errors.push("缺少 version（非空字符串）");
  else if (!SEMVER_PATTERN.test(version)) errors.push("version 必须是 semver，例如 1.0.0");

  const songId = str("songId");
  if (m.songId !== undefined && !songId) errors.push("songId 必须是非空字符串");
  else if (songId && !ID_PATTERN.test(songId)) errors.push("songId 格式不合法");
  const arrangementId = str("arrangementId");
  if (m.arrangementId !== undefined && !arrangementId) errors.push("arrangementId 必须是非空字符串");
  else if (arrangementId && !ID_PATTERN.test(arrangementId)) errors.push("arrangementId 格式不合法");
  const minAppVersion = str("minAppVersion");
  if (m.minAppVersion !== undefined && !minAppVersion) errors.push("minAppVersion 必须是非空字符串");
  else if (minAppVersion && !SEMVER_PATTERN.test(minAppVersion)) errors.push("minAppVersion 必须是 semver");
  const songTitle = str("songTitle");
  if (m.songTitle !== undefined && !songTitle) errors.push("songTitle 必须是非空字符串");
  const composer = str("composer");
  if (m.composer !== undefined && !composer) errors.push("composer 必须是非空字符串");

  const type = str("type");
  if (!type || !PACKAGE_TYPES.includes(type as PackageType)) {
    errors.push("type 必须是 course | song | practice");
  }

  const skillDeps: string[] = [];
  if (m.skillDeps !== undefined) {
    if (!Array.isArray(m.skillDeps)) {
      errors.push("skillDeps 必须是字符串数组");
    } else {
      for (const d of m.skillDeps) {
        if (typeof d !== "string") {
          errors.push("skillDeps 含非字符串项");
        } else if (!known.has(d)) {
          errors.push(`skillDeps 引用未知技能：${d}`);
        } else if (!skillDeps.includes(d)) {
          skillDeps.push(d);
        }
      }
    }
  }

  const assets: string[] = [];
  if (m.assets === undefined) {
    errors.push("缺少 assets（至少一个包内资源）");
  } else if (!Array.isArray(m.assets)) {
    errors.push("assets 必须是字符串数组");
  } else {
    if (m.assets.length === 0) errors.push("assets 不能为空");
    if (m.assets.length > MAX_ASSETS) errors.push(`assets 最多 ${MAX_ASSETS} 个`);
    const seen = new Set<string>();
    for (const a of m.assets) {
      if (typeof a !== "string" || a.length === 0) {
        errors.push("assets 含空或非字符串项");
        continue;
      }
      if (!isSafeAssetPath(a)) {
        errors.push(`assets 路径不合法：${a}`);
        continue;
      }
      if (seen.has(a)) {
        errors.push(`assets 重复：${a}`);
        continue;
      }
      seen.add(a);
      assets.push(a);
    }
  }

  let difficulty: PackageManifest["difficulty"];
  if (m.difficulty !== undefined) {
    const d = m.difficulty as Record<string, unknown>;
    if (typeof d !== "object" || d === null || Array.isArray(d)) {
      errors.push("difficulty 必须是对象");
    } else {
      for (const key of Object.keys(d)) {
        if (!KNOWN_DIFFICULTY_KEYS.has(key)) warnings.push(`未知字段已忽略：difficulty.${key}`);
      }
      if (typeof d.level !== "number") errors.push("difficulty.level 必须是数字");
      else if (!Number.isInteger(d.level) || d.level < 1 || d.level > 7) {
        errors.push("difficulty.level 必须是 1..7 的整数（7 = 超纲）");
      }
      if (typeof d.bpm !== "number") errors.push("difficulty.bpm 必须是数字");
      else if (!Number.isFinite(d.bpm) || d.bpm < 20 || d.bpm > 300) {
        errors.push("difficulty.bpm 必须在 20..300");
      }
      if (d.repeat !== undefined) {
        if (typeof d.repeat !== "number" || !Number.isFinite(d.repeat) || d.repeat < 0 || d.repeat > 1) {
          errors.push("difficulty.repeat 必须在 0..1");
        }
      }
      if (d.len !== undefined) {
        if (typeof d.len !== "number" || !Number.isFinite(d.len) || d.len < 0) {
          errors.push("difficulty.len 必须是非负数字（小节数）");
        }
      }
      difficulty = {
        level: typeof d.level === "number" ? d.level : 0,
        bpm: typeof d.bpm === "number" ? d.bpm : 0,
        repeat: typeof d.repeat === "number" ? d.repeat : undefined,
        len: typeof d.len === "number" ? d.len : undefined,
      };
    }
  }

  let checksum: string | undefined;
  if (m.checksum !== undefined) {
    if (typeof m.checksum !== "string") errors.push("checksum 必须是字符串");
    else if (!/^(sha256|sha512):[0-9a-fA-F]+$/.test(m.checksum)) {
      errors.push("checksum 必须是 sha256:<hex> 或 sha512:<hex>");
    } else checksum = m.checksum;
  }
  let license: string | undefined;
  if (m.license !== undefined) {
    if (typeof m.license !== "string") errors.push("license 必须是字符串");
    else license = m.license;
  }

  let rights: PackageRights | undefined;
  if (m.rights !== undefined) {
    if (!isPlainObject(m.rights)) {
      errors.push("rights 必须是对象");
    } else {
      const r = m.rights;
      for (const key of Object.keys(r)) {
        if (!KNOWN_RIGHTS_KEYS.has(key)) warnings.push(`未知字段已忽略：rights.${key}`);
      }
      const typeValue = typeof r.type === "string" ? r.type : "";
      if (!RIGHTS_TYPES.includes(typeValue as RightsType)) {
        errors.push("rights.type 必须是 public-domain | licensed | original | user-imported");
      }
      if (r.attribution !== undefined && typeof r.attribution !== "string") {
        errors.push("rights.attribution 必须是字符串");
      }
      if (r.territory !== undefined && typeof r.territory !== "string") {
        errors.push("rights.territory 必须是字符串");
      }
      if (r.expiresAt !== undefined) {
        if (typeof r.expiresAt !== "string") {
          errors.push("rights.expiresAt 必须是 ISO 日期字符串");
        } else {
          const expiresMs = Date.parse(r.expiresAt);
          if (Number.isNaN(expiresMs)) {
            errors.push("rights.expiresAt 不是合法日期");
          } else if (expiresMs < (options.now ?? new Date()).getTime()) {
            warnings.push(`授权已过期（expiresAt = ${r.expiresAt}），应下架`);
          }
        }
      }
      rights = {
        type: typeValue as RightsType,
        attribution: typeof r.attribution === "string" ? r.attribution : undefined,
        territory: typeof r.territory === "string" ? r.territory : undefined,
        expiresAt: typeof r.expiresAt === "string" ? r.expiresAt : undefined,
      };
    }
  }

  if (errors.length > 0) return { ok: false, errors, warnings };

  return {
    ok: true,
    errors: [],
    warnings,
    manifest: {
      schemaVersion: 1,
      id: id!,
      name: name!,
      type: type as PackageType,
      version: version!,
      songId: songId ?? undefined,
      arrangementId: arrangementId ?? undefined,
      songTitle: songTitle ?? undefined,
      composer: composer ?? undefined,
      minAppVersion: minAppVersion ?? undefined,
      skillDeps,
      difficulty,
      assets,
      checksum,
      license,
      rights,
    },
  };
}

/** 解析 manifest 文本并校验。 */
export function parseManifest(
  jsonText: string,
  knownSkillIds: Iterable<string>,
  options: ValidateOptions = {},
): ValidationResult {
  let raw: unknown;
  try {
    raw = JSON.parse(jsonText);
  } catch (e) {
    return { ok: false, errors: [`JSON 解析失败：${(e as Error).message}`], warnings: [] };
  }
  return validateManifest(raw, knownSkillIds, options);
}

/** 数据包的文件读取抽象（本地目录 / zip / fetch 均可实现）。 */
export interface PackageSource {
  readText(path: string): Promise<string>;
  list(): Promise<string[]>;
}

/** 内存数据源，供测试与纯逻辑层使用。 */
export function memorySource(files: Record<string, string>): PackageSource {
  return {
    async readText(path: string) {
      const content = files[path];
      if (content === undefined) throw new Error(`文件不存在：${path}`);
      return content;
    },
    async list() {
      return Object.keys(files);
    },
  };
}

export interface LoadedPackage {
  manifest: PackageManifest;
  /** 已读取的资源文本（按 manifest.assets 顺序）；checksum 已在 loadPackage 内比对。 */
  files: Record<string, string>;
}

export type LoadResult =
  | { ok: true; pkg: LoadedPackage; warnings: string[] }
  | { ok: false; errors: string[]; warnings: string[] };

/** UTF-8 字节数（TextEncoder 在浏览器与 Node 18+ 都是全局的）。 */
function byteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

const HASH_ALGORITHMS: Record<string, string> = { sha256: "SHA-256", sha512: "SHA-512" };

/**
 * checksum 覆盖范围：按 `assets` 声明顺序拼接「路径\n内容」，资源之间用 \n 分隔。
 * 路径参与拼接，改名或改顺序都会让摘要变化。
 */
export function checksumPayload(
  assets: readonly string[],
  files: Record<string, string>,
): string {
  return assets.map((asset) => `${asset}\n${files[asset] ?? ""}`).join("\n");
}

/** 用 Web Crypto 算摘要；环境不支持时返回 null（调用方降级为警告）。 */
async function digestHex(algorithm: string, text: string): Promise<string | null> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return null;
  const buffer = await subtle.digest(algorithm, new TextEncoder().encode(text));
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** 从数据源加载一个包：读 manifest.json → 校验 → 读取声明的资源 → 比对 checksum。 */
export async function loadPackage(
  source: PackageSource,
  knownSkillIds: Iterable<string>,
  options: ValidateOptions = {},
): Promise<LoadResult> {
  let manifestText: string;
  try {
    manifestText = await source.readText("manifest.json");
  } catch (e) {
    return { ok: false, errors: [`读取 manifest.json 失败：${(e as Error).message}`], warnings: [] };
  }

  const vr = parseManifest(manifestText, knownSkillIds, options);
  if (!vr.ok || !vr.manifest) return { ok: false, errors: vr.errors, warnings: vr.warnings };

  const manifest = vr.manifest;
  const files: Record<string, string> = {};
  const errors: string[] = [];
  const warnings = [...vr.warnings];
  let totalBytes = 0;
  for (const asset of manifest.assets) {
    let text: string;
    try {
      text = await source.readText(asset);
    } catch (e) {
      errors.push(`读取资源失败：${asset}（${(e as Error).message}）`);
      continue;
    }
    const bytes = byteLength(text);
    if (bytes > MAX_ASSET_BYTES) {
      errors.push(`资源超出单文件上限：${asset}（${bytes} > ${MAX_ASSET_BYTES} 字节）`);
      continue;
    }
    totalBytes += bytes;
    if (totalBytes > MAX_TOTAL_BYTES) {
      errors.push(`资源合计超出上限（> ${MAX_TOTAL_BYTES} 字节）`);
      break;
    }
    files[asset] = text;
  }
  if (errors.length > 0) return { ok: false, errors, warnings };

  // checksum：声明了就按约定覆盖范围重算并比对，防止内容被替换。
  if (manifest.checksum) {
    const separator = manifest.checksum.indexOf(":");
    const scheme = manifest.checksum.slice(0, separator);
    const expected = manifest.checksum.slice(separator + 1);
    const algorithm = HASH_ALGORITHMS[scheme];
    if (!algorithm) {
      errors.push(`未知的 checksum 算法：${scheme}`);
    } else {
      const actual = await digestHex(algorithm, checksumPayload(manifest.assets, files));
      if (actual === null) {
        warnings.push("无法校验 checksum（当前环境没有 Web Crypto），已跳过");
      } else if (actual.toLowerCase() !== expected.toLowerCase()) {
        errors.push(`checksum 不匹配（期望 ${expected}，实际 ${actual}）`);
      }
    }
  }
  if (errors.length > 0) return { ok: false, errors, warnings };

  return { ok: true, pkg: { manifest, files }, warnings };
}
