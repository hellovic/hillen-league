import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: { port: 5173, strictPort: true },
  // Bind the preview server to IPv4 explicitly: verify.mjs probes 127.0.0.1,
  // but on macOS Node resolves "localhost" to ::1 first, so the default host
  // made `npm run verify` wait for a server it could never reach.
  preview: { port: 4173, strictPort: true, host: "127.0.0.1" },
  build: {
    // Stable filenames tolerate cached HTML across deploys. The exporter
    // versions each file from its own bytes, independently of data changes.
    rollupOptions: {
      output: {
        entryFileNames: "assets/[name].js",
        chunkFileNames: "assets/[name].js",
        assetFileNames: "assets/[name][extname]",
      },
    },
  },
});
