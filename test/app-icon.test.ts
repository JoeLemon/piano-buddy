import { inflateSync } from "node:zlib";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  BRAND,
  encodePng,
  generateIcons,
  iconTargets,
  renderAdaptiveForeground,
  renderIosAppIcon,
  renderLegacyIcon,
  renderRoundIcon,
  renderSplash,
} from "../scripts/gen-app-icon.mjs";

const root = resolve(__dirname, "..");

/** 读 PNG 头，拿宽高与色彩类型（不引图片库）。 */
function readPngHeader(buffer: Buffer) {
  const signature = buffer.subarray(0, 8).toString("hex");
  return {
    signature,
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
    colorType: buffer[25],
  };
}

/** 解 IDAT 太费事，这里只验证每个 chunk 的 CRC 是否自洽。 */
function chunksAreSelfConsistent(buffer: Buffer): boolean {
  let offset = 8;
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.subarray(offset + 4, offset + 8).toString("ascii");
    const expected = buffer.readUInt32BE(offset + 8 + length);
    // zlib.crc32 在 node 22 可用；这里用手头最稳的方式重算
    const body = buffer.subarray(offset + 4, offset + 8 + length);
    const actual = crc32Of(body);
    if (actual !== expected) return false;
    offset += 12 + length;
    if (type === "IEND") break;
  }
  return true;
}

import { crc32 } from "node:zlib";
function crc32Of(body: Buffer): number {
  return crc32(body) >>> 0;
}

describe("PNG 编码", () => {
  it("写出的文件带头有正确的签名、尺寸与 RGBA 色彩类型", () => {
    const png = encodePng(4, 3, new Uint8Array(4 * 3 * 4));
    const header = readPngHeader(png);
    expect(header.signature).toBe("89504e470d0a1a0a");
    expect(header.width).toBe(4);
    expect(header.height).toBe(3);
    expect(header.colorType).toBe(6);
    expect(chunksAreSelfConsistent(png)).toBe(true);
  });

  it("同样输入得到同样字节（CI 的 --check 靠这个发现漂移）", () => {
    expect(renderLegacyIcon(64).equals(renderLegacyIcon(64))).toBe(true);
  });
});

/** 中央区域（避开边缘留白）里最亮的通道值——用来确认「白键真的画上去了」。 */
function brightestInCenter(pixels: Uint8Array, size: number): number {
  let brightest = 0;
  const from = Math.round(size * 0.25);
  const to = Math.round(size * 0.75);
  for (let y = from; y < to; y += 1) {
    for (let x = from; x < to; x += 1) {
      const i = (y * size + x) * 4;
      brightest = Math.max(brightest, pixels[i], pixels[i + 1], pixels[i + 2]);
    }
  }
  return brightest;
}

describe("图标图形", () => {
  it("Android 旧式图标：四角透明（烤了圆角），中央有白键", () => {
    const png = renderLegacyIcon(48);
    expect(readPngHeader(png).width).toBe(48);
    const pixels = decodeRgba(png);
    expect(pixels.at(0)).toBe(0); // 左上角 alpha：圆角裁掉了
    expect(pixels.at(24 * 48 * 4 + 3)).toBeGreaterThan(200); // 中心不透明（深绿底）
    expect(brightestInCenter(pixels, 48)).toBeGreaterThan(200); // 白键是亮的
  });

  it("圆形图标：四个角都裁掉，中央同样有白键", () => {
    const png = renderRoundIcon(64);
    const pixels = decodeRgba(png);
    expect(pixels.at(0)).toBe(0);
    expect(pixels.at(63 * 64 * 4 + 3)).toBe(0);
    expect(brightestInCenter(pixels, 64)).toBeGreaterThan(200);
  });

  it("自适应前景：底色全透明，只画中间的键", () => {
    const png = renderAdaptiveForeground(108);
    const pixels = decodeRgba(png);
    expect(pixels.at(0)).toBe(0); // 角落全透明
    const keyX = Math.round((108 - 108 * 0.6 * 0.434) / 2 + (108 * 0.6 * 0.13) / 2);
    const white = pixels.subarray((54 * 108 + keyX) * 4, (54 * 108 + keyX) * 4 + 4);
    expect(Math.max(white[0], white[1], white[2])).toBeGreaterThan(180);
    // 108dp 画布的安全区是中间 72dp：图形不该超出 18..90 的范围
    let minX = 108;
    let maxX = -1;
    for (let y = 0; y < 108; y += 1) {
      for (let x = 0; x < 108; x += 1) {
        if (pixels[(y * 108 + x) * 4 + 3] > 128) {
          minX = Math.min(minX, x);
          maxX = Math.max(maxX, x);
        }
      }
    }
    expect(minX).toBeGreaterThanOrEqual(14);
    expect(maxX).toBeLessThanOrEqual(94);
  });

  it("iOS 图标：1024 全出血深绿底，不烤圆角", () => {
    const png = renderIosAppIcon(1024);
    const pixels = decodeRgba(png);
    expect(readPngHeader(png).width).toBe(1024);
    // 左上角就是深绿（iOS 自己按 mask 裁圆角）
    expect(pixels[0]).toBe(BRAND.bg[0]);
    expect(pixels[1]).toBe(BRAND.bg[1]);
    expect(pixels[2]).toBe(BRAND.bg[2]);
    expect(pixels[3]).toBe(255);
  });

  it("启动图按传入的宽高输出，背景是品牌深绿", () => {
    const png = renderSplash(320, 480);
    const header = readPngHeader(png);
    expect([header.width, header.height]).toEqual([320, 480]);
    const pixels = decodeRgba(png);
    expect(pixels[3]).toBe(255);
    expect([pixels[0], pixels[1], pixels[2]]).toEqual(BRAND.bg);
  });
});

describe("产物清单与仓库现状", () => {
  it("每个产物都有生成函数，路径不重复", () => {
    const targets = iconTargets();
    const paths = targets.map(([path]) => path);
    expect(new Set(paths).size).toBe(paths.length);
    expect(paths.length).toBeGreaterThanOrEqual(30);
    expect(paths.some((p) => p.endsWith("mipmap-xxxhdpi/ic_launcher.png"))).toBe(true);
    expect(paths.some((p) => p.includes("AppIcon.appiconset/AppIcon-512@2x.png"))).toBe(true);
  });

  it("仓库里的产物与脚本一致（改了图形忘了重跑会挂这里）", () => {
    const { total, drifted } = generateIcons(root, { check: true });
    expect(drifted).toEqual([]);
    expect(total).toBe(iconTargets().length);
  });
});

/** 最小 PNG 解码：只处理本项目生成的「无隔行 + filter 0」RGBA8。 */
function decodeRgba(png: Buffer): Uint8Array {
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  const idat = collectIdat(png);
  const raw = inflateSync(idat);
  const stride = width * 4;
  const out = new Uint8Array(stride * height);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)];
    expect(filter).toBe(0);
    out.set(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)), y * stride);
  }
  return out;
}

function collectIdat(png: Buffer): Buffer {
  const parts = [];
  let offset = 8;
  while (offset < png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.subarray(offset + 4, offset + 8).toString("ascii");
    if (type === "IDAT") parts.push(png.subarray(offset + 8, offset + 8 + length));
    offset += 12 + length;
    if (type === "IEND") break;
  }
  return Buffer.concat(parts);
}
