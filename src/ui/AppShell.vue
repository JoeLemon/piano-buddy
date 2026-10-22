<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from "vue";

export type ShellSection = { id: string; label: string };

const props = defineProps<{
  /** 当前页面名，如「识谱」「视奏」；首页为空。 */
  title?: string;
  /** 当前所属分区名，如「课程」；用于面包屑。 */
  section?: string;
  /** 分区导航；为空时不显示导航（练习中的沉浸模式）。 */
  sections?: readonly ShellSection[];
  activeSection?: string;
  midiConnected: boolean;
  midiDeviceName?: string | null;
  webMidiConnected?: boolean;
  secureContext?: boolean;
  webMidiAvailable?: boolean;
  bleAvailable?: boolean;
  midiError?: string | null;
  showBack?: boolean;
  /** 页面自己带 h1 时置 false，避免出现两行标题。 */
  showHeading?: boolean;
  theme?: "light" | "dark";
  metronomeOn?: boolean;
  metronomeBpm?: number;
  keyboardMode?: boolean;
}>();

const emit = defineEmits<{
  back: [];
  connectMidi: [];
  "toggle-theme": [];
  "toggle-metronome": [];
  "metronome-bpm": [bpm: number];
  "toggle-keyboard": [];
  navigate: [id: string];
}>();

const settingsOpen = ref(false);
const drawerEl = ref<HTMLElement | null>(null);

function readBpm(event: Event): number {
  return Number((event.target as HTMLInputElement).value);
}

function closeSettings() {
  settingsOpen.value = false;
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === "Escape" && settingsOpen.value) closeSettings();
}

watch(settingsOpen, (open) => {
  if (typeof document !== "undefined") {
    document.body.style.overflow = open ? "hidden" : "";
  }
});

onMounted(() => {
  if (typeof window !== "undefined") window.addEventListener("keydown", onKeydown);
});

onBeforeUnmount(() => {
  if (typeof window !== "undefined") window.removeEventListener("keydown", onKeydown);
  if (typeof document !== "undefined") document.body.style.overflow = "";
});
</script>

