import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
    plugins: [react()],
    // Tauri expects the built output at the configured frontendDist path
    base: "./",
    server: {
        port: 3000,
        open: false,
        strictPort: true,
        watch: {
            ignored: ["**/src-tauri/**"],
        },
    },
    build: {
        outDir: "dist",
        emptyOutDir: true,
    },
});
