import { crc32, deflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { readMxl } from "../scripts/lib/mxl";

/**
 * `.mxl` 解压的契约。
 *
 * 不往仓库里放二进制样本：这里现场造一个 zip，用的是与真实 `.mxl` 相同的
 * 结构（local header + 中央目录 + 目录结尾），所以解压路径是真跑过的。
 */

const u16 = (value: number) => {
  const buffer = Buffer.alloc(2);
  buffer.writeUInt16LE(value);
  return buffer;
};
const u32 = (value: number) => {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32LE(value);
  return buffer;
};

type ZipFile = { name: string; data: string; deflate?: boolean };

/** 造一个 zip。默认 deflate（真实 `.mxl` 里谱面就是 deflate 的）。 */
function makeZip(files: ZipFile[]): Uint8Array {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;

  for (const file of files) {
    const name = Buffer.from(file.name, "utf8");
    const raw = Buffer.from(file.data, "utf8");
    const deflated = file.deflate ?? true;
    const body = deflated ? deflateRawSync(raw) : raw;
    const method = deflated ? 8 : 0;
    const sum = crc32(raw);

    const local = Buffer.concat([
      u32(0x04034b50), u16(20), u16(0x0800), u16(method),
      u16(0), u16(0), // 修改时间 / 日期，读的时候不看
      u32(sum), u32(body.length), u32(raw.length),
      u16(name.length), u16(0), name, body,
    ]);
    locals.push(local);

    centrals.push(
      Buffer.concat([
        u32(0x02014b50), u16(20), u16(20), u16(0x0800), u16(method),
        u16(0), u16(0), u32(sum), u32(body.length), u32(raw.length),
        u16(name.length), u16(0), u16(0),
        u16(0), u16(0), u32(0),
        u32(offset), name,
      ]),
    );
    offset += local.length;
  }

  const directory = Buffer.concat(centrals);
  const end = Buffer.concat([
    u32(0x06054b50), u16(0), u16(0), u16(files.length), u16(files.length),
    u32(directory.length), u32(offset), u16(0),
  ]);
  return new Uint8Array(Buffer.concat([...locals, directory, end]));
}

const SCORE = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0"><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list><part id="P1"><measure number="1"><attributes><divisions>1</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes><note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><type>whole</type></note></measure></part></score-partwise>`;

const CONTAINER = (path: string) => `<?xml version="1.0" encoding="UTF-8"?>
<container><rootfiles><rootfile full-path="${path}" media-type="application/vnd.recordare.musicxml+xml"/></rootfiles></container>`;

describe("readMxl", () => {
  it("follows container.xml to the score and returns its text", () => {
    const zip = makeZip([
      { name: "META-INF/container.xml", data: CONTAINER("score.musicxml"), deflate: false },
      { name: "score.musicxml", data: SCORE },
    ]);

    const result = readMxl(zip);
    expect(result.entry).toBe("score.musicxml");
    expect(result.musicxml).toContain("<score-partwise");
    expect(result.musicxml).toContain("<step>C</step>");
    expect(result.warnings).toEqual([]);
  });

  it("reads a stored (uncompressed) score too", () => {
    // 有的软件会把谱面原样存进去，方法 0 也要能读
    const zip = makeZip([
      { name: "META-INF/container.xml", data: CONTAINER("score.xml"), deflate: false },
      { name: "score.xml", data: SCORE, deflate: false },
    ]);
    expect(readMxl(zip).musicxml).toContain("<score-partwise");
  });

  it("falls back to the first xml when container.xml is missing", () => {
    const zip = makeZip([
      { name: "piano.musicxml", data: SCORE },
      { name: "cover.png", data: "not-really-a-png" },
    ]);

    const result = readMxl(zip);
    expect(result.entry).toBe("piano.musicxml");
    expect(result.warnings.join()).toContain("没有 META-INF/container.xml");
  });

  it("falls back when container points at a path that is not in the package", () => {
    const zip = makeZip([
      { name: "META-INF/container.xml", data: CONTAINER("missing.musicxml"), deflate: false },
      { name: "actual.xml", data: SCORE },
    ]);

    const result = readMxl(zip);
    expect(result.entry).toBe("actual.xml");
    expect(result.warnings.join()).toContain("不在包里");
  });

  it("strips a leading byte-order mark", () => {
    // XML 声明前多一个 U+FEFF，解析器会直接报错，所以这里先去掉
    const zip = makeZip([{ name: "score.xml", data: `\uFEFF${SCORE}` }]);
    expect(readMxl(zip).musicxml.charCodeAt(0)).toBe("<".charCodeAt(0));
  });

  it("rejects a package with no score at all", () => {
    const zip = makeZip([{ name: "readme.txt", data: "nothing here" }]);
    expect(() => readMxl(zip)).toThrow(/没有找到 MusicXML/);
  });

  it("rejects something that is not a zip", () => {
    expect(() => readMxl(new Uint8Array(Buffer.from("<?xml version=\"1.0\"?>")))).toThrow(
      /不是有效的 zip/,
    );
  });
});
