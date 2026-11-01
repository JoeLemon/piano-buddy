# 曲目包内容目录

每个子目录是一个数据包，至少包含：

```
<package>/
├── manifest.json
└── content/
    └── score.json
```

参考示例：《欢乐颂》同一首曲子的三档编配——`song.ode-to-joy.l2/`（L2）、`song.ode-to-joy.l3/`（L3）、`song.ode-to-joy.l4/`（L4），每档 8 小节；原创示范曲 `song.morning-song.l5/`（L5，弱起小节 + 跨小节延音）；以及 `song.evening-breeze.l4plus/`（L4+，3/4 拍、1 拍弱起、9 小节，双手都有跨小节延音，适合当「连线 + 弱起」的完整样例）；`song.rain-alley.l4/`（L4，A 小调、3/4 拍、12 小节、左手柱式和弦，适合当小调入门样例）；`song.little-boat.l5/`（L5，6/8 拍、12 小节、右手八分音符旋律、左手根音 + 柱式和弦，适合当 6/8 入门样例）；`song.starlight.l5/`（L5，4/4 拍、12 小节、右手四分音符三连音、左手全音符柱式和弦，适合当三连音入门样例）；`song.rainbow.l5/`（L5，4/4 拍、12 小节、左手三和弦转位与大七/属七柱式和弦、右手四分音符旋律，适合当转位/七和弦入门样例）；`song.wind-chime.l6/`（L6，4/4 拍、12 小节、右手十六分音符跑动与六度/八度跳进、左手分解和弦，适合当 L6 综合样例）；`song.dusk.l4/`（L4+，E 小调、3/4 拍、12 小节、右手八分音符旋律、左手分解和弦，适合当第二种小调的教学样例）；`song.gust.l6/`（L6，4/4 拍、12 小节、右手十六分跑动与换位、左手分解和弦换位，适合当第二首 L6 样例）；`song.lantern.l4/`（L4，D 小调、4/4 拍、12 小节、右手八分音符旋律、左手 Dm/F/C 柱式和弦，适合当 d 小调教学样例）；`song.corridor.l6/`（L6，F 大调一个降号、4/4 拍、12 小节、右手十六分跑动与八度跳进、左手分解和弦换位，适合当「非 C 调」的 L6 样例）；`song.mist.l6/`（L6，A 小调、4/4 拍、8 小节、右手柱式和弦（含八度重复根音）与半减七 B–D–F–A、减七 G♯–B–D–F，左手长音低音，适合当「减和弦 + 重复根音」的样例）。`catalog.json` 由脚本从这些包聚合生成，不要手工维护。

## 作者流程

1. 复制示例包，修改 `manifest.json` 的 `id` / `songId` / `arrangementId` / `songTitle` / `composer` / `name` / `difficulty`。
2. 写 `content/score.json`（内部 `Score` 格式）；也可以从 MusicXML 生成，见下节。
3. 为**每个音**填 `fingers`，取值 1..5；不要用 0。
4. 运行校验：

```bash
npm run validate:content
# 或只检查一个包
npm run validate:content -- content/song.ode-to-joy.l3
```

5. 0 error 后重新生成曲库目录：

```bash
npm run build:catalog
```

6. 提交前确认 `content/catalog.json` 已更新。warning 需要人工确认（通常是 `skillDeps` 与引擎识别不完全一致，或声明难度偏高）。

## 从 MusicXML 生成 score.json

MuseScore 里排好谱（单声部或钢琴大谱表、4/4 / 3/4 / 6/8、C/F/G/D/♭B 大调或 a/e/d 小调），导出未压缩的 `.musicxml`：

```bash
# 先看报告：小节数、评级、需要技能、可直接粘进 manifest 的字段
npm run import:musicxml -- song.musicxml

# 转换并补指法，直接写到包里
npm run import:musicxml -- song.musicxml \
  --out content/song.x/content/score.json --id score.song.x --bpm 96

# 转换 + 用现有 manifest 跑内容 QA
npm run import:musicxml -- song.musicxml --manifest content/song.x/manifest.json
```

