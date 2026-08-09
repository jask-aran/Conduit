import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const LOCAL_AGENT_BROWSER_CONFIG = fileURLToPath(
  new URL("./agent-browser-local-config.json", import.meta.url),
);

const BLOCKED_ENVIRONMENT_KEYS = new Set([
  "AGENT_BROWSER_ACTION_POLICY",
  "AGENT_BROWSER_ALLOW_FILE_ACCESS",
  "AGENT_BROWSER_ALLOWED_DOMAINS",
  "AGENT_BROWSER_ARGS",
  "AGENT_BROWSER_AUTO_CONNECT",
  "AGENT_BROWSER_CONFIG",
  "AGENT_BROWSER_CONFIRM_ACTIONS",
  "AGENT_BROWSER_CONFIRM_INTERACTIVE",
  "AGENT_BROWSER_CDP",
  "AGENT_BROWSER_DEVICE",
  "AGENT_BROWSER_DOWNLOAD_PATH",
  "AGENT_BROWSER_ENCRYPTION_KEY",
  "AGENT_BROWSER_ENABLE",
  "AGENT_BROWSER_ENGINE",
  "AGENT_BROWSER_EXECUTABLE_PATH",
  "AGENT_BROWSER_EXTENSIONS",
  "AGENT_BROWSER_HEADERS",
  "AGENT_BROWSER_INIT_SCRIPTS",
  "AGENT_BROWSER_NAMESPACE",
  "AGENT_BROWSER_PLUGINS",
  "AGENT_BROWSER_PROFILE",
  "AGENT_BROWSER_PROVIDER",
  "AGENT_BROWSER_PROXY",
  "AGENT_BROWSER_PROXY_BYPASS",
  "AGENT_BROWSER_RESTORE",
  "AGENT_BROWSER_RESTORE_CHECK_FN",
  "AGENT_BROWSER_RESTORE_CHECK_TEXT",
  "AGENT_BROWSER_RESTORE_CHECK_URL",
  "AGENT_BROWSER_RESTORE_SAVE",
  "AGENT_BROWSER_SCREENSHOT_DIR",
  "AGENT_BROWSER_SESSION_NAME",
  "AGENT_BROWSER_STATE",
  "AGENT_BROWSER_USER_AGENT",
  "ALL_PROXY",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "NO_PROXY",
  "all_proxy",
  "http_proxy",
  "https_proxy",
  "no_proxy",
]);

export function sanitizeLocalAgentBrowserEnvironment(baseEnvironment = process.env) {
  const environment = { ...baseEnvironment };
  for (const key of BLOCKED_ENVIRONMENT_KEYS) delete environment[key];
  return environment;
}

export function spawnLocalAgentBrowser(
  args,
  { capture = false, socketDir } = {},
) {
  const resolvedSocketDir =
    socketDir ||
    process.env.CONDUIT_AGENT_BROWSER_SOCKET_DIR ||
    path.join(tmpdir(), "conduit-agent-browser");
  mkdirSync(resolvedSocketDir, { recursive: true });

  const result = spawnSync(
    "agent-browser",
    ["--config", LOCAL_AGENT_BROWSER_CONFIG, ...args],
    {
      encoding: "utf8",
      env: sanitizeLocalAgentBrowserEnvironment({
        ...process.env,
        AGENT_BROWSER_SOCKET_DIR: resolvedSocketDir,
      }),
      stdio: capture ? ["ignore", "pipe", "inherit"] : "inherit",
    },
  );
  if (result.error) {
    if (result.error.code === "ENOENT") {
      throw new Error("agent-browser is not installed or is not on PATH");
    }
    throw result.error;
  }
  return result;
}
