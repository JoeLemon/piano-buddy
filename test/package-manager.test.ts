import { flushPromises, mount } from "@vue/test-utils";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import type { PackageManifest } from "../src/repertoire/package";
import {
  clearInstalledPackages,
  loadInstalledPackages,
} from "../src/storage/packages";
import PackageManager from "../src/ui/PackageManager.vue";

const packageDir = resolve("content/song.ode-to-joy.l2");
const manifest = JSON.parse(
  readFileSync(resolve(packageDir, "manifest.json"), "utf8"),
) as PackageManifest;
const scoreText = readFileSync(resolve(packageDir, "content/score.json"), "utf8");

function bundle(overrides: Partial<PackageManifest> = {}): string {
  return JSON.stringify({
    manifest: { ...manifest, ...overrides },
    files: { "content/score.json": scoreText },
  });
}

async function waitFor(assertion: () => void, timeout = 2_000) {
  const start = Date.now();
  for (;;) {
    try {
      assertion();
      return;
    } catch (error) {
      if (Date.now() - start > timeout) throw error;
      await flushPromises();
      await new Promise((done) => setTimeout(done, 10));
    }
  }
}

function setFile(input: ReturnType<ReturnType<typeof mount>["get"]>, text: string) {
  const file = new File([text], "demo.pbpack", { type: "application/json" });
  Object.defineProperty(input.element, "files", {
    configurable: true,
    value: [file],
  });
}

beforeEach(async () => {
  await clearInstalledPackages();
});

describe("PackageManager", () => {
  it("启动时列出已安装包，没有包时显示空状态", async () => {
    const wrapper = mount(PackageManager);
    await waitFor(() => {
      expect(wrapper.get("[data-test=package-empty]").text()).toContain("还没有安装");
    });
    expect(wrapper.text()).toContain("App 2.0.0");
  });

  it("导入外部包后列出名称、版本、类型与 id，并通知外层刷新曲库", async () => {
    const wrapper = mount(PackageManager);
    await flushPromises();

    setFile(
      wrapper.get("[data-test=package-file]"),
      bundle({
        id: "pkg.external.demo",
        songId: "song.external.demo",
        arrangementId: "arr.external.demo",
        songTitle: "外部曲",
        name: "外部曲 · L2 编配",
        version: "1.3.0",
      }),
    );
    await wrapper.get("[data-test=package-file]").trigger("change");

    await waitFor(() => {
      expect(wrapper.get("[data-test=package-notice]").text()).toContain("已安装");
    });

    const item = wrapper.get('[data-package-id="pkg.external.demo"]');
    expect(item.text()).toContain("外部曲 · L2 编配");
    expect(item.text()).toContain("1.3.0");
    expect(item.text()).toContain("曲目");
    expect(item.text()).toContain("pkg.external.demo");
    expect(wrapper.find("[data-test=package-empty]").exists()).toBe(false);

    expect(wrapper.emitted("changed")?.at(-1)?.[0]).toHaveLength(1);
    expect((await loadInstalledPackages()).map((pkg) => pkg.manifest.id)).toEqual([
      "pkg.external.demo",
    ]);
  });

  it("拒绝要求更高 App 版本的包，并说明原因", async () => {
    const wrapper = mount(PackageManager);
    await flushPromises();

    setFile(wrapper.get("[data-test=package-file]"), bundle({ minAppVersion: "9.9.9" }));
    await wrapper.get("[data-test=package-file]").trigger("change");

    await waitFor(() => {
      expect(wrapper.get("[data-test=package-error]").text()).toContain("9.9.9");
    });
    expect(wrapper.find("[data-test=installed-package]").exists()).toBe(false);
    expect(await loadInstalledPackages()).toEqual([]);
  });

  it("卸载后从列表移除，并同步到存储", async () => {
    const wrapper = mount(PackageManager);
    await flushPromises();

    setFile(wrapper.get("[data-test=package-file]"), bundle());
    await wrapper.get("[data-test=package-file]").trigger("change");
    await waitFor(() => {
      expect(wrapper.find("[data-test=installed-package]").exists()).toBe(true);
    });

    await wrapper.get("[data-test=package-remove-pkg.ode-to-joy.simple]").trigger("click");
    await waitFor(() => {
      expect(wrapper.get("[data-test=package-notice]").text()).toContain("已卸载");
    });
    expect(wrapper.find("[data-test=installed-package]").exists()).toBe(false);
    expect(await loadInstalledPackages()).toEqual([]);
    expect(wrapper.emitted("changed")?.at(-1)?.[0]).toEqual([]);
  });
});
