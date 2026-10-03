import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, copyFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
const scratch = path.resolve(root, "../.smoke-tools/desktop-icons");
const icons = path.join(root, "src-tauri/icons");
const source = readFileSync(path.join(root, "public/favicon.svg"), "utf8");
// Generate both variants from the shared artwork, preserving transparent corners.
for (const dev of [false, true]) {
  const input = path.join(scratch, dev ? "dev.svg" : "release.svg");
  const output = path.join(scratch, dev ? "dev" : "release");
  mkdirSync(scratch, { recursive: true });
  writeFileSync(input, dev ? source.replace(/#08090A|#EDEEF0/g, (color) => color === "#08090A" ? "#EDEEF0" : "#08090A") : source);
  execFileSync("npx", ["--no-install", "tauri", "icon", input, "--output", output], { cwd: root, stdio: "inherit" });
  const destination = dev ? path.join(icons, "dev") : icons;
  mkdirSync(destination, { recursive: true });
  for (const name of readdirSync(output)) {
    if (/\.(png|ico|icns)$/.test(name)) copyFileSync(path.join(output, name), path.join(destination, name));
  }
}
