// 弱起小节（pickup）的视觉核对。
//
// 两件事只有画出来才看得见：
//  1. 单手谱面（EasyScore voice 是 STRICT）要在**首小节前面**补休止符，
//     弱起的音才会落在小节末尾——补在后面就变成「第一拍起音」。
//  2. 双手谱面的首小节要按拍数缩窄，否则它和整小节一样宽、内容少一截，
//     看起来像漏了音。
//
// 用真实内容《晨歌》（content/song.morning-song.l5）当样本：首小节 1 拍、
// 第 6–7 小节还有一条跨小节延音。
//
// 运行：
//   1. npx vite --port 5180 --strictPort
//   2. node scripts/verify-pickup.mjs
// 截图落在 shots/pickup-*.png。

import { mkdirSync, readFileSync } from 'node:fs';
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

const base = JSON.parse(
  readFileSync(resolve(ROOT, 'content/song.morning-song.l5/content/score.json'), 'utf8'),
);

if (base.pickup !== 1) throw new Error(`样本谱面的 pickup 应是 1，实际 ${base.pickup}`);

/** 对照组：同一个首小节的内容改成满 4 拍，渲染时不会补前置休止符。 */
const control = structuredClone(base);
delete control.pickup;
control.staves.RH.measures[0] = {
  notes: ['C', 'D', 'E', 'F'].map((step, index) => ({
    id: `ctrl-${index}`,
    pitches: [{ step, octave: 4, alteration: 0 }],
    duration: 'q',
    fingers: [index + 1],
  })),
};
control.staves.LH.measures[0] = {
  notes: [
    {
      id: 'ctrl-lh',
      pitches: [
        { step: 'C', octave: 3, alteration: 0 },
        { step: 'E', octave: 3, alteration: 0 },
        { step: 'G', octave: 3, alteration: 0 },
      ],
      duration: 'w',
      fingers: [5, 3, 1],
    },
  ],
};

const browser = await chromium.launch({
  headless: true,
  executablePath: CHROME,
  args: ['--mute-audio'],
});
const page = await browser.newPage({ viewport: { width: 1720, height: 900 }, deviceScaleFactor: 2 });
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
page.on('console', (message) => {
  if (message.type() === 'error' && !message.text().includes('404')) {
    errors.push(`console: ${message.text()}`);
  }
});

await page.goto(URL, { waitUntil: 'networkidle' });

/**
 * 单手谱面：返回开头几个 stavenote 的绝对 x。
 *
 * 弱起版的首小节第一个 stavenote 是**前置休止符**（音符被推到它后面），
 * 所以真正要比的是「弱起版的第 2 个」对「满拍版的第 1 个」。
 */
async function paintSingle(score) {
  return page.evaluate(async (payload) => {
    const { renderScore } = await import('/src/notation/renderScore.ts');
    const host = document.createElement('div');
    host.style.cssText = 'width:1620px;padding:16px;background:#fff;';
    document.body.replaceChildren(host);
    renderScore(host, payload, 'RH', true);
    const notes = [...host.querySelectorAll('.vf-stavenote')];
    const xs = notes.slice(0, 3).map((node) => Math.round(node.getBoundingClientRect().x));
    const svg = host.querySelector('svg');
    return { xs, noteCount: notes.length, width: svg ? Math.round(svg.getBoundingClientRect().width) : 0 };
  }, score);
}

/** 双手谱面：返回前三个谱表的宽度（每小节两个：高音/低音）。 */
async function paintGrand(score) {
  return page.evaluate(async (payload) => {
    const { renderGrandScore } = await import('/src/notation/renderScore.ts');
    const host = document.createElement('div');
    host.style.cssText = 'width:1620px;padding:16px;background:#fff;';
    document.body.replaceChildren(host);
    renderGrandScore(host, payload, true);
    const staves = [...host.querySelectorAll('.vf-stave')].slice(0, 4).map((node) => {
      const box = node.getBoundingClientRect();
      return Math.round(box.width);
    });
    const ties = host.querySelectorAll('.vf-stavetie').length;
    const svg = host.querySelector('svg');
    return {
      staves,
      ties,
      width: svg ? Math.round(svg.getBoundingClientRect().width) : 0,
      height: svg ? Math.round(svg.getBoundingClientRect().height) : 0,
    };
  }, score);
}

