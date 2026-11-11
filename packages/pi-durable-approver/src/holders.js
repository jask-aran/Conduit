import { canonicalJson } from "./key.js";

const canonical = (value) => JSON.parse(canonicalJson(value));
const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

function heldAnswer(text) {
  for (let start = text.indexOf("{"); start !== -1; start = text.indexOf("{", start + 1)) {
    for (const candidate of [text.slice(start), text.slice(start, text.lastIndexOf("}") + 1)]) {
      try {
        const value = JSON.parse(candidate);
        if (value.status === "approval-required" && typeof value.requestId === "string" &&
            value.requestId && object(value.invocation) && typeof value.invocation.tool === "string" &&
            object(value.invocation.input)) return value;
      } catch { /* Try the next possible JSON object. */ }
    }
  }
  return null;
}

export function executorHolder({ prefix = "mcp__executor__" } = {}) {
  return {
    name: "executor",
    before(call) {
      if (call.tool !== `${prefix}resume`) return null;
      return {
        source: "executor", tool: call.tool, action: "executor.resume",
        input: { requestId: call.arguments.requestId ?? null },
        resume: { tool: call.tool, arguments: call.arguments },
      };
    },
    after(call, result) {
      if (![`${prefix}call`, `${prefix}execute`].includes(call.tool)) return null;
      const parts = [...(Array.isArray(result.output) ? result.output : []),
        ...(Array.isArray(result.content) ? result.content : [])];
      for (const part of parts) {
        if (part.type !== "text" || typeof part.text !== "string") continue;
        const answer = heldAnswer(part.text);
        if (!answer) continue;
        const { invocation, requestId } = answer;
        const calls = call.arguments.calls;
        const paths = call.tool === `${prefix}call`
          ? (Array.isArray(calls) ? calls : object(calls) ? [calls] : [])
            .map((item) => item?.path).filter((path) => typeof path === "string")
            .map((path) => path.replace(/^tools\./, ""))
            .filter((path) => path.split(".").at(-1) === invocation.tool)
          : [];
        const unique = [...new Set(paths)];
        const action = unique.length === 1 ? unique[0] : invocation.tool;
        const { accounts: _accounts, ...payload } = invocation.input;
        const input = canonical(payload);
        const recipients = [];
        for (const field of ["to", "cc", "bcc", "attendees"]) {
          const values = Array.isArray(input[field]) ? input[field] : [input[field]];
          for (const value of values) {
            const address = typeof value === "string" ? value : value?.email ?? value?.address;
            if (typeof address === "string") recipients.push(address);
          }
        }
        const held = {
          source: "executor", tool: call.tool, action, input,
          resume: { tool: `${prefix}resume`, arguments: {
            requestId, response: { action: "accept", content: {} },
          } },
        };
        if (["send", "delete", "remove", "trash", "pay", "transfer", "share", "forward"]
          .includes(action.split(/[.\s/_-]+/).at(-1).toLowerCase())) held.reversible = false;
        if (recipients.length) held.recipients = recipients;
        return held;
      }
      return null;
    },
  };
}

export function namedHolder(tools, { when, reversible } = {}) {
  return {
    name: "named",
    before(call) {
      if (!tools.includes(call.tool) || when?.(call) === false) return null;
      const held = { source: "named", tool: call.tool, action: call.tool, input: canonical(call.arguments) };
      if (reversible !== undefined) held.reversible = reversible;
      return held;
    },
  };
}
