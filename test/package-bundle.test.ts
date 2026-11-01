import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  compareSemver,
  loadPackageBundle,
  minAppVersionError,
  parseSemver,
  satisfiesMinAppVersion,
} from "../src/repertoire";
import { APP_VERSION } from "../src/version";

const packageDir = resolve("content/song.ode-to-joy.l2");
const manifest = JSON.parse(
  readFileSync(resolve(packageDir, "manifest.json"), "utf8"),
) as Record<string, unknown>;
const scoreText = readFileSync(resolve(packageDir, "content/score.json"), "utf8");

function bundle(
  manifestOverrides: Record<string, unknown> = {},
  files: Record<string, unknown> = { "content/score.json": scoreText },
): string {
  return JSON.stringify({
    manifest: { ...manifest, ...manifestOverrides },
    files,
  });
}

describe("semver 比较", () => {
  it("解析标准三段版本与预发布标记", () => {
    expect(parseSemver("2.0.0")).toEqual({ core: [2, 0, 0], prerelease: null });
    expect(parseSemver("1.12.3-beta.2")?.prerelease).toBe("beta.2");
    expect(parseSemver("2.0")).toBeNull();
    expect(parseSemver("v2.0.0")).toBeNull();
    expect(parseSemver("2.0.0.1")).toBeNull();
  });

  it("按主次修订号比较，预发布版本低于正式版", () => {
    expect(compareSemver("2.0.0", "2.0.0")).toBe(0);
    expect(compareSemver("2.0.1", "2.0.0")).toBeGreaterThan(0);
    expect(compareSemver("1.9.9", "2.0.0")).toBeLessThan(0);
    expect(compareSemver("2.0.0-beta", "2.0.0")).toBeLessThan(0);
    expect(compareSemver("2.0.0-alpha", "2.0.0-beta")).toBeLessThan(0);
    expect(compareSemver("2.0.0-beta.2", "2.0.0-beta.10")).toBeLessThan(0);
    expect(compareSemver("2.0.0-alpha.1", "2.0.0-alpha.beta")).toBeLessThan(0);
    // 无法解析时保持稳定，不抛异常。
    expect(compareSemver("nope", "2.0.0")).toBe(0);
  });
});

describe("minAppVersion 硬校验", () => {
  it("APP_VERSION 与 package.json 保持一致", () => {
    const pkg = JSON.parse(readFileSync(resolve("package.json"), "utf8")) as { version: string };
    expect(APP_VERSION).toBe(pkg.version);
  });

  it("未声明最低版本时任何 App 都能装", () => {
    expect(satisfiesMinAppVersion({}, "0.0.1")).toBe(true);
    expect(minAppVersionError({}, "0.0.1")).toBeNull();
  });

  it("当前版本高于或等于要求时通过", () => {
    expect(satisfiesMinAppVersion({ minAppVersion: "2.0.0" }, "2.0.0")).toBe(true);
    expect(satisfiesMinAppVersion({ minAppVersion: "2.0.0" }, "2.1.0")).toBe(true);
    expect(satisfiesMinAppVersion({ minAppVersion: "2.0.0" }, "2.0.0-beta")).toBe(false);
  });

  it("版本不够或版本号非法时给出可读错误", () => {
    expect(satisfiesMinAppVersion({ minAppVersion: "2.1.0" }, "2.0.0")).toBe(false);
    const error = minAppVersionError({ minAppVersion: "2.1.0" }, "2.0.0");
    expect(error).toContain("2.1.0");
    expect(error).toContain("2.0.0");

    // 包声明了版本要求、App 版本却读不出来：不能放行。
    expect(satisfiesMinAppVersion({ minAppVersion: "2.0.0" }, "dev")).toBe(false);
  });
});

describe("单文件曲库包", () => {
  it("能导入内置包导出的 bundle，并且只保留 manifest 声明的资源", async () => {
    const result = await loadPackageBundle(
      bundle({}, { "content/score.json": scoreText, "content/extra.json": "{}" }),
      { appVersion: APP_VERSION },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.pkg.manifest.id).toBe("pkg.ode-to-joy.simple");
    expect(result.pkg.files["content/score.json"]).toBe(scoreText);
    // 额外文件不在 assets 里，不进入运行时。
    expect(result.pkg.files["content/extra.json"]).toBeUndefined();
  });

  it("JSON 坏掉、缺少外壳字段或资源不是字符串时直接拒绝", async () => {
    const broken = await loadPackageBundle("{ not json", { appVersion: APP_VERSION });
    expect(broken.ok).toBe(false);
    if (!broken.ok) expect(broken.errors[0]).toContain("JSON 解析失败");

    const noManifest = await loadPackageBundle(
      JSON.stringify({ files: { "content/score.json": scoreText } }),
      { appVersion: APP_VERSION },
    );
    expect(noManifest.ok).toBe(false);
    if (!noManifest.ok) expect(noManifest.errors).toContain("包文件缺少 manifest 对象");

    const noFiles = await loadPackageBundle(JSON.stringify({ manifest }), {
      appVersion: APP_VERSION,
    });
    expect(noFiles.ok).toBe(false);
    if (!noFiles.ok) expect(noFiles.errors).toContain("包文件缺少 files 对象");

    const wrongType = await loadPackageBundle(
      bundle({}, { "content/score.json": 42 }),
      { appVersion: APP_VERSION },
    );
    expect(wrongType.ok).toBe(false);
    if (!wrongType.ok) {
      expect(wrongType.errors.some((text) => text.includes("资源内容必须是字符串"))).toBe(true);
    }
  });

  it("内部 manifest 仍然走完整校验，不会因为套了外壳就跳过", async () => {
    // 资源路径越界：bundle 外壳看起来合法，内部也要被 loadPackage 拦下。
    const result = await loadPackageBundle(
      bundle({ assets: ["../outside.json"] }, { "../outside.json": scoreText }),
      { appVersion: APP_VERSION },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((text) => text.includes("路径不合法"))).toBe(true);
    }
  });

  it("要求更高 App 版本的包被拒绝安装", async () => {
    const result = await loadPackageBundle(bundle({ minAppVersion: "9.9.9" }), {
      appVersion: APP_VERSION,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((text) => text.includes("9.9.9") && text.includes(APP_VERSION))).toBe(
        true,
      );
    }
  });

  it("App 版本满足要求时正常安装", async () => {
    const result = await loadPackageBundle(
      bundle({ minAppVersion: APP_VERSION }),
      { appVersion: APP_VERSION },
    );
    expect(result.ok).toBe(true);
  });
});
