# 曲目包内容目录

每个子目录是一个数据包，至少包含：

```
<package>/
├── manifest.json
└── content/
    └── score.json
```

参考示例：《欢乐颂》同一首曲子的三档编配——`song.ode-to-joy.l2/`（L2）、`song.ode-to-joy.l3/`（L3）、`song.ode-to-joy.l4/`（L4），每档 8 小节；另有原创示范曲 `song.morning-song.l5/`（L5，弱起小节 + 跨小节延音）。`catalog.json` 由脚本从这些包聚合生成，不要手工维护。

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

MuseScore 里排好谱（单声部或钢琴大谱表、4/4 或 3/4、C/F/G/D/♭B 大调），导出未压缩的 `.musicxml`：

```bash
# 先看报告：小节数、评级、需要技能、可直接粘进 manifest 的字段
npm run import:musicxml -- song.musicxml

# 转换并补指法，直接写到包里
npm run import:musicxml -- song.musicxml \
  --out content/song.x/content/score.json --id score.song.x --bpm 96

# 转换 + 用现有 manifest 跑内容 QA
npm run import:musicxml -- song.musicxml --manifest content/song.x/manifest.json
```

导入器会报错而不是降级处理的情况：6/8 及其它拍号、两个升降号以上的调号、32 分音符、三连音、重升重降、`score-timewise`、一行谱多声部（可加 `--voice 2` 指定保留哪一声部）、**两只手首小节拍数不一致**。小节缺拍会补休止符，以警告写出来。

**弱起小节**：首小节不满拍就按弱起导入，报告里会写一句，`score.json` 里多一个 `"pickup": 1`。两手首小节必须一样短（MuseScore 的弱起小节会自动缩短所有谱表；如果一手满一手短，说明小节线没对齐，请先改谱）。手工写 `score.json` 时：`pickup` 是**首小节的拍数**，取值 `0 < pickup < 每小节拍数`、且是十六分音符的整数倍，首小节的实际时值必须正好等于它，否则 `validate:content` 报错。

**连音线**（`<tie>`）小节内和跨小节都支持，保留成 `tie: "start" | "stop" | "continue"` 链而不是合并成长音——这样谱面上能看到连线，跟弹也知道那段不用重新击键。前提是链必须接得上：`start` 后面要跟同音高的 `stop`/`continue`，中间不能隔别的音或被休止符打断；`validate:content` 会把断线算成错误。

**注意**：转换后补的指法来自求解器，它只看局部连贯，可能给出一只手换位的指法，把评级抬高（脚本会把「按音高」和「按指法」两个数都打出来）。**导入的指法只是起点，提交前必须人工校对**；`validate:content` 是按指法评级的。

## 当前硬约束（P0.5）

- 调号：C / F / G / D / Bb 大调。
- 拍号：4/4、3/4。
- 和弦：只允许 C–E–G、F–A–C、G–B–D 原位大三和弦。
- 节奏：支持跨小节连音线（`tie`）与弱起小节（`pickup`）；不支持反复。
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

## 当前限制

- 包大小上限：单文件 512 KB、合计 4 MB（`MAX_ASSET_BYTES` / `MAX_TOTAL_BYTES`）；暂不支持签名。
- MusicXML 转换器只覆盖当前 `Score` 能表达的子集（见上节）；`.mxl` 压缩包需先另存为 `.musicxml`。
- 指法求解器只保证局部连贯，不保证与记谱手位一致；导入内容的指法需人工校对。
- `catalog.json` 是构建产物，不是数据包；不要给它加 `manifest.json`。
