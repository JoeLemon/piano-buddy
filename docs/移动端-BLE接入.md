# 移动端接入（Capacitor + BLE MIDI）

> 目标：在 iOS / Android 真机上用蓝牙 MIDI 键盘完成一次跟弹。
> 本文只写「现在代码里已经实现的东西」以及真机上怎么验证它。

---

## 1. 为什么需要 App 版

浏览器里的三条输入通路，在移动端断了两条：

| 能力 | 桌面 Chrome/Edge | Android Chrome | iOS Safari | App（Capacitor） |
|---|---|---|---|---|
| Web MIDI（USB） | ✅ | ❌ | ❌ | ❌（改用原生 BLE） |
| Web Bluetooth（BLE MIDI） | ✅ | ✅ | ❌ | ✅ 原生插件 |
| 电脑键盘模拟 | ✅ | ✅ | ✅ | ✅（软键盘也可） |
| 88 键屏幕琴键 | ✅ | ✅ | ✅ | ✅ |

iOS 的 WKWebView 既没有 `navigator.requestMIDIAccess`，也没有 `navigator.bluetooth`；
Android WebView 同样没有 Web Bluetooth。所以「手机 + 蓝牙键盘」这条组合，只能走原生插件。
电容壳里跑的是同一份 `dist/`，没有第二套业务代码。

---

## 2. 输入层怎么分层

```
src/midi/access.ts        对外唯一入口（subscribeMidi + 各键盘开关）
  ├── src/midi/keyboard.ts    电脑键盘模拟
  └── src/midi/ble.ts         会话层：选通道 → 建连 → 解码 → 分发
        ├── bleTransport.ts   契约：BleMidiTransport / BleMidiLink / 错误码
        ├── bleNative.ts      App 通道：@capacitor-community/bluetooth-le
        ├── bleWeb.ts         浏览器通道：Web Bluetooth
        └── bleCodec.ts       字节流 → MIDI 消息 → 音符事件（通道无关，只有一份）
```

三条约定：

1. **通道选择是「原生优先」**：`bleTransport()` 先问 `bleNative.isSupported()`
   （即 `window.Capacitor.isNativePlatform()`），再问 Web Bluetooth。App 里永远走原生，
   浏览器里永远走 Web Bluetooth，两边不会同时活着。
2. **解码只有一份**：两个通道都把 BLE-MIDI 原始包交给同一个 `BleMidiDecoder`，
   所以「跟弹判定」在不同平台看到的是同一串 `MidiNote`，不会出现「桌面能弹、手机漏音」。
3. **错误只有一套码**：`ble-unavailable / ble-cancelled / ble-no-device /
   ble-no-midi-service / ble-permission / ble-connect-failed`。UI 只认这些码
   （`bleErrorMessage()`），不认浏览器 `DOMException.name` 或插件原始文案。

平台判断在 `src/platform.ts`（`isNativeApp()` / `appPlatform()`），只有一处。

---

## 3. 平台配置

### 3.1 Capacitor 壳

`capacitor.config.ts`：

- `appId: app.pianobuddy.mobile`、`appName: Piano Buddy`、`webDir: dist`；
- `server.androidScheme: "https"`——App 内没有地址栏，只有 https scheme 才算 secure context
  （Web Audio、`crypto.subtle` 校验内容包 checksum 都依赖它）；
- `ios.contentInset: "always"` 配合 CSS 的 `env(safe-area-inset-*)`。

`safe-area` 落点：`AppShell` 顶栏让出 `safe-area-inset-top`，设置抽屉让出 bottom，
页面高度用 `100dvh`（`tokens.css` 里关掉了纵向 overscroll 与点按高亮）。

### 3.2 Android

`android/app/src/main/AndroidManifest.xml` 已声明：

- `BLUETOOTH_SCAN`（带 `usesPermissionFlags="neverForLocation"`）+ `BLUETOOTH_CONNECT`；
- `ACCESS_COARSE_LOCATION` / `ACCESS_FINE_LOCATION` 限定 `maxSdkVersion="30"`
  （Android 11 及以下扫描 BLE 仍要定位权限，12+ 不再需要）；
- `uses-feature android.hardware.bluetooth_le required="false"`（没有 BLE 的机器也能装）。

`neverForLocation` 与代码里的 `BleClient.initialize({ androidNeverForLocation: true })` 必须成对出现，
否则上架审核会按「需要定位」处理。

