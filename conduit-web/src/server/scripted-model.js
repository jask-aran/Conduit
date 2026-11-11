import { randomUUID } from "node:crypto";
import fs from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
import { getCurrentSystemMessage, getCurrentSystemPrompt } from "@earendil-works/pi-ai/utils/transcript";
import { parseAttachmentEnvelope } from "../attachment-envelope.js";
import { KATEX_COMPENDIUM, KATEX_LIMITS, MARKDOWN_MIX, RICH_MIX, RICH_PROSE } from "../test-stream-replays.js";
import { createAssistantMessageEventStream, createFauxCore, createProvider, fauxAssistantMessage, fauxText, fauxThinking, fauxToolCall } from "@earendil-works/pi-ai";

const SHAPES = {
  steady: { name: "Scripted · steady" },
  bursty: { name: "Scripted · bursty", gapsMs: [40, 120, 60, 350, 80, 1200, 150, 90] },
};
const SPEEDS = { off: 20, minimal: 40, low: 60, medium: 120, high: 250, xhigh: 1000, max: 4000 };
const definitions = Object.entries(SHAPES).map(([id, shape]) => ({ id, name: shape.name, reasoning: true }));
export const SCRIPTED_MODELS = definitions.map((model) => `conduit-test/${model.id}`);
const THOUGHT = "Working through the request step by step, checking what each part needs before answering. ";
const stretch = (text, chars) => { let out = text; while (out.length < chars) out += text; return out.slice(0, Math.max(chars, 1)); };
const zeroUsage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
const replayTiming = new WeakMap();
const help = `| Keyword | Turn |
| --- | --- |
| help | Show this table |
| replay, replay <name> | List recordings or replay one; add fast to skip recorded waits |
| (thinking level) | The pace: off 20, minimal 40, low 60, medium 120, high 250, extra high 1000, max 4000 tok/s |
| think, think 900 | Thinking before each step (about that many tokens) |
| narrate | Commentary before each tool call |
| tool, 3 tools | That many read calls |
| bash | Run echo scripted |
| fail | Read a missing path |
| script | Run read and bash in codemode |
| spawn | Spawn a foreground subagent |
| background | Spawn a background subagent |
| run heartbeat, run brief, run check-back | Start a Conduit run; add quiet or urgent to choose its report level |
| fan out, 3 spawns | That many foreground subagents in parallel, from one codemode script (fan out: 3) |
| 3 backgrounds | That many background subagents, from one codemode script |
| ask | Ask a question with two options |
| slow | Each subagent takes three 2-second steps before it answers (with narrate, a line before each) |
| 1500t | An answer of about that many tokens |
| rich | Realistic text: typographic punctuation, Markdown, formulas, code (thinking too) |
| markdown, katex, katex limits | A recorded reply streamed whole: lists, table and code; hundreds of formulas; long aligned blocks |`;
const textOf = (message) => typeof message?.content === "string" ? message.content : (message?.content || []).filter((part) => part.type === "text").map((part) => part.text).join("\n");

