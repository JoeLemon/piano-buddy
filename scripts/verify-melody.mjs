// 旋律谱面化验收（开发工具，不在 package.json scripts 中）
//
// 覆盖：旋律题两阶段——默认出谱面 + 试听 + 跟弹组件；启用「先听再看」后谱面藏起、
// 给出提示并自动播放；答完调性即揭谱，跟弹照同一份谱面出现。截图落 shots/。
//
// 运行：
//   1. npx vite --port 5180（vite 只听 [::1]，必须用 localhost；demo 占 5173）
//   2. PB_URL=http://localhost:5180 node scripts/verify-melody.mjs
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

// ── 1. 默认旋律题：出谱面 + 试听 + 跟弹 ─────────────────────────────────────
await page.locator('[data-test=practice-tab-melodies]').click();
await page.waitForSelector('[data-test=practice-prompt]', { timeout: 8000 });
check('旋律题干', (await page.locator('[data-test=practice-prompt]').textContent()) === '听旋律，判断调性');
check('旋律谱面渲染', (await page.locator('[data-test=practice-staff] svg').count()) >= 1);
check('旋律试听按钮', (await page.locator('[data-test=practice-play]').count()) === 1);
check('跟弹组件在场', (await page.locator('[data-test=melody-follow]').count()) === 1);
const choices = await page.locator('[data-test=practice-choice]').count();
check('四个调性选项', choices === 4, `实际 ${choices}`);
await page.screenshot({ path: resolve(SHOTS, 'melody-default.png'), fullPage: true });

// ── 2. 启用「先听再看」：谱面藏起 + 提示，旋律仍可手动试听 ─────────────────
await page.locator('[data-test=practice-listen-first]').click();
await page.waitForTimeout(300);
check('先听再看·谱面藏起', (await page.locator('[data-test=practice-staff]').count()) === 0);
check('先听再看·提示出现', (await page.locator('[data-test=practice-listen-hint]').count()) === 1);
// 听的部分：手动点试听，确认旋律可播放、可停止（auto-play 只在换题挂载时触发）。
await page.locator('[data-test=practice-play]').click();
await page.waitForTimeout(200);
check('先听再看·试听可播放', (await page.locator('[data-test=practice-play]').textContent()) === '播放中…');
await page.locator('[data-test=practice-stop]').click();
await page.waitForTimeout(200);
check('先听再看·可停止', (await page.locator('[data-test=practice-play]').textContent()) === '播放旋律');
await page.screenshot({ path: resolve(SHOTS, 'melody-listen-first.png'), fullPage: true });

// ── 3. 答完调性：谱面与跟弹立即出现 ─────────────────────────────────────────
await page.locator('[data-test=practice-choice]').first().click();
await page.waitForTimeout(300);
check('答完·谱面出现', (await page.locator('[data-test=practice-staff] svg').count()) >= 1);
check('答完·跟弹仍在', (await page.locator('[data-test=melody-follow]').count()) === 1);
check('答完·反馈给出', (await page.locator('[data-test=practice-feedback]').count()) === 1);
await page.screenshot({ path: resolve(SHOTS, 'melody-revealed.png'), fullPage: true });

// ── 4. 跟弹组件：点「跟弹」出网格 ───────────────────────────────────────────
await page.locator('[data-test=practice-follow]').click();
await page.waitForTimeout(400);
check('跟弹网格出现', (await page.locator('[data-test=practice-follow-status]').count()) === 1);
await page.screenshot({ path: resolve(SHOTS, 'melody-follow-grid.png'), fullPage: true });

check('无页面异常', fatal.length === 0, fatal.join('; '));
check('无 HTTP 错误', httpErrors.length === 0, httpErrors.join('; '));

await browser.close();

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} ${failed.length === 0 ? 'ALL PASS' : 'FAILED'}`);
process.exit(failed.length === 0 ? 0 : 1);