### 3.3 iOS

`ios/App/App/Info.plist` 已加 `NSBluetoothAlwaysUsageDescription`（中文说明）。
没有这条，第一次请求蓝牙时 App 会直接崩。

未开 `UIBackgroundModes: bluetooth-central`：练习是前台行为，后台常驻蓝牙只会增加耗电与审核成本。

---

## 4. 构建与真机调试

```bash
npm run build        # vue-tsc + vite build → dist/
npm run cap:sync     # 等价于 npm run build && npx cap sync（同步 dist 与插件）
npm run cap:android  # Android Studio 打开 android/
npm run cap:ios      # Xcode 打开 ios/（需要 macOS）
```

首次在新机器上还要 `npx cap add android` / `npx cap add ios`（工程目录已提交，通常不用重跑）。

- **Android 真机**：`adb devices` 能看到设备后，在 Android Studio 里 Run 即可；
  首次连接键盘会弹系统蓝牙授权。
- **iOS 真机**：必须真机，**模拟器不支持 BLE**（插件 `initialize` 会以 "BLE unsupported" 拒绝）。
  需要在 Xcode 里选好 Team 与 Bundle Identifier。
- **改完 web 代码后**：一定要重跑 `npm run cap:sync`，否则 App 里还是旧 `dist`。

---

## 5. 真机自检清单

1. 设置抽屉 →「连接诊断」：**运行环境 = App（原生）**、**蓝牙通道 = App 原生蓝牙**。
   若显示「不可用」，先看通道判断是否走错（浏览器里打开的就是浏览器通道）。
2. 点「连接键盘」：出现系统设备选择框，选中键盘后「蓝牙设备」显示其名称。
3. 弹一个音：诊断里的「最近错误」保持为空；练习页按键有反应。
4. 进曲库选一首（例如《暮色》L4+），跑「跟弹本段」并弹对一整段。
5. 关掉键盘电源：设备名应回到「无」，重新点连接能连上（不需要重启 App）。
6. 拒绝蓝牙权限后重试：应看到「蓝牙权限被拒绝：请到系统设置里允许本应用使用蓝牙」，
   而不是空白或卡住。

---

## 6. 已知限制

| 限制 | 影响 | 现状 |
|---|---|---|
| iOS 模拟器不支持 BLE | CI/模拟器上无法验证连接 | 真机验证；单测用假插件覆盖逻辑 |
| Android 系统定位服务关闭 | 部分机型扫不到设备 | 提示文案已覆盖；未做 `openLocationSettings()` 引导 |
| 插件只支持 BLE，不支持经典蓝牙 | 老式蓝牙键盘（Classic）连不上 | 产品只承诺 BLE MIDI |
| 没有后台蓝牙 | App 退到后台断连 | 前台练习场景可接受 |
| Google Fonts 走网络 | 真机离线时回落到系统字体 | 排版仍可用；如需离线可改自托管字体 |
| 首次扫描按 MIDI 服务过滤 | 少数键盘配对后不广播服务列表 | 找不到设备时自动再扫一次「全部设备」 |

---

## 7. 测试策略

`test/ble-native.test.ts`（16 例）用**假插件**覆盖了原生通道的全部行为，不依赖真机：

- 原生优先（`Capacitor` 存在时选 `capacitor-ble`，否则 `web-bluetooth`）；
- 包 → 解码 → 音符事件（note-on / note-off）；
- 请求的服务与特征 UUID、连接时 pin 住 MIDI 服务；
- 按服务过滤扫不到设备时，第二次不加过滤再扫；
- 断开时调用 `stopNotifications` + `disconnect`；
- 设备侧掉线清会话；换设备时旧链路的迟到掉线不会清掉新连接；
- 权限拒绝 / 插件缺失 / 两边都不可用分别映射到 `ble-permission`、`ble-unavailable`；
- 连上瞬间就掉线的链路不会被登记成「已连接」；连点两下「连接」时只让最后一次尝试落地。

`test/ble.test.ts`（11 例）继续覆盖浏览器通道与解码器。两条通道共用一份解码器，
所以「手机与桌面的判定一致」这件事是被测试钉住的，不是靠约定。

真机回归目前仍靠上面的自检清单：CI 会跑类型/单测/内容 QA 与 60 项 headless 验收，但跑不了真机 BLE（模拟器不支持蓝牙），这一段仍是人工。
