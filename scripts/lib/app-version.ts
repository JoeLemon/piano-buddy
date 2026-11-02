/**
 * 把 `package.json` 的版本号同步进 web 常量与 Android / iOS 两个原生工程。
 *
 * 为什么要脚本而不是手改：web 发版一次只动 package.json，但 `src/version.ts`
 * 的 `APP_VERSION` 和原生工程里的 `versionName` / `versionCode` /
 * `MARKETING_VERSION` / `CURRENT_PROJECT_VERSION` 都是独立字面量；漏改任何一个，
 * 用户拿到的 App 版本号或 `minAppVersion` 校验就会和 web 版对不上，反馈 bug 时
 * 连「装的是哪一版」都问不清楚。
 *
 * versionCode 用 semver 折算：major*10000 + minor*100 + patch。
 * 2.0.0 → 20000，2.0.1 → 20001，2.1.0 → 20100。Google Play 只要求它单调递增，
 * 这样既能从版本号反推构建号，也不会像「每次 +1」那样在 git 历史里留下无意义 diff。
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
/** 仓库根：本文件在 scripts/lib/ 下。 */
export const projectRoot = resolve(here, "..", "..");

export const SRC_VERSION = "src/version.ts";
export const ANDROID_GRADLE = "android/app/build.gradle";
export const IOS_PBXPROJ = "ios/App/App.xcodeproj/project.pbxproj";

export type ParsedVersion = { major: number; minor: number; patch: number; versionCode: number };
export type NativeVersion = { versionName: string; versionCode: number };

/** "2.0.0" → { major: 2, minor: 0, patch: 0, versionCode: 20000 } */
export function parseVersion(raw: string): ParsedVersion {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(raw).trim());
  if (!match) throw new Error(`无法解析版本号 "${raw}"（期望 major.minor.patch）`);
  const [, major, minor, patch] = match.map(Number);
  return { major, minor, patch, versionCode: major * 10000 + minor * 100 + patch };
}

export function versionString(parsed: ParsedVersion): string {
  return `${parsed.major}.${parsed.minor}.${parsed.patch}`;
}

/**
 * 按 pattern 替换。pattern 匹配不到才抛错——不能拿「替换后没变化」判断，
 * 否则第二次同步（值本来就对）会被误判成没找到。
 */
function replaceOnce(text: string, pattern: RegExp, replacement: string, label: string): string {
  if (!pattern.test(text)) throw new Error(`在 ${label} 里没找到可替换的 ${pattern}`);
  return text.replace(pattern, replacement);
}

/** Web：`src/version.ts` 的 `APP_VERSION`。 */
export function syncWeb(root: string, version: ParsedVersion): boolean {
  const path = resolve(root, SRC_VERSION);
  if (!existsSync(path)) throw new Error(`缺少 ${SRC_VERSION}`);
  const before = readFileSync(path, "utf8");
  const after = replaceOnce(
    before,
    /export const APP_VERSION = ["'][^"']*["']/,
    `export const APP_VERSION = "${versionString(version)}"`,
    SRC_VERSION,
  );
  if (after !== before) writeFileSync(path, after, "utf8");
  return after === before;
}

/** Android：`versionCode 1` / `versionName "1.0"`（cap add 生成的模板值）。 */
export function syncAndroid(root: string, version: ParsedVersion): boolean {
  const path = resolve(root, ANDROID_GRADLE);
  if (!existsSync(path)) throw new Error(`缺少 ${ANDROID_GRADLE}（先 npx cap add android）`);
  const before = readFileSync(path, "utf8");
  let after = replaceOnce(before, /versionCode\s+\d+/, `versionCode ${version.versionCode}`, ANDROID_GRADLE);
  after = replaceOnce(after, /versionName\s+["'][^"']*["']/, `versionName "${versionString(version)}"`, ANDROID_GRADLE);
  if (after !== before) writeFileSync(path, after, "utf8");
  return after === before;
}

/**
 * iOS：Xcode 工程里三套构建配置（Debug/Release/Profile）各有一份
 * `MARKETING_VERSION`（给用户看的版本）与 `CURRENT_PROJECT_VERSION`（构建号），
 * 漏改任一配置都会出现「Archive 出来还是旧版本号」。
 */
