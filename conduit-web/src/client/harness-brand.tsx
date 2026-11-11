import type { HarnessSummary } from "./api/contracts";

export function harnessStatusLabel(status: HarnessSummary["status"]): string {
  return status === "authentication_required" ? "Sign-in required" : status === "unavailable" ? "Unavailable" : "Ready";
}

const HARNESS_LABELS: Record<string, string> = {
  conduit: "Conduit",
  codex: "Codex",
  "chatgpt-web": "ChatGPT Web",
  "claude-code": "Claude Code",
  fx: "fx",
  opencode: "OpenCode",
};

/** Keyed by the implementation the chat reports, so a surface names the harness actually running, not the built-in one. */
const IMPLEMENTATION_LABELS: Record<string, string> = {
  "conduit-runtime": "Conduit durable agent",
  codex: "Codex",
  "chatgpt-web": "ChatGPT Web",
  "claude-code": "Claude Code",
};

export const harnessLabelFor = (implementation?: string | null) => implementation
  ? IMPLEMENTATION_LABELS[implementation] || HARNESS_LABELS[implementation] || implementation
  : null;

export const harnessMarkLabelFor = (id?: string) => HARNESS_LABELS[id || "conduit"] || id || "conduit";
