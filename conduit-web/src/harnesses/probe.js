import { spawn } from "node:child_process";

export const READY = (version = null, detail = null) => ({ available: true, status: "ready", version, detail });
export const UNAVAILABLE = (detail = null) => ({ available: false, status: "unavailable", version: null, detail });

/** Never rejects. */
function run(command, args, timeoutMs) {
  return new Promise((resolve) => {
    let child;
    try { child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] }); }
    catch (cause) { return resolve({ code: -1, stdout: "", stderr: String(cause?.message || cause) }); }
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => { child.kill("SIGKILL"); }, timeoutMs);
    child.stdout.on("data", (data) => { stdout += data; });
    child.stderr.on("data", (data) => { stderr += data; });
    child.once("error", (cause) => { clearTimeout(timer); resolve({ code: -1, stdout, stderr: String(cause?.message || cause) }); });
    child.once("close", (code) => { clearTimeout(timer); resolve({ code, stdout, stderr }); });
  });
}

export const commandProbe = (command, args = ["--version"], { timeoutMs = 3_000 } = {}) => async () => {
  const { code, stdout, stderr } = await run(command, args, timeoutMs);
  if (code !== 0) return UNAVAILABLE((stderr || "").trim().split("\n")[0] || `${command} exited with ${code}`);
  return READY((stdout || "").trim().split("\n")[0] || null);
};

export const importProbe = (python, module, { timeoutMs = 3_000 } = {}) => async () => {
  const { code, stderr } = await run(python, ["-c", `import ${module}`], timeoutMs);
  return code === 0 ? READY() : UNAVAILABLE((stderr || "").trim().split("\n").at(-1) || null);
};

/**
 * Probe every harness at once. Four sequential three-second timeouts would put
 * twelve seconds into startup; these are independent, so they run together.
 */
export async function detect(manifests, config = {}) {
  const results = await Promise.all(manifests.map(async (manifest) => {
    try { return [manifest.id, await manifest.probe(config)]; }
    catch (cause) { return [manifest.id, UNAVAILABLE(String(cause?.message || cause))]; }
  }));
  return new Map(results);
}
