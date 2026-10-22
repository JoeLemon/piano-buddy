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
  manifest?: PackageManifest;
}

const PACKAGE_TYPES: readonly PackageType[] = ["course", "song", "practice"];
const RIGHTS_TYPES: readonly RightsType[] = ["public-domain", "licensed", "original", "user-imported"];
const MAX_ASSETS = 64;
const MAX_ASSET_PATH = 200;
const ID_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;
const SEMVER_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

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
export function validateManifest(raw: unknown, knownSkillIds: Iterable<string>): ValidationResult {
  const errors: string[] = [];
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ok: false, errors: ["manifest 必须是 JSON 对象"] };
  }
  const m = raw as Record<string, unknown>;
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
      if (r.expiresAt !== undefined && typeof r.expiresAt !== "string") {
        errors.push("rights.expiresAt 必须是 ISO 日期字符串");
      }
      rights = {
        type: typeValue as RightsType,
        attribution: typeof r.attribution === "string" ? r.attribution : undefined,
        territory: typeof r.territory === "string" ? r.territory : undefined,
        expiresAt: typeof r.expiresAt === "string" ? r.expiresAt : undefined,
      };
    }
  }

  if (errors.length > 0) return { ok: false, errors };

  return {
    ok: true,
    errors: [],
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
export function parseManifest(jsonText: string, knownSkillIds: Iterable<string>): ValidationResult {
  let raw: unknown;
  try {
    raw = JSON.parse(jsonText);
  } catch (e) {
    return { ok: false, errors: [`JSON 解析失败：${(e as Error).message}`] };
  }
  return validateManifest(raw, knownSkillIds);
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
  /** 已读取的资源文本（P0 只读文本内容；checksum 校验留待接入真实 IO 时补） */
  files: Record<string, string>;
}

export type LoadResult = { ok: true; pkg: LoadedPackage } | { ok: false; errors: string[] };

/** 从数据源加载一个包：读 manifest.json → 校验 → 读取声明的资源。 */
export async function loadPackage(
  source: PackageSource,
  knownSkillIds: Iterable<string>,
): Promise<LoadResult> {
  let manifestText: string;
  try {
    manifestText = await source.readText("manifest.json");
  } catch (e) {
    return { ok: false, errors: [`读取 manifest.json 失败：${(e as Error).message}`] };
  }

  const vr = parseManifest(manifestText, knownSkillIds);
  if (!vr.ok || !vr.manifest) return { ok: false, errors: vr.errors };

  const files: Record<string, string> = {};
  const errors: string[] = [];
  for (const asset of vr.manifest.assets) {
    try {
      files[asset] = await source.readText(asset);
    } catch (e) {
      errors.push(`读取资源失败：${asset}（${(e as Error).message}）`);
    }
  }
  if (errors.length > 0) return { ok: false, errors };

  return { ok: true, pkg: { manifest: vr.manifest, files } };
}
