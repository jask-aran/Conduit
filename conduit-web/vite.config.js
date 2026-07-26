import { defineConfig } from "vite";
import solid from "vite-plugin-solid";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";
import path from "node:path";

export default defineConfig(() => {
  const serverPort = process.env.CONDUIT_PORT || "4310";
  const serverTarget = `http://127.0.0.1:${serverPort}`;
  return {
    plugins: [
      solid(),
      tailwindcss(),
      // Production-only installability: SW registration is injected into the
      // built index.html. Dev keeps HMR free of a controlling worker.
      VitePWA({
        registerType: "autoUpdate",
        injectRegister: "auto",
        includeAssets: ["favicon.svg", "pwa-192x192.png", "pwa-512x512.png"],
        manifest: {
          name: "Conduit",
          short_name: "Conduit",
          description: "Your personal AI agent platform",
          theme_color: "#18181b",
          background_color: "#18181b",
          display: "standalone",
          start_url: "/",
          icons: [
            { src: "pwa-192x192.png", sizes: "192x192", type: "image/png" },
            { src: "pwa-512x512.png", sizes: "512x512", type: "image/png" },
            { src: "pwa-512x512.png", sizes: "512x512", type: "image/png", purpose: "any maskable" },
          ],
        },
        workbox: {
          // App shell only. Never add runtimeCaching for /v0 — those routes are
          // authenticated and mutable (catalogue, chat, runtime, live session).
          globPatterns: ["**/*.{js,css,html,svg,png,ico,woff2}"],
          navigateFallback: "/index.html",
          navigateFallbackDenylist: [/^\/v0(?:\/|$)/, /^\/healthz$/, /^\/login$/],
        },
        devOptions: { enabled: false },
      }),
    ],
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
