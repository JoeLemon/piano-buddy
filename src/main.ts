import { createApp } from "vue";
import App from "./App.vue";
import { installWindowErrorHandlers, reportAppError } from "./app-errors";
import "./ui/tokens.css";

const app = createApp(App);

// 组件渲染 / watch / 生命周期里的异常：Vue 默认只打 console，用户看到的是卡住的页面。
app.config.errorHandler = (error, _instance, info) => {
  reportAppError(error, `vue:${info}`);
};

installWindowErrorHandlers();

app.mount("#app");
