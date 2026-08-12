import assert from "node:assert/strict";
import test from "node:test";
import {
  createErrorDiagnostic,
  ERROR_DIAGNOSTIC_LIMITS,
  formatRuntimeDiagnosticPrompt,
  safeDiagnosticText,
} from "../src/client/error-diagnostics.ts";

test("diagnostics retain safe request and runtime context without secrets", () => {
  const error = Object.assign(new Error("Pi session mapping is outside the runtime session directory apiKey=super-secret provider: {\"api_key\":\"json-secret\"}"), {
    error: "invalid_session_mapping",
    apiRequest: { method: "DELETE", path: "/v0/sessions/chat-1", status: 500 },
    runtimeEvent: { type: "runtime_error", code: "invalid_session_mapping", generationId: "generation-1" },
  });
  const diagnostic = createErrorDiagnostic(error, {
    route: "/chat/chat-1",
    chat: { id: "chat-1", projectId: "project-chat", status: "active" },
    runtime: { kind: "conduit_profile", installationId: "conduit-pinned", profileId: "chat" },
    model: "example/reasoner",
    thinkingLevel: "medium",
    connectivity: "online",
  });

  assert.equal(diagnostic.code, "invalid_session_mapping");
  assert.equal(diagnostic.method, "DELETE");
  assert.equal(diagnostic.path, "/v0/sessions/chat-1");
  assert.equal(diagnostic.status, 500);
  assert.equal(diagnostic.route, "/chat/chat-1");
  assert.equal(diagnostic.runtime?.profileId, "chat");
  assert.match(diagnostic.message, /\[redacted\]/);
  assert.doesNotMatch(JSON.stringify(diagnostic), /super-secret|json-secret/);
});

test("diagnostic text and prompts stay bounded", () => {
  const text = safeDiagnosticText(`password=hidden ${"x".repeat(2_000)}`);
  assert.ok(text.length <= ERROR_DIAGNOSTIC_LIMITS.maxFieldLength);
  assert.doesNotMatch(text, /hidden/);
  const prompt = formatRuntimeDiagnosticPrompt(createErrorDiagnostic(new Error("x".repeat(10_000)), {
    route: "/chat/example",
    model: "example/reasoner",
  }));
  assert.ok(prompt.length <= ERROR_DIAGNOSTIC_LIMITS.maxPromptLength);
  assert.match(prompt, /The following is a bounded, redacted Conduit error report/);
  assert.doesNotMatch(prompt, /Why did this happen\?/);
  assert.match(prompt, /```json/);
});