// The context is the state machine: every completed call advances one step.
const promptOf = (message) => parseAttachmentEnvelope(textOf(message).trim()).message.trim();
const reportText = (prompt) => /^(?:(?:sa|bg)-\d+\b|that was your .+ run's report\b)/i.test(prompt) || /^ping\d*[.!]?$/i.test(prompt)
  || /\n---\nThat was your .+ run's report\b/i.test(prompt);
const noticeText = (prompt) => !prompt || /^(?:\[Approval\]|The user stopped your previous response|It is |Since this thread began:)/i.test(prompt);
const finalAnswer = (message) => message.role === "assistant" && !(message.content || []).some((part) => part.type === "toolCall");
/** A report holds only the child's answer ("ping" or "pingN"); its id is in the result of the call that started it. */
function reporter(messages, index) {
  const before = messages.slice(0, index);
  const word = promptOf(messages[index]).match(/^ping(\d*)[.!]?$/i);
  const starter = word && before.filter((message) => message.role === "assistant").flatMap((message) => message.content || [])
    .findLast((part) => part.type === "toolCall" && (word[1]
      ? part.name === "codemode" && String(part.arguments?.code || "").includes(`word ping${word[1]}.`)
      : part.name === "subagent" && part.arguments?.background));
  const started = starter && textOf(before.find((message) => message.role === "toolResult" && message.toolCallId === starter.id));
  return promptOf(messages[index]).match(/^(?:sa|bg)-\d+\b/)?.[0] || started?.match(/\b(?:sa|bg)-\d+\b/g)?.[word?.[1] ? Number(word[1]) - 1 : 0] || "A subagent";
}

function scriptedStep(context) {
  const messages = context.messages || [];
  const last = messages.findLastIndex((message) => message.role === "user");
  // A report or notice steered into a turn still under way (between its calls) is heard, and the turn goes on with
  // its own prompt; only one that arrives once the turn has answered starts a turn of its own.
  const asked = messages.findLastIndex((message) => message.role === "user" && !reportText(promptOf(message)) && !noticeText(promptOf(message)));
  // A turn stopped is over too (its call came back aborted): a report after it starts a turn of its own.
  const stopped = (message) => message.role === "toolResult" && /\bwas aborted\b/.test(textOf(message)) || message.stopReason === "aborted";
  const midTurn = asked >= 0 && asked < last && !messages.slice(asked + 1, last).some((message) => finalAnswer(message) || stopped(message));
  const at = midTurn ? asked : last;
  const heard = midTurn ? messages.map((message, index) => ({ message, index })).slice(at + 1)
    .filter(({ message }) => message.role === "user" && reportText(promptOf(message))).map(({ message, index }) => `${reporter(messages, index)} reported ${promptOf(message).replace(/[.!]?$/, "")}`) : [];
  const prompt = promptOf(messages[at]);
  const later = messages.slice(at + 1);
  const systemMessage = getCurrentSystemMessage(messages);
  const system = [context.systemPrompt || "", getCurrentSystemPrompt(messages)].join("\n");
  const child = /you are a subagent working for another agent/i.test(system);
  if (child) {
    // 2-second shell calls before answering, so its row is seen working.
    const steps = Number(prompt.match(/first take (\d+) slow steps/i)?.[1] || 0);
    const taken = messages.slice(at + 1).filter((message) => message.role === "assistant").flatMap((message) => message.content || []).filter((part) => part.type === "toolCall").length;
    const said = /narrating/i.test(prompt) ? [fauxText(`Step ${taken + 1} of ${steps}: a slow shell step.`)] : [];
    if (taken < steps) return fauxAssistantMessage([...said, fauxToolCall("bash", { command: `sleep 2 && echo step ${taken + 1}` }, { id: `scripted-${randomUUID()}` })], { stopReason: "toolUse" });
    const single = prompt.match(/reply with the single word\s+([^\s.!]+)/i);
    return fauxAssistantMessage(single ? single[1] : `Done: ${prompt.split(/\r?\n/)[0]}`);
  }
  const isReport = reportText(prompt);
  const isNotice = noticeText(prompt);
  if (isReport) {
    const id = reporter(messages, at);
    return fauxAssistantMessage(`${id} reported: ${prompt.split(/\n-{3}\n/)[0].replace(/\s+/g, " ").replace(/[.!]?$/, ".")}`);
  }
  if (isNotice) return fauxAssistantMessage("Notice received.");
  const recording = prompt.match(/\breplay\b(?:\s+fast\b)?(?:\s+([^\s]+))?/i);
  if (recording) {
    const directory = new URL("../test-stream-recordings/", import.meta.url);
    const names = fs.readdirSync(directory).filter((name) => name.endsWith(".json")).sort();
    const name = names.find((name) => name.slice(0, -5) === recording[1]);
    if (!name) return fauxAssistantMessage(names.map((name) => {
      const data = JSON.parse(fs.readFileSync(new URL(name, directory), "utf8"));
      return `${name.slice(0, -5)}: ${data.behaviours}`;
    }).join("\n") || "No recordings available.");
    const data = JSON.parse(fs.readFileSync(new URL(name, directory), "utf8"));
    const index = later.filter((message) => message.role === "assistant").length;
    const step = data.steps[index];
    if (!step) return fauxAssistantMessage("The recording is complete.");
    const blocks = [
      ...(step.thinking === undefined ? [] : [fauxThinking(step.thinking)]),
      ...(step.texts || []).map(({ text, phase }) => ({ ...fauxText(text), textSignature: JSON.stringify({ v: 1, phase }) })),
      ...(step.calls || []).map(({ name, arguments: args }) => fauxToolCall(name, args, { id: `scripted-${randomUUID()}` })),
    ];
    const message = fauxAssistantMessage(blocks, { stopReason: step.calls?.length ? "toolUse" : "stop" });
    if (!/\bfast\b/i.test(prompt)) replayTiming.set(message, step);
    return message;
  }
  const run = prompt.match(/^run (heartbeat|brief|check-back)(?: (quiet|urgent))?$/);
  if (run) return fauxAssistantMessage(`Conduit is starting a ${run[1]} run.`);
  const cwd = systemMessage?.sections?.cwd?.match(/<cwd>\s*([\s\S]*?)\s*<\/cwd>/)?.[1];
  let file = "README.md";
  try { file = fs.readdirSync(cwd, { withFileTypes: true }).filter((entry) => entry.isFile()).map((entry) => entry.name).sort()[0] || file; } catch {}
  const has = (pattern) => pattern.test(prompt);
  const selected = [];
  const calls = [];
  // Calls run in the order their words come in the prompt ("background slow 3 tools": the agent works while the reads run).
  const add = (keyword, name, args, where, say) => { selected.push(keyword); calls.push({ name, args, at: prompt.search(where), say }); };
  const count = (pattern) => Math.min(8, Number(prompt.match(pattern)?.[1] || 0));
  const readCount = count(/\b(\d+)\s+tools\b/i) || (has(/\btools?\b/i) ? 1 : 0);
  if (readCount) { selected.push(readCount > 1 ? `${readCount} tools` : "tool"); for (let i = 0; i < readCount; i++) calls.push({ name: "read", args: { path: file }, at: prompt.search(/\btools?\b/i), say: i ? `Reading ${file} again for the next part.` : `Let me read ${file} first.` }); }
  if (has(/\bbash\b/i)) add("bash", "bash", { command: "echo scripted" }, /\bbash\b/i, "I'll run a quick shell check.");
  if (has(/\bfail\b/i)) add("fail", "read", { path: ".conduit-scripted-missing-file" }, /\bfail\b/i, "Let me check the settings file too.");
  if (has(/\bscript\b/i)) add("script", "codemode", { code: `await tools.read({path: ${JSON.stringify(file)}}); await tools.bash({command: "echo scripted"});` }, /\bscript\b/i, "I'll read and check in one script.");
  const slow = has(/\bslow\b/i) ? ` First take 3 slow steps${has(/\bnarrate\b/i) ? ", narrating" : ""}.` : "";
  if (slow) selected.push("slow");
  if (has(/\bspawn\b/i)) add("spawn", "subagent", { task: `Look over the project and reply with the single word pong.${slow}`, name: "Project review" }, /\bspawn\b/i, "I'll hand the project to an agent to look over, and wait for it.");
  if (has(/\bbackground\b/i)) add("background", "subagent", { task: `Keep watch on the build and reply with the single word ping.${slow}`, name: "Build watch", background: true }, /\bbackground\b/i, "I'll start an agent in the background to keep watch on the build, and carry on meanwhile.");
  const fan = count(/\b(\d+)\s+spawns\b/i) || (has(/\bfan\s+out\b/i) ? 3 : 0);
  if (fan) add(has(/\bspawns\b/i) ? `${fan} spawns` : "fan out", "codemode", { code: `await Promise.all([${Array.from({ length: fan }, (_, i) => `tools.subagent({name: "Part ${i + 1} review", task: "Look over part ${i + 1} and reply with the single word pong${i + 1}.${slow}"})`).join(", ")}]);` }, /\b(?:fan\s+out|\d+\s+spawns)\b/i, `Let me fan out ${fan} agents to look over each part, and wait for them.`);
  const away = count(/\b(\d+)\s+backgrounds\b/i);
  if (away) add(`${away} backgrounds`, "codemode", { code: `console.log(JSON.stringify(await Promise.all([${Array.from({ length: away }, (_, i) => `tools.subagent({name: "Job ${i + 1} watch", task: "Keep watch on job ${i + 1} and reply with the single word ping${i + 1}.${slow}", background: true})`).join(", ")}])));` }, /\b\d+\s+backgrounds\b/i, `I'll start ${away} background agents to keep watch on the jobs; they'll report back while I carry on.`);
  if (has(/\bask\b/i)) add("ask", "ask_user", { questions: [{ question: "Which option do you prefer?", header: "Test", options: [{ label: "First" }, { label: "Second" }] }] }, /\bask\b/i, "Before I go on, one question for you.");
  calls.sort((a, b) => a.at - b.at);
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
    if (narrate) blocks.push(fauxText(call.say || `I will call ${call.name} now.`));
    blocks.push(fauxToolCall(call.name, call.args, { id: `scripted-${randomUUID()}` }));
    return fauxAssistantMessage(blocks, { stopReason: "toolUse" });
  }
  const replay = has(/\bkatex(?:\s+|-)limits\b/i) ? KATEX_LIMITS : has(/\bkatex\b/i) ? KATEX_COMPENDIUM : has(/\bmarkdown\b/i) ? MARKDOWN_MIX : null;
  const news = heard.length ? `While that ran, ${heard.join("; ")}.\n\n` : "";
  if (replay || rich) {
    blocks.push(fauxText(news + (replay ?? stretch(RICH_MIX, length ? length * 4 : RICH_MIX.length))));
    return fauxAssistantMessage(blocks);
  }
  let answer = `${news}The scripted turn acted on: ${selected.join(", ") || "no keywords"}. The requested steps are complete.`;
  if (has(/\bhelp\b/i)) answer += `\n\n${help}`;
  const target = length ? Math.min(400_000, length * 4) : 480;
  const filler = " This is a repeatable response from the scripted model. It uses the real runtime and reports each requested step.";
  while (answer.length < target) answer += filler;
  blocks.push(fauxText(answer));
  return fauxAssistantMessage(blocks);
}

