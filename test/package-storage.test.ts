import { beforeEach, describe, expect, it } from "vitest";
import type { LoadedPackage } from "../src/repertoire/package";
import {
  clearInstalledPackages,
  loadInstalledPackages,
  removeInstalledPackage,
  saveInstalledPackage,
} from "../src/storage/packages";

function pkg(id: string, version = "1.0.0"): LoadedPackage {
  return {
    manifest: {
      schemaVersion: 1,
      id,
      name: `测试包 ${id}`,
      type: "song",
      version,
      songId: `song.${id}`,
      arrangementId: `arr.${id}`,
      songTitle: `曲目 ${id}`,
      skillDeps: [],
      assets: ["content/score.json"],
    },
    files: { "content/score.json": "{}" },
  };
}

beforeEach(async () => {
  await clearInstalledPackages();
});

describe("外部包安装表", () => {
  it("写入后能读回，并按安装时间倒序排列", async () => {
    await saveInstalledPackage(pkg("pkg.one"), 1_000);
    await saveInstalledPackage(pkg("pkg.two"), 2_000);

    const packages = await loadInstalledPackages();
    expect(packages.map((item) => item.manifest.id)).toEqual(["pkg.two", "pkg.one"]);
    expect(packages[0]!.installedAt).toBe(2_000);
  });

  it("同一 id 重复安装是覆盖升级，不会留下两条", async () => {
    await saveInstalledPackage(pkg("pkg.one", "1.0.0"), 1_000);
    await saveInstalledPackage(pkg("pkg.one", "1.1.0"), 2_000);

    const packages = await loadInstalledPackages();
    expect(packages).toHaveLength(1);
    expect(packages[0]!.manifest.version).toBe("1.1.0");
    expect(packages[0]!.installedAt).toBe(2_000);
  });

  it("按 id 卸载，其他包不受影响", async () => {
    await saveInstalledPackage(pkg("pkg.one"), 1_000);
    await saveInstalledPackage(pkg("pkg.two"), 2_000);

    await removeInstalledPackage("pkg.one");
    expect((await loadInstalledPackages()).map((item) => item.manifest.id)).toEqual(["pkg.two"]);
  });

  it("清空后读到空列表", async () => {
    await saveInstalledPackage(pkg("pkg.one"), 1_000);
    await clearInstalledPackages();
    expect(await loadInstalledPackages()).toEqual([]);
  });
});
