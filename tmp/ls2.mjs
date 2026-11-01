import { resolve } from "node:path";
import { CHROME, loadChromium } from "../scripts/lib/browser.mjs";
const { chromium } = loadChromium();
const SHOTS = process.env.PB_SHOTS_DIR || "/tmp/pb-shots";
const browser = await chromium.launch({ headless: true, executablePath: CHROME, args: ["--mute-audio"] });

async function run(label, width, height) {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 2 });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("http://localhost:5187", { waitUntil: "networkidle" });
  await page.locator("nav.tabs [data-section=library]").click();
  await page.waitForSelector("[data-song]");
  await page.locator('[data-arrangement="arr.mist.full"]').click();
  await page.waitForTimeout(300);
  await page.locator('[data-test="repertoire-follow"]').click();
  await page.waitForTimeout(200);
  await page.locator('[data-test="repertoire-start"]').click();
  await page.waitForTimeout(700);
  // 用户想看键盘时会滚到「键盘底边贴住视口底」，再多就看别的了
  await page.evaluate(() => {
    const kb = document.querySelector(".keyboard-panel");
    window.scrollBy(0, kb.getBoundingClientRect().bottom - window.innerHeight);
  });
  await page.waitForTimeout(400);

  const info = await page.evaluate(() => {
    const kb = document.querySelector(".keyboard-panel");
    const r = kb.getBoundingClientRect();
    const topbar = document.querySelector(".topbar");
    const tr = topbar.getBoundingClientRect();
    return {
      viewportH: window.innerHeight,
      topbarPos: getComputedStyle(topbar).position,
      topbarVisible: tr.bottom > 0,
      keyboardTop: Math.round(r.top),
      keyboardBottom: Math.round(r.bottom),
      keyboardFullyVisible: r.top >= -1 && r.bottom <= window.innerHeight + 1,
    };
  });
  console.log(label, JSON.stringify(info));
  await page.screenshot({ path: resolve(SHOTS, `landscape-${label}.png`) });
  if (errors.length) console.log(label, "errors:", errors);
  await page.close();
}

await run("phone", 844, 390);
await run("portrait", 390, 844);
await run("desktop", 1280, 900);
await browser.close();
