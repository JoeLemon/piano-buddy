// 练习统计验收（开发工具，不在 package.json scripts 中）
//
// 覆盖：答过题后练习页出现「这个类型累计」行、自由练习与关卡都写档、
// 「我的」页出现乐理答题汇总。IndexedDB 在同一浏览器上下文内持久，
// 答完题直接跳「我的」即可验证落账。
//
// 运行：
//   1. npm run dev（vite 默认 5173；被 demo 的 dev server 占用时换端口，
//      如 npx vite --port 5180）
//   2. node scripts/verify-stats.mjs（默认打 5180，可用 PB_URL 覆盖；
//      vite 只听 [::1]，必须用 localhost）
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
  args: ['--mute-audio', '--autoplay-policy=no-user-gesture-required'],
});

const page = await browser.newPage({ viewport: { width: 1100, height: 1000 } });
const fatal = [];
page.on('pageerror', (error) => fatal.push(error.message));

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

/** 答当前题并点「下一题」；返回是否点亮了累计行。 */
async function answerOne() {
  await page.locator('[data-test=practice-choice]').first().click();
  const next = page.locator('[data-test=practice-next]');
  if (await next.count()) await next.click();
}

await page.goto(URL, { waitUntil: 'networkidle' });
await page.locator('nav.tabs [data-section=practice]').click();
await page.waitForSelector('[data-test=practice]');

// 没答过题：累计行不出现。
check('答前无累计行', (await page.locator('[data-test=practice-kind-accuracy]').count()) === 0);

// 自由练习答 3 题（默认题型 symbols）。
await answerOne();
await answerOne();
await answerOne();
const line = page.locator('[data-test=practice-kind-accuracy]');
check('答后出现累计行', (await line.count()) === 1);
const lineText = (await line.textContent()) ?? '';
check('累计行口径', /累计 \d+%/.test(lineText), lineText.trim());
await page.screenshot({ path: resolve(SHOTS, 'stats-practice.png'), fullPage: true });

// 「我的」页汇总：等 IndexedDB 落账后跳转。
await page.locator('nav.tabs [data-section=me]').click();
await page.waitForSelector('[data-test=me]', { timeout: 8000 });
await page.waitForTimeout(600);
const rows = await page.locator('[data-test=me-practice] .stat').allTextContents();
const quizRow = rows.find((text) => text.includes('乐理答题'));
check('我的页有乐理答题行', Boolean(quizRow), quizRow ?? rows.join(' | '));
check('汇总口径', /共 \d+ 题 · 正确率 \d+%/.test(quizRow ?? ''), quizRow ?? '');
await page.screenshot({ path: resolve(SHOTS, 'stats-me.png'), fullPage: true });

check('无页面异常', fatal.length === 0, fatal.join('; '));

await browser.close();

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} ${failed.length === 0 ? 'ALL PASS' : 'FAILED'}`);
process.exit(failed.length === 0 ? 0 : 1);