export function scriptedProvider() {
  const core = createFauxCore({ api: "conduit-test", provider: "conduit-test", models: definitions });
  for (const model of core.models) Object.assign(model, { thinkingLevelMap: { xhigh: "xhigh", max: "max" },
    thinkingLabels: Object.fromEntries(Object.entries(SPEEDS).map(([level, pace]) => [level, `${pace} tok/s`])) });
  const stream = (model, context, options) => {
    // One core per call avoids a shared response queue and lets concurrent streams use different speeds.
    const speed = { ...(SHAPES[model.id] || SHAPES.steady), tokensPerSecond: SPEEDS[options?.reasoning] || SPEEDS.off };
    const request = createFauxCore({ api: "conduit-test", provider: "conduit-test", models: definitions,
      tokensPerSecond: speed.tokensPerSecond, tokenSize: { min: 4, max: 4 } });
    let response;
    request.setResponses([async (context) => {
      response = scriptedStep(context);
      const timing = replayTiming.get(response);
      if (timing) {
        // Faux streams four-character tokens, including serialized tool arguments.
        const tokens = response.content.reduce((sum, block) => sum + Math.ceil((block.type === "text" ? block.text
          : block.type === "thinking" ? block.thinking : JSON.stringify(block.arguments)).length / 4), 0);
        const wait = Math.min(10_000, Math.max(0, timing.afterMs - (timing.toolMs || 0) - tokens / speed.tokensPerSecond * 1000));
        try { await delay(wait, undefined, { signal: options?.signal }); }
        catch (error) { if (error.name !== "AbortError") throw error; }
      }
      return response;
    }]);
    const source = request.stream(model, context, options);
    const output = createAssistantMessageEventStream();
    (async () => {
      // The core writes at the pace and its deltas are held and let out after each uneven gap, so the average stays the
      // pace; gaps alone would let a long reply out in a few huge bursts.
      let gap = 0, held = [], due = Date.now() + (speed.gapsMs?.[0] ?? 0);
      const flush = () => { for (const item of held) output.push(item); held = []; due = Date.now() + speed.gapsMs[++gap % speed.gapsMs.length]; };
      for await (const event of source) {
        for (const key of ["partial", "message", "error"]) if (event[key]) event[key] = { ...event[key], usage: zeroUsage };
        // Faux keeps signatures on the final message, but drops them from streamed partials.
        if (event.partial && response) event.partial.content = event.partial.content.map((block, index) => {
          const signature = response.content[index]?.textSignature;
          return block.type === "text" && signature ? { ...block, textSignature: signature } : block;
        });
        if (!speed.gapsMs) { output.push(event); continue; }
        held.push(event);
        if (!/_delta$/.test(event.type) || Date.now() >= due) flush();
      }
      if (held.length) flush();
      output.end();
    })();
    return output;
  };
  return createProvider({ id: "conduit-test", auth: { apiKey: { name: "Scripted", resolve: async () => ({ auth: {} }) } },
    models: core.models, api: { stream, streamSimple: stream } });
}
