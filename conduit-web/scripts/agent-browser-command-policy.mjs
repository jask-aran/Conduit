import { tmpdir } from "node:os";
import path from "node:path";
import { resolveLocalBrowserUrl } from "./agent-browser-target.mjs";

const FLAG = "flag";
const OPTIONAL_VALUE = "optional";
const REQUIRED_VALUE = "required";

const LOCAL_BROWSER_COMMANDS = new Set([
  "a11y",
  "back",
  "check",
  "click",
  "close",
  "console",
  "dblclick",
  "diff",
  "drag",
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

const SAFE_GLOBAL_OPTIONS = new Map([
  ["--session", REQUIRED_VALUE],
  ["--restore", OPTIONAL_VALUE],
  ["--restore-save", REQUIRED_VALUE],
  ["--restore-check-text", REQUIRED_VALUE],
  ["--restore-check-url", REQUIRED_VALUE],
  ["--engine", REQUIRED_VALUE],
  ["--idle-timeout", REQUIRED_VALUE],
  ["--timeout", REQUIRED_VALUE],
  ["--color-scheme", REQUIRED_VALUE],
  ["--max-output", REQUIRED_VALUE],
  ["--json", FLAG],
  ["--headed", OPTIONAL_VALUE],
  ["--webgpu", FLAG],
  ["--hide-scrollbars", OPTIONAL_VALUE],
  ["--content-boundaries", FLAG],
  ["--no-auto-dialog", FLAG],
  ["--verbose", FLAG],
  ["--quiet", FLAG],
  ["--debug", FLAG],
  ["-v", FLAG],
  ["-q", FLAG],
]);

const SAFE_COMMAND_OPTIONS = new Map([
  [
    "a11y",
    new Map([
      ["--tags", REQUIRED_VALUE],
      ["--selector", REQUIRED_VALUE],
      ["-s", REQUIRED_VALUE],
    ]),
  ],
  ["click", new Map([["--new-tab", FLAG]])],
  ["console", new Map([["--clear", FLAG]])],
  ["errors", new Map([["--clear", FLAG]])],
  ["find", new Map([["--name", REQUIRED_VALUE], ["--exact", FLAG]])],
  [
    "read",
    new Map([
      ["--raw", FLAG],
      ["--require-md", FLAG],
      ["--llms", REQUIRED_VALUE],
      ["--outline", FLAG],
      ["--filter", REQUIRED_VALUE],
    ]),
  ],
  [
    "screenshot",
    new Map([
      ["--full", FLAG],
      ["-f", FLAG],
      ["--annotate", FLAG],
      ["--screenshot-dir", REQUIRED_VALUE],
      ["--screenshot-quality", REQUIRED_VALUE],
      ["--screenshot-format", REQUIRED_VALUE],
    ]),
  ],
  [
    "snapshot",
    new Map([
      ["--interactive", FLAG],
      ["-i", FLAG],
      ["--urls", FLAG],
      ["-u", FLAG],
      ["--compact", FLAG],
      ["-c", FLAG],
      ["--depth", REQUIRED_VALUE],
      ["-d", REQUIRED_VALUE],
      ["--selector", REQUIRED_VALUE],
      ["-s", REQUIRED_VALUE],
    ]),
  ],
  [
    "wait",
    new Map([
      ["--url", REQUIRED_VALUE],
      ["--load", REQUIRED_VALUE],
      ["--text", REQUIRED_VALUE],
      ["--state", REQUIRED_VALUE],
    ]),
  ],
]);

const UNSAFE_OPTIONS = new Set([
  "--action-policy",
  "--allow-file-access",
  "--allowed-domains",
  "--all",
  "--args",
  "--auto-connect",
  "--cdp",
  "--config",
  "--confirm-actions",
  "--confirm-interactive",
  "--device",
  "--download",
  "--download-path",
  "--enable",
  "--executable-path",
  "--extension",
  "--fn",
  "--headers",
  "--ignore-https-errors",
  "--init-script",
  "--namespace",
  "--plugin",
  "--plugins",
  "--profile",
  "--proxy",
  "--proxy-bypass",
  "--provider",
  "--restore-check-fn",
  "--session-name",
  "--state",
  "--user-agent",
  "-p",
]);

const SAFE_FIND_ACTIONS = new Set(["check", "click", "fill", "hover", "text"]);

function optionName(arg) {
  if (!arg.startsWith("-") || arg === "-") return null;
  const equalsIndex = arg.indexOf("=");
  return equalsIndex === -1 ? arg : arg.slice(0, equalsIndex);
}

function inlineOptionValue(arg) {
  const equalsIndex = arg.indexOf("=");
  return equalsIndex === -1 ? null : arg.slice(equalsIndex + 1);
}

function optionError(name) {
  throw new Error(
    `unsupported local browser option ${name}; external browser access and executable actions remain under review`,
  );
}

function consumeOption(args, index, name, spec, { allowNamedRestore = false } = {}) {
  const inlineValue = inlineOptionValue(args[index]);
  if (spec === FLAG) {
    if (inlineValue !== null && !["true", "false"].includes(inlineValue)) {
      throw new Error(`${name} accepts only true or false when a value is supplied`);
    }
    return { nextIndex: index + 1, value: inlineValue };
  }

  if (inlineValue !== null) {
    return { nextIndex: index + 1, value: inlineValue };
  }

  const next = args[index + 1];
  if (spec === OPTIONAL_VALUE) {
    if (
      allowNamedRestore &&
      next &&
      !next.startsWith("-") &&
      !LOCAL_BROWSER_COMMANDS.has(next)
    ) {
      return { nextIndex: index + 2, value: next };
    }
    if (next === "true" || next === "false") {
      return { nextIndex: index + 2, value: next };
    }
    return { nextIndex: index + 1, value: null };
  }

  if (next === undefined || next.startsWith("--")) {
    throw new Error(`${name} requires a value`);
  }
  return { nextIndex: index + 2, value: next };
}

function recordSession(sessions, name, value) {
  if (name !== "--session") return;
  if (!value) throw new Error("--session <name> is required");
  sessions.push(value);
}

function parsePrefix(args) {
  const sessions = [];
  let index = 0;

  while (index < args.length) {
    if (args[index] === "--") {
      return { commandIndex: index + 1, sessions };
    }
    if (!args[index].startsWith("-")) {
      return { commandIndex: index, sessions };
    }

    const name = optionName(args[index]);
    const spec = SAFE_GLOBAL_OPTIONS.get(name);
    if (!spec) optionError(name || args[index]);
    const consumed = consumeOption(args, index, name, spec, {
      allowNamedRestore: name === "--restore",
    });
    recordSession(sessions, name, consumed.value);
    index = consumed.nextIndex;
  }

  return { commandIndex: -1, sessions };
}

function parseCommandTail(args, commandIndex, command, sessions) {
  const positionals = [];
  const options = [];
  let index = commandIndex + 1;
  while (index < args.length) {
    const arg = args[index];
    if (arg === "--") {
      positionals.push(...args.slice(index + 1));
      break;
    }
    if (!arg.startsWith("-")) {
      positionals.push(arg);
      index += 1;
      continue;
    }

    const name = optionName(arg);
    if (UNSAFE_OPTIONS.has(name)) optionError(name);
    const spec =
      SAFE_GLOBAL_OPTIONS.get(name) || SAFE_COMMAND_OPTIONS.get(command)?.get(name);
    if (!spec) optionError(name || arg);
    const consumed = consumeOption(args, index, name, spec);
    recordSession(sessions, name, consumed.value);
    options.push({ name, value: consumed.value });
    index = consumed.nextIndex;
  }
  return { positionals, options };
}

function isWithinRoot(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export function validateEvidencePath(rawPath) {
  if (!rawPath || rawPath.startsWith("--")) {
    throw new Error("browser evidence requires a project or /tmp path");
  }
  const candidate = path.resolve(process.cwd(), rawPath);
  const projectRoot = path.resolve(process.cwd());
  const tempRoot = path.resolve(tmpdir());
  if (!isWithinRoot(projectRoot, candidate) && !isWithinRoot(tempRoot, candidate)) {
    throw new Error("Conduit browser evidence must stay in the project or /tmp");
  }
}

function validateFindPositionals(positionals) {
  if (positionals.length < 2) {
    throw new Error("find requires a locator and value");
  }
  const actionIndex = positionals[0] === "nth" ? 3 : 2;
  const action = positionals[actionIndex] || "click";
  if (!SAFE_FIND_ACTIONS.has(action)) {
    throw new Error("browser uploads and downloads remain under review");
  }
}

function validateCommandArguments(command, positionals, options) {
  if (command === "open") {
    if (positionals.length !== 1) throw new Error("open requires a local Conduit URL");
    resolveLocalBrowserUrl(positionals[0]);
  }

  if (command === "read" || command === "a11y") {
    if (positionals.length > 1) {
      throw new Error(`${command} accepts at most one local Conduit URL`);
    }
    if (positionals[0]) resolveLocalBrowserUrl(positionals[0]);
  }

  if (command === "diff") {
    if (positionals.length !== 1 || positionals[0] !== "snapshot") {
      throw new Error("only diff snapshot is allowed in local browser QA");
    }
  }

  if (command === "find") validateFindPositionals(positionals);

  if (command === "screenshot") {
    const screenshotDirectory = options.find(
      ({ name }) => name === "--screenshot-dir",
    );
    if (screenshotDirectory) validateEvidencePath(screenshotDirectory.value);
    if (positionals.length > 2) {
      throw new Error("screenshot accepts at most a selector and evidence path");
    }
    if (positionals.length > 0) {
      validateEvidencePath(positionals[positionals.length - 1]);
    }
  }
}

export function validateLocalAgentBrowserCommand(args) {
  if (!Array.isArray(args) || args.length === 0) {
    throw new Error("a local agent-browser command is required");
  }

  const { commandIndex, sessions } = parsePrefix(args);
  const command = commandIndex === -1 ? null : args[commandIndex];
  if (!command || !LOCAL_BROWSER_COMMANDS.has(command)) {
    throw new Error(
      "unsupported local browser command; eval, network, storage, cookies, auth, uploads, downloads, plugins, and batch remain under review",
    );
  }

  const parsed = parseCommandTail(args, commandIndex, command, sessions);
  if (sessions.length !== 1) {
    throw new Error("exactly one --session <name> is required");
  }
  validateCommandArguments(command, parsed.positionals, parsed.options);
  return { command, session: sessions[0] };
}
