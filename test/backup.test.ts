import { describe, expect, it } from "vitest";
import { initialProfile } from "../src/domain/profile";
import {
  backupFilename,
  exportProfileBackup,
  parseProfileBackup,
} from "../src/storage/backup";
import { APP_VERSION } from "../src/version";

const AT = new Date(2026, 9, 20, 12, 0, 0);

describe("学习档案备份", () => {
  it("导出带信封的档案，并能原样导入", () => {
    const profile = {
      ...initialProfile(),
      l1RightPassed: true,
      practiceLog: [{ at: AT.getTime(), kind: "reading" as const, ms: 60_000 }],
    };
    const text = exportProfileBackup(profile, AT);
    const raw = JSON.parse(text) as Record<string, unknown>;

    expect(raw.app).toBe("piano-buddy");
    expect(raw.schemaVersion).toBe(1);
    expect(raw.appVersion).toBe(APP_VERSION);
    expect(raw.exportedAt).toBe(AT.toISOString());
    expect(raw.profile).toMatchObject({ l1RightPassed: true });

    const result = parseProfileBackup(text);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.profile.l1RightPassed).toBe(true);
      expect(result.profile.practiceLog).toHaveLength(1);
    }
  });

  it("拒绝坏 JSON、别的 App、未来版本和空 profile", () => {
    const broken = parseProfileBackup("{ not json");
    expect(broken.ok).toBe(false);
    if (!broken.ok) expect(broken.errors[0]).toContain("JSON 解析失败");

    const otherApp = parseProfileBackup(JSON.stringify({ app: "other", schemaVersion: 1 }));
    expect(otherApp.ok).toBe(false);
    if (!otherApp.ok) expect(otherApp.errors).toContain("不是 Piano Buddy 的学习档案");

    const future = parseProfileBackup(
      JSON.stringify({ app: "piano-buddy", schemaVersion: 99, profile: initialProfile() }),
    );
    expect(future.ok).toBe(false);
    if (!future.ok) expect(future.errors[0]).toContain("不支持的档案版本");

    const noProfile = parseProfileBackup(JSON.stringify({ app: "piano-buddy", schemaVersion: 1 }));
    expect(noProfile.ok).toBe(false);
    if (!noProfile.ok) expect(noProfile.errors).toContain("档案缺少 profile 对象");

    const randomProfile = parseProfileBackup(
      JSON.stringify({ app: "piano-buddy", schemaVersion: 1, profile: { hello: "world" } }),
    );
    expect(randomProfile.ok).toBe(false);
    if (!randomProfile.ok) expect(randomProfile.errors).toContain("profile 不是完整的学习档案");
  });

  it("旧档案缺新字段时由 mergeProfile 补齐", () => {
    const result = parseProfileBackup(
      JSON.stringify({
        app: "piano-buddy",
        schemaVersion: 1,
        profile: { assessment: null, lessonId: "L1-1", practiceLog: [] },
      }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.profile.assessment).toBeNull();
      expect(result.profile.lessonId).toBe("L1-1");
      expect(result.profile.skillLedger).toEqual({});
      expect(result.profile.repertoireAssessments).toEqual({});
    }
  });

  it("用本地日期生成文件名", () => {
    expect(backupFilename(AT)).toBe("piano-buddy-backup-2026-10-20.json");
  });
});
