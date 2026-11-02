# App 发布清单

> 目标：把同一份 `dist/` 装进 Android / iOS 壳里，版本号、图标、字体、权限和签名都可复核。
> 真机 BLE 自检见 `docs/移动端-BLE接入.md`；本文只写「发版前要做什么、怎么验」。

---

## 0. 一键检查

在仓库根目录跑：

```bash
npm ci
npm run version:check
npm run icon:check
npm run build
npm test
npm run validate:content
npm run verify:all
```

`version:check` 与 `icon:check` 不写文件，CI 也跑这两条。任何一条失败都不要发版。

---

## 1. 版本号：只改 `package.json`

`package.json` 的 `version` 是唯一事实源。`src/version.ts` 的 `APP_VERSION`、
Android 的 `versionName` / `versionCode` 和 iOS 的 `MARKETING_VERSION` /
`CURRENT_PROJECT_VERSION` 都由脚本写入：

```bash
# 1) 先改 package.json 的 version（例如 2.0.1）
npm run version:sync
# 2) 只校验，不写文件
npm run version:check
```

`versionCode` 的折算规则是 `major * 10000 + minor * 100 + patch`：

| 版本 | versionCode |
|---|---|
| 2.0.0 | 20000 |
| 2.0.1 | 20001 |
| 2.1.0 | 20100 |

这样既能从版本号反推构建号，也不会每次发版都留下一个「+1」的无意义 diff。
Google Play 只要求 `versionCode` 单调递增，当前规则满足。

**不要手改** `src/version.ts`、`android/app/build.gradle` 或
`ios/App/App.xcodeproj/project.pbxproj` 里的版本字段；下次 `version:sync` 会覆盖，
而且容易漏掉 Debug/Release/Profile 三套配置中的一套。`APP_VERSION` 还参与外部包
`minAppVersion` 的硬校验，漂移会让「包说支持 2.0.1、App 却以为自己还是 2.0.0」。

---

## 2. 图标与启动图：脚本生成

```bash
npm run icon:gen          # 写入原生工程
npm run icon:check        # 只校验产物与脚本一致（CI 用）
```

产物共 30 个：

- Android 5 个密度档 × 旧式图标 / 圆形图标 / 自适应前景；
- iOS `AppIcon-512@2x.png`（1024，全出血，不烤圆角）；
- Android 双平台启动图 + iOS 三张 2732 启动图。

图形源在 `scripts/gen-app-icon.mjs` 的 `BRAND` 与 `drawKeys()`。改品牌色或图形后
重跑 `npm run icon:gen`，不要直接改 PNG——`icon:check` 和
`test/app-icon.test.ts` 都会拿脚本重算并比对字节。

---

## 3. 字体：自托管，不再等 Google Fonts

```bash
npm run fonts:fetch       # 重新抓取 public/fonts/
```

- `index.html` 只引用 `/fonts/fonts.css`，不再请求 `fonts.googleapis.com`。
- 只保留 `latin` 子集；中文与符号继续由系统字体渲染，和原来一致。
- IBM Plex Sans / Source Serif 4 都是 SIL OFL 1.1，允许随应用分发。
- 字体是生成产物，换字体族或字重时同时改 `scripts/fetch-fonts.mjs` 与
  `index.html` 的引用，再重跑抓取。

App 离线打开时不再先白屏等外网超时，上架审核也少一个外部域名依赖。

---

## 4. Web 产物

```bash
npm run build             # vue-tsc --noEmit + vite build
npm test                  # 单元测试
npm run validate:content  # 17 个内容包
npm run verify:all        # 6 个 headless 脚本 / 67 项
```

`npm run build` 的 Vite 大 chunk 警告是已知项，不是失败。构建产物在 `dist/`，
Capacitor 的 `webDir` 指向它。

---

## 5. Android 发布

### 5.1 准备签名

