/**
 * App 版本：包 manifest 的 `minAppVersion` 用它做硬校验。
 *
 * 不直接从 package.json 读，是为了让浏览器构建与测试共用同一个常量；
 * 发版时改这里和 package.json 两处，避免一边改了另一边忘掉。
 */
export const APP_VERSION = "2.0.0";
