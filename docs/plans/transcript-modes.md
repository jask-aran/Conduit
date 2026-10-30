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