// ── 1. 单手：弱起版的首音要往后让出三拍 ─────────────────────────────
const weak = await paintSingle(base);
await page.screenshot({ path: resolve(SHOTS, 'pickup-single.png'), fullPage: true });
const full = await paintSingle(control);
const gap = (weak.xs[1] ?? 0) - (full.xs[0] ?? 0);
check('单手弱起谱能画出来', weak.noteCount >= 24 && weak.xs.length >= 2, `${weak.noteCount} 个 stavenote`);
// 首小节只有「一个前置休止符 + 一个音」，两者间距就是空出来的三拍。
const restSpan = (weak.xs[1] ?? 0) - (weak.xs[0] ?? 0);
check('前置休止符占满空出来的三拍', restSpan >= 90 && restSpan <= 280, `间距 ${restSpan}px`);
check(
  '首音落在休止符之后（不是第一拍起音）',
  gap >= 60,
  `弱起第 2 个 ${weak.xs[1]} vs 满拍第 1 个 ${full.xs[0]}，差 ${gap}px`,
);

// ── 2. 双手：首小节明显窄于整小节，跨小节延音仍是一条线 ──────────────
const grand = await paintGrand(base);
await page.screenshot({ path: resolve(SHOTS, 'pickup-grand.png'), fullPage: true });
const [firstStave, , secondStave] = grand.staves;
check('双手弱起谱能画出来', grand.staves.length >= 4 && grand.width > 400, `${grand.width}×${grand.height}`);
check(
  '首小节按拍数缩窄',
  firstStave > 0 && secondStave > 0 && firstStave < secondStave * 0.85,
  `首 ${firstStave}px vs 次 ${secondStave}px`,
);
check('跨小节延音仍然一条线', grand.ties === 1, `实际 ${grand.ties}`);
check('渲染过程没有页面异常', errors.length === 0, errors.slice(0, 3).join(' | '));

// ── 3. 真实页面：曲库里有《晨歌》，跟弹网格首小节只占第 4 拍 ──────────
await page.goto(URL, { waitUntil: 'networkidle' });
await page.locator('[data-section="library"]').click();
await page.waitForSelector('[data-test="repertoire"]');
const arrangementCount = await page.locator('[data-arrangement]').count();
// 曲库会继续加曲子，期望值从 catalog 读，别在脚本里写死。
const catalog = JSON.parse(readFileSync(resolve(ROOT, 'content/catalog.json'), 'utf8'));
const expectedArrangements = catalog.songs.reduce(
  (sum, song) => sum + song.arrangements.length,
  0,
);
check(`曲库列出 ${expectedArrangements} 个编配`, arrangementCount === expectedArrangements, `实际 ${arrangementCount}`);
check('曲库里出现《晨歌》', (await page.locator('[data-arrangement="arr.morning-song.flow"]').count()) === 1);

await page.locator('[data-arrangement="arr.morning-song.flow"]').click();
const detailText = await page.locator('[data-test="repertoire-detail"]').innerText();
check('详情认出这是 L5 编配', detailText.includes("L5"), detailText.split("\n").slice(0, 2).join(" / "));

await page.locator('[data-test="repertoire-follow"]').click();
// 网格在「开始跟弹」之后才渲染（先听预备拍再画）。
await page.locator('[data-test="repertoire-start"]').click();
await page.waitForSelector('[data-test="repertoire-grid"]', { timeout: 5000 });
const grid = await page.evaluate(() => {
  const host = document.querySelector('[data-test="repertoire-grid"]');
  const cells = [...host.querySelectorAll(".cell")];
  return {
    cells: cells.length,
    labels: cells.slice(0, 6).map((cell) => cell.querySelector(".cell-no")?.textContent?.trim()),
    bars: cells.filter((cell) => cell.classList.contains("bar")).length,
  };
});
// 曲库跟弹是按段（默认 2 小节）切的：首段 = 1 拍弱起 + 4 拍 = 5 拍。
check('首段按 5 拍铺开（1 + 4）', grid.cells === 5, `实际 ${grid.cells}`);
check(
  '首格标第 4 拍：弱起不从第一拍起算',
  grid.labels[0] === "4" && grid.labels[1] === "1",
  `前几格 ${grid.labels.join(",")}`,
);
check('小节线 2 条（弱起小节 + 第 2 小节）', grid.bars === 2, `实际 ${grid.bars}`);
await page.screenshot({ path: resolve(SHOTS, 'pickup-follow.png'), fullPage: false });

await browser.close();

const failed = CHECKS.filter((item) => !item.ok);
console.log(`\n${CHECKS.length - failed.length}/${CHECKS.length} 通过`);
if (failed.length > 0) process.exitCode = 1;
