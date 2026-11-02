/**
 * App 版本：包 manifest 的 `minAppVersion` 用它做硬校验。
 *
 * `package.json` 是唯一事实源；`npm run version:sync` 会把这个常量与 Android /
 * iOS 的版本字段一起写入，`npm run version:check` 在 CI 里防止漂移。不要手改。
 */
export const APP_VERSION = "2.0.0";
