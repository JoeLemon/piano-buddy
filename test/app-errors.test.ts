import { afterEach, describe, expect, it, vi } from "vitest";
import { appError, clearAppError, installWindowErrorHandlers, reportAppError } from "../src/app-errors";

afterEach(() => {
  clearAppError();
  vi.restoreAllMocks();
});

describe("错误收集", () => {
  it("记录 message、来源与堆栈", () => {
    const error = new Error("渲染炸了");
    reportAppError(error, "vue:render");

    expect(appError.value?.message).toBe("渲染炸了");
    expect(appError.value?.detail).toContain("来源: vue:render");
    expect(appError.value?.detail).toContain("Error: 渲染炸了");
  });

  it("长 message 截断到一行能放下的长度", () => {
    reportAppError(new Error("x".repeat(500)), "test");
    expect(appError.value?.message.length).toBeLessThanOrEqual(161);
    expect(appError.value?.message.endsWith("…")).toBe(true);
  });

  it("非 Error 的值（字符串 / 对象 / undefined）也能收", () => {
    reportAppError("权限被拒绝", "string");
    expect(appError.value?.message).toBe("权限被拒绝");

    clearAppError();
    reportAppError({ message: "插件抛的对象" }, "object");
    expect(appError.value?.message).toBe("插件抛的对象");

    clearAppError();
    reportAppError(undefined, "unknown");
    expect(appError.value?.message).toBe("发生了未捕获的错误");
  });

  it("同一条错误重复上报只留第一次（避免渲染循环刷屏）", () => {
    const error = new Error("同一个");
    reportAppError(error, "loop");
    const first = appError.value;
    reportAppError(error, "loop");
    expect(appError.value).toBe(first);
  });

  it("清掉之后还能再收下一条", () => {
    reportAppError(new Error("第一条"), "a");
    clearAppError();
    expect(appError.value).toBeNull();
    reportAppError(new Error("第二条"), "b");
    expect(appError.value?.message).toBe("第二条");
  });
});

describe("window 级监听", () => {
  it("同步异常与未处理的 rejection 都会进卡片", () => {
    const stop = installWindowErrorHandlers(window);

    window.dispatchEvent(new ErrorEvent("error", { message: "同步炸了" }));
    expect(appError.value?.detail).toContain("来源: window.error");

    clearAppError();
    const rejection = new Event("unhandledrejection") as Event & { reason?: unknown };
    rejection.reason = new Error("异步炸了");
    window.dispatchEvent(rejection);
    expect(appError.value?.detail).toContain("来源: unhandledrejection");
    expect(appError.value?.message).toBe("异步炸了");

    stop();
  });

  it("清理函数摘掉监听后不再收错误", () => {
    const stop = installWindowErrorHandlers(window);
    stop();
    window.dispatchEvent(new ErrorEvent("error", { message: "没人听了" }));
    expect(appError.value).toBeNull();
  });
});
