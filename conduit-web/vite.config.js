import { defineConfig } from "vite";
import solid from "vite-plugin-solid";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";
import path from "node:path";
import { solidComponentsViteOptions } from "./scripts/solid-components-mode.mjs";

export default defineConfig(() => {
  const serverPort = process.env.CONDUIT_PORT || "4310";
  const serverTarget = `http://127.0.0.1:${serverPort}`;
  const solidComponents = solidComponentsViteOptions();
  const aliases = [
    ...(solidComponents?.aliases ?? []),
    { find: "@", replacement: path.resolve(import.meta.dirname, "src") },
  ];
  return {
    plugins: [
      solid(),
      tailwindcss(),
      // Production-only installability: the client owns SW registration so
      // updates can reload the current page. Dev keeps HMR free of a worker.
      VitePWA({
        registerType: "autoUpdate",
        // Register through the application so autoUpdate can reload the page
        // when a new worker takes control. The generated fallback script does
        // not expose that update lifecycle to the current page.
        injectRegister: false,
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
          skipWaiting: true,
          clientsClaim: true,
          globPatterns: ["**/*.{js,css,html,svg,png,ico,woff2}"],
          navigateFallback: "/index.html",
          navigateFallbackDenylist: [
            /^\/v0(?:\/|(?:\?.*)?$)/,
            /^\/healthz(?:\?.*)?$/,
            /^\/login(?:\?.*)?$/,
          ],
        },
        devOptions: { enabled: false },
      }),
    ],
    resolve: {
      alias: aliases,
      dedupe: ["solid-js"],
    },
    optimizeDeps: solidComponents
      ? { exclude: ["@jask-aran/solid-components"] }
      : undefined,
    build: { outDir: "dist", emptyOutDir: true },
    server: {
      fs: solidComponents
        ? { allow: [import.meta.dirname, solidComponents.root] }
        : undefined,
      proxy: {
        "/v0": { target: serverTarget, ws: true },
        "/healthz": serverTarget,
      },
    },
  };
});
