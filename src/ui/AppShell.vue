<script setup lang="ts">
defineProps<{
  title?: string;
  midiConnected: boolean;
  midiDeviceName?: string | null;
  webMidiConnected?: boolean;
  secureContext?: boolean;
  webMidiAvailable?: boolean;
  bleAvailable?: boolean;
  midiError?: string | null;
  showBack?: boolean;
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
}>();

function readBpm(event: Event): number {
  return Number((event.target as HTMLInputElement).value);
}
</script>

<template>
  <section class="shell">
    <header class="bar-wrap">
      <div class="bar">
        <button
          v-if="showBack"
          type="button"
          class="back"
          data-test="home"
          @click="emit('back')"
        >
          返回
        </button>
        <div class="bar-right">
          <p
            class="midi"
            :data-connected="midiConnected ? 'true' : 'false'"
            data-test="midi-status"
          >
            <span v-if="keyboardMode" data-test="keyboard-status">
              <span v-if="midiConnected">模拟键盘输入（与 MIDI 并用）</span>
              <span v-else>模拟键盘输入</span>
            </span>
            <span v-else-if="midiConnected">
              <span v-if="midiDeviceName">已连接：{{ midiDeviceName }}</span>
              <span v-else>MIDI 已连接</span>
            </span>
            <template v-else>
              <button type="button" class="connect" data-test="connect-midi" @click="emit('connectMidi')">
                连接 MIDI 键盘
              </button>
              <span class="hint">支持蓝牙 / USB MIDI 键盘</span>
            </template>
          </p>
          <button
            type="button"
            class="keyboard-toggle"
            data-test="toggle-keyboard"
            :aria-pressed="keyboardMode ? 'true' : 'false'"
            :title="keyboardMode ? '关闭模拟键盘' : '没有 MIDI 键盘时用电脑键盘弹奏'"
            @click="emit('toggle-keyboard')"
          >
            {{ keyboardMode ? "模拟键盘 开" : "模拟键盘 关" }}
          </button>
          <div class="metro" data-test="metronome">
            <button
              type="button"
              class="metro-toggle"
              data-test="toggle-metronome"
              :aria-pressed="metronomeOn ? 'true' : 'false'"
              @click="emit('toggle-metronome')"
            >
              {{ metronomeOn ? "节拍器 开" : "节拍器 关" }}
            </button>
            <template v-if="metronomeOn">
              <button
                type="button"
                class="metro-step"
                data-test="metronome-slower"
                aria-label="减慢"
                @click="emit('metronome-bpm', (metronomeBpm ?? 80) - 4)"
              >
                −
              </button>
              <input
                type="range"
                class="metro-range"
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
                class="metro-step"
                data-test="metronome-faster"
                aria-label="加快"
                @click="emit('metronome-bpm', (metronomeBpm ?? 80) + 4)"
              >
                ＋
              </button>
              <span class="metro-value" data-test="metronome-value">{{ metronomeBpm ?? 80 }}</span>
            </template>
          </div>
          <button
            type="button"
            class="theme"
            data-test="toggle-theme"
            :title="theme === 'dark' ? '切换到浅色' : '切换到深色'"
            @click="emit('toggle-theme')"
          >
            {{ theme === "dark" ? "浅色" : "深色" }}
          </button>
        </div>
        <details class="diag" data-test="midi-diag">
          <summary>连接诊断</summary>
          <dl class="diag-grid">
            <div class="row"><dt>安全上下文 (HTTPS/localhost)</dt><dd :class="secureContext ? 'ok' : 'warn'">{{ secureContext ? "是" : "否" }}</dd></div>
            <div class="row"><dt>Web MIDI（USB）</dt><dd :class="webMidiAvailable ? 'ok' : 'muted'">{{ webMidiAvailable ? "支持" : "不支持" }}</dd></div>
            <div class="row"><dt>Web Bluetooth（蓝牙 MIDI）</dt><dd :class="bleAvailable ? 'ok' : 'warn'">{{ bleAvailable ? "支持" : "不支持" }}</dd></div>
            <div class="row"><dt>Web MIDI 连接</dt><dd :class="webMidiConnected ? 'ok' : 'muted'">{{ webMidiConnected ? "已连接" : "未连接" }}</dd></div>
            <div class="row"><dt>蓝牙设备</dt><dd :class="midiDeviceName ? 'ok' : 'muted'">{{ midiDeviceName ?? "无" }}</dd></div>
            <div class="row"><dt>模拟键盘输入</dt><dd :class="keyboardMode ? 'ok' : 'muted'">{{ keyboardMode ? "已开启" : "未开启" }}</dd></div>
            <div class="row"><dt>最近错误</dt><dd :class="midiError ? 'warn' : 'muted'">{{ midiError ?? "无" }}</dd></div>
          </dl>
        </details>
        <p v-if="keyboardMode" class="keyboard-hint" data-test="keyboard-hint">
          用电脑键盘弹奏：Z X C V B N M = 低音区（C3–B3），Q W E R T Y U I = 高音区（C4–C5），黑键用上排 S D G H J 与 2 3 5 6 7。
        </p>
      </div>
    </header>
    <div class="panel">
      <h1 v-if="title">{{ title }}</h1>
      <slot />
    </div>
  </section>
</template>

<style scoped>
.shell {
  min-height: 100vh;
  background:
    radial-gradient(120% 80% at 10% 0%, rgb(201 132 42 / 12%), transparent 55%),
    var(--pb-bg);
  color: var(--pb-ink);
}

