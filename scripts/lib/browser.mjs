// 验收脚本共用的浏览器/地址/截图入口。
//
// 以前每个脚本各抄一份 chromium 路径和 5180 端口：换机器要改 5 处，
// 两个进程同时跑还会抢端口。这里统一成环境变量：
//   PB_URL        完整地址（优先；verify:all 会注入自己起的服务）
//   PB_PORT       只给端口时用（默认 5180）
//   PB_CHROME     chromium 可执行文件（覆盖自动解析）
//   PB_SHOTS_DIR  截图落盘目录（默认系统临时目录，见下）
//   PW_HOME       playwright-core 所在 workspace 的 package.json（仅当项目里没装时用）
//
// 解析顺序（为了同一份脚本能在本机、CI、别人的机器上跑）：
//   1. PB_CHROME；
//   2. playwright-core 自带的 chromium（`npx playwright-core install chromium` 装的）；
//   3. 本机历史路径（老机器上现成的 chromium-1223）。
// 三条都落空才报错，并在错误里写清楚该跑哪条命令。
import { existsSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** 老机器（本仓库作者机器）上的历史路径，仅作兜底。 */
const LEGACY_WORKSPACE = "C:/Users/HJY/.workbuddy/binaries/node/workspace/package.json";
const LEGACY_CHROME =
  "C:/Users/HJY/AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe";

function loadPlaywright() {
  const attempts = [
    // 项目依赖（CI 与其它机器走这条）
    () => createRequire(import.meta.url)("playwright-core"),
    // 本机 workspace（项目没装 playwright-core 时）
    () => createRequire(process.env.PW_HOME || LEGACY_WORKSPACE)("playwright-core"),
  ];
  for (const attempt of attempts) {
    try {
      return attempt();
    } catch {
      // 换下一条
    }
  }
  throw new Error(
    "没找到 playwright-core：在项目里 npm i -D playwright-core，或把 PW_HOME 指向含它的 package.json",
  );
}

const playwright = loadPlaywright();
// 有的版本把 chromium 挂在具名导出上，有的直接导出 BrowserType。
const chromium = playwright.chromium ?? playwright;

function resolveChrome() {
  if (process.env.PB_CHROME) return process.env.PB_CHROME;
  try {
    const bundled = chromium.executablePath();
    if (bundled && existsSync(bundled)) return bundled;
  } catch {
    // executablePath() 在没装浏览器时可能直接抛
  }
  if (existsSync(LEGACY_CHROME)) return LEGACY_CHROME;
  throw new Error(
    "没找到 chromium：先跑 npm run verify:install（等价 npx playwright-core install chromium），或用 PB_CHROME 指定可执行文件",
  );
}

export const BASE_URL = process.env.PB_URL || `http://localhost:${process.env.PB_PORT || 5180}`;
export const CHROME = resolveChrome();

/**
 * 截图落盘目录。
 *
 * 默认写系统临时目录而不是仓库里的 `shots/`：截图是验收的副产品，每次跑都
 * 重渲染一遍，像素级差几十字节、视觉上没区别，落在仓库里等于每跑一次就把
 * 工作区弄脏一次，提交时还得手工分辨哪些是真正的界面变化。
 *
 * 需要留档时显式指一个目录：
 *   PB_SHOTS_DIR=shots npm run verify:all      # 本地留档
 *   CI 里设 PB_SHOTS_DIR=shots                 # 失败时随 artifact 上传
 */
export const SHOTS = (() => {
  const dir = process.env.PB_SHOTS_DIR || join(tmpdir(), "piano-buddy-shots");
  mkdirSync(dir, { recursive: true });
  return dir;
})();

export function loadChromium() {
  return { chromium };
}
