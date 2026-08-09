import test from "node:test";
import assert from "node:assert/strict";
import { validateLocalAgentBrowserCommand } from "../scripts/agent-browser-command-policy.mjs";

test("accepts the documented restored snapshot command", () => {
  assert.deepEqual(
    validateLocalAgentBrowserCommand([
      "--session",
      "conduit-qa-test",
      "--restore",
      "snapshot",
      "-i",
      "-c",
    ]),
    { command: "snapshot", session: "conduit-qa-test" },
  );
  assert.deepEqual(
    validateLocalAgentBrowserCommand(["--session", "qa", "drag", "@e1", "@e2"]),
    { command: "drag", session: "qa" },
  );
});

test("rejects executable and external-browser options before or after a command", () => {
  for (const args of [
    ["--session", "qa", "--restore-check-fn", "true", "snapshot"],
    ["--session", "qa", "snapshot", "--restore-check-fn", "true"],
    ["--session", "qa", "--cdp", "9222", "snapshot"],
    ["--session", "qa", "snapshot", "--cdp", "9222"],
    ["--session", "qa", "snapshot", "--provider", "browserbase"],
  ]) {
    assert.throws(
      () => validateLocalAgentBrowserCommand(args),
      /unsupported local browser option/,
    );
  }
});

test("validates every URL-bearing command against the local origin", () => {
  for (const args of [
    ["--session", "qa", "open", "https://example.com"],
    ["--session", "qa", "read", "--json", "https://example.com"],
    ["--session", "qa", "a11y", "--json", "https://example.com"],
    ["--session", "qa", "read", "example.com/guide"],
  ]) {
    assert.throws(
      () => validateLocalAgentBrowserCommand(args),
      /local Conduit URL|local origin|only accepts http/,
    );
  }

  assert.deepEqual(
    validateLocalAgentBrowserCommand(["--session", "qa", "a11y", "--json"]),
    { command: "a11y", session: "qa" },
  );
});

test("keeps screenshot output inside the project or temporary directory", () => {
  assert.deepEqual(
    validateLocalAgentBrowserCommand([
      "--session",
      "qa",
      "screenshot",
      "--screenshot-dir=/tmp/conduit-qa",
    ]),
    { command: "screenshot", session: "qa" },
  );
  assert.throws(
    () =>
      validateLocalAgentBrowserCommand([
        "--session",
        "qa",
        "screenshot",
        "--screenshot-dir=/outside",
      ]),
    /evidence must stay in the project or \/tmp/,
  );
});

test("rejects unsafe commands and nested action escapes", () => {
  for (const args of [
    ["--session", "qa", "eval", "document.title"],
    ["--session", "qa", "batch", "snapshot"],
    ["--session", "qa", "close", "--all"],
    ["--session", "qa", "wait", "--fn", "true"],
    ["--session", "qa", "find", "nth", "2", ".item", "download"],
  ]) {
    assert.throws(
      () => validateLocalAgentBrowserCommand(args),
      /unsupported local browser|unsupported local browser option|uploads and downloads|external browser access/,
    );
  }
});

test("requires exactly one explicit session", () => {
  assert.throws(
    () => validateLocalAgentBrowserCommand(["snapshot"]),
    /exactly one --session|--session/,
  );
  assert.throws(
    () =>
      validateLocalAgentBrowserCommand([
        "--session",
        "one",
        "--session",
        "two",
        "snapshot",
      ]),
    /exactly one --session/,
  );
});
