import { randomUUID } from "node:crypto";
import fs from "node:fs";
import { getCurrentSystemMessage, getCurrentSystemPrompt } from "@earendil-works/pi-ai/utils/transcript";
import { parseAttachmentEnvelope } from "../attachment-envelope.js";
import { KATEX_COMPENDIUM, KATEX_LIMITS, MARKDOWN_MIX, RICH_MIX, RICH_PROSE } from "../test-stream-replays.js";
import { createAssistantMessageEventStream, createFauxCore, createProvider, fauxAssistantMessage, fauxText, fauxThinking, fauxToolCall } from "@earendil-works/pi-ai";

/** The paces, as the models (Render test's, same ids where they existed before): bursty is 60 tok/s on average, sent
 *  as chunks after uneven gaps with one long pause, as a real provider does. */
const SPEEDS = {
  paced: { name: "Scripted · 60 tok/s · like a real model", tokensPerSecond: 60 },
  bursty: { name: "Scripted · 60 tok/s in bursts · like a real provider", tokensPerSecond: 60, gapsMs: [40, 120, 60, 350, 80, 1200, 150, 90] },
  steady: { name: "Scripted · 250 tok/s", tokensPerSecond: 250 },
  fast: { name: "Scripted · 1000 tok/s", tokensPerSecond: 1000 },
  flood: { name: "Scripted · 4000 tok/s · past any provider", tokensPerSecond: 4000 },
};
const definitions = Object.entries(SPEEDS).map(([id, speed]) => ({ id, name: speed.name, reasoning: true }));
export const SCRIPTED_MODELS = definitions.map((model) => `conduit-test/${model.id}`);
const THOUGHT = "Working through the request step by step, checking what each part needs before answering. ";
/** A text repeated to about `chars` characters. */
const stretch = (text, chars) => { let out = text; while (out.length < chars) out += text; return out.slice(0, Math.max(chars, 1)); };
const zeroUsage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
const help = `| Keyword | Turn |
| --- | --- |
| help | Show this table |
| think, think 900 | Thinking before each step (about that many tokens) |
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
| slow | Each subagent takes three 2-second steps before it answers |
| 1500t | An answer of about that many tokens |
| rich | Realistic text: typographic punctuation, Markdown, formulas, code (thinking too) |
| markdown, katex, katex limits | A recorded reply streamed whole: lists, table and code; hundreds of formulas; long aligned blocks |`;
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
    // "First take N slow steps": that many 2-second shell calls before answering, so its row is seen working.
    const steps = Number(prompt.match(/first take (\d+) slow steps/i)?.[1] || 0);
    const taken = messages.slice(at + 1).filter((message) => message.role === "assistant").flatMap((message) => message.content || []).filter((part) => part.type === "toolCall").length;
    if (taken < steps) return fauxAssistantMessage([fauxToolCall("bash", { command: `sleep 2 && echo step ${taken + 1}` }, { id: `scripted-${randomUUID()}` })], { stopReason: "toolUse" });
    const single = prompt.match(/^reply with the single word\s+([^\s.!]+)/i);
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
  // "slow": each subagent takes three 2-second steps first.
  const slow = has(/\bslow\b/i) ? " First take 3 slow steps." : "";
  if (slow) selected.push("slow");
  if (has(/\bspawn\b/i)) add("spawn", "subagent", { task: `Reply with the single word pong.${slow}` });
  if (has(/\bbackground\b/i)) add("background", "subagent", { task: `Reply with the single word ping.${slow}`, background: true });
  const fan = count(/\b(\d+)\s+spawns\b/i) || (has(/\bfan\s+out\b/i) ? 3 : 0);
  if (fan) add(has(/\bspawns\b/i) ? `${fan} spawns` : "fan out", "codemode", { code: `await Promise.all([${Array.from({ length: fan }, (_, i) => `tools.subagent({task: "Reply with the single word pong${i + 1}.${slow}"})`).join(", ")}]);` });
  const away = count(/\b(\d+)\s+backgrounds\b/i);
  if (away) add(`${away} backgrounds`, "codemode", { code: `await Promise.all([${Array.from({ length: away }, (_, i) => `tools.subagent({task: "Reply with the single word ping${i + 1}.${slow}", background: true})`).join(", ")}]);` });
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
  const thought = Number(prompt.match(/\bthink(?:ing)?\s+(\d+)(?!\d|\s*t\b)/i)?.[1] || 0);
  const rich = has(/\brich\b/i);
  if (thinking) blocks.push(fauxThinking(thought || rich ? stretch(rich ? RICH_PROSE : THOUGHT, (thought || 400) * 4) : "I will follow the scripted steps in order."));
  if (done < calls.length) {
    const call = calls[done];
    if (narrate) blocks.push(fauxText(`I will call ${call.name} now.`));
    blocks.push(fauxToolCall(call.name, call.args, { id: `scripted-${randomUUID()}` }));
    return fauxAssistantMessage(blocks, { stopReason: "toolUse" });
  }
  // Content, as Render test's replays: a recorded reply streamed whole, or realistic text to the length asked.
  const replay = has(/\bkatex(?:\s+|-)limits\b/i) ? KATEX_LIMITS : has(/\bkatex\b/i) ? KATEX_COMPENDIUM : has(/\bmarkdown\b/i) ? MARKDOWN_MIX : null;
  if (replay || rich) {
    blocks.push(fauxText(replay ?? stretch(RICH_MIX, length ? length * 4 : RICH_MIX.length)));
    return fauxAssistantMessage(blocks);
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
    const speed = SPEEDS[model.id] || SPEEDS.paced;
    const request = createFauxCore({ api: "conduit-test", provider: "conduit-test", models: definitions,
      tokensPerSecond: speed.gapsMs ? 100_000 : speed.tokensPerSecond, tokenSize: { min: 4, max: 4 } });
    request.setResponses([scriptedStep]);
    const source = request.stream(model, context, options);
    const output = createAssistantMessageEventStream();
    (async () => {
      // Bursty: deltas held and let out a gap's worth at a time, so the average stays the pace.
      let gap = 0, owed = 0;
      for await (const event of source) {
        for (const key of ["partial", "message", "error"]) if (event[key]) event[key] = { ...event[key], usage: zeroUsage };
        if (speed.gapsMs && /_delta$/.test(event.type)) {
          if (owed <= 0) {
            const wait = speed.gapsMs[gap++ % speed.gapsMs.length];
            await new Promise((resolve) => setTimeout(resolve, wait));
            owed = Math.max(4, Math.round(wait * speed.tokensPerSecond / 1000) * 4);
          }
          // Counted in characters, about four a token: a fast core may send several tokens in one delta.
          owed -= String(event.delta ?? "").length || 4;
        }
        output.push(event);
      }
      output.end();
    })();
    return output;
  };
  return createProvider({ id: "conduit-test", auth: { apiKey: { name: "Scripted", resolve: async () => ({ auth: {} }) } },
    models: core.models, api: { stream, streamSimple: stream } });
}
