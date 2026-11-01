import { APP_VERSION } from "../version";
import {
  loadPackage,
  memorySource,
  type LoadResult,
  type PackageManifest,
  type ValidateOptions,
} from "./package";
import { knownSkillIds } from "./skillGraph";

/**
 * ── 单文件曲库包 ─────────────────────────────────────────────
 * 浏览器不能直接读目录，所以外部包用一个 JSON 文件交换：
 *
 * {
 *   "manifest": { ...与 manifest.json 相同... },
 *   "files": { "content/score.json": "<score.json 文本>" }
 * }
 *
 * 解析时仍然走 `loadPackage` 的同一套未信任输入校验：manifest、资源路径、
 * 大小、checksum 都不放过。`minAppVersion` 在这里硬校验——旧 App 读到新包
 * 不能只给一句提示然后继续加载，否则会在运行期遇到不认识的字段/谱面。
 */

export interface PackageBundleOptions extends ValidateOptions {
  /** 当前 App 版本；测试可注入固定值。 */
  appVersion?: string;
  /** 已知技能 id；默认取技能图谱。 */
  knownSkillIds?: Iterable<string>;
}

type Semver = {
  core: [number, number, number];
  prerelease: string | null;
};

export function parseSemver(value: string): Semver | null {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(value);
  if (!match) return null;
  return {
    core: [Number(match[1]), Number(match[2]), Number(match[3])],
    prerelease: match[4] ?? null,
  };
}

/** semver 预发布段比较：数字段按数值，数字段低于字母段，其余按 ASCII。 */
function comparePrerelease(left: string, right: string): number {
  const a = left.split(".");
  const b = right.split(".");
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const l = a[index];
    const r = b[index];
    if (l === undefined) return -1;
    if (r === undefined) return 1;
    const lNumeric = /^\d+$/.test(l);
    const rNumeric = /^\d+$/.test(r);
    if (lNumeric && rNumeric) {
      const diff = Number(l) - Number(r);
      if (diff !== 0) return diff;
    } else if (lNumeric) {
      return -1;
    } else if (rNumeric) {
      return 1;
    } else if (l !== r) {
      return l < r ? -1 : 1;
    }
  }
  return 0;
}

/** 比较 semver：a < b 返回负数，a > b 返回正数，相等返回 0。 */
export function compareSemver(a: string, b: string): number {
  const left = parseSemver(a);
  const right = parseSemver(b);
  if (!left || !right) return 0;
  for (let index = 0; index < 3; index += 1) {
    const diff = left.core[index]! - right.core[index]!;
    if (diff !== 0) return diff;
  }
  if (left.prerelease === right.prerelease) return 0;
  if (left.prerelease === null) return 1;
  if (right.prerelease === null) return -1;
  return comparePrerelease(left.prerelease, right.prerelease);
}

/** 当前 App 是否满足包的最低版本要求。 */
export function satisfiesMinAppVersion(
  manifest: Pick<PackageManifest, "minAppVersion">,
  appVersion = APP_VERSION,
): boolean {
  const min = manifest.minAppVersion;
  if (!min) return true;
  if (!parseSemver(min) || !parseSemver(appVersion)) return false;
  return compareSemver(appVersion, min) >= 0;
}

export function minAppVersionError(
  manifest: Pick<PackageManifest, "minAppVersion">,
  appVersion = APP_VERSION,
): string | null {
  if (satisfiesMinAppVersion(manifest, appVersion)) return null;
  return `包需要 App ${manifest.minAppVersion} 或更高，当前是 ${appVersion}`;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * 解析并校验一个单文件包。
 *
 * `files` 只接受字符串值；manifest 本身再走 `loadPackage`，所以不会因为
 * bundle 外壳看起来合法就跳过内部校验。返回的 `pkg.files` 只含 manifest
 * 声明的资源，额外文件不会进入运行时。
 */
export async function loadPackageBundle(
  text: string,
  options: PackageBundleOptions = {},
): Promise<LoadResult> {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    return { ok: false, errors: [`JSON 解析失败：${(error as Error).message}`], warnings: [] };
  }
  if (!isPlainObject(raw)) {
    return { ok: false, errors: ["包文件必须是 JSON 对象"], warnings: [] };
  }
  if (!isPlainObject(raw.manifest)) {
    return { ok: false, errors: ["包文件缺少 manifest 对象"], warnings: [] };
  }
  if (!isPlainObject(raw.files)) {
    return { ok: false, errors: ["包文件缺少 files 对象"], warnings: [] };
  }

  const files: Record<string, string> = {};
  for (const [path, value] of Object.entries(raw.files)) {
    if (typeof value !== "string") {
      return { ok: false, errors: [`资源内容必须是字符串：${path}`], warnings: [] };
    }
    files[path] = value;
  }

  const source = memorySource({
    ...files,
    "manifest.json": JSON.stringify(raw.manifest),
  });
  const result = await loadPackage(
    source,
    options.knownSkillIds ?? knownSkillIds(),
    options,
  );
  if (!result.ok) return result;

  const versionError = minAppVersionError(result.pkg.manifest, options.appVersion);
  if (versionError) {
    return { ok: false, errors: [versionError], warnings: result.warnings };
  }
  return result;
}
