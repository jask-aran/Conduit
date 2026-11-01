import { randomUUID } from "node:crypto";
import fs from "node:fs";
import { getCurrentSystemMessage, getCurrentSystemPrompt } from "@earendil-works/pi-ai/utils/transcript";
import { parseAttachmentEnvelope } from "../attachment-envelope.js";
import { createAssistantMessageEventStream, createFauxCore, createProvider, fauxAssistantMessage, fauxText, fauxThinking, fauxToolCall } from "@earendil-works/pi-ai";

const definitions = [
  { id: "paced", name: "Scripted · 60 tok/s", reasoning: true },
  { id: "fast", name: "Scripted · 1000 tok/s", reasoning: true },
];
const zeroUsage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
const help = `| Keyword | Turn |
| --- | --- |
| help | Show this table |
| think | Thinking before each step |
| narrate | Commentary before each tool call |
| tool, 3 tools | That many read calls |
| bash | Run echo scripted |
| fail | Read a missing path |
| script | Run read and bash in codemode |
| spawn | Spawn a foreground subagent |
| background | Spawn a background subagent |
| fan out, 3 spawns | That many foreground subagents in parallel, from one codemode script (fan out: 3) |
| 3 backgrounds | That many background subagents, from one codemode script |
| ask | Ask a question with two options |
| 1500t | An answer of about that many tokens |`;
const textOf = (message) => typeof message?.content === "string" ? message.content : (message?.content || []).filter((part) => part.type === "text").map((part) => part.text).join("\n");

