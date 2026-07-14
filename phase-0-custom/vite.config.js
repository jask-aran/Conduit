import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: { outDir: "dist", emptyOutDir: true },
  server: { proxy: { "/v0": "http://127.0.0.1:4310", "/healthz": "http://127.0.0.1:4310" } },
});
