import path from "node:path";
import { spawn } from "node:child_process";

export function workingDirectoryCommand(directory, { env = process.env, platform = process.platform } = {}) {
  const resolved = path.resolve(directory);
  if (platform === "win32") return { command: "explorer.exe", args: [resolved] };
  if (platform === "darwin") return { command: "open", args: [resolved] };
  if (env.WSL_DISTRO_NAME) {
    const unc = `\\\\wsl.localhost\\${env.WSL_DISTRO_NAME}${resolved.replaceAll("/", "\\")}`;
    return { command: "explorer.exe", args: [unc] };
  }
  return { command: "xdg-open", args: [resolved] };
}

export function openWorkingDirectory(directory, options = {}) {
  const spawnImpl = options.spawnImpl || spawn;
  const { command, args } = workingDirectoryCommand(directory, options);
  return new Promise((resolve, reject) => {
    const child = spawnImpl(command, args, { detached: true, stdio: "ignore" });
    child.once("error", reject);
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
  });
}
