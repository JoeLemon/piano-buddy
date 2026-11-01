import { inflateRawSync } from "node:zlib";
import { parseXml, type XmlNode } from "../../src/repertoire/musicxml";

/**
 * 读 `.mxl`（压缩的 MusicXML）。
 *
 * `.mxl` 不是另一种谱面格式，只是一个 zip：真正的谱面躺在里面，另外用
 * `META-INF/container.xml` 指一下是哪个文件。MuseScore、Finale 这些软件
 * 默认导出的就是它，所以「请先另存为 .musicxml」一直是个多余的坎。
 *
 * 这里只做两件事：把 zip 解出指定条目、按 container 找到谱面。不做 CRC 校验
 * （谱面文本自己会被 XML 解析器严格校验，坏文件在那里就炸了），也不碰图片
 * 之类的其它条目。
 *
 * zip 解析不引依赖：`node:zlib` 的 `inflateRawSync` 就够，剩下的只是按
 * 中央目录把字节切出来。只支持 stored(0) 与 deflate(8) 两种方法——`.mxl`
 * 里的条目一律是这两种。
 */

const EOCD_SIG = 0x06054b50; // "PK\x05\x06"
const CENTRAL_SIG = 0x02014b50; // "PK\x01\x02"
const LOCAL_SIG = 0x04034b50; // "PK\x03\x04"

type ZipEntry = {
  name: string;
  method: number;
  compressedSize: number;
  localOffset: number;
};

/** 从末尾往前找目录结尾记录；注释最长 65535，所以最多回看这么远。 */
function findEndOfCentralDirectory(buf: Uint8Array): number {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const earliest = Math.max(0, buf.length - 22 - 0xffff);
  for (let at = buf.length - 22; at >= earliest; at -= 1) {
    if (view.getUint32(at, true) === EOCD_SIG) return at;
  }
  throw new Error("不是有效的 zip：找不到目录结尾记录（文件可能被截断）");
}

function readCentralDirectory(buf: Uint8Array): ZipEntry[] {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const eocd = findEndOfCentralDirectory(buf);
  const count = view.getUint16(eocd + 10, true);
  let at = view.getUint32(eocd + 16, true);

  const entries: ZipEntry[] = [];
  for (let index = 0; index < count; index += 1) {
    if (view.getUint32(at, true) !== CENTRAL_SIG) {
      throw new Error(`zip 目录第 ${index + 1} 项损坏`);
    }
    const method = view.getUint16(at + 10, true);
    const compressedSize = view.getUint32(at + 20, true);
    const nameLength = view.getUint16(at + 28, true);
    const extraLength = view.getUint16(at + 30, true);
    const commentLength = view.getUint16(at + 32, true);
    const localOffset = view.getUint32(at + 42, true);
    const name = new TextDecoder("utf-8").decode(buf.subarray(at + 46, at + 46 + nameLength));
    entries.push({ name, method, compressedSize, localOffset });
    at += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

/** 按 local header 找出数据起点，再按压缩方式还原。 */
function readEntry(buf: Uint8Array, entry: ZipEntry): Uint8Array {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  if (view.getUint32(entry.localOffset, true) !== LOCAL_SIG) {
    throw new Error(`zip 条目 ${entry.name} 的头部损坏`);
  }
  const nameLength = view.getUint16(entry.localOffset + 26, true);
  const extraLength = view.getUint16(entry.localOffset + 28, true);
  const start = entry.localOffset + 30 + nameLength + extraLength;
  const raw = buf.subarray(start, start + entry.compressedSize);

  if (entry.method === 0) return raw;
  if (entry.method === 8) {
    try {
      return inflateRawSync(raw);
    } catch (error) {
      throw new Error(`zip 条目 ${entry.name} 解压失败：${(error as Error).message}`);
    }
  }
  throw new Error(`zip 条目 ${entry.name} 用了不支持的压缩方式 ${entry.method}`);
}

/** `META-INF/container.xml` 里的 `rootfile/@full-path`。 */
function rootfileFromContainer(xml: string): string | null {
  let doc: XmlNode;
  try {
    doc = parseXml(xml);
  } catch {
    return null;
  }
  const walk = (node: XmlNode): string | null => {
    if (node.name === "rootfile") {
      const path = node.attrs["full-path"] ?? node.attrs.fullpath;
      if (path) return path;
    }
    for (const child of node.children) {
      const found = walk(child);
      if (found) return found;
    }
    return null;
  };
  return walk(doc);
}

export type MxlReadResult = {
  /** 谱面 XML 文本。 */
  musicxml: string;
  /** 实际取到的包内路径，日志里写出来便于排查。 */
  entry: string;
  /** 非阻断提示（比如 container 缺失、退回猜文件名）。 */
  warnings: string[];
};

/**
 * 解开一个 `.mxl`，返回谱面 XML 文本。
 *
 * 查找顺序：`META-INF/container.xml` 指的文件 → 第一个非 META-INF 的
 * `.musicxml` / `.xml`。前者是规范做法，后者兼容手工打的包。
 */
export function readMxl(data: Uint8Array): MxlReadResult {
  const warnings: string[] = [];
  const entries = readCentralDirectory(data);
  const byName = new Map(entries.map((entry) => [entry.name, entry]));

  let target: string | null = null;
  const container = byName.get("META-INF/container.xml");
  if (container) {
    const xml = new TextDecoder("utf-8").decode(readEntry(data, container));
    target = rootfileFromContainer(xml);
    if (!target) warnings.push("container.xml 里没读到 rootfile，改用包内第一个谱面文件");
  } else {
    warnings.push("包里没有 META-INF/container.xml，改用第一个谱面文件");
  }

  if (!target || !byName.has(target)) {
    if (target) warnings.push(`container 指向的 ${target} 不在包里，改用第一个谱面文件`);
    target =
      entries.find(
        (entry) =>
          !entry.name.startsWith("META-INF/") &&
          entry.name !== "mimetype" &&
          /\.(musicxml|xml)$/i.test(entry.name),
      )?.name ?? null;
  }

  if (!target) throw new Error("这个 .mxl 里没有找到 MusicXML（既没有 container.xml，也没有 .xml 谱面）");

  const text = new TextDecoder("utf-8").decode(readEntry(data, byName.get(target)!));
  // 有些软件会在开头写 BOM；XML 声明前面多一个字符会让解析器直接报错。
  return { musicxml: text.charCodeAt(0) === 0xfeff ? text.slice(1) : text, entry: target, warnings };
}
