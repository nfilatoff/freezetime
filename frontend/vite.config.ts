import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The built app is served by the FastAPI backend (freezetime app) from freezetime/app/static.
// In development (`npm run dev`) API calls are proxied to a backend on port 8000.
export default defineConfig({
  plugins: [react()],
  build: { outDir: "../freezetime/app/static", emptyOutDir: true },
  server: { proxy: { "/api": "http://127.0.0.1:8000" } },
});