<template>
  <section class="shell">
    <header class="topbar">
      <div class="bar">
        <div class="bar-left">
          <button
            v-if="showBack"
            type="button"
            class="back"
            data-test="home"
            aria-label="返回"
            @click="emit('back')"
          >
            <span aria-hidden="true">←</span>
          </button>
          <p v-if="section" class="crumbs">
            <span class="crumb-section">{{ section }}</span>
          </p>
          <p v-else class="brand">Piano Buddy</p>
        </div>

        <div class="bar-right">
          <p
            class="device"
            :data-connected="midiConnected ? 'true' : 'false'"
            data-test="midi-status"
          >
            <template v-if="keyboardMode">
              <span class="chip" data-test="keyboard-status">
                <span class="dot" data-state="ok" />
                模拟键盘
              </span>
            </template>
            <template v-else-if="midiConnected">
              <span class="chip">
                <span class="dot" data-state="ok" />
                <span v-if="midiDeviceName">{{ midiDeviceName }}</span>
                <span v-else>MIDI 已连接</span>
              </span>
            </template>
            <template v-else>
              <button type="button" class="chip chip-action" data-test="connect-midi" @click="emit('connectMidi')">
                <span class="dot" data-state="warn" />
                连接键盘
              </button>
            </template>
          </p>

          <div class="metro">
            <button
              type="button"
              class="chip"
              data-test="toggle-metronome"
              :aria-pressed="metronomeOn ? 'true' : 'false'"
              :class="{ 'chip-on': metronomeOn }"
              @click="emit('toggle-metronome')"
            >
              <span class="metro-glyph" aria-hidden="true">♩</span>
              <span class="metro-label">{{ metronomeOn ? "节拍器 开" : "节拍器 关" }}</span>
            </button>
            <span v-if="metronomeOn" class="metro-value" data-test="metronome-value">
              {{ metronomeBpm ?? 80 }}
            </span>
          </div>

          <button
            type="button"
            class="settings-btn"
            data-test="open-settings"
            aria-label="设置"
            :aria-expanded="settingsOpen ? 'true' : 'false'"
            @click="settingsOpen = true"
          >
            <span class="gear" aria-hidden="true">⚙</span>
            <span class="settings-label">设置</span>
          </button>
        </div>
      </div>

      <nav v-if="sections && sections.length > 0" class="tabs" aria-label="主导航">
        <button
          v-for="item in sections"
          :key="item.id"
          type="button"
          class="tab"
          :data-section="item.id"
          :aria-current="item.id === activeSection ? 'page' : undefined"
          @click="emit('navigate', item.id)"
        >
          {{ item.label }}
        </button>
      </nav>
    </header>

    <div class="panel">
      <h1 v-if="title && showHeading !== false">{{ title }}</h1>
      <slot />
    </div>

    <div v-show="settingsOpen" class="drawer" data-test="settings">
      <div class="drawer-backdrop" @click="closeSettings"></div>
      <aside
        ref="drawerEl"
        class="drawer-panel panel-surface"
        role="dialog"
        aria-modal="true"
        aria-label="设置"
      >
        <header class="drawer-head">
          <h2>设置</h2>
          <button type="button" class="drawer-close" aria-label="关闭设置" @click="closeSettings">×</button>
        </header>

        <div class="drawer-body">
          <!-- 节拍器：关着时只有一个「打开」按钮，开着才出现速度控件 -->
          <div v-if="metronomeOn" class="row-actions">
            <span class="row-label">速度</span>
            <button
              type="button"
              class="step"
              data-test="metronome-slower"
              aria-label="减慢"
              @click="emit('metronome-bpm', (metronomeBpm ?? 80) - 4)"
            >
              −
            </button>
            <input
              type="range"
              class="range"
              data-test="metronome-bpm"
              min="40"
              max="200"
              step="2"
              :value="metronomeBpm ?? 80"
              aria-label="节拍器速度"
              @input="emit('metronome-bpm', readBpm($event))"
            />
            <button
              type="button"
              class="step"
              data-test="metronome-faster"
              aria-label="加快"
              @click="emit('metronome-bpm', (metronomeBpm ?? 80) + 4)"
            >
              ＋
            </button>
          </div>
          <div v-else class="row-actions">
            <button type="button" class="chip" @click="emit('toggle-metronome')">打开节拍器</button>
          </div>

          <div class="row-actions">
            <button
              type="button"
              class="chip"
              data-test="toggle-keyboard"
              :aria-pressed="keyboardMode ? 'true' : 'false'"
              :class="{ 'chip-on': keyboardMode }"
              @click="emit('toggle-keyboard')"
            >
              {{ keyboardMode ? "模拟键盘 开" : "模拟键盘 关" }}
            </button>
            <button
              v-if="!midiConnected"
              type="button"
              class="chip chip-action"
              @click="emit('connectMidi')"
            >
              连接 MIDI 键盘
            </button>
            <button
              type="button"
              class="chip"
              data-test="toggle-theme"
              :aria-label="theme === 'dark' ? '切换到舞台主题' : '切换到夜间主题'"
              @click="emit('toggle-theme')"
            >
              {{ theme === "dark" ? "舞台" : "夜间" }}
            </button>
          </div>

          <p v-if="keyboardMode" class="keyboard-map" data-test="keyboard-hint">
            黑键 S D G H J · 2 3 5 6 7<br />
            白键 Z X C V B N M（C3–B3）· Q W E R T Y U I（C4–C5）
          </p>

          <details class="diag" data-test="midi-diag">
            <summary>连接诊断</summary>
            <dl class="diag-grid">
              <div class="diag-row"><dt>安全上下文 (HTTPS/localhost)</dt><dd :class="secureContext ? 'ok' : 'warn'">{{ secureContext ? "是" : "否" }}</dd></div>
              <div class="diag-row"><dt>Web MIDI（USB）</dt><dd :class="webMidiAvailable ? 'ok' : 'muted'">{{ webMidiAvailable ? "支持" : "不支持" }}</dd></div>
              <div class="diag-row"><dt>Web Bluetooth（蓝牙 MIDI）</dt><dd :class="bleAvailable ? 'ok' : 'warn'">{{ bleAvailable ? "支持" : "不支持" }}</dd></div>
              <div class="diag-row"><dt>Web MIDI 连接</dt><dd :class="webMidiConnected ? 'ok' : 'muted'">{{ webMidiConnected ? "已连接" : "未连接" }}</dd></div>
              <div class="diag-row"><dt>蓝牙设备</dt><dd :class="midiDeviceName ? 'ok' : 'muted'">{{ midiDeviceName ?? "无" }}</dd></div>
              <div class="diag-row"><dt>最近错误</dt><dd :class="midiError ? 'warn' : 'muted'">{{ midiError ?? "无" }}</dd></div>
            </dl>
          </details>
        </div>
      </aside>
    </div>
  </section>
</template>

