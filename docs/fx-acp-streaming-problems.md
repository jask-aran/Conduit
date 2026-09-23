# fx ACP streaming: answer text, notices and reasoning

**Status (2026-09-23):** Conduit streams fx reasoning and message chunks into the expandable trace. It takes the normal final answer from the latest saved fx turn, so an `agent_message_chunk` cannot enter the answer during streaming.

## What fx 0.0.10 sends

fx uses `agent_message_chunk` for both operational text and model output. The update has `sessionUpdate`, `messageId` and `content`; it has no kind field or `_meta` discriminator. fx rotates `messageId` when it switches between operational text and assistant text. The ID groups chunks only; its value does not identify their kind.

Reasoning arrives as `agent_thought_chunk`, a separate update with no `messageId`. Do not infer message kind from ID spelling, order or text prefixes.

Q1 is answered: the 0.0.10 wire output has no live field that distinguishes `assistant_source` from `operational`. An upstream fx fix is out of scope.

## Conduit approach

- Stream `agent_thought_chunk` as a `thinking` block in the expandable trace.
- Stream `agent_message_chunk` as `narration` in the expandable trace. Start a new entry when `messageId` changes. The client does not have a separate Activity block, so `narration` is the closest existing trace block kind.
- Read `fx session --id <id> --json` after `session/prompt` and use the latest saved `turn.assistant` as the answer. Compare prompt text after trimming, but accept the latest turn if its user text still differs. A live check against fx 0.0.10 found the saved reply on the first read after `session/prompt` returned, so no retry was needed.
- If the saved-session read fails on all attempts, use concatenated live message chunks as the answer and attach an error. This exceptional fallback can contain operational text because the wire does not distinguish it; the normal answer path does not use live message chunks.

Tool-call live updates and cancel/error handling retain their existing flow. fx issue [#207](https://github.com/vercel-labs/fx/issues/207) concerns terminal-rendered text versus raw Markdown, not notice classification.
