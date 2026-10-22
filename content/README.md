# 曲目包内容目录

每个子目录是一个数据包，至少包含：

```
<package>/
├── manifest.json
└── content/
    └── score.json
```

参考示例：《欢乐颂》同一首曲子的三档编配——`song.ode-to-joy.l2/`（L2）、`song.ode-to-joy.l3/`（L3）、`song.ode-to-joy.l4/`（L4），每档 8 小节。`catalog.json` 由脚本从这三个包聚合生成，不要手工维护。

## 作者流程

1. 复制示例包，修改 `manifest.json` 的 `id` / `songId` / `arrangementId` / `songTitle` / `composer` / `name` / `difficulty`。
2. 写 `content/score.json`（内部 `Score` 格式）。
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

## 当前硬约束（P0.5）

- 调号：C / F / G / D / Bb 大调。
- 拍号：4/4、3/4。
- 和弦：只允许 C–E–G、F–A–C、G–B–D 原位大三和弦。
- 节奏：不支持跨小节连线、弱起、反复。
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

## 当前限制

- `checksum` 只校验格式，还没有真正计算哈希。
- 没有包大小上限/签名；P1 再补。
- 没有 MusicXML 转换器；P0.5 先手写 JSON，P1 再做作者工具。
- `catalog.json` 是构建产物，不是数据包；不要给它加 `manifest.json`。
