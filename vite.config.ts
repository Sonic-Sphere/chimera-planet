import { defineConfig } from "vite";
export default defineConfig({
  base: "/BongoChorus/",
  server: { host: "127.0.0.1", port: 5427, strictPort: true },
  preview: { host: "127.0.0.1", port: 5427, strictPort: true },
  build: { chunkSizeWarningLimit: 900 },
});