<style scoped>
.shell {
  min-height: 100vh;
  /* 深绿舞台底 + 五线谱音符暗纹（暗纹透明度已烘进 SVG，约 5%） */
  background-color: var(--pb-bg);
  background-image: var(--pb-bg-pattern);
  background-size: 180px 120px;
  color: var(--pb-ink);
}

/* ---------- 顶栏 ---------- */

.topbar {
  position: sticky;
  top: 0;
  z-index: 20;
  background: color-mix(in srgb, var(--pb-bg) 88%, transparent);
  backdrop-filter: blur(10px);
  border-bottom: 1px solid var(--pb-border-soft);
}

.bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--pb-space-2) var(--pb-space-3);
  max-width: var(--pb-max-width);
  margin: 0 auto;
  padding: var(--pb-space-2) clamp(0.75rem, 3vw, 1.25rem);
  min-height: 3.15rem;
}

.bar-left,
.bar-right {
  display: flex;
  align-items: center;
  gap: var(--pb-space-2);
  min-width: 0;
}

.bar-left {
  flex: 1 1 auto;
}

.back {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2rem;
  height: 2rem;
  padding: 0;
  border: 1px solid var(--pb-border-soft);
  border-radius: var(--pb-radius-pill);
  background: transparent;
  color: var(--pb-ink);
  font-size: 1rem;
  line-height: 1;
  cursor: pointer;
}

.brand {
  margin: 0;
  color: var(--pb-accent-2-strong);
  font-family: var(--pb-font-display);
  font-size: 1rem;
  font-weight: 600;
  letter-spacing: 0.01em;
  white-space: nowrap;
}

.crumbs {
  display: flex;
  align-items: baseline;
  gap: 0.35rem;
  min-width: 0;
  margin: 0;
  font-size: 0.92rem;
}

.crumb-section {
  color: var(--pb-ink-2);
  font-weight: 600;
  white-space: nowrap;
}

/* 设备 / 节拍器 / 设置：都是同一套 chip，避免顶栏出现四种按钮长相 */

.chip {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.32rem 0.65rem;
  border: 1px solid var(--pb-border-soft);
  border-radius: var(--pb-radius-pill);
  background: transparent;
  color: var(--pb-muted);
  font-size: 0.82rem;
  line-height: 1.35;
  white-space: nowrap;
  cursor: pointer;
}

.chip[aria-pressed="true"],
.chip-on {
  border-color: var(--pb-accent-2);
  background: var(--pb-accent-soft);
  color: var(--pb-accent-2-strong);
}

.device {
  display: flex;
  align-items: center;
  margin: 0;
  font-size: 0.82rem;
}

.device[data-connected="false"] .chip {
  border-color: color-mix(in srgb, var(--pb-warn) 45%, transparent);
  color: var(--pb-warn);
}

.metro {
  display: flex;
  align-items: center;
  gap: 0.35rem;
}

.metro-glyph {
  font-size: 0.95rem;
  line-height: 1;
}

.metro-value {
  min-width: 2ch;
  color: var(--pb-ink);
  font-size: 0.82rem;
  font-variant-numeric: tabular-nums;
  font-weight: 600;
}

.settings-btn {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.32rem 0.65rem;
  border: 1px solid var(--pb-border-soft);
  border-radius: var(--pb-radius-pill);
  background: transparent;
  color: var(--pb-muted);
  font-size: 0.82rem;
  cursor: pointer;
}

.gear {
  font-size: 0.9rem;
  line-height: 1;
}

.settings-btn:hover {
  color: var(--pb-ink);
}

/* ---------- 分区导航 ---------- */

.tabs {
  display: flex;
  gap: var(--pb-space-1);
  max-width: var(--pb-max-width);
  margin: 0 auto;
  padding: 0 clamp(0.75rem, 3vw, 1.25rem);
  overflow-x: auto;
  scrollbar-width: none;
}

.tabs::-webkit-scrollbar {
  display: none;
}

.tab {
  position: relative;
  padding: 0.5rem 0.7rem 0.6rem;
  border: 0;
  background: transparent;
  color: var(--pb-muted);
  font-size: 0.88rem;
  white-space: nowrap;
  cursor: pointer;
}

/* 选中导航：亮金文字 + 亮金竖条，符合深绿底上的选中态 */
.tab[aria-current="page"] {
  color: var(--pb-accent-2-strong);
  font-weight: 600;
}

.tab[aria-current="page"]::after {
  content: "";
  position: absolute;
  right: 0.55rem;
  bottom: 0;
  left: 0.55rem;
  height: 2px;
  border-radius: 2px;
  background: var(--pb-accent-2);
}

