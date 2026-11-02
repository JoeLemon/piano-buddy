#!/usr/bin/env node
/**
 * 生成 App 图标与启动图（Android mipmap / iOS AppIcon / 双平台 splash）。
 *
 *   npm run icon:gen             # 写入原生工程
 *   npm run icon:gen -- --check  # 只校验产物与脚本一致（CI 用）
 *
 * 为什么自己画而不是放一张设计稿：图标要覆盖 5 个 Android 密度档（旧式 + 圆形 +
 * 自适应前景）+ iOS 1024 + 14 张启动图，手导一遍就容易漏；而且这些是「跟着品牌色
 * 走」的图形，用脚本生成才能保证改一次 BRAND 常量、全平台一起变。纯 node 实现
 * （自带 PNG 编码 + 解析抗锯齿 + 面积平均缩放），不引 sharp/canvas，CI 里也能跑。
 *
 * 图形语义：深绿底（`--pb-bg` #132f28）上三根白键 + 两根「黑键」——黑键用品牌金
 * （`--pb-accent-2-strong` #dfc98e），因为深绿底上画深色黑键会糊成一片。
 * iOS 的 1024 图不要自己裁圆角（系统会按 mask 切），Android 旧式图标才烤圆角。
 */
import { deflateSync, crc32 } from "node:zlib";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
export const projectRoot = resolve(here, "..");

export const BRAND = {
  bg: [19, 47, 40], // #132f28 舞台深绿
  keyWhite: [242, 238, 226], // #f2eee2
  keyGold: [223, 201, 142], // #dfc98e
};

/* ---------------- PNG 编码（RGBA8、无隔行） ---------------- */

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function pngChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body) >>> 0);
  return Buffer.concat([length, body, crc]);
}

export function encodePng(width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  ihdr[10] = 0; // compression: deflate
  ihdr[11] = 0; // filter: adaptive（每行都填 0 = none）
  ihdr[12] = 0; // no interlace
  const stride = width * 4;
  const source = Buffer.from(rgba.buffer, rgba.byteOffset, rgba.byteLength);
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0; // filter: none
    source.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  return Buffer.concat([PNG_SIGNATURE, pngChunk("IHDR", ihdr), pngChunk("IDAT", deflateSync(raw, { level: 9 })), pngChunk("IEND", Buffer.alloc(0))]);
}

/* ---------------- 画布 ---------------- */

class Surface {
  constructor(width, height) {
    this.width = width;
    this.height = height;
    this.data = new Uint8Array(width * height * 4);
  }

  /** src-over 混合一个不透明色，coverage 取 0..255（解析抗锯齿的覆盖率）。 */
  blend(x, y, [r, g, b], coverage) {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height || coverage <= 0) return;
    const i = (y * this.width + x) * 4;
    const sa = coverage / 255;
    const da = this.data[i + 3] / 255;
    const outA = sa + da * (1 - sa);
    if (outA === 0) return;
    this.data[i] = Math.round((r * sa + this.data[i] * da * (1 - sa)) / outA);
    this.data[i + 1] = Math.round((g * sa + this.data[i + 1] * da * (1 - sa)) / outA);
    this.data[i + 2] = Math.round((b * sa + this.data[i + 2] * da * (1 - sa)) / outA);
    this.data[i + 3] = Math.round(outA * 255);
  }

  /** 实心矩形（边缘就是画布边界，不需要抗锯齿）。 */
  fillRect(x, y, w, h, color) {
    for (let py = Math.max(0, y); py < Math.min(this.height, y + h); py += 1) {
      for (let px = Math.max(0, x); px < Math.min(this.width, x + w); px += 1) this.blend(px, py, color, 255);
    }
  }

  /** 圆角矩形，1px 过渡带的解析抗锯齿。 */
  fillRoundRect(x, y, w, h, radius, color) {
    const r = Math.min(radius, w / 2, h / 2);
    for (let py = Math.max(0, Math.floor(y - 1)); py < Math.min(this.height, Math.ceil(y + h + 1)); py += 1) {
      for (let px = Math.max(0, Math.floor(x - 1)); px < Math.min(this.width, Math.ceil(x + w + 1)); px += 1) {
        const dx = Math.max(x + r - (px + 0.5), (px + 0.5) - (x + w - r), 0);
        const dy = Math.max(y + r - (py + 0.5), (py + 0.5) - (y + h - r), 0);
        const distance = Math.sqrt(dx * dx + dy * dy) - r; // 负 = 在圆角矩形内
        this.blend(px, py, color, Math.round(Math.max(0, Math.min(1, 0.5 - distance)) * 255));
      }
    }
  }

  /** 按到圆心的距离裁圆形（1px 过渡带），圆外 alpha 清 0。 */
  maskCircle() {
    const { width: w, height: h, data } = this;
    const cx = w / 2;
    const cy = h / 2;
    const radius = Math.min(w, h) / 2;
    for (let y = 0; y < h; y += 1) {
      for (let x = 0; x < w; x += 1) {
        const i = (y * w + x) * 4;
        const distance = Math.hypot(x + 0.5 - cx, y + 0.5 - cy) - radius;
        const keep = Math.max(0, Math.min(1, 0.5 - distance));
        data[i + 3] = Math.round((data[i + 3] * keep) / 255);
      }
    }
  }

  /** 把已渲染好的 RGBA 瓦片按面积平均缩放平铺到 (dx, dy, dw, dh)。 */
  blit(tile, tileSize, dx, dy, dw, dh) {
    for (let py = Math.max(0, Math.floor(dy)); py < Math.min(this.height, Math.ceil(dy + dh)); py += 1) {
      for (let px = Math.max(0, Math.floor(dx)); px < Math.min(this.width, Math.ceil(dx + dw)); px += 1) {
        // 目标像素中心映射回瓦片坐标，取覆盖的瓦片像素做平均
        const sx0 = ((px + 0.5 - dx) / dw) * tileSize - 0.5;
        const sy0 = ((py + 0.5 - dy) / dh) * tileSize - 0.5;
        const x0 = Math.max(0, Math.floor(sx0));
        const y0 = Math.max(0, Math.floor(sy0));
        const x1 = Math.min(tileSize - 1, Math.ceil(sx0));
        const y1 = Math.min(tileSize - 1, Math.ceil(sy0));
        let r = 0;
        let g = 0;
        let b = 0;
        let a = 0;
        let n = 0;
        for (let ty = y0; ty <= y1; ty += 1) {
          for (let tx = x0; tx <= x1; tx += 1) {
            const i = (ty * tileSize + tx) * 4;
            r += tile[i];
            g += tile[i + 1];
            b += tile[i + 2];
            a += tile[i + 3];
            n += 1;
          }
        }
        if (!n) continue;
        this.blend(px, py, [Math.round(r / n), Math.round(g / n), Math.round(b / n)], Math.round(a / n));
      }
    }
  }
}

