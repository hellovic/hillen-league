import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: { port: 5173, strictPort: true },
  preview: { port: 4173, strictPort: true },
  build: {
    // Stable asset names, not content hashes: the static export (server.py
    // --export) injects its own `?v=<build stamp>` into index.html so GitHub
    // Pages' 10-minute cache can never serve a stale bundle or a 404 (old
    // hashed files disappear on the next deploy, stable names never do).
    rollupOptions: {
      output: {
        entryFileNames: "assets/[name].js",
        chunkFileNames: "assets/[name].js",
        assetFileNames: "assets/[name][extname]",
      },
    },
  },
});
