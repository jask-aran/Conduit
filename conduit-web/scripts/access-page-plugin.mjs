import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

/** Generate login HTML with the same Solid components and CSS as the app.
 * writeBundle finishes before PWA closeBundle discovers the final assets. */
export function accessPagePlugin(configFile) {
  return {
    name: "conduit-access-page",
    apply: "build",
    async writeBundle(options) {
      const { build } = await import("vite");
      const result = await build({ configFile, mode: "access", logLevel: "warn" });
      const output = Array.isArray(result) ? result.flatMap((item) => item.output) : result.output;
      const css = output.filter((item) => item.type === "asset" && item.fileName.endsWith(".css")).map((item) => `/${item.fileName}`);
      if (!css.length) throw new Error("Access page build emitted no v2 stylesheet");
      const directory = options.dir;
      const entry = path.resolve(directory, "access/render.mjs");
      const { renderAccessPage } = await import(`${pathToFileURL(entry).href}?build=${Date.now()}`);
      await fs.writeFile(path.join(directory, "access/templates.json"), JSON.stringify({
        css, normal: renderAccessPage(), error: renderAccessPage("__CONDUIT_ACCESS_ERROR__"),
      }));
    },
  };
}
