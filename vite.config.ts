import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import electron from "vite-plugin-electron/simple";

export default defineConfig({
    plugins: [
        react(),
        electron({
            main: {
                entry: "src/main/index.ts",
            },
            renderer: {},
        }),
    ],
    // Electron 生产环境用文件协议加载，base 设为 ./
    base: "./",
    // 固定端口，方便 Electron 加载
    server: {
        port: 3000,
        open: false,
    },
    // 生产构建输出目录
    build: {
        outDir: "dist",
        emptyOutDir: true,
    },
});
