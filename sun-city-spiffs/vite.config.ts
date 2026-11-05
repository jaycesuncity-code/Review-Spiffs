import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// The frontend is a plain Vite SPA. In production the Worker serves ./dist.
// For hot-reload dev, run `npm run dev:api` (wrangler on :8787) and `npm run dev:web` (this, on :5173).
export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: { outDir: "dist", emptyOutDir: true },
  server: {
    proxy: { "/api": { target: "http://127.0.0.1:8787", changeOrigin: false } },
  },
});
