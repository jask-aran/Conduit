import { spawnSync } from "node:child_process";

const major = Number(process.versions.node.split(".")[0]);
if (major < 22) throw new Error(`Node.js 22+ required; found ${process.version}`);
for (const command of ["pi", "git"]) {
  const result = spawnSync(command, ["--version"], { stdio: "ignore" });
  if (result.error?.code === "ENOENT") throw new Error(`${command} is not available on PATH`);
}
console.log("Conduit PI WEB prerequisites are available.");

