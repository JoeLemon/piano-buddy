import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(__dirname, "..");
const fontsDir = resolve(root, "public/fonts");
const cssPath = resolve(fontsDir, "fonts.css");

describe("自托管字体", () => {
  it("fonts.css 里的每个 woff2 都存在，且文件头是 wOF2", () => {
    const css = readFileSync(cssPath, "utf8");
    const files = [...css.matchAll(/url\("\.\/([^"]+\.woff2)"\)/g)].map((match) => match[1]);

    expect(files).toHaveLength(5);
    for (const file of files) {
      const path = resolve(fontsDir, file);
      expect(existsSync(path), `${file} 缺失，跑 npm run fonts:fetch`).toBe(true);
      expect(readFileSync(path).subarray(0, 4).toString("ascii")).toBe("wOF2");
    }
  });

  it("index.html 只引用本地字体，不再请求 Google Fonts", () => {
    const html = readFileSync(resolve(root, "index.html"), "utf8");
    expect(html).toContain('href="/fonts/fonts.css"');
    expect(html).not.toMatch(/href=["']https:\/\/fonts\.googleapis\.com/);
    expect(html).not.toMatch(/href=["']https:\/\/fonts\.gstatic\.com/);
  });
});
