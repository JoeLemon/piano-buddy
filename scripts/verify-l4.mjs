// L4 乐理内容验收（开发工具，不在 package.json scripts 中）
//
// 覆盖：L4 章地图（分解和弦 / 手位读谱两关）、L4-1 分解和弦题面（谱面 + 分解/柱式
// 两个入口、无琶音按钮）、L4-2 手位读谱题面（谱面 + 四个跨度选项）、自由练习
// 新增的两个题型页签。截图落 shots/。
//
// 运行：
//   1. npm run dev（vite 默认 5173；被 demo 的 dev server 占用时换端口，
//      如 npx vite --port 5180）
//   2. PB_URL=http://localhost:5180 node scripts/verify-l4.mjs
//      （vite 只听 [::1]，必须用 localhost；dev server 要用受管后台任务起）
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const requireFromWorkspace = createRequire(
  process.env.PW_HOME || 'C:/Users/HJY/.workbuddy/binaries/node/workspace/package.json',
);
const { chromium } = requireFromWorkspace('playwright-core');

const URL = process.env.PB_URL || 'http://localhost:5180';
const EXE =
  process.env.PB_CHROME ||
  'C:/Users/HJY/AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe';
const SHOTS = resolve(import.meta.dirname, '..', 'shots');
mkdirSync(SHOTS, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  executablePath: EXE,
  args: [
    '--enable-unsafe-swiftshader',
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--autoplay-policy=no-user-gesture-required',
    '--mute-audio',
  ],
});

const page = await browser.newPage({ viewport: { width: 1100, height: 1000 } });
const fatal = [];
const httpErrors = [];
page.on('response', (response) => {
  if (response.status() >= 400) httpErrors.push(`${response.status()} ${response.url()}`);
});
page.on('pageerror', (error) => fatal.push(error.message));

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

async function openPractice() {
  await page.locator('nav.tabs [data-section=practice]').click();
  await page.waitForSelector('[data-test=practice]', { timeout: 8000 });
}

await page.goto(URL, { waitUntil: 'networkidle' });
await openPractice();

// ── 1. L4 章地图 ────────────────────────────────────────────────────────────
const chapter = page.locator('[data-test=practice-chapter-l4]');
check('L4 章在地图上', await chapter.count() === 1);
const l41 = page.locator('[data-test=practice-stage-L4-1]');
const l42 = page.locator('[data-test=practice-stage-L4-2]');
check('L4-1 分解和弦节点', await l41.count() === 1);
check('L4-2 手位读谱节点', await l42.count() === 1);
check(
  'L4 节点文案',
  (await l41.textContent())?.includes('分解和弦') &&
    (await l42.textContent())?.includes('手位读谱'),
);
await page.screenshot({ path: resolve(SHOTS, 'l4-map.png'), fullPage: true });

// ── 2. L4-1 分解和弦 ────────────────────────────────────────────────────────
await l41.click();
await page.waitForSelector('[data-test=practice-stage-head]', { timeout: 8000 });
const head1 = await page.locator('[data-test=practice-stage-head]').textContent();
check('L4-1 关卡标题', (head1 ?? '').includes('分解和弦'), head1 ?? '');
check('L4-1 进度 5 题', (await page.locator('[data-test=practice-progress]').textContent()) === '第 1 / 5 题');
check('L4-1 谱面渲染', (await page.locator('[data-test=practice-staff] svg').count()) >= 1);
check('L4-1 分解入口', (await page.locator('[data-test=practice-play]').count()) === 1);
check('L4-1 柱式入口', (await page.locator('[data-test=practice-block]').count()) === 1);
check('L4-1 无琶音按钮', (await page.locator('[data-test=practice-arpeggio]').count()) === 0);
// 题干把音按顺序列出（分解的语义：一个个听）
const prompt1 = await page.locator('[data-test=practice-prompt]').textContent();
check('L4-1 题干列音', /[A-G]/.test(prompt1 ?? ''), prompt1 ?? '');
await page.locator('[data-test=practice-block]').click();
await page.waitForTimeout(400);
check('柱式试听无报错', fatal.length === 0, fatal.join('; '));
await page.screenshot({ path: resolve(SHOTS, 'l4-broken.png'), fullPage: true });

// ── 3. L4-2 手位读谱 ────────────────────────────────────────────────────────
await page.locator('nav.tabs [data-section=practice]').click();
await page.waitForSelector('[data-test=practice-stage-L4-2]', { timeout: 8000 });
await page.locator('[data-test=practice-stage-L4-2]').click();
await page.waitForSelector('[data-test=practice-stage-head]', { timeout: 8000 });
const head2 = await page.locator('[data-test=practice-stage-head]').textContent();
check('L4-2 关卡标题', (head2 ?? '').includes('手位读谱'), head2 ?? '');
check('L4-2 进度 5 题', (await page.locator('[data-test=practice-progress]').textContent()) === '第 1 / 5 题');
check('L4-2 谱面渲染', (await page.locator('[data-test=practice-staff] svg').count()) >= 1);
const choices = await page.locator('[data-test=practice-choice]').count();
check('L4-2 四个选项', choices === 4, `实际 ${choices}`);
const labels = await page.locator('[data-test=practice-choice]').allTextContents();
check('L4-2 选项是跨度', labels.every((t) => /(五度|六度|七度|八度|三度|四度)/.test(t)), labels.join(' / '));
await page.screenshot({ path: resolve(SHOTS, 'l4-span.png'), fullPage: true });

// ── 4. 自由练习新增页签 ─────────────────────────────────────────────────────
await page.locator('nav.tabs [data-section=practice]').click();
await page.waitForSelector('[data-test=practice]', { timeout: 8000 });
check('自由练习·分解和弦页签', (await page.locator('[data-test=practice-tab-broken]').count()) === 1);
check('自由练习·手位页签', (await page.locator('[data-test=practice-tab-handSpan]').count()) === 1);
await page.locator('[data-test=practice-tab-handSpan]').click();
await page.waitForSelector('[data-test=practice-staff] svg', { timeout: 8000 });
check('手位自由练习出题', (await page.locator('[data-test=practice-choice]').count()) === 4);

check('无页面异常', fatal.length === 0, fatal.join('; '));
check('无 HTTP 错误', httpErrors.length === 0, httpErrors.join('; '));

await browser.close();

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} ${failed.length === 0 ? 'ALL PASS' : 'FAILED'}`);
process.exit(failed.length === 0 ? 0 : 1);