/* ---------------- 图形 ---------------- */

/** 三白键 + 两金键，画满一个正方形画布（键组宽约 0.434、高约 0.36，居中）。 */
function drawKeys(surface, N) {
  const keyW = N * 0.13;
  const gap = N * 0.022;
  const keyH = N * 0.36;
  const originX = (N - (3 * keyW + 2 * gap)) / 2;
  const top = (N - keyH) / 2;
  for (let i = 0; i < 3; i += 1) {
    surface.fillRoundRect(originX + i * (keyW + gap), top, keyW, keyH, N * 0.02, BRAND.keyWhite);
  }
  // 「黑键」压在两根白键的缝上：比白键短，只从顶部下来 0.22
  const blackW = N * 0.085;
  const blackH = N * 0.22;
  for (let i = 0; i < 2; i += 1) {
    const center = originX + keyW + gap / 2 + i * (keyW + gap);
    surface.fillRoundRect(center - blackW / 2, top, blackW, blackH, N * 0.014, BRAND.keyGold);
  }
}

const TILE_SIZE = 256;
let motifTile = null;

/** 键组瓦片：只在第一次用时渲染，之后所有尺寸都从它缩放。 */
function getMotifTile() {
  if (!motifTile) {
    const surface = new Surface(TILE_SIZE, TILE_SIZE);
    drawKeys(surface, TILE_SIZE);
    motifTile = surface.data;
  }
  return motifTile;
}

/** 把键组按「占短边 ratio」的比例居中贴到画布上。 */
function blitMotif(surface, ratio) {
  const side = Math.min(surface.width, surface.height) * ratio;
  surface.blit(getMotifTile(), TILE_SIZE, (surface.width - side) / 2, (surface.height - side) / 2, side, side);
}

/* ---------------- 各类产物 ---------------- */

/** Android 旧式启动图标：深绿圆角方底 + 白/金键。 */
export function renderLegacyIcon(size) {
  const surface = new Surface(size, size);
  surface.fillRoundRect(0, 0, size, size, size * 0.22, BRAND.bg);
  blitMotif(surface, 0.434);
  return encodePng(size, size, surface.data);
}

/** Android 圆形图标（部分启动器用 ic_launcher_round）。 */
export function renderRoundIcon(size) {
  const surface = new Surface(size, size);
  surface.fillRoundRect(0, 0, size, size, size / 2, BRAND.bg);
  blitMotif(surface, 0.434);
  surface.maskCircle();
  return encodePng(size, size, surface.data);
}

/**
 * Android 自适应图标前景：透明底，图形缩到中心 60%——自适应图标只有中间
 * 72/108（66.7%）是任何遮罩都裁不掉的安全区，放满会被圆角/方形 mask 切边。
 */
