// 验收脚本共用的浏览器/地址入口。
//
// 以前每个脚本各抄一份 chromium 路径和 5180 端口：换机器要改 5 处，
// 两个进程同时跑还会抢端口。这里统一成环境变量：
//   PB_URL     完整地址（优先；verify:all 会注入自己起的服务）
//   PB_PORT    只给端口时用（默认 5180）
//   PB_CHROME  chromium 可执行文件（覆盖自动解析）
//   PW_HOME    playwright-core 所在 workspace 的 package.json（仅当项目里没装时用）
//
// 解析顺序（为了同一份脚本能在本机、CI、别人的机器上跑）：
//   1. PB_CHROME；
//   2. playwright-core 自带的 chromium（`npx playwright-core install chromium` 装的）；
//   3. 本机历史路径（老机器上现成的 chromium-1223）。
// 三条都落空才报错，并在错误里写清楚该跑哪条命令。
import { existsSync } from "node:fs";
import { createRequire } from "node:module";

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

export function loadChromium() {
  return { chromium };
}
