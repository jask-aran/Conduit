import { defineConfig } from "vite";
import solid from "vite-plugin-solid";
import path from "node:path";

// Vite config for the meteors playground. Separate from the main Conduit
// Vite dev server so the playground can run on port 5173 without
// colliding with the Conduit app (which lives on 4310 via Node, or 5173
// via the managed Vite watcher started by .devcontainer/start-conduit.sh).
export default defineConfig({
  plugins: [solid()],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "../../src/"),
    },
  },
  server: {
    host: "0.0.0.0",
    port: 5173,
    strictPort: true,
  },
});