导入器会报错而不是降级处理的情况：6/8 之外的拍号、不在支持范围的调号（大调只到两个升降号，小调只支持 a/e/d）、32 分音符、5:4 等非 3:2 连音符、附点三连音、跨小节三连音、重升重降、`score-timewise`、一行谱多声部（可加 `--voice 2` 指定保留哪一声部）、**两只手首小节拍数不一致**。小节缺拍会补休止符，以警告写出来。

**6/8**：从 L5 起进入词汇表；内部时间轴仍以四分音符为 1 拍，所以一小节是 `6 × 4/8 = 3` 拍。导入器读 `<time>6/8</time>`，`score.json` 写 `"meter": { "beats": 6, "beatValue": 8 }`。

**三连音**：只支持 3:2，即三个同基础时值的音占两个。`score.json` 里给同一组连续 3 个音加同一个 `tuplet` 字符串（组 id 全谱唯一、不能跨小节），`duration` 仍写基础时值（如 `"8"`），实际拍数由引擎按 2/3 折算。组里可以含休止符。导入器读 `<time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes></time-modification>` 和 `<type>`；组不完整、基础时值不一致或跨小节都会报错。

**小调调号**：MusicXML 的 `<key>` 同时看 `<fifths>` 和 `<mode>`。`<mode>minor</mode>` + fifths `0/1/-1` 分别导入成 `Am/Em/Dm`；缺省 `<mode>` 按大调处理。小调按自然小调写调号，和声小调的升高导音（如 E 小调的 D♯）写成临时记号。

**弱起小节**：首小节不满拍就按弱起导入，报告里会写一句，`score.json` 里多一个 `"pickup": 1`。两手首小节必须一样短（MuseScore 的弱起小节会自动缩短所有谱表；如果一手满一手短，说明小节线没对齐，请先改谱）。手工写 `score.json` 时：`pickup` 是**首小节的拍数**（四分音符单位；6/8 的一整小节是 3，不是 6），取值 `0 < pickup < 每小节拍数`、且是十六分音符/三连音栅格的整数倍，首小节的实际时值必须正好等于它，否则 `validate:content` 报错。

**连音线**（`<tie>`）小节内和跨小节都支持，保留成 `tie: "start" | "stop" | "continue"` 链而不是合并成长音——这样谱面上能看到连线，跟弹也知道那段不用重新击键。前提是链必须接得上：`start` 后面要跟同音高的 `stop`/`continue`，中间不能隔别的音或被休止符打断；`validate:content` 会把断线算成错误。

**反复与导航**：`score.json` 里写 `repeats` / `navigation`，小节号 **0 起算、两端都包含**：

```json
{
  "repeats": [{ "from": 0, "to": 7 }, { "from": 8, "to": 15, "times": 3 }],
  "navigation": [
    { "at": 8, "kind": "segno" },
    { "at": 19, "kind": "ds" },
    { "at": 15, "kind": "to-coda" },
    { "at": 23, "kind": "coda" }
  ]
}
```

- `repeats`：`|: :|`，省略 `times` 即弹两遍；`times` 必须是 2–16 的整数。可以嵌套（内层先反复），但**不能部分重叠**，也不能两个段落从同一小节开始。
- `navigation.kind`：`dc`（回到第 1 小节）、`ds`（回到 `segno`）、`segno` / `coda`（落点）、`fine`（D.C./D.S. 后的收尾）、`to-coda`（第二遍跳 `coda`）。D.C./D.S. 只触发一次；同一份谱不能同时有 D.C. 和 D.S.。
- 谱面仍按「写一遍」的线性小节保存，跟弹、试听、节拍网格会按展开后的演奏顺序走；反复线由渲染层画成 `|:` / `:|`，导航记号画成谱表下方的小字。
- MusicXML 导入会读 `<barline>` 里的 `repeat` / `segno` / `coda` / `fine`，以及 `<sound dacapo|dalsegno|fine|tocoda>` 和 `<words>` 里的 D.C./D.S. 文本；没有配对的反复端点会直接报错，不猜。

