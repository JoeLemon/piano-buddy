#!/usr/bin/env node
/**
 * 重新生成本地字体（public/fonts/）。什么时候跑：换了字体族/字重，或想升 Google
 * Fonts 上的新版字形。
 *
 *   npm run fonts:fetch
 *
 * 为什么自托管：App（Capacitor）离线打开时，走 fonts.googleapis.com 会先白屏一下
 * 等网络超时；上架后这也是个「为什么你的 App 要连谷歌域名」的审核问答点。
 * IBM Plex Sans / Source Serif 4 都是 SIL OFL 1.1，允许随应用分发。
 *
 * 只取 `latin` 子集：界面文案是中文，中文与符号始终由系统字体渲染（和原来一致），
 * 把 vietnamese/cyrillic 等子集搬进来只是白占包体。当前合计约 390KB。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = resolve(root, "public/fonts");

const FAMILY_SLUG = { "IBM Plex Sans": "ibm-plex-sans", "Source Serif 4": "source-serif-4" };
/** 与 index.html 里的请求保持一致；换字体时两边一起改。 */
const CSS_URL =
  "https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600&family=Source+Serif+4:opsz,wght@8..60,600;8..60,700&display=swap";
const CHROME_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";
const KEEP_SUBSET = "latin";

export async function fetchFonts({ url = CSS_URL, out = outDir } = {}) {
  const css = await (await fetch(url, { headers: { "User-Agent": CHROME_UA } })).text();
  const faces = [];
  for (const block of css.split("/*").slice(1)) {
    const subset = block.slice(0, block.indexOf("*/")).trim();
    if (subset !== KEEP_SUBSET) continue;
    const body = block.slice(block.indexOf("*/") + 2);
    const family = /font-family:\s*'([^']+)'/.exec(body)?.[1];
    const weight = /font-weight:\s*(\d+)/.exec(body)?.[1];
    const style = /font-style:\s*(\w+)/.exec(body)?.[1] ?? "normal";
    const file = /src:\s*url\((https:[^)]+)\)/.exec(body)?.[1];
    const range = /unicode-range:\s*([^;]+);/.exec(body)?.[1]?.trim();
    if (!family || !weight || !file || !range) {
      throw new Error(`解析 Google Fonts CSS 失败（${subset}）：${body.slice(0, 120)}`);
    }
    faces.push({ family, weight, style, range, file: `${FAMILY_SLUG[family]}-${weight}-${subset}.woff2`, url: file });
  }
  if (!faces.length) throw new Error("一个 @font-face 都没解析到，Google 返回的格式可能变了");

  mkdirSync(out, { recursive: true });
  let bytes = 0;
  for (const face of faces) {
    const res = await fetch(face.url);
    if (!res.ok) throw new Error(`下载失败 ${face.url}：HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    writeFileSync(resolve(out, face.file), buf);
    bytes += buf.length;
  }

  writeFileSync(
    resolve(out, "fonts.css"),
    `${licenseComment()}
${faces
  .map(
    (f) => `@font-face {
  font-family: "${f.family}";
  font-style: ${f.style};
  font-weight: ${f.weight};
  font-display: swap;
  src: url("./${f.file}") format("woff2");
  unicode-range: ${f.range};
}`,
  )
  .join("\n\n")}
`,
    "utf8",
  );
  return { count: faces.length, bytes };
}

function licenseComment() {
  return `/*
 * 本地字体，由 scripts/fetch-fonts.mjs 生成，不要手改（改了会被下次抓取覆盖）。
 * IBM Plex Sans 与 Source Serif 4 均为 SIL Open Font License 1.1，允许随应用分发。
 * 只保留 latin 子集：中文与符号仍由系统字体渲染（与原来一致）。
 */`;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  if (!existsSync(resolve(root, "public"))) mkdirSync(resolve(root, "public"), { recursive: true });
  const { count, bytes } = await fetchFonts();
  console.log(`已生成 public/fonts：${count} 个 @font-face，共 ${(bytes / 1024).toFixed(0)} KB`);
}
