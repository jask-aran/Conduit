import { defineConfig } from "vite";
import solid from "vite-plugin-solid";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { solidComponentsViteOptions } from "./scripts/solid-components-mode.mjs";
import { MOBILE_LAYOUT_BREAKPOINT_PX, NON_PHONE_LAYOUT_QUERY, PHONE_LAYOUT_QUERY } from "./src/client/layout-geometry.ts";

function sharedGeometryCssPlugin() {
  const replacements = [
    ["@media (--conduit-mobile-layout)", `@media (max-width: ${MOBILE_LAYOUT_BREAKPOINT_PX}px)`],
    ["@media (--conduit-phone-layout)", `@media ${PHONE_LAYOUT_QUERY}`],
    ["@media (--conduit-wide-layout)", `@media ${NON_PHONE_LAYOUT_QUERY}`],
    ["@container chat-main (--conduit-wide-chat)", `@container chat-main (min-width: ${MOBILE_LAYOUT_BREAKPOINT_PX}px)`],
  ];
  return {
    name: "conduit-shared-geometry-css",
    enforce: "pre",
    transform(code, id) {
      if (!id.split("?", 1)[0].endsWith(".css")) return null;
      let transformed = code;
      for (const [source, target] of replacements) transformed = transformed.replaceAll(source, target);
      return transformed === code ? null : { code: transformed, map: null };
    },
  };
}

/**
 * What this bundle is, stamped in at build time.
 *
 * The interface, the server and the shell around an installed client are three
 * separately released things, so a report that says only "Conduit" names none
 * of them. CI passes the commit it checked out; a local build asks git, and a
 * build from an archive with no git at all still names its version.
 */
function buildStamp() {
  const { version } = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));
  const describe = (...args) => {
    try {
      return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    } catch {
      return "";
    }
  };
  return {
    version,
    commit: (process.env.GITHUB_SHA || describe("rev-parse", "HEAD")).slice(0, 12) || "unknown",
    // The tag, when this build is a release; a plain commit otherwise.
    release: process.env.CONDUIT_RELEASE_TAG || (process.env.GITHUB_REF_TYPE === "tag" ? process.env.GITHUB_REF_NAME : "") || describe("describe", "--tags", "--exact-match") || "",
    builtAt: new Date().toISOString(),
  };
}

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
      sharedGeometryCssPlugin(),
      solid(),
      tailwindcss(),
      // Production-only installability: the client owns SW registration so
      // updates can reload the current page. Dev keeps HMR free of a worker.
      VitePWA({
        // Prompt, not autoUpdate: autoUpdate attaches its own `activated`
        // listener that reloads the page the moment a build installs, which is
        // the decision `pwa-update.ts` exists to make. Under prompt it hands
        // back the lever and reloads only once it is pulled.
        registerType: "prompt",
        // Registered by the application, because the generated fallback script
        // does not expose the update lifecycle to the page that has to decide
        // when it is replaced.
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
          // A new build installs and waits. Activating deletes the precached
          // files the running page still needs, and this client loads Settings,
          // the workspace panel, the terminal and the project dashboard on
          // demand -- an old page left running past activation would 404 on
          // the next one it opened.
          skipWaiting: false,
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
    define: { __CONDUIT_BUILD__: JSON.stringify(buildStamp()) },
    build: { outDir: "dist", emptyOutDir: true },
    server: {
      fs: solidComponents
        ? { allow: [import.meta.dirname, solidComponents.root] }
        : undefined,
      proxy: {
        "/v0": { target: serverTarget, ws: true },
        "/healthz": serverTarget,
        "/login": serverTarget,
      },
    },
  };
});
