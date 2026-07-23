import { defineConfig } from "vite";
import solid from "vite-plugin-solid";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

export default defineConfig(() => {
  const serverPort = process.env.CONDUIT_PORT || "4310";
  const serverTarget = `http://127.0.0.1:${serverPort}`;

  return {
    plugins: [solid(), tailwindcss()],
    resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
    build: { outDir: "dist", emptyOutDir: true },
    server: {
      proxy: {
        "/v0": { target: serverTarget, ws: true },
        "/healthz": serverTarget,
      },
    },
  };
});
