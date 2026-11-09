import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const local = { host: "127.0.0.1", port: 5431, strictPort: true };

export default defineConfig({
  base: "/BongoChimera/",
  plugins: [react()],
  publicDir: "vendor/chimera/public",
  worker: { format: "es" },
  build: {
    target: "es2022",
    chunkSizeWarningLimit: 900,
    rolldownOptions: { input: ["index.html", "chimera.html"] },
  },
  server: local,
  preview: local,
});
