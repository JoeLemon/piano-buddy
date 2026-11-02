#!/usr/bin/env node
/**
 * CLI：`npm run version:sync` 写入，`npm run version:check` 只校验（CI 用）。
 * 逻辑在 scripts/lib/app-version.ts，那边有单元测试。
 */
import { checkAppVersion, projectRoot, syncAppVersion } from "./lib/app-version.ts";

if (process.argv.includes("--check")) {
  const result = checkAppVersion(projectRoot);
  if (!result.ok) {
    console.error(`版本号漂移：${result.problems.join("；")}，与 package.json (${result.version}) 不一致，跑 npm run version:sync`);
    process.exit(1);
  }
  console.log(`版本号一致：web / Android / iOS 都是 ${result.version}`);
} else {
  const { version, versionCode } = syncAppVersion(projectRoot);
  console.log(`已同步版本号 ${version}（src/version.ts / Android / iOS；versionCode = ${versionCode}）`);
}
