import type * as Renderer from "./renderScore";

/**
 * 谱面渲染按需加载。
 *
 * VexFlow 是主包里最大的一块；首页、自评、乐理听辨都不画谱，却要跟着主包
 * 一起解析。把 `renderScore` 收进动态 import 之后，打包器会把它单独拆成一
 * 块：只有真正需要画谱的页面才会请求，冷启动不再先解析这份渲染器。
 *
 * 只发起一次加载：模块缓存由打包器保证，这里再存一份 Promise，避免同一帧
 * 里多个视图同时 `await` 时重复请求。
 */
let pending: Promise<typeof Renderer> | null = null;

export function loadRenderer(): Promise<typeof Renderer> {
  pending ??= import("./renderScore");
  return pending;
}
