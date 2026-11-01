import { openDB, type IDBPDatabase } from "idb";
import type { InstalledPackage } from "../repertoire/installed";
import type { LoadedPackage } from "../repertoire/package";

/**
 * 外部曲库包的本地安装表。
 *
 * 与档案分库，避免一次包升级/损坏把学习档案一起拖下水；key 用 manifest.id，
 * 同一包重复安装就是覆盖升级。包内容在写入前已经过 `loadPackageBundle`
 * 校验，这里只负责持久化，不再执行任何内容。
 */

const DB_NAME = "piano-buddy-packages";
const DB_VERSION = 1;
const STORE_NAME = "packages";

type PackageDB = {
  packages: {
    key: string;
    value: InstalledPackage;
  };
};

let dbPromise: Promise<IDBPDatabase<PackageDB>> | null = null;

function getDb(): Promise<IDBPDatabase<PackageDB>> {
  if (!dbPromise) {
    dbPromise = openDB<PackageDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME);
        }
      },
    });
  }
  return dbPromise;
}

export async function loadInstalledPackages(): Promise<InstalledPackage[]> {
  const db = await getDb();
  const packages = await db.getAll(STORE_NAME);
  return packages.sort(
    (a, b) => b.installedAt - a.installedAt || a.manifest.id.localeCompare(b.manifest.id),
  );
}

export async function saveInstalledPackage(
  pkg: LoadedPackage,
  installedAt = Date.now(),
): Promise<InstalledPackage> {
  const db = await getDb();
  const record: InstalledPackage = { ...pkg, installedAt };
  await db.put(STORE_NAME, record, pkg.manifest.id);
  return record;
}

export async function removeInstalledPackage(packageId: string): Promise<void> {
  const db = await getDb();
  await db.delete(STORE_NAME, packageId);
}

/** 测试与「清空外部包」用；正常卸载请按 id 删除。 */
export async function clearInstalledPackages(): Promise<void> {
  const db = await getDb();
  await db.clear(STORE_NAME);
}