// The context is the state machine: every completed call advances one step.
export function scriptedStep(context) {
  const messages = context.messages || [];
  const at = messages.findLastIndex((message) => message.role === "user");
  const raw = textOf(messages[at]).trim();
  const prompt = parseAttachmentEnvelope(raw).message.trim();
  const later = messages.slice(at + 1);
  const systemMessage = getCurrentSystemMessage(messages);
  const system = [context.systemPrompt || "", getCurrentSystemPrompt(messages)].join("\n");
  const child = /you are a subagent working for another agent/i.test(system);
  if (child) {
    const single = prompt.match(/^reply with the single word\s+([^\s]+?)[.!]?$/i);
    return fauxAssistantMessage(single ? single[1] : `Done: ${prompt.split(/\r?\n/)[0]}`);
  }
  // The report-subagent template contains only the answer. Recognize our child's fixed reply from its prior call.
  const before = messages.slice(0, at);
  const backgroundCall = before.filter((message) => message.role === "assistant").flatMap((message) => message.content || [])
    .findLast((part) => part.type === "toolCall" && part.name === "subagent" && part.arguments?.background);
  const backgroundResult = backgroundCall && before.find((message) => message.role === "toolResult" && message.toolCallId === backgroundCall.id);
  const isReport = /^(?:sa-\d+\b|that was your .+ run's report\b)/i.test(prompt) || /^ping\d*[.!]?$/i.test(prompt);
  const isNotice = !prompt || /^(?:\[Approval\]|The user stopped your previous response|It is |Since this thread began:)/i.test(prompt);
  if (isReport) {
    const id = textOf(backgroundResult).match(/\bsa-\d+\b/)?.[0] || "Subagent";
    return fauxAssistantMessage(`${id} reported: ${prompt.replace(/\s+/g, " ").replace(/[.!]?$/, ".")}`);
  }
  if (isNotice) return fauxAssistantMessage("Notice received.");
  const cwd = systemMessage?.sections?.cwd?.match(/<cwd>\s*([\s\S]*?)\s*<\/cwd>/)?.[1];
  let file = "README.md";
  try { file = fs.readdirSync(cwd, { withFileTypes: true }).filter((entry) => entry.isFile()).map((entry) => entry.name).sort()[0] || file; } catch {}
  const has = (pattern) => pattern.test(prompt);
  const selected = [];
  const calls = [];
  const add = (keyword, name, args) => { selected.push(keyword); calls.push({ name, args }); };
  const count = (pattern) => Math.min(8, Number(prompt.match(pattern)?.[1] || 0));
  const readCount = count(/\b(\d+)\s+tools\b/i) || (has(/\btools?\b/i) ? 1 : 0);
  if (readCount) { selected.push(readCount > 1 ? `${readCount} tools` : "tool"); for (let i = 0; i < readCount; i++) calls.push({ name: "read", args: { path: file } }); }
  if (has(/\bbash\b/i)) add("bash", "bash", { command: "echo scripted" });
  if (has(/\bfail\b/i)) add("fail", "read", { path: ".conduit-scripted-missing-file" });
  if (has(/\bscript\b/i)) add("script", "codemode", { code: `await tools.read({path: ${JSON.stringify(file)}}); await tools.bash({command: "echo scripted"});` });
  if (has(/\bspawn\b/i)) add("spawn", "subagent", { task: "Reply with the single word pong." });
  if (has(/\bbackground\b/i)) add("background", "subagent", { task: "Reply with the single word ping.", background: true });
  const fan = count(/\b(\d+)\s+spawns\b/i) || (has(/\bfan\s+out\b/i) ? 3 : 0);
  if (fan) add(has(/\bspawns\b/i) ? `${fan} spawns` : "fan out", "codemode", { code: `await Promise.all([${Array.from({ length: fan }, (_, i) => `tools.subagent({task: "Reply with the single word pong${i + 1}."})`).join(", ")}]);` });
  const away = count(/\b(\d+)\s+backgrounds\b/i);
  if (away) add(`${away} backgrounds`, "codemode", { code: `await Promise.all([${Array.from({ length: away }, (_, i) => `tools.subagent({task: "Reply with the single word ping${i + 1}.", background: true})`).join(", ")}]);` });
  if (has(/\bask\b/i)) add("ask", "ask_user", { questions: [{ question: "Which option do you prefer?", header: "Test", options: [{ label: "First" }, { label: "Second" }] }] });
  const thinking = has(/\bthink\b/i);
  const narrate = has(/\bnarrate\b/i);
  if (thinking) selected.unshift("think");
  if (narrate) selected.unshift("narrate");
  const length = Number(prompt.match(/\b(\d+)\s*t\b/i)?.[1] || 0);
  if (length) selected.push(`${length}t`);
  if (has(/\bhelp\b/i)) selected.unshift("help");
  const done = later.filter((message) => message.role === "assistant").flatMap((message) => message.content || []).filter((part) => part.type === "toolCall").length;
  const blocks = [];
  if (thinking) blocks.push(fauxThinking("I will follow the scripted steps in order."));
  if (done < calls.length) {
    const call = calls[done];
    if (narrate) blocks.push(fauxText(`I will call ${call.name} now.`));
    blocks.push(fauxToolCall(call.name, call.args, { id: `scripted-${randomUUID()}` }));
    return fauxAssistantMessage(blocks, { stopReason: "toolUse" });
  }
  let answer = `The scripted turn acted on: ${selected.join(", ") || "no keywords"}. The requested steps are complete.`;
  if (has(/\bhelp\b/i)) answer += `\n\n${help}`;
  const target = length ? Math.min(400_000, length * 4) : 480;
  const filler = " This is a repeatable response from the scripted model. It uses the real runtime and reports each requested step.";
  while (answer.length < target) answer += filler;
  blocks.push(fauxText(answer));
  return fauxAssistantMessage(blocks);
}

export function scriptedProvider() {
  const core = createFauxCore({ api: "conduit-test", provider: "conduit-test", models: definitions });
  const stream = (model, context, options) => {
    // One core per call avoids a shared response queue and lets concurrent streams use different speeds.
    const request = createFauxCore({ api: "conduit-test", provider: "conduit-test", models: definitions,
      tokensPerSecond: model.id === "paced" ? 60 : 1000, tokenSize: { min: 4, max: 4 } });
    request.setResponses([scriptedStep]);
    const source = request.stream(model, context, options);
    const output = createAssistantMessageEventStream();
    (async () => {
      for await (const event of source) {
        for (const key of ["partial", "message", "error"]) if (event[key]) event[key] = { ...event[key], usage: zeroUsage };
        output.push(event);
      }
      output.end();
    })();
    return output;
  };
  return createProvider({ id: "conduit-test", auth: { apiKey: { name: "Scripted", resolve: async () => ({ auth: {} }) } },
    models: core.models, api: { stream, streamSimple: stream } });
}
