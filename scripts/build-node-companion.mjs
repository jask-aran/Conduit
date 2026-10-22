#!/usr/bin/env node
/**
 * The node role as the desktop app ships it (plan: "How does the node role
 * run on a desktop?"): `conduit-node` bundled into one file, node-pty beside
 * it with only the target's prebuilt binaries, and a Node runtime to run it.
 * The Tauri shell starts it as `node conduit-node.mjs run` while "Serve this
 * computer" is on; nothing here is a second implementation of the node.
 *
 * Usage: build-node-companion.mjs <node executable> [--platform win32] [--arch x64]
 * Output: conduit-web/src-tauri/companion/ (a bundle resource, not in Git).
 */
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const web = path.join(root, "conduit-web");
// esbuild is the web client's build dependency.
const { build } = await import(pathToFileURL(createRequire(path.join(web, "package.json")).resolve("esbuild")).href);
const out = path.join(web, "src-tauri", "companion");
const args = process.argv.slice(2);
const flag = (name, fallback) => { const at = args.indexOf(`--${name}`); return at >= 0 ? args[at + 1] : fallback; };
const runtime = args.find((item) => !item.startsWith("--") && !["win32", "x64", "arm64", "linux", "darwin"].includes(item));
const platform = flag("platform", "win32");
const arch = flag("arch", "x64");
if (!runtime || !fs.existsSync(runtime)) {
  console.error("Usage: build-node-companion.mjs <node executable> [--platform win32] [--arch x64]");
  process.exit(2);
}

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

await build({
  entryPoints: [path.join(root, "scripts", "conduit-node.mjs")],
  outfile: path.join(out, "conduit-node.mjs"),
  bundle: true, platform: "node", format: "esm", target: "node22",
  // node-pty loads a native binary by path; ws's speedups are optional.
  external: ["node-pty", "bufferutil", "utf-8-validate"],
  // An ESM bundle of CommonJS dependencies still needs `require`.
  banner: { js: "import { createRequire as __conduitRequire } from 'node:module'; const require = __conduitRequire(import.meta.url);" },
  absWorkingDir: web, nodePaths: [path.join(web, "node_modules")], logLevel: "warning",
});

// node-pty without its build tree, so it loads the prebuilt binary for the target.
const pty = path.join(web, "node_modules", "node-pty");
const ptyOut = path.join(out, "node_modules", "node-pty");
fs.cpSync(path.join(pty, "lib"), path.join(ptyOut, "lib"), { recursive: true });
fs.copyFileSync(path.join(pty, "package.json"), path.join(ptyOut, "package.json"));
fs.cpSync(path.join(pty, "prebuilds", `${platform}-${arch}`), path.join(ptyOut, "prebuilds", `${platform}-${arch}`), {
  recursive: true, filter: (source) => !source.endsWith(".pdb"),
});

fs.copyFileSync(runtime, path.join(out, platform === "win32" ? "node.exe" : "node"));
fs.writeFileSync(path.join(out, ".gitignore"), "*\n");
console.log(`Node companion for ${platform}-${arch} in ${path.relative(root, out)}`);
