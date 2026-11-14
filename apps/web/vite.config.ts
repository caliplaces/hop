import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    // The API Worker runs on wrangler dev; in production both share one origin.
    proxy: { "/api": { target: "http://localhost:8787", changeOrigin: false } },
  },
});
