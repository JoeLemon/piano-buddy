// 手机横屏的可用性验收。
//
// 竖屏 390×844 是默认姿势，但弹琴时很多人把手机横过来（844×390）：这时
// 竖向只剩 390px，顶栏 sticky 常驻会吃掉四分之一屏，跟弹的键盘只能露出一半，
// 弹两个音就得滚一下——键盘滚出视野等于没法弹。
//
// 所以横屏且屏高 < 520px 时顶栏改成 static（跟着内容滚走）：弹琴不需要导航，
// 要切页滚回顶部即可。这个行为是纯 CSS media query，单元测试看不见，
// 只能靠真实视口量。
//
// 运行：
//   1. npx vite --port 5180 --strictPort
//   2. node scripts/verify-landscape.mjs
// 截图默认落系统临时目录（PB_SHOTS_DIR=shots 可留档）。

import { resolve } from 'node:path';
import { BASE_URL, CHROME, SHOTS, loadChromium } from './lib/browser.mjs';

const { chromium } = loadChromium();

const URL = BASE_URL;

const CHECKS = [];
function check(name, ok, detail = '') {
  CHECKS.push({ name, ok });
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
}

const browser = await chromium.launch({
  headless: true,
  executablePath: CHROME,
  args: ['--mute-audio'],
});

/**
 * 进到「曲库 →《薄雾》→ 分段跟弹」，返回量到的几何。
 *
 * 用《薄雾》是因为它第一拍就是四音和弦：展开条 + 键盘是最高的那种组合，
 * 空间够不够在这里最容易暴露。
 */
async function measure(width, height) {
  const page = await browser.newPage({
    viewport: { width, height },
    deviceScaleFactor: 2,
    isMobile: width < 500,
    hasTouch: width < 500,
  });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));

  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.locator('nav.tabs [data-section=library]').click();
  await page.waitForSelector('[data-song]');
  await page.locator('[data-arrangement="arr.mist.full"]').click();
  await page.waitForTimeout(300);
  await page.locator('[data-test="repertoire-follow"]').click();
  await page.waitForTimeout(200);
  await page.locator('[data-test="repertoire-start"]').click();
  await page.waitForTimeout(700);

  // 用户想看键盘时会滚到「键盘底边贴住视口底」，再多就看别的去了
  await page.evaluate(() => {
    const panel = document.querySelector('.keyboard-panel');
    window.scrollBy(0, panel.getBoundingClientRect().bottom - window.innerHeight);
  });
  await page.waitForTimeout(400);

  const info = await page.evaluate(() => {
    const topbar = document.querySelector('.topbar');
    const panel = document.querySelector('.keyboard-panel');
    const hint = document.querySelector('[data-test="repertoire-chord-hint"]');
    const box = panel.getBoundingClientRect();
    return {
      topbarPosition: getComputedStyle(topbar).position,
      keyboardTop: Math.round(box.top),
      keyboardBottom: Math.round(box.bottom),
      viewportHeight: window.innerHeight,
      // 容差 1px：子像素布局会让 844 变成 844.0000001
      keyboardFullyVisible: box.top >= -1 && box.bottom <= window.innerHeight + 1,
      hintText: hint ? hint.textContent.replace(/\s+/g, ' ').trim() : null,
      overflowX: document.documentElement.scrollWidth - window.innerWidth,
    };
  });

  await page.screenshot({ path: resolve(SHOTS, `landscape-${width}x${height}.png`) });
  await page.close();
  return { ...info, errors };
}

/* ── 横屏：顶栏让位，键盘整块可见 ─────────────────────────────────── */

const landscape = await measure(844, 390);

check(
  '横屏顶栏不再 sticky（跟着内容滚走）',
  landscape.topbarPosition === 'static',
  `position=${landscape.topbarPosition}`,
);

check(
  '横屏滚到键盘处，整块键盘在屏内',
  landscape.keyboardFullyVisible,
  `键盘 ${landscape.keyboardTop}–${landscape.keyboardBottom} / 视口 ${landscape.viewportHeight}`,
);

check(
  '横屏仍能看到这一拍要按的键',
  landscape.hintText !== null && landscape.hintText.includes('A3'),
  landscape.hintText ?? '没有展开条',
);

check('横屏没有横向溢出', landscape.overflowX <= 0, `溢出 ${landscape.overflowX}px`);

/* ── 竖屏与桌面：不应该被这条规则误伤 ─────────────────────────────── */

const portrait = await measure(390, 844);
check(
  '竖屏顶栏仍 sticky',
  portrait.topbarPosition === 'sticky',
  `position=${portrait.topbarPosition}`,
);

const desktop = await measure(1280, 900);
check(
  '桌面顶栏仍 sticky',
  desktop.topbarPosition === 'sticky',
  `position=${desktop.topbarPosition}`,
);

const allErrors = [...landscape.errors, ...portrait.errors, ...desktop.errors];
check('三个视口都没有 pageError', allErrors.length === 0, allErrors.join(' / '));

await browser.close();

const passed = CHECKS.filter((item) => item.ok).length;
console.log(`\n${passed}/${CHECKS.length}`);
if (passed !== CHECKS.length) process.exitCode = 1;
