import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The frontend dev server proxies /api to the Express backend so the browser
// only ever talks to one origin during development.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:8787",
        changeOrigin: true,
      },
    },
  },
});
