import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

if (Number(process.versions.node.split(".")[0]) < 22) {
  console.error("PI WEB requires Node.js 22 or newer.");
  process.exit(1);
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bin = (name) => path.join(root, "node_modules", ".bin", process.platform === "win32" ? `${name}.cmd` : name);
const children = [
  spawn(bin("pi-web-sessiond"), [], { stdio: "inherit", env: process.env }),
  spawn(bin("pi-web-server"), [], { stdio: "inherit", env: { ...process.env, PI_WEB_PORT: process.env.PI_WEB_PORT || "8504" } }),
];

let stopping = false;
function stop(signal = "SIGTERM") {
  if (stopping) return;
  stopping = true;
  for (const child of children) if (!child.killed) child.kill(signal);
}

for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => stop(signal));
for (const child of children) {
  child.on("error", (error) => { console.error(error.message); stop(); process.exitCode = 1; });
  child.on("exit", (code, signal) => {
    if (!stopping) {
      console.error(`PI WEB process exited (${signal || code}); stopping its peer.`);
      process.exitCode = code || 1;
      stop();
    }
  });
}

console.log(`PI WEB starting at http://127.0.0.1:${process.env.PI_WEB_PORT || 8504}`);

