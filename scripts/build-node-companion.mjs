#!/usr/bin/env node
// The node role as the desktop app ships it: `conduit-node` bundled into one file, node-pty with only the target's
// prebuilt binaries, and a Node runtime to run it.
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const web = path.join(root, "conduit-web");
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

// OpenCode Browse runs as its own process under this bundle's Node.
const browse = path.join(web, "node_modules", "@opencode", "browse");
const browseOut = path.join(out, "node_modules", "@opencode", "browse");
const browsePackage = JSON.parse(fs.readFileSync(path.join(browse, "package.json"), "utf8"));
fs.cpSync(path.join(browse, "dist"), path.join(browseOut, "dist"), { recursive: true });
for (const file of ["package.json", "LICENSE"]) fs.copyFileSync(path.join(browse, file), path.join(browseOut, file));
const copied = new Set();
const carry = (name, from) => {
  if (copied.has(name)) return;
  copied.add(name);
  const found = [path.join(from, "node_modules", name), path.join(browse, "node_modules", name), path.join(web, "node_modules", name)].find((dir) => fs.existsSync(dir));
  if (!found) throw new Error(`OpenCode Browse needs ${name}, which is not installed`);
  fs.cpSync(found, path.join(browseOut, "node_modules", name), { recursive: true, dereference: true });
  for (const next of Object.keys(JSON.parse(fs.readFileSync(path.join(found, "package.json"), "utf8")).dependencies ?? {})) carry(next, found);
};
for (const name of Object.keys(browsePackage.dependencies ?? {})) carry(name, browse);

fs.copyFileSync(runtime, path.join(out, platform === "win32" ? "node.exe" : "node"));
fs.writeFileSync(path.join(out, ".gitignore"), "*\n");
console.log(`Node companion for ${platform}-${arch} in ${path.relative(root, out)}`);
