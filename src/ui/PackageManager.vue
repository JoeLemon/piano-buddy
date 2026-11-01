<script setup lang="ts">
import { onMounted, ref } from "vue";
import { loadPackageBundle, type InstalledPackage } from "../repertoire";
import {
  loadInstalledPackages,
  removeInstalledPackage,
  saveInstalledPackage,
} from "../storage/packages";
import { APP_VERSION } from "../version";

/**
 * 设置抽屉里的曲库包管理：导入单文件包、列出已安装版本、卸载。
 *
 * 包是未信任输入，安装前统一走 `loadPackageBundle`（manifest、路径、大小、
 * checksum、minAppVersion）。这里只展示校验结果，不在 UI 层重复一套规则。
 */
const emit = defineEmits<{
  changed: [packages: InstalledPackage[]];
}>();

const packages = ref<InstalledPackage[]>([]);
const busy = ref(false);
const error = ref("");
const notice = ref("");
const fileInput = ref<HTMLInputElement | null>(null);

function typeLabel(type: string): string {
  return type === "song" ? "曲目" : type === "course" ? "课程" : "练习";
}

async function refresh(notify = false) {
  try {
    packages.value = await loadInstalledPackages();
    if (notify) emit("changed", packages.value);
  } catch {
    // 隐私模式/旧浏览器可能拿不到 IndexedDB；包管理不可用，但设置其他功能不受影响。
    packages.value = [];
  }
}

onMounted(() => {
  void refresh();
});

function pickFile() {
  fileInput.value?.click();
}

async function onFile(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;

  busy.value = true;
  error.value = "";
  notice.value = "";
  try {
    const result = await loadPackageBundle(await file.text(), { appVersion: APP_VERSION });
    if (!result.ok) {
      error.value = result.errors.join("；");
      return;
    }
    const installed = await saveInstalledPackage(result.pkg);
    await refresh(true);
    notice.value = `已安装 ${installed.manifest.name} ${installed.manifest.version}`;
  } catch (e) {
    error.value = e instanceof Error ? e.message : "读取包失败";
  } finally {
    busy.value = false;
    input.value = "";
  }
}

async function uninstall(pkg: InstalledPackage) {
  busy.value = true;
  error.value = "";
  notice.value = "";
  try {
    await removeInstalledPackage(pkg.manifest.id);
    await refresh(true);
    notice.value = `已卸载 ${pkg.manifest.name}`;
  } catch (e) {
    error.value = e instanceof Error ? e.message : "卸载失败";
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <section class="packages" data-test="package-manager">
    <div class="packages-head">
      <h3>曲库包</h3>
      <small>App {{ APP_VERSION }}</small>
    </div>
    <p class="packages-hint">
      导入 <code>.pbpack</code> / <code>.json</code> 单文件包。安装前会校验 manifest、
      资源路径、大小、checksum 与最低 App 版本。
    </p>

    <div class="packages-actions">
      <button type="button" class="chip" data-test="package-pick" :disabled="busy" @click="pickFile">
        {{ busy ? "处理中…" : "导入曲库包" }}
      </button>
      <input
        ref="fileInput"
        type="file"
        class="file-input"
        data-test="package-file"
        accept=".pbpack,.json,application/json"
        @change="onFile"
      />
    </div>

    <p v-if="error" class="packages-error" data-test="package-error">{{ error }}</p>
    <p v-if="notice" class="packages-notice" data-test="package-notice">{{ notice }}</p>

    <ul v-if="packages.length > 0" class="package-list">
      <li
        v-for="pkg in packages"
        :key="pkg.manifest.id"
        data-test="installed-package"
        :data-package-id="pkg.manifest.id"
      >
        <div class="package-copy">
          <strong>{{ pkg.manifest.name }}</strong>
          <small>
            {{ pkg.manifest.version }} · {{ typeLabel(pkg.manifest.type) }} · {{ pkg.manifest.id }}
          </small>
        </div>
        <button
          type="button"
          class="package-remove"
          :data-test="`package-remove-${pkg.manifest.id}`"
          :disabled="busy"
          @click="uninstall(pkg)"
        >
          卸载
        </button>
      </li>
    </ul>
    <p v-else class="packages-empty" data-test="package-empty">还没有安装外部包。</p>
  </section>
</template>

<style scoped>
.packages {
  margin-top: var(--pb-space-3);
  padding-top: var(--pb-space-3);
  border-top: 1px solid var(--pb-border-soft);
}

.packages-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--pb-space-2);
}

.packages-head h3 {
  margin: 0;
  font-size: 0.95rem;
}

.packages-head small,
.packages-hint,
.packages-empty,
.package-copy small {
  color: var(--pb-muted);
}

.packages-hint {
  margin: 0.35rem 0 0.65rem;
  font-size: 0.78rem;
  line-height: 1.55;
}

.packages-hint code {
  font-size: 0.95em;
}

.packages-actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--pb-space-2);
}

/* 原生 file input 太难同时做到可访问与统一外观，保留在 DOM 里由按钮触发 */
.file-input {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

.packages-error,
.packages-notice {
  margin: 0.55rem 0 0;
  font-size: 0.8rem;
  line-height: 1.5;
}

.packages-error {
  color: var(--pb-danger);
}

.packages-notice {
  color: var(--pb-ok);
}

.package-list {
  display: grid;
  gap: 0.45rem;
  margin: 0.7rem 0 0;
  padding: 0;
  list-style: none;
}

.package-list li {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--pb-space-2);
  padding: 0.45rem 0.55rem;
  border: 1px solid var(--pb-border-soft);
  border-radius: var(--pb-radius);
  background: var(--pb-surface-2);
}

.package-copy {
  display: grid;
  gap: 0.1rem;
  min-width: 0;
}

.package-copy strong {
  font-size: 0.85rem;
  overflow-wrap: anywhere;
}

.package-copy small {
  font-size: 0.72rem;
  overflow-wrap: anywhere;
}

.package-remove {
  flex: none;
  padding: 0.25rem 0.5rem;
  border: 1px solid var(--pb-border-soft);
  border-radius: var(--pb-radius-pill);
  background: transparent;
  color: var(--pb-danger);
  font-size: 0.75rem;
  cursor: pointer;
}

.package-remove:disabled {
  opacity: 0.5;
  cursor: default;
}
</style>