**注意**：转换后补的指法来自求解器，它只看局部连贯，可能给出一只手换位的指法，把评级抬高（脚本会把「按音高」和「按指法」两个数都打出来）。**导入的指法只是起点，提交前必须人工校对**；`validate:content` 是按指法评级的。

## 批量导入与评级差异表

收一批谱时用 `import:batch`，一次扫描目录（可递归）并给每首生成一个包：

```bash
# 默认写到 content/<slug>/
npm run import:batch -- path/to/musicxml/

# 指定输出根目录和 manifest 模板
npm run import:batch -- path/to/musicxml/ --out content --template content/import-template.example.json

# 试运行 + 机器可读报告；差 ≥2 档或仍有音没补上指法时返回非 0
npm run import:batch -- path/to/musicxml/ --strict --json --report tmp/import-report.json
```

输出表里有四列值得先看：

```
文件               | 小节 | 按音高 | 按指法 | 差 | 未补指法 | 状态
-------------------+------+--------+--------+----+----------+-----
Demo Song.musicxml | 2    | L1+    | L3     | +2 | 0        | !
```

- **按音高**：未补指法时按谱面/词汇表评级，代表这首谱本身的要求。
- **按指法**：补完指法后引擎读手位得出的评级，`validate:content` 用这个。
- **差**：`按指法 - 按音高`。`+2` 及以上通常是求解器把手位判错了，`--strict` 会让这批导入失败；先人工改 `fingers`，不要直接改声明档。
- **未补指法**：补完后仍没有 1..5 指法的音数；>0 时 demo 会崩，`--strict` 也会失败。

默认 manifest 的 `difficulty.level` 取「按音高/按指法」的较大值，`skillDeps` 用补指法后的识别结果，保证刚导入的包能通过内容 QA；它只是起点，作者仍要按差异表校对。`--no-fingers` 只做转换和按音高评级，适合先看谱面难度。

目录里出现 `.mxl` 会跳过并提示先解压成 `.musicxml`。已存在的包目录默认跳过，确认要覆盖时加 `--force`。`--json` 输出纯 ASCII 转义的 JSON（避免 Windows 管道按 GBK 转码），人类日志走 stderr；`--report` 另存一份 UTF-8 报告。

模板是普通 JSON，字符串里的 `{{slug}}` / `{{title}}` / `{{file}}` / `{{id}}` / `{{songId}}` / `{{arrangementId}}` / `{{level}}` / `{{pitchLevel}}` / `{{fingerLevel}}` / `{{pitchLabel}}` / `{{fingerLabel}}` / `{{bpm}}` / `{{measures}}` / `{{skills}}` 会被替换。整个字符串正好是一个占位符时保留类型，所以：

```json
{
  "name": "{{title}} · 导入编配",
  "composer": "待填写",
  "difficulty": { "level": "{{level}}", "repeat": 0.3 },
  "skillDeps": ["{{skills}}"],
  "rights": { "type": "user-imported" }
}
```

`skillDeps` 里的 `["{{skills}}"]` 会摊平成技能数组，不会变成嵌套数组。

## 当前硬约束（P1）