.bar-wrap {
  position: sticky;
  top: 0;
  z-index: 10;
  background: var(--pb-bg);
  border-bottom: 1px solid var(--pb-border-soft);
}

.bar {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem 1rem;
  align-items: center;
  justify-content: space-between;
  max-width: 52rem;
  margin: 0 auto;
  padding: clamp(0.6rem, 1vw + 0.4rem, 0.75rem) clamp(0.75rem, 3vw, 1.25rem);
}

.bar-right {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.75rem;
}

.metro {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.4rem;
}

.metro-toggle {
  padding: 0.3rem 0.7rem;
  border: 1px solid var(--pb-border-soft);
  border-radius: var(--pb-radius);
  background: var(--pb-surface);
  color: var(--pb-muted);
  font-size: 0.85rem;
  cursor: pointer;
}

.metro-toggle[aria-pressed="true"] {
  background: var(--pb-accent);
  border-color: var(--pb-accent);
  color: var(--pb-accent-text);
}

.metro-step {
  width: 1.6rem;
  min-height: 1.6rem;
  padding: 0;
  border: 1px solid var(--pb-border-soft);
  border-radius: var(--pb-radius);
  background: var(--pb-surface);
  color: var(--pb-ink);
  line-height: 1;
  cursor: pointer;
}

.metro-range {
  width: clamp(5rem, 12vw, 9rem);
}

.metro-value {
  min-width: 2.4rem;
  font-size: 0.85rem;
  font-variant-numeric: tabular-nums;
  color: var(--pb-muted);
  text-align: right;
}

.keyboard-toggle {
  padding: 0.3rem 0.7rem;
  border: 1px solid var(--pb-border-soft);
  border-radius: var(--pb-radius);
  background: var(--pb-surface);
  color: var(--pb-muted);
  font-size: 0.85rem;
  cursor: pointer;
}

.keyboard-toggle[aria-pressed="true"] {
  background: var(--pb-accent);
  border-color: var(--pb-accent);
  color: var(--pb-accent-text);
}

.keyboard-hint {
  flex-basis: 100%;
  margin: 0.1rem 0 0;
  color: var(--pb-muted);
  font-size: 0.8rem;
  line-height: 1.45;
}

.theme {
  padding: 0.3rem 0.7rem;
  border: 1px solid var(--pb-border-soft);
  border-radius: var(--pb-radius);
  background: var(--pb-surface);
  color: var(--pb-muted);
  font-size: 0.85rem;
  cursor: pointer;
}

.back {
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--pb-muted);
  text-decoration: underline;
  text-underline-offset: 0.2rem;
  cursor: pointer;
}

.midi {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem;
  margin: 0;
  color: var(--pb-muted);
  font-size: 0.95rem;
}

.midi[data-connected="false"] {
  color: var(--pb-warn);
}

.connect {
  padding: 0.3rem 0.7rem;
  border: 1px solid var(--pb-accent);
  border-radius: var(--pb-radius);
  background: var(--pb-accent);
  color: var(--pb-accent-text);
  font-size: 0.9rem;
  cursor: pointer;
}

.hint {
  color: var(--pb-muted);
  font-size: 0.85rem;
}

.diag {
  flex-basis: 100%;
  margin-top: 0.25rem;
  font-size: 0.85rem;
  color: var(--pb-muted);
}

.diag summary {
  cursor: pointer;
  user-select: none;
  color: var(--pb-muted);
}

.diag summary:hover {
  color: var(--pb-ink);
}

.diag-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(15rem, 1fr));
  gap: 0.35rem 1.5rem;
  margin: 0.5rem 0 0;
  padding: 0.65rem 0.85rem;
  border: 1px solid var(--pb-border-soft);
  border-radius: var(--pb-radius);
  background: var(--pb-surface);
}

.row {
  display: flex;
  justify-content: space-between;
  gap: 1rem;
}

.row dt {
  color: var(--pb-muted);
}

.row dd {
  margin: 0;
  font-weight: 500;
}

.row dd.ok {
  color: var(--pb-ok);
}

.row dd.warn {
  color: var(--pb-warn);
}

.row dd.muted {
  color: var(--pb-muted);
}

.panel {
  width: 100%;
  max-width: 52rem;
  margin: 0 auto;
  padding: clamp(0.75rem, 1.2vw + 0.4rem, 1rem) clamp(0.75rem, 3vw, 1.25rem)
    clamp(1.5rem, 4vw, 2.5rem);
}

.panel > :deep(.surface) {
  background: var(--pb-surface);
  border: 1px solid var(--pb-border-soft);
  border-radius: var(--pb-radius);
  box-shadow: var(--pb-shadow);
  padding: clamp(0.9rem, 2.6vw, 1.25rem) clamp(0.9rem, 2.8vw, 1.35rem)
    clamp(1.1rem, 3.2vw, 1.5rem);
}

h1 {
  margin: 0 0 0.75rem;
  font-family: var(--pb-font-display);
  font-size: clamp(1.35rem, 1.1rem + 1.7vw, 1.85rem);
  font-weight: 600;
  letter-spacing: -0.02em;
}

/* 窄屏：内容贴边更少、诊断面板不挤占操作区 */
@media (max-width: 640px) {
  .bar {
    gap: 0.35rem 0.6rem;
  }

  .metro {
    flex-basis: 100%;
    order: 3;
  }

  .metro-range {
    flex: 1;
  }
}
</style>
