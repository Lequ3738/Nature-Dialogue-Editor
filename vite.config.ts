import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import electron from "vite-plugin-electron/simple";
import path from 'node:path';

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
    resolve: {
        alias: {
          // 强制所有对这些包的引用都指向根目录下的同一个文件
          '@codemirror/state': path.resolve(__dirname, 'node_modules/@codemirror/state'),
          '@codemirror/view': path.resolve(__dirname, 'node_modules/@codemirror/view'),
          '@codemirror/language': path.resolve(__dirname, 'node_modules/@codemirror/language'),
          '@codemirror/stream-parser': path.resolve(__dirname, 'node_modules/@codemirror/stream-parser'),
          '@lezer/common': path.resolve(__dirname, 'node_modules/@lezer/common'),
          '@lezer/highlight': path.resolve(__dirname, 'node_modules/@lezer/highlight'),
        }
    },
    optimizeDeps: {
        // 强制 Vite 预构建这些包，不要让它们以不同的方式加载
        include: [
          "@codemirror/state",
          "@codemirror/view",
          "@codemirror/language",
          "@codemirror/stream-parser",
          "@uiw/react-codemirror",
          "@lezer/highlight"
        ]
    }
});
