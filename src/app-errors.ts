import { ref } from "vue";

/**
 * 全局错误兜底。
 *
 * 为什么要有：App 装到真机上以后，任何未捕获异常（渲染期崩溃、插件抛错、
 * 异步链里没人 catch 的 rejection）在 WebView 里表现为「页面停住」或白屏，
 * 用户既看不到原因也没有出口——只能卸载。这里把错误收成一张卡片，卡片里的
 * 文本和「复制诊断信息」同源，用户点一下就能贴给开发者。
 *
 * 三条来源：
 *   1. Vue 的 `app.config.errorHandler`（组件渲染 / watch / 生命周期）；
 *   2. `window.onerror`（其它同步异常）；
 *   3. `unhandledrejection`（异步链里漏掉的 catch）。
 */

export type AppError = {
  /** 给用户看的一句话（取错误 message，过长截断）。 */
  message: string;
  /** 给开发者看的完整信息：来源 + name + message + 栈。 */
  detail: string;
  at: number;
};

const MAX_MESSAGE = 160;

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "message" in error) return String((error as { message: unknown }).message);
  return "";
}

function detailOf(error: unknown, source: string): string {
  const name = error instanceof Error && error.name ? error.name : "Error";
  const message = messageOf(error) || String(error);
  const stack = error instanceof Error && error.stack ? error.stack.split("\n").slice(0, 6).join("\n") : "";
  return [`来源: ${source}`, `${name}: ${message}`, stack].filter(Boolean).join("\n");
}

/** 当前未处理的错误；null 表示没有。 */
export const appError = ref<AppError | null>(null);

/** 记录一条错误。同一条错误重复上报（例如渲染循环里）只留第一次。 */
export function reportAppError(error: unknown, source: string): void {
  const detail = detailOf(error, source);
  if (appError.value?.detail === detail) return;
  const raw = messageOf(error) || "发生了未捕获的错误";
  appError.value = {
    message: raw.length > MAX_MESSAGE ? `${raw.slice(0, MAX_MESSAGE)}…` : raw,
    detail,
    at: Date.now(),
  };
}

export function clearAppError(): void {
  appError.value = null;
}

/**
 * 装上 window 级监听，返回清理函数。
 * 传 `target` 是为了测试里用假对象（jsdom 的 window 也能直接用）。
 */
export function installWindowErrorHandlers(target: Window = window): () => void {
  const onError = (event: ErrorEvent) => {
    reportAppError(event.error ?? event.message, "window.error");
  };
  const onRejection = (event: PromiseRejectionEvent) => {
    reportAppError(event.reason, "unhandledrejection");
  };
  target.addEventListener("error", onError as EventListener);
  target.addEventListener("unhandledrejection", onRejection as EventListener);
  return () => {
    target.removeEventListener("error", onError as EventListener);
    target.removeEventListener("unhandledrejection", onRejection as EventListener);
  };
}
