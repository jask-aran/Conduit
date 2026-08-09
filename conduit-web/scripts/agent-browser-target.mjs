import { tmpdir } from "node:os";
import path from "node:path";

export const DEFAULT_CONDUIT_ORIGIN = "http://127.0.0.1:4310";
const ALLOWED_HOSTS = new Set(["127.0.0.1", "0.0.0.0"]);
const GLOBAL_OPTIONS_WITH_VALUES = new Set([
  "--cdp",
  "--engine",
  "--idle-timeout",
  "--restore-check-fn",
  "--restore-check-text",
  "--restore-check-url",
  "--restore-save",
  "--session",
  "--timeout",
]);
const LOCAL_BROWSER_COMMANDS = new Set([
  "a11y",
  "back",
  "check",
  "click",
  "close",
  "console",
  "dblclick",
  "diff",
  "errors",
  "fill",
  "find",
  "focus",
  "forward",
  "get",
  "hover",
  "is",
  "keyboard",
  "open",
  "press",
  "read",
  "reload",
  "screenshot",
  "scroll",
  "scrollintoview",
  "select",
  "snapshot",
  "type",
  "uncheck",
  "wait",
]);
const DISALLOWED_FIND_ACTIONS = new Set(["download", "upload"]);

function commandIndex(args) {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--") return index + 1;
    if (!arg.startsWith("--")) return index;
    if (arg.startsWith("--session=")) continue;
    if (GLOBAL_OPTIONS_WITH_VALUES.has(arg)) index += 1;
  }
  return -1;
}

function sessionValue(args) {
  const index = args.findIndex(
    (arg) => arg === "--session" || arg.startsWith("--session="),
  );
  if (index === -1) return null;
  if (args[index].startsWith("--session=")) {
    return args[index].slice("--session=".length) || null;
  }
  const value = args[index + 1];
  return value && !value.startsWith("--") ? value : null;
}

function isWithinRoot(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function validateEvidencePath(rawPath) {
  if (!rawPath || rawPath.startsWith("--")) return;
  const candidate = path.resolve(process.cwd(), rawPath);
  const projectRoot = path.resolve(process.cwd());
  const tempRoot = path.resolve(tmpdir());
  if (!isWithinRoot(projectRoot, candidate) && !isWithinRoot(tempRoot, candidate)) {
    throw new Error("Conduit browser evidence must stay in the project or /tmp");
  }
}

export function resolveLocalBrowserUrl(rawUrl) {
  const candidate = new URL(rawUrl, DEFAULT_CONDUIT_ORIGIN);
  return resolveLocalTarget({
    rawOrigin: candidate.origin,
    rawPath: `${candidate.pathname}${candidate.search}${candidate.hash}`,
  });
}

export function validateLocalAgentBrowserCommand(args) {
  if (!Array.isArray(args) || args.length === 0) {
    throw new Error("a local agent-browser command is required");
  }
  const session = sessionValue(args);
  if (!session) throw new Error("--session <name> is required");

  const index = commandIndex(args);
  const command = index === -1 ? null : args[index];
  if (!command || !LOCAL_BROWSER_COMMANDS.has(command)) {
    throw new Error(
      "unsupported local browser command; eval, network, storage, cookies, auth, uploads, downloads, and plugins remain under review",
    );
  }

  if (command === "open") {
    const rawUrl = args[index + 1];
    if (!rawUrl || rawUrl.startsWith("--")) {
      throw new Error("open requires a local Conduit URL");
    }
    resolveLocalBrowserUrl(rawUrl);
  }

  if (command === "read" && args[index + 1] && !args[index + 1].startsWith("--")) {
    resolveLocalBrowserUrl(args[index + 1]);
  }

  if (command === "diff" && args[index + 1] !== "snapshot") {
    throw new Error("only diff snapshot is allowed in local browser QA");
  }

  if (command === "find" && DISALLOWED_FIND_ACTIONS.has(args[index + 3])) {
    throw new Error("browser uploads and downloads remain under review");
  }

  if (command === "close" && args.includes("--all")) {
    throw new Error("closing all browser sessions remains under review");
  }

  if (command === "screenshot") {
    const evidencePath = args.slice(index + 1).find((arg) => !arg.startsWith("-"));
    validateEvidencePath(evidencePath);
  }

  return { command, session };
}

export function resolveLocalTarget({
  rawOrigin = DEFAULT_CONDUIT_ORIGIN,
  rawPath = "/",
} = {}) {
  const origin = new URL(rawOrigin);
  if (
    origin.protocol !== "http:" ||
    !ALLOWED_HOSTS.has(origin.hostname) ||
    origin.port !== "4310" ||
    origin.pathname !== "/" ||
    origin.search ||
    origin.hash
  ) {
    throw new Error(
      "Conduit QA only accepts http://127.0.0.1:4310 or http://0.0.0.0:4310",
    );
  }

  const target = new URL(rawPath, origin);
  if (target.origin !== origin.origin) {
    throw new Error("Conduit QA path must stay on the local Conduit origin");
  }

  return target.toString();
}