/* ---------- 内容区 ---------- */

.panel {
  width: 100%;
  max-width: var(--pb-max-width);
  margin: 0 auto;
  padding: clamp(0.85rem, 1.4vw + 0.5rem, 1.25rem) clamp(0.75rem, 3vw, 1.25rem)
    clamp(1.75rem, 4vw, 2.75rem);
}

h1 {
  margin: 0 0 var(--pb-space-3);
}

/* ---------- 设置抽屉 ---------- */

.drawer {
  position: fixed;
  inset: 0;
  z-index: 60;
}

.drawer-backdrop {
  position: absolute;
  inset: 0;
  /* 遮罩压暗舞台，但保留一点墨绿底色 */
  background: rgb(5 14 11 / 55%);
}

/* 抽屉是暖白面板：里面的 chip 要回到卡内样式，而不是顶栏的透明样式 */
.drawer-panel .chip {
  border-color: var(--pb-border-soft);
  background: var(--pb-surface-2);
  color: var(--pb-ink);
}

.drawer-panel .chip[aria-pressed="true"],
.drawer-panel .chip-on {
  border-color: var(--pb-accent);
  background: var(--pb-accent-soft);
  color: var(--pb-accent);
}

.drawer-panel {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  display: flex;
  flex-direction: column;
  gap: var(--pb-space-4);
  width: min(22rem, 90vw);
  padding: var(--pb-space-4) var(--pb-space-4) var(--pb-space-5);
  overflow-y: auto;
  background: var(--pb-surface);
  border-left: 1px solid var(--pb-border-soft);
  box-shadow: var(--pb-shadow-2);
  animation: slide-in var(--pb-dur) var(--pb-ease);
}

@keyframes slide-in {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}

.drawer-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.drawer-head h2 {
  margin: 0;
  font-size: 1.1rem;
}

.drawer-close {
  width: 1.9rem;
  height: 1.9rem;
  padding: 0;
  border: 1px solid var(--pb-border-soft);
  border-radius: var(--pb-radius-pill);
  background: transparent;
  color: var(--pb-muted);
  font-size: 1.1rem;
  line-height: 1;
  cursor: pointer;
}

.drawer-body {
  display: flex;
  flex-direction: column;
  gap: var(--pb-space-3);
}

.row-label {
  color: var(--pb-muted);
  font-size: 0.82rem;
}

.row-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--pb-space-2);
}

.step {
  width: 1.75rem;
  height: 1.75rem;
  padding: 0;
  border: 1px solid var(--pb-border-soft);
  border-radius: var(--pb-radius);
  background: var(--pb-surface-2);
  color: var(--pb-ink);
  line-height: 1;
  cursor: pointer;
}

.range {
  flex: 1 1 6rem;
  min-width: 5rem;
  accent-color: var(--pb-accent-2);
}

.keyboard-map {
  margin: var(--pb-space-2) 0 0;
  padding: var(--pb-space-2) var(--pb-space-3);
  border-radius: var(--pb-radius);
  background: var(--pb-surface-2);
  color: var(--pb-ink-2);
  font-size: 0.8rem;
  line-height: 1.6;
}

/* 诊断默认收起，只有排查连接时才展开 */
.diag {
  padding-top: var(--pb-space-3);
  border-top: 1px solid var(--pb-border-soft);
  color: var(--pb-muted);
  font-size: 0.82rem;
}

.diag summary {
  cursor: pointer;
  user-select: none;
}

.diag summary:hover {
  color: var(--pb-ink);
}

.diag-grid {
  display: grid;
  gap: 0.3rem;
  margin: var(--pb-space-2) 0 0;
}

.diag-row {
  display: flex;
  justify-content: space-between;
  gap: var(--pb-space-3);
}

.diag-row dt {
  color: var(--pb-muted);
}

.diag-row dd {
  margin: 0;
  font-weight: 500;
  text-align: right;
}

.diag-row dd.ok {
  color: var(--pb-ok);
}

.diag-row dd.warn {
  color: var(--pb-warn);
}

.diag-row dd.muted {
  color: var(--pb-muted);
}

/* 窄屏：面包屑让位，节拍器数值留在顶栏，其余进抽屉 */
@media (max-width: 640px) {
  .bar {
    gap: var(--pb-space-1) var(--pb-space-2);
  }

  /* 窄屏只留图标，文字让位给设备状态和节拍器 */
  .metro-label,
  .settings-label {
    display: none;
  }

  .settings-btn {
    padding: 0.32rem 0.5rem;
  }
}
</style>