export function syncIos(root: string, version: ParsedVersion): boolean {
  const path = resolve(root, IOS_PBXPROJ);
  if (!existsSync(path)) throw new Error(`缺少 ${IOS_PBXPROJ}（先 npx cap add ios）`);
  const before = readFileSync(path, "utf8");
  if (!/MARKETING_VERSION = /.test(before) || !/CURRENT_PROJECT_VERSION = /.test(before)) {
    throw new Error(`${IOS_PBXPROJ} 里没有 MARKETING_VERSION / CURRENT_PROJECT_VERSION`);
  }
  let after = before.replace(/MARKETING_VERSION = [^;]+;/g, `MARKETING_VERSION = ${versionString(version)};`);
  after = after.replace(/CURRENT_PROJECT_VERSION = [^;]+;/g, `CURRENT_PROJECT_VERSION = ${version.versionCode};`);
  if (after !== before) writeFileSync(path, after, "utf8");
  return after === before;
}

/** 只读：原生工程里现在写的版本号。工程缺失时对应项为 null。 */
export function readNativeVersions(root: string = projectRoot): { android: NativeVersion | null; ios: NativeVersion | null } {
  const androidPath = resolve(root, ANDROID_GRADLE);
  const iosPath = resolve(root, IOS_PBXPROJ);
  const android = existsSync(androidPath)
    ? (() => {
        const text = readFileSync(androidPath, "utf8");
        const name = /versionName\s+["']([^"']+)["']/.exec(text);
        const code = /versionCode\s+(\d+)/.exec(text);
        return name && code ? { versionName: name[1], versionCode: Number(code[1]) } : null;
      })()
    : null;
  const ios = existsSync(iosPath)
    ? (() => {
        const text = readFileSync(iosPath, "utf8");
        const marketing = /MARKETING_VERSION = ([^;]+);/.exec(text);
        const current = /CURRENT_PROJECT_VERSION = ([^;]+);/.exec(text);
        return marketing && current ? { versionName: marketing[1].trim(), versionCode: Number(current[1]) } : null;
      })()
    : null;
  return { android, ios };
}

/** package.json 的版本（唯一事实源）。 */
export function webVersion(root: string = projectRoot): ParsedVersion {
  const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
  return parseVersion(pkg.version);
}

/** 只读：`src/version.ts` 里现在写的 APP_VERSION；文件或常量缺失时为 null。 */
export function readWebVersion(root: string = projectRoot): string | null {
  const path = resolve(root, SRC_VERSION);
  if (!existsSync(path)) return null;
  const match = /export const APP_VERSION = ["']([^"']+)["']/.exec(readFileSync(path, "utf8"));
  return match?.[1] ?? null;
}

/**
 * 同步一次。unchanged = 那个平台本来就一致、没有写入。
 * 原生工程目录不存在时抛错——那说明还没 `cap add`，不是版本号的问题。
 */
export function syncAppVersion(root: string = projectRoot): {
  version: string;
  versionCode: number;
  webUnchanged: boolean;
  androidUnchanged: boolean;
  iosUnchanged: boolean;
} {
  const parsed = webVersion(root);
  return {
    version: versionString(parsed),
    versionCode: parsed.versionCode,
    webUnchanged: syncWeb(root, parsed),
    androidUnchanged: syncAndroid(root, parsed),
    iosUnchanged: syncIos(root, parsed),
  };
}

/** 只读校验（CI 用）：任一平台与 web 不一致就 ok=false，不写任何文件。 */
export function checkAppVersion(root: string = projectRoot): { ok: boolean; problems: string[]; version: string } {
  const parsed = webVersion(root);
  const expected = versionString(parsed);
  const { android, ios } = readNativeVersions(root);
  const problems: string[] = [];
  const web = readWebVersion(root);
  if (web !== expected) {
    problems.push(`src/version.ts APP_VERSION=${web ?? "缺失"}`);
  }
  if (android && (android.versionName !== expected || android.versionCode !== parsed.versionCode)) {
    problems.push(`Android versionName=${android.versionName} versionCode=${android.versionCode}`);
  }
  if (ios && (ios.versionName !== expected || ios.versionCode !== parsed.versionCode)) {
    problems.push(`iOS MARKETING_VERSION=${ios.versionName} CURRENT_PROJECT_VERSION=${ios.versionCode}`);
  }
  return { ok: problems.length === 0, problems, version: expected };
}
