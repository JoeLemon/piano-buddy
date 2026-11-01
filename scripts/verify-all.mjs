// 一键验收：起 dev server → 顺序跑 scripts/verify-*.mjs → 汇总 → 关服务。
//
// 用法：
//   npm run verify:all
//   PB_PORT=5190 npm run verify:all        # 指定起始端口
//   PB_URL=http://localhost:5180 npm run verify:all   # 复用已经开着的服务
//
// 端口被占用时自动往后找空闲端口；所有脚本共用同一个 PB_URL。
// 地址一律用 127.0.0.1 而不是 localhost：Windows 上 vite 可能只监听 ::1，
// Linux/CI 上 localhost 又可能先解析到 127.0.0.1，两边对不上就会出现
// 「服务起来了但 fetch 连不上」。显式绑 IPv4 + 显式用 IPv4 请求，跨平台一致。
// 单个脚本失败不会中断后面的脚本——一次跑完才知道总共坏了多少项。
import { spawn } from "node:child_process";
import { readdirSync } from "node:fs";
import { createServer } from "node:net";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const VITE_BIN = join(ROOT, "node_modules", "vite", "bin", "vite.js");
const SCRIPTS = readdirSync(join(ROOT, "scripts"))
  .filter((name) => /^verify-.+\.mjs$/.test(name) && name !== "verify-all.mjs")
  .sort();

/** 起服务前先找一个空闲端口；两个验收进程不会互相抢 5180。 */
function freePort(start) {
  return new Promise((resolvePort, reject) => {
    let port = start;
    const attempt = () => {
      const server = createServer();
      server.once("error", () => {
        port += 1;
        if (port > start + 20) reject(new Error(`从 ${start} 起找不到空闲端口`));
        else attempt();
      });
      server.once("listening", () => {
        server.close(() => resolvePort(port));
      });
      server.listen(port, process.env.PB_HOST || "127.0.0.1");
    };
    attempt();
  });
}

function run(command, args, options = {}) {
  return new Promise((resolveRun) => {
    const child = spawn(command, args, {
      cwd: ROOT,
      env: process.env,
      ...options,
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr?.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      resolveRun({ code: 1, stdout, stderr: `${stderr}${error.message}` });
    });
    child.on("close", (code) => {
      resolveRun({ code: code ?? 1, stdout, stderr });
    });
  });
}

async function waitForServer(url, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { redirect: "manual" });
      if (response.status < 500) return;
    } catch {
      // 还没起来，继续等。
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 250));
  }
  throw new Error(`dev server 在 ${timeoutMs / 1000}s 内没有响应：${url}`);
}

/** 从脚本输出的最后一行汇总里取 `22/22`；取不到就按失败处理。 */
function parseSummary(stdout) {
  const lines = stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .reverse();
  for (const line of lines) {
    const match = /^(\d+)\s*\/\s*(\d+)\b/.exec(line);
    if (match) return { passed: Number(match[1]), total: Number(match[2]), line };
  }
  return null;
}

async function stopServer(child) {
  if (!child || child.killed) return;
  if (process.platform === "win32") {
    await run("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
  } else {
    child.kill("SIGTERM");
  }
}

let server = null;
let stopping = false;
async function cleanup() {
  if (stopping) return;
  stopping = true;
  await stopServer(server);
}

process.on("SIGINT", async () => {
  await cleanup();
  process.exit(130);
});
process.on("SIGTERM", async () => {
  await cleanup();
  process.exit(143);
});

const HOST = process.env.PB_HOST || "127.0.0.1";
const externalUrl = process.env.PB_URL;
const startPort = Number(process.env.PB_PORT || 5180);
const baseUrl = externalUrl ?? `http://${HOST}:${await freePort(startPort)}`;

if (!externalUrl) {
  console.log(`起 dev server：${baseUrl}`);
  server = spawn(
    process.execPath,
    [VITE_BIN, "--port", new URL(baseUrl).port, "--strictPort", "--host", HOST],
    {
      cwd: ROOT,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let serverLog = "";
  server.stdout?.on("data", (chunk) => {
    serverLog += chunk;
  });
  server.stderr?.on("data", (chunk) => {
    serverLog += chunk;
  });
  server.on("exit", (code) => {
    if (!stopping && code !== 0) {
      console.error(`dev server 提前退出（code ${code}）：\n${serverLog}`);
      process.exitCode = 1;
    }
  });
  try {
    await waitForServer(baseUrl);
  } catch (error) {
    await cleanup();
    console.error(error instanceof Error ? error.message : String(error));
    console.error(serverLog);
    process.exit(1);
  }
} else {
  console.log(`复用已运行的服务：${baseUrl}`);
}

const results = [];
for (const name of SCRIPTS) {
  process.stdout.write(`\n── ${name} ──\n`);
  const started = Date.now();
  const result = await run(process.execPath, [join(ROOT, "scripts", name)], {
    env: { ...process.env, PB_URL: baseUrl },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const summary = parseSummary(result.stdout);
  const seconds = ((Date.now() - started) / 1000).toFixed(1);

  if (summary) {
    console.log(`  ${summary.passed}/${summary.total} · ${seconds}s`);
    if (summary.passed !== summary.total) {
      console.log(result.stdout.trimEnd());
      if (result.stderr.trim()) console.error(result.stderr.trimEnd());
    }
    results.push({ name, ...summary, ok: summary.passed === summary.total });
  } else {
    console.log(`  没有读到汇总行 · ${seconds}s`);
    console.log(result.stdout.trimEnd());
    if (result.stderr.trim()) console.error(result.stderr.trimEnd());
    results.push({ name, passed: 0, total: 0, ok: false });
  }
}

await cleanup();

const passed = results.reduce((sum, item) => sum + item.passed, 0);
const total = results.reduce((sum, item) => sum + item.total, 0);
const failed = results.filter((item) => !item.ok);
console.log(`\n${results.length} 个脚本：${passed}/${total} 项通过`);
for (const item of failed) console.log(`  ✗ ${item.name}`);
if (failed.length > 0) process.exitCode = 1;
