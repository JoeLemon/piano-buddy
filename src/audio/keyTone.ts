/**
 * 屏幕琴键 / 电脑键盘的发声：轻量、可按键按住、按松开停。
 *
 * 与 `preview.ts` 的示范播放器分开：示范谱面要精确排程和变速，
 * 而这里只要求「按下去立刻有声音」，所以每次按下就建一个短音，
 * 松开时快速收音，不做时间轴。
 */

type AudioContextCtor = typeof AudioContext;

type Voice = {
  oscillators: OscillatorNode[];
  gain: GainNode;
};

/** 同一个 midi 按住不放时只保留一个声音。 */
const voices = new Map<number, Voice>();
let ctx: AudioContext | null = null;

function audioContextConstructor(): AudioContextCtor | null {
  const scope = globalThis as typeof globalThis & { webkitAudioContext?: AudioContextCtor };
  if (typeof scope.AudioContext === "function") return scope.AudioContext;
  if (typeof scope.webkitAudioContext === "function") return scope.webkitAudioContext;
  return null;
}

/** 懒创建：第一次按键才申请 AudioContext（浏览器要求用户手势之后）。 */
function context(): AudioContext | null {
  if (ctx) {
    if (ctx.state === "suspended") void ctx.resume();
    return ctx;
  }
  const Ctor = audioContextConstructor();
  if (!Ctor) return null;
  try {
    ctx = new Ctor();
  } catch {
    return null;
  }
  return ctx;
}

function midiToHz(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12);
}

/** 按下某个音。重复按同一个音不会叠加。 */
export function keyToneOn(midi: number): void {
  const audio = context();
  if (!audio) return;
  if (voices.has(midi)) return;

  const now = audio.currentTime;
  const frequency = midiToHz(midi);
  const gain = audio.createGain();
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.16, now + 0.012);
  // 慢衰减模拟止音前的自然减弱；按住不放也不会无限响。
  gain.gain.exponentialRampToValueAtTime(0.05, now + 0.9);
  gain.connect(audio.destination);

  const oscillators: OscillatorNode[] = [];
  // 基频 + 八度泛音：单纯正弦太"电子"，加一点泛音更像琴。
  for (const [type, harmonic, level] of [
    ["sine", 1, 1],
    ["sine", 2, 0.28],
    ["triangle", 3, 0.1],
  ] as const) {
    const osc = audio.createOscillator();
    const partial = audio.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(frequency * harmonic, now);
    partial.gain.setValueAtTime(level, now);
    osc.connect(partial);
    partial.connect(gain);
    osc.start(now);
    oscillators.push(osc);
  }

  voices.set(midi, { oscillators, gain });
}

/** 松开某个音：短促收音后断开节点。 */
export function keyToneOff(midi: number): void {
  const voice = voices.get(midi);
  const audio = ctx;
  if (!voice || !audio) return;
  voices.delete(midi);

  const now = audio.currentTime;
  const { gain, oscillators } = voice;
  try {
    gain.gain.cancelScheduledValues(now);
    gain.gain.setValueAtTime(Math.max(gain.gain.value, 0.0002), now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.16);
  } catch {
    // 已断开
  }
  for (const osc of oscillators) {
    try {
      osc.stop(now + 0.2);
      osc.onended = () => {
        try {
          osc.disconnect();
        } catch {
          // 已断开
        }
      };
    } catch {
      // 未启动或已停止
    }
  }
  globalThis.setTimeout(() => {
    try {
      gain.disconnect();
    } catch {
      // 已断开
    }
  }, 260);
}

/** 全部收音（切换音区、组件卸载、页面失焦时用）。 */
export function keyToneStopAll(): void {
  for (const midi of [...voices.keys()]) keyToneOff(midi);
}