- 调号：C / F / G / D / Bb 大调；a / e / d 小调。小调从 L4 起进入词汇表，L1–L3 仍只教大调。
- 拍号：4/4、3/4、6/8。6/8 从 L5 起进入词汇表。
- 和弦：C–E–G、F–A–C、G–B–D 大三和弦，以及 A–C–E、D–F–A、E–G–B 小三和弦。L3 只收原位三和弦；L4 起开放转位（同一组音级，低音不是根音）。L5 起开放大七/小七/属七和弦与**八度重复根音**的四音三和弦（`C4–E4–G4–C5`），两者都只限总跨度 ≤ 一个八度。L6 起开放**减七**与**半减七**（`B–D–F–A♭` / `B–D–F–A`），需要 `chord.diminished` 节点。增三和弦与五音以上的和弦仍不在范围。转位、七和弦、减和弦分别触发 `chord.inversion` / `chord.seventh` / `chord.diminished` 评级。
- 节奏：支持跨小节连音线（`tie`）、弱起小节（`pickup`）、`|: :|` 反复与 D.C./D.S. 导航、3:2 三连音（`tuplet`）；三连音从 L5 起进入词汇表。
- 每只手单声部；`Score` 没有力度/踏板/速度地图。
- 曲目先做 8–16 小节教学版，不做完整原曲。

超出以上范围的内容会在 `validateSongContent` 报错（`minLevel=7`），不是“引擎没识别出来”。

## manifest 要点

- `id`：包稳定唯一 id，**不要写难度**；重新评级时不变。
- `songId` / `arrangementId`：同一歌曲的多个编配共享 `songId`；`arrangementId` 全局唯一。
- `songTitle` / `composer`：曲库展示用；同一 `songId` 下必须一致。catalog 生成时要求 `songTitle` 非空。
- `difficulty.level`：作者声明档；**不能低于引擎评级**。
- `difficulty.len`：小节数，不是秒。
- `skillDeps`：必须引用 `src/repertoire/skillGraph.ts` 里的技能 id。
- `assets`：包内相对 POSIX 路径，拒绝绝对路径/反斜杠/`..`。
- `rights.type`：`public-domain` / `licensed` / `original` / `user-imported`。
- `rights.expiresAt`：ISO 日期；过期时 loader 给警告，`build:catalog` 会把该编配下架（不进目录）。
- `checksum`：声明后按「`assets` 顺序拼接 `路径\n内容`」重算 sha256/sha512 并比对；不声明则跳过。

## 单文件导入包（`.pbpack` / `.json`）

浏览器不能直接读目录，所以外部包用一个 JSON 文件交换：

```json
{
  "manifest": {
    "schemaVersion": 1,
    "id": "pkg.demo",
    "name": "示例曲 · L2 编配",
    "type": "song",
    "version": "1.0.0",
    "songId": "song.demo",
    "arrangementId": "arr.demo.l2",
    "songTitle": "示例曲",
    "minAppVersion": "2.0.0",
    "skillDeps": ["clef.treble", "rhythm.quarter"],
    "assets": ["content/score.json"]
  },
  "files": {
    "content/score.json": "{ ... score.json 的文本 ... }"
  }
}
```

- `manifest` 与 `manifest.json` 完全同构，校验规则也相同；`files` 的值必须是**字符串**。
- 只有 `manifest.assets` 里声明的资源会进入运行时；额外文件被忽略。
- `minAppVersion` 是硬门槛：高于当前 App 版本（`src/version.ts` 的 `APP_VERSION`）时拒绝安装，不会“先装再提示”。
- 安装后按 `manifest.id` 存在独立的 IndexedDB `piano-buddy-packages`；同 id 再次导入即覆盖升级。
- 曲库按 `arrangementId` / `packageId` 与内置目录合并，同 id 以已安装版本为准。

## 当前限制

- 包大小上限：单文件 512 KB、合计 4 MB（`MAX_ASSET_BYTES` / `MAX_TOTAL_BYTES`）；暂不支持签名。
- MusicXML 转换器只覆盖当前 `Score` 能表达的子集（见上节）；`.mxl` 压缩包需先另存为 `.musicxml`。
- 指法求解器只保证局部连贯，不保证与记谱手位一致；导入内容的指法需人工校对。
- `catalog.json` 是构建产物，不是数据包；不要给它加 `manifest.json`。
