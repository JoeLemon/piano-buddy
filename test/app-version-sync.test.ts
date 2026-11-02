import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { checkAppVersion, parseVersion, syncAppVersion } from "../scripts/lib/app-version";

const root = resolve(__dirname, "..");
const SRC_VERSION = "src/version.ts";
const GRADLE = "android/app/build.gradle";
const PBXPROJ = "ios/App/App.xcodeproj/project.pbxproj";

const gradleFixture = `apply plugin: 'com.android.application'
android {
    defaultConfig {
        versionCode 1
        versionName "1.0"
    }
    buildTypes {
        release {
            minifyEnabled false
        }
    }
}
`;

const pbxprojFixture = `objects = {
  BuildConfiguration = {
    isa = XCBuildConfiguration;
    buildSettings = {
      CURRENT_PROJECT_VERSION = 1;
      MARKETING_VERSION = 1.0;
    };
  };
};
`;

function makeTempProject(version: string): string {
  const dir = mkdtempSync(join(tmpdir(), "pb-version-"));
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "piano-buddy", version }, null, 2));
  mkdirSync(join(dir, "src"), { recursive: true });
  writeFileSync(join(dir, SRC_VERSION), `export const APP_VERSION = "0.0.0";\n`);
  mkdirSync(join(dir, "android/app"), { recursive: true });
  writeFileSync(join(dir, GRADLE), gradleFixture);
  mkdirSync(join(dir, "ios/App/App.xcodeproj"), { recursive: true });
  writeFileSync(join(dir, PBXPROJ), pbxprojFixture);
  return dir;
}

const temps: string[] = [];
afterAll(() => {
  for (const dir of temps) rmSync(dir, { recursive: true, force: true });
});

describe("版本号解析", () => {
  it("semver 折算成单调递增的 versionCode", () => {
    expect(parseVersion("2.0.0")).toEqual({ major: 2, minor: 0, patch: 0, versionCode: 20000 });
    expect(parseVersion("2.0.1").versionCode).toBe(20001);
    expect(parseVersion("2.1.0").versionCode).toBe(20100);
    expect(parseVersion("10.3.7").versionCode).toBe(100307);
  });

  it("非三段版本号直接报错，不猜", () => {
    expect(() => parseVersion("2.0")).toThrow(/major\.minor\.patch/);
    expect(() => parseVersion("v2.0.0")).toThrow();
  });
});

describe("同步进 web 与原生工程", () => {
  it("web / Android / iOS 都写成 package.json 的版本", () => {
    const dir = makeTempProject("2.0.0");
    temps.push(dir);
    const result = syncAppVersion(dir);

    expect(result).toEqual({
      version: "2.0.0",
      versionCode: 20000,
      webUnchanged: false,
      androidUnchanged: false,
      iosUnchanged: false,
    });
    expect(readFileSync(join(dir, SRC_VERSION), "utf8")).toContain('APP_VERSION = "2.0.0"');
    const gradle = readFileSync(join(dir, GRADLE), "utf8");
    expect(gradle).toMatch(/versionCode 20000/);
    expect(gradle).toMatch(/versionName "2\.0\.0"/);
    const pbxproj = readFileSync(join(dir, PBXPROJ), "utf8");
    expect(pbxproj).toMatch(/MARKETING_VERSION = 2\.0\.0;/);
    expect(pbxproj).toMatch(/CURRENT_PROJECT_VERSION = 20000;/);
  });

  it("幂等：同步第二次不再改文件", () => {
    const dir = makeTempProject("2.0.0");
    temps.push(dir);
    syncAppVersion(dir);
    const webAfterFirst = readFileSync(join(dir, SRC_VERSION), "utf8");
    const gradleAfterFirst = readFileSync(join(dir, GRADLE), "utf8");
    const pbxprojAfterFirst = readFileSync(join(dir, PBXPROJ), "utf8");

    const second = syncAppVersion(dir);

    expect(second.webUnchanged).toBe(true);
    expect(second.androidUnchanged).toBe(true);
    expect(second.iosUnchanged).toBe(true);
    expect(readFileSync(join(dir, SRC_VERSION), "utf8")).toBe(webAfterFirst);
    expect(readFileSync(join(dir, GRADLE), "utf8")).toBe(gradleAfterFirst);
    expect(readFileSync(join(dir, PBXPROJ), "utf8")).toBe(pbxprojAfterFirst);
  });

  it("只改版本字段，buildTypes 等其他内容原样保留", () => {
    const dir = makeTempProject("3.1.4");
    temps.push(dir);
    syncAppVersion(dir);
    const gradle = readFileSync(join(dir, GRADLE), "utf8");
    expect(gradle).toContain("minifyEnabled false");
    expect(gradle).toContain("apply plugin: 'com.android.application'");
    expect(readFileSync(join(dir, SRC_VERSION), "utf8")).toContain('APP_VERSION = "3.1.4"');
  });

  it("缺原生工程时报错，提示先 cap add", () => {
    const dir = mkdtempSync(join(tmpdir(), "pb-version-empty-"));
    temps.push(dir);
    writeFileSync(join(dir, "package.json"), JSON.stringify({ version: "2.0.0" }));
    mkdirSync(join(dir, "src"), { recursive: true });
    writeFileSync(join(dir, SRC_VERSION), `export const APP_VERSION = "0.0.0";\n`);
    expect(() => syncAppVersion(dir)).toThrow(/cap add/);
  });
});

describe("checkAppVersion（CI 用）", () => {
  it("已同步时返回 true", () => {
    const dir = makeTempProject("2.0.0");
    temps.push(dir);
    syncAppVersion(dir);
    expect(checkAppVersion(dir).ok).toBe(true);
  });

  it("漂移时返回 false，但不写文件", () => {
    const dir = makeTempProject("2.0.0");
    temps.push(dir);
    const before = readFileSync(join(dir, GRADLE), "utf8");
    const result = checkAppVersion(dir);
    expect(result.ok).toBe(false);
    expect(result.problems.join(" ")).toMatch(/src\/version\.ts/);
    expect(result.problems.join(" ")).toMatch(/Android/);
    expect(readFileSync(join(dir, GRADLE), "utf8")).toBe(before);
  });

  it("只漂移 web 常量时也能被发现", () => {
    const dir = makeTempProject("2.0.0");
    temps.push(dir);
    syncAppVersion(dir);
    writeFileSync(join(dir, SRC_VERSION), `export const APP_VERSION = "1.9.9";\n`);

    const result = checkAppVersion(dir);
    expect(result.ok).toBe(false);
    expect(result.problems.join(" ")).toMatch(/APP_VERSION=1\.9\.9/);
  });
});

describe("仓库当前状态", () => {
  it("三端版本号一致（web / Android / iOS）", () => {
    expect(checkAppVersion(root).ok).toBe(true);
  });
});
