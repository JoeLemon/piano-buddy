// 谱面渲染器平时走动态 import；测试里先把它读进模块缓存，
// 这样视图 `await loadRenderer()` 时只需一次微任务就能拿到，
// 不必让每个断言都去猜 Vite 加载大模块要多久。
import "../src/notation/renderScore";
