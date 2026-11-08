# Transcript modes: Folded and Narrated

Status: planned 2026-10-30. Spec: DESIGN.md, Transcript › Turns.

Every chat can be shown two ways, at any time:

- **Folded**: the turn's working-out (reasoning, tool calls, text said between them) goes into its trace; the answer
  stands alone. Chats today.
- **Narrated**: text said between tool calls stands in the transcript, a trace per run of tool calls between texts;
  reasoning still folds. jbot today.

## The rule

One rule says which text is interim, for every harness: `textBlockClassifications` (active-generation.js). Per
model message, from that message alone: its text is interim when the message calls a tool or stopped to call one, an
answer otherwise. Never decided across the turn (a later message cannot unmake an answer already shown). Live, the
same rule runs as blocks arrive, so in Folded a text streams as the answer and folds when its message's tool call
starts. Every adapter already states `interim` when it closes a message; what changes is that both modes read it
through one projection instead of two (`liveProjectionIndex` and `conversationalLiveIndex` in turn-rows.ts).

## What a model's stream is like

Measured through pi-ai on a multi-step tool task (DESIGN.md has the table). The traits that decide how a mode looks:

| Trait | Values seen | Effect |
|---|---|---|
| Labelled text | OpenAI Responses (`commentary` / `final_answer`) | Folded could skip the flash, once pi-ai sets `phase` at text start |
| Where it narrates | in text (OpenAI, Gemini, MiniMax, Muse); in reasoning (DeepSeek, Qwen3, Nemotron) | narrating in reasoning: no text before the answer, both modes look alike |
| Flash window in Folded | 0-0.7 s first words to tool call | short and one sentence (OpenAI) is fine; long narration is not |
| Interim readability | short sentences to the person; or long, unstructured working-out (DeepSeek over OpenCode, reported) | unreadable interim text belongs in Folded |
| Reasoning | always, sometimes, signature only, never | always in the trace; huge traces stay there, summarised in one line |

Conduit learns these per model from its own turns rather than a hand-kept list: the durable adapter (then the
others) records per model, on the hub, how often a message carries interim text, its length, whether it was
labelled, and how much reasoning came with it. The probe matrix seeds the first values.

## What the person sees

- A **mode switch** per chat (the chat's menu), a default per profile (Settings › Profiles), jbot Narrated.
- A **recommendation** from the traits, said where the mode is chosen, never enforced: Folded where interim text can be
  kept out of the answer (labelled, or a short one-sentence window); Narrated where the model narrates in readable
  text; Folded where its interim text is long or not meant for a person.
- **Reasoning** of any size stays in the trace: one line with how long it thought, its body opened on request and
  capped with "show all". An untyped stream's `<think>` tags are split out by the adapter, should one appear.

## Steps

1. One projection: `turn-rows.ts` walks a turn's segments once, with `narration: "fold" | "show"`; Folded and
   Narrated render exactly as chats and jbot do now (screenshot both before and after).
2. The mode as a chat setting and profile default; the switch in the chat's menu.
3. Stream traits recorded per model (durable adapter first), and the recommendation from them.
4. DeepSeek over OpenCode: over OpenRouter through pi-ai (2026-10-30) DeepSeek V4.1 Flash classifies cleanly: a
   one-sentence narration in text before each tool call (0.06-0.27 s window), reasoning on its own channel (28 chars to
   4.8k on a bug hunt), the answer after the last tool. So the mess seen is the OpenCode side (its endpoint or the
   OpenCode harness's part mapping, opencode-adapter.js), to reproduce there when needed.
5. Optional, upstream: pi-ai sets `phase` on a text block when the item opens, so labelled streams fold without a
   flash.

Requests never ask for a model's whole catalogue output: the durable runtime caps `maxTokens` at 64k (OpenRouter
lists 943,718 for 1M-context models and reserves credit for it).

## What each stream can say (moved from DESIGN.md)

What text is depends on what the stream can say, and when. Measured 2026-10-30 through pi-ai (`ModelRuntime.streamSimple`) on one multi-step tool task (calendar, then weather per place, then advice):
  - *Phased* -- OpenAI Responses (`gpt-6.1-terra`; the OpenAI, ChatGPT-login and Azure providers alike): every text is labelled `commentary` or `final_answer` when its message opens. pi-ai carries it in the text's `textSignature` (`TextSignatureV1.phase`) but set it only at `text_end`; `conduit-web/scripts/patch-pi-ai.mjs` (run on install) sets it at `text_start` too, until pi-ai does upstream. Reasoning summaries come and go (pi-ai asks for `summary: "auto"`): none in four calls at medium, one short line in four at high; the GPT-5.6 models sent them most calls, and wrote little commentary.
  - *Typed, narrating in text* -- Google direct (Gemini 3.5 Flash: a thinking summary every call, then text, plus an empty text part after each tool call), Gemini via OpenRouter (reasoning signature-only, no words), Muse Spark (summary on some calls, signature-only on others), MiniMax M3 (full reasoning, then text). Text carries no label: it is narration once a tool call follows it in the same message, the answer once the message stops without one.
  - *Typed, narrating in reasoning* -- DeepSeek V4 Flash, Qwen3 32B, Nemotron 3.5: no text at all until the answer. Told to say what they are checking, they say it in reasoning. Under `show` such a turn is its traces, then the answer.
  - *Untyped* -- reasoning in the content as `<think>` tags: not seen. OpenRouter hands reasoning on its own channel, which pi-ai makes thinking. OpenCode Zen's completions endpoints are untested (its key had expired).

  So reasoning is optional on any call, even one model's (`thinking` with no words but a signature is "Reasoning not shared by the provider"), and a turn may have no narration in text at all.
  The adapter says each text's label as soon as the block has it, before its first word (an `assistant_content` delta carrying `textPhase`), and a saved message is commentary unless one of its texts is the final answer; nothing provider-specific reaches the browser. It reads labels through pi-ai's own shapes (`TextSignatureV1`, a message's `stopReason`, its content parts) rather than per provider. A labelled text is placed by its label from its first word (`textBlockClassifications`): under `fold` commentary goes straight into the trace and never draws as an answer. Unlabelled text is *pending* until its message shows what it was, and the policy decides only where pending text draws. Under `show` it draws as text at once: commentary and final answer look the same, so learning which it was changes nothing. Under `fold` it streams as the final answer, and folds into the trace when a tool call starts in the same message (per message, never across the turn) -- a brief draw-and-take-back, measured from first words to the tool call's start at 0-0.25 s on Gemini, 0.2-0.3 s on MiniMax (OpenAI, before the label: 0.2-0.7 s). Holding unlabelled text back until its message ends would end the flash only by losing the streamed answer. Untyped reasoning under `show` reads as commentary, so a model that streams its thinking as content is better under `fold`; which providers offer `show` at all is per provider. Reasoning summaries come on their own channel on every provider measured, so they never draw as text.
