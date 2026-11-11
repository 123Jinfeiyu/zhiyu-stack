import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

export default defineConfig({
  plugins: [vue()],
  build: {
    // 注意：产物目录**不能**叫 dist / build / out。
    // 发布工具上传时会排除构建产物目录，放 dist 里会被整个跳过，
    // 服务器上 Django 找不到 index.html，每个请求都 503。
    outDir: "../web",
    assetsDir: "assets",
    emptyOutDir: true,
    target: "es2019",
  },
  server: {
    port: 5173,
    proxy: { "/api": "http://127.0.0.1:8000" },
  },
  test: {
    environment: "jsdom",
    globals: true,
    include: ["tests/**/*.spec.js"],
  },
});
