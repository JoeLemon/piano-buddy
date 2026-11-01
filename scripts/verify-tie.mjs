// 跨小节连音线的视觉核对。
//
// 临时往页面里塞一段带 tie 的谱面，确认跨行时那两段半截线真的拼成一条，
// 而不是画到行尾就没了、或者从行首飘出来。
//
// 运行：
//   1. npx vite --port 5180 --strictPort
//   2. node scripts/verify-tie.mjs
// 截图落在 shots/tie-*.png。

import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BASE_URL, CHROME, loadChromium } from './lib/browser.mjs';

const { chromium } = loadChromium();

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SHOTS = resolve(ROOT, 'shots');
const URL = BASE_URL;

mkdirSync(SHOTS, { recursive: true });

const CHECKS = [];
function check(name, ok, detail = '') {
  CHECKS.push({ name, ok });
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
}

/** 4/4、两小节、右手：第 1 小节最后一拍连到第 2 小节第一拍。 */
const SINGLE = {
  id: 'score.tie.single',
  mode: 'repertoire',
  level: 3,
  meter: { beats: 4, beatValue: 4 },
  keySignature: 'C',
  hands: ['RH'],
  bpm: 72,
  staves: {
    RH: {
      clef: 'treble',
      measures: [
        {
          notes: [
            { id: 'a1', pitches: [{ step: 'C', octave: 4, alteration: 0 }], duration: 'q', fingers: [1] },
            { id: 'a2', pitches: [{ step: 'D', octave: 4, alteration: 0 }], duration: 'q', fingers: [2] },
            { id: 'a3', pitches: [{ step: 'E', octave: 4, alteration: 0 }], duration: 'q', fingers: [3] },
            { id: 'a4', pitches: [{ step: 'F', octave: 4, alteration: 0 }], duration: 'q', fingers: [4], tie: 'start' },
          ],
        },
        {
          notes: [
            { id: 'b1', pitches: [{ step: 'F', octave: 4, alteration: 0 }], duration: 'h', fingers: [4], tie: 'stop' },
            { id: 'b2', pitches: [{ step: 'G', octave: 4, alteration: 0 }], duration: 'h', fingers: [5] },
          ],
        },
      ],
    },
  },
};

/** 同一小节内的连线：应该是一条完整的曲线，不是两段。 */
const SAME_BAR = {
  ...SINGLE,
  id: 'score.tie.same-bar',
  staves: {
    RH: {
      clef: 'treble',
      measures: [
        {
          notes: [
            { id: 'a1', pitches: [{ step: 'C', octave: 4, alteration: 0 }], duration: 'q', fingers: [1], tie: 'start' },
            { id: 'a2', pitches: [{ step: 'C', octave: 4, alteration: 0 }], duration: 'q', fingers: [1], tie: 'stop' },
            { id: 'a3', pitches: [{ step: 'E', octave: 4, alteration: 0 }], duration: 'h', fingers: [3] },
          ],
        },
        {
          notes: [
            { id: 'b1', pitches: [{ step: 'F', octave: 4, alteration: 0 }], duration: 'w', fingers: [4] },
          ],
        },
      ],
    },
  },
};

const browser = await chromium.launch({
  headless: true,
  executablePath: CHROME,
  args: ['--mute-audio'],
});
const page = await browser.newPage({ viewport: { width: 1100, height: 1000 }, deviceScaleFactor: 2 });
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
page.on('console', (message) => {
  // favicon 之类的 404 与渲染无关，别让噪声盖住真正的问题。
  if (message.type() === 'error' && !message.text().includes('404')) {
    errors.push(`console: ${message.text()}`);
  }
});

await page.goto(URL, { waitUntil: 'networkidle' });

/** 在页面里用 vite 的模块图直接渲染，不必为它做一条内容包。 */
async function paint(score) {
  return page.evaluate(async (payload) => {
    const { renderScore } = await import('/src/notation/renderScore.ts');
    const host = document.createElement('div');
    host.id = 'tie-host';
    host.style.cssText = 'width:880px;padding:24px;background:#fff;';
    document.body.replaceChildren(host);
    renderScore(host, payload, 'RH', true);
    const ties = host.querySelectorAll('.vf-stavetie');
    // 取每段线的包围盒，检查跨行时两段是不是一左一右接得上。
    const boxes = [...ties].map((node) => {
      const box = node.getBBox();
      return { x: Math.round(box.x), y: Math.round(box.y), w: Math.round(box.width), h: Math.round(box.height) };
    });
    const svg = host.querySelector('svg');
    return {
      ties: ties.length,
      boxes,
      width: svg ? Math.round(svg.getBoundingClientRect().width) : 0,
    };
  }, score);
}

// ── 1. 跨小节：一条完整的曲线，跨过小节间隙 ────────────────────────
const cross = await paint(SINGLE);
check('跨小节只画一条线', cross.ties === 1, `实际 ${cross.ties}`);
await page.screenshot({ path: resolve(SHOTS, 'tie-cross-bar.png'), fullPage: true });

if (cross.ties === 1) {
  const [line] = cross.boxes;
  // 起点在第一小节最后一个音附近，终点在第二小节第一个音附近：
  // 宽度接近「两个音之间的距离」，而不是只画在自己那一小节里。
  check('曲线横跨两个小节', line.w >= 60, `宽 ${line.w}`);
}

// ── 2. 同一小节：一条完整曲线 ────────────────────────────────────
const same = await paint(SAME_BAR);
check('小节内的连线只画一条', same.ties === 1, `实际 ${same.ties}`);
await page.screenshot({ path: resolve(SHOTS, 'tie-same-bar.png'), fullPage: true });

check('渲染过程没有页面异常', errors.length === 0, errors.slice(0, 3).join(' | '));

await browser.close();

const failed = CHECKS.filter((item) => !item.ok);
console.log(`\n${CHECKS.length - failed.length}/${CHECKS.length} 通过`);
if (failed.length > 0) process.exitCode = 1;