export function renderAdaptiveForeground(size) {
  const surface = new Surface(size, size);
  blitMotif(surface, 0.6);
  return encodePng(size, size, surface.data);
}

/** iOS AppIcon：全出血方图（不烤圆角，系统按 mask 裁）。 */
export function renderIosAppIcon(size = 1024) {
  const surface = new Surface(size, size);
  surface.fillRect(0, 0, size, size, BRAND.bg);
  blitMotif(surface, 0.434);
  return encodePng(size, size, surface.data);
}

/** 启动图：深绿底 + 居中的小图标，尺寸按各平台原图比例。 */
export function renderSplash(width, height) {
  const surface = new Surface(width, height);
  surface.fillRect(0, 0, width, height, BRAND.bg);
  blitMotif(surface, 0.22);
  return encodePng(width, height, surface.data);
}

/* ---------------- 产物清单 ---------------- */

const ANDROID_ICON_DENSITIES = [
  ["mdpi", 48],
  ["hdpi", 72],
  ["xhdpi", 96],
  ["xxhdpi", 144],
  ["xxxhdpi", 192],
];

/** 自适应图标前景按 108dp 折算：mdpi 108 … xxxhdpi 432。 */
const FOREGROUND_DENSITIES = [
  ["mdpi", 108],
  ["hdpi", 162],
  ["xhdpi", 216],
  ["xxhdpi", 324],
  ["xxxhdpi", 432],
];

const SPLASH_FILES = [
  ["android/app/src/main/res/drawable/splash.png", 480, 320],
  ["android/app/src/main/res/drawable-land-mdpi/splash.png", 480, 320],
  ["android/app/src/main/res/drawable-land-hdpi/splash.png", 800, 480],
  ["android/app/src/main/res/drawable-land-xhdpi/splash.png", 1280, 720],
  ["android/app/src/main/res/drawable-land-xxhdpi/splash.png", 1600, 960],
  ["android/app/src/main/res/drawable-land-xxxhdpi/splash.png", 1920, 1280],
  ["android/app/src/main/res/drawable-port-mdpi/splash.png", 320, 480],
  ["android/app/src/main/res/drawable-port-hdpi/splash.png", 480, 800],
  ["android/app/src/main/res/drawable-port-xhdpi/splash.png", 720, 1280],
  ["android/app/src/main/res/drawable-port-xxhdpi/splash.png", 960, 1600],
  ["android/app/src/main/res/drawable-port-xxxhdpi/splash.png", 1280, 1920],
  ["ios/App/App/Assets.xcassets/Splash.imageset/splash-2732x2732.png", 2732, 2732],
  ["ios/App/App/Assets.xcassets/Splash.imageset/splash-2732x2732-1.png", 2732, 2732],
  ["ios/App/App/Assets.xcassets/Splash.imageset/splash-2732x2732-2.png", 2732, 2732],
];

/** 全部产物：[相对路径, 生成函数]。 */
export function iconTargets() {
  const targets = [];
  for (const [density, size] of ANDROID_ICON_DENSITIES) {
    targets.push([`android/app/src/main/res/mipmap-${density}/ic_launcher.png`, () => renderLegacyIcon(size)]);
    targets.push([`android/app/src/main/res/mipmap-${density}/ic_launcher_round.png`, () => renderRoundIcon(size)]);
  }
  for (const [density, size] of FOREGROUND_DENSITIES) {
    targets.push([`android/app/src/main/res/mipmap-${density}/ic_launcher_foreground.png`, () => renderAdaptiveForeground(size)]);
  }
  targets.push(["ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png", () => renderIosAppIcon(1024)]);
  for (const [path, width, height] of SPLASH_FILES) targets.push([path, () => renderSplash(width, height)]);
  return targets;
}

/** 写入或校验全部产物。check=true 时不写文件，只报差异。 */
export function generateIcons(root = projectRoot, { check = false } = {}) {
  const drifted = [];
  for (const [relative, build] of iconTargets()) {
    const path = resolve(root, relative);
    const expected = build();
    if (!existsSync(path)) {
      drifted.push(`${relative}（缺失）`);
      if (!check) {
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, expected);
      }
      continue;
    }
    if (!readFileSync(path).equals(expected)) {
      drifted.push(relative);
      if (!check) writeFileSync(path, expected);
    }
  }
  return { total: iconTargets().length, drifted };
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const check = process.argv.includes("--check");
  const { total, drifted } = generateIcons(projectRoot, { check });
  if (check) {
    if (drifted.length) {
      console.error(`图标与脚本不一致（${drifted.length}/${total}）：${drifted.join("、")}，跑 npm run icon:gen`);
      process.exit(1);
    }
    console.log(`图标一致：${total} 个产物与 scripts/gen-app-icon.mjs 相同`);
  } else {
    console.log(`已生成 ${total} 个图标/启动图产物${drifted.length ? `（更新 ${drifted.length} 个）` : "（无变化）"}`);
  }
}
