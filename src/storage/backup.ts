import { mergeProfile, type Profile } from "../domain/profile";
import { APP_VERSION } from "../version";

/**
 * 本地学习档案备份。
 *
 * 只导出 `Profile`，不导出 IndexedDB 里的外部曲库包：包可以重新导入，
 * 学习档案才是不可再生的。导入时先校验信封，再用 `mergeProfile` 补齐旧版本
 * 缺的字段；任何不认识的 JSON 都不能直接覆盖当前档案。
 */

export const BACKUP_SCHEMA_VERSION = 1;

export interface ProfileBackup {
  app: "piano-buddy";
  schemaVersion: number;
  appVersion: string;
  exportedAt: string;
  profile: Profile;
}

export type ProfileBackupResult =
  | { ok: true; profile: Profile }
  | { ok: false; errors: string[] };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function exportProfileBackup(profile: Profile, at = new Date()): string {
  const payload: ProfileBackup = {
    app: "piano-buddy",
    schemaVersion: BACKUP_SCHEMA_VERSION,
    appVersion: APP_VERSION,
    exportedAt: at.toISOString(),
    profile,
  };
  return JSON.stringify(payload, null, 2);
}

export function parseProfileBackup(text: string): ProfileBackupResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    return { ok: false, errors: [`JSON 解析失败：${(error as Error).message}`] };
  }
  if (!isPlainObject(raw)) {
    return { ok: false, errors: ["档案文件必须是 JSON 对象"] };
  }
  if (raw.app !== "piano-buddy") {
    return { ok: false, errors: ["不是 Piano Buddy 的学习档案"] };
  }
  if (raw.schemaVersion !== BACKUP_SCHEMA_VERSION) {
    return {
      ok: false,
      errors: [`不支持的档案版本：${String(raw.schemaVersion)}（当前支持 ${BACKUP_SCHEMA_VERSION}）`],
    };
  }
  if (!isPlainObject(raw.profile)) {
    return { ok: false, errors: ["档案缺少 profile 对象"] };
  }
  // 三个基础字段能挡住「随便一个 JSON 对象」；旧档案缺新字段仍由 mergeProfile 补齐。
  if (
    !("assessment" in raw.profile)
    || !("lessonId" in raw.profile)
    || !("practiceLog" in raw.profile)
  ) {
    return { ok: false, errors: ["profile 不是完整的学习档案"] };
  }
  return { ok: true, profile: mergeProfile(raw.profile as Partial<Profile>) };
}

export function backupFilename(at = new Date()): string {
  const year = at.getFullYear();
  const month = String(at.getMonth() + 1).padStart(2, "0");
  const day = String(at.getDate()).padStart(2, "0");
  return `piano-buddy-backup-${year}-${month}-${day}.json`;
}