```bash
cp android/keystore.properties.example android/keystore.properties
keytool -genkeypair -v -keystore piano-buddy-release.jks \
  -alias pianobuddy -keyalg RSA -keysize 4096 -validity 10000
```

把 `piano-buddy-release.jks` 放到 `android/`（或写绝对路径），在
`android/keystore.properties` 填 `storeFile` / `storePassword` / `keyAlias` /
`keyPassword`。

`keystore.properties`、`*.jks`、`*.keystore` 已在 `.gitignore` 里；**不要把
签名文件或密码提交到仓库**。没有 `keystore.properties` 时 release 仍能编译，
只是产物未签名——CI 用这种方式验证 R8 / 资源合并 / AAB 打包本身。

### 5.2 构建

```bash
npm run cap:sync          # build + npx cap sync
cd android
./gradlew bundleRelease   # 上架用 AAB
# 或 ./gradlew assembleRelease  # 本地安装用 APK
```

产物：

- `android/app/build/outputs/bundle/release/app-release.aab`
- `android/app/build/outputs/apk/release/app-release.apk`

### 5.3 安装后自检

- 设置 →「关于」/ 系统应用信息里版本号应为 `package.json` 的版本；
- 首次连接 BLE 键盘会弹系统蓝牙授权；
- Android 11 及以下如果扫不到设备，检查系统定位服务是否开启（设置抽屉里有
  「系统定位服务」诊断和「去打开」）；
- `BLUETOOTH_SCAN` 必须带 `usesPermissionFlags="neverForLocation"`，与代码里的
  `BleClient.initialize({ androidNeverForLocation: true })` 成对出现。

---

## 6. iOS 发布

需要 macOS + Xcode。

```bash
npm run cap:sync
npm run cap:ios           # Xcode 打开 ios/
```

- 在 Xcode 里选好 Team 与 Bundle Identifier（`app.pianobuddy.mobile`）。
- 确认 `Info.plist` 有 `NSBluetoothAlwaysUsageDescription`；没有这条，第一次
  请求蓝牙时 App 会直接崩。
- 不开 `UIBackgroundModes: bluetooth-central`：练习是前台行为，后台常驻蓝牙
  只会增加耗电与审核成本。
- Product → Archive → Distribute App。版本号来自 `MARKETING_VERSION` /
  `CURRENT_PROJECT_VERSION`，发版前跑 `npm run version:check`。

CI 只在模拟器上关签名编译，验证 SPM 依赖、Info.plist 与插件注册；Archive、
证书、真机安装仍需本机 Xcode。

---

## 7. CI 覆盖范围

`.github/workflows/ci.yml` 四个 job：

| job | 验证 |
|---|---|
| `check` | 版本号一致、图标一致、类型/构建、单测、内容 QA、catalog 幂等 |
| `headless` | 6 个验收脚本 / 67 项，失败上传 `shots/` |
| `android` | `cap sync` → JDK 21 → `assembleDebug`，APK 上传 artifact |
| `ios` | `cap sync` → `xcodebuild -target App -sdk iphonesimulator` 关签名编译 |

真机 BLE、系统授权弹窗、连接选择框仍只能人工验，清单见
`docs/移动端-BLE接入.md` 第 5 节。

---

## 8. 发版前最后一遍

- [ ] `package.json` 版本已改，`npm run version:sync` 已跑，`version:check` 通过
- [ ] `npm run icon:check` 通过（改过品牌图形才需要 `icon:gen`）
- [ ] `npm run build` / `npm test` / `validate:content` / `verify:all` 全过
- [ ] Android `bundleRelease` 用正式 keystore 签名，版本号与 web 一致
- [ ] iOS Archive 用正式证书，`NSBluetoothAlwaysUsageDescription` 在
- [ ] 真机至少完成一次「连接 BLE 键盘 → 跟弹一段 → 关琴重连」
- [ ] 发版说明写清楚：曲库/课程/移动端各自改了什么
