# Table renders as pipe-soup + bunched paragraphs in Mersen chat — investigated, NOT fixed

Date (UTC): 2026-09-08
Status: investigated, NOT fixed (read-only investigation).

## Symptom (user wording)

> why is table rendering failing in this chat, is it the model's fault our the renderer has inadvertedly broken? it doesnt seem to affect older chats? I did seem to notice some of the markdown rendering in that thread really bunched together like not enough spaces between paras.

Screenshot: `screenshot.png` in this same folder (header `nhp / Mersen AU/NZ Pricing & Discount Restructure context received and verified`).

What the screenshot shows:

* Assistant message `06:04 pm`: `Got it — will do after every regen from now on. Here's the current LDC Map ...` followed by raw `| LDC | Family | AU mgn S0 | ...` pipe text running as wrapped paragraph lines — no `<table>`, no grid, no cell borders.
* `Thinking process · 1 tool call` trace above renders fine; user reply `What the fuck is this?` + `image.png` attachment below confirms the table never formed.
* Paragraph after the table (`Totals flagged: AU 80 / NZ 115; clean 193/193 both...`) runs directly on, matching the "bunched, not enough space between paras" observation — consistent with the whole block falling back to one paragraph render.

## Chat + message identified

* `chat_id = e3152b4e-7e2b-4be5-8cea-c71c4933863d` (`Mersen AU/NZ ... verified`, NHP project `project_ee2f106f...`, Assistant v9, binary 0.84.1)
* Failing message: assistant msg `822fccdd`, file ts `2026-09-08T08:04:44Z` (18:04 AEST — matches `06:04 pm` in screenshot), `provider: openrouter`, `model: meta/muse-spark-1.3-contributor`, `api: openai-completions`, `stopReason: stop`
* Parent is `toolResult bash` (`d9f3a28e`) — the LDC dataframe dump — so the model transcribed the table from the tool output in the same turn.
* `piSessionFile = /home/jask/Conduit/data/pi/model-profiles/brave-search/sessions/--home-jask-Conduit-data-chat-files-nhp--/2026-09-08T06-05-41-808Z_01a07f9f-4e30-7e9b-ac09-6c0ba2814441.jsonl` (144 lines at read time)

## Verdict: model's fault — malformed GFM table, renderer correctly declines

Column counts from the persisted source text (header/footer pipes stripped, split on `|`):

* Header row: **16** columns (`LDC | Family | AU mgn S0 ... NZ mgn S2`)
* Delimiter row: **17** columns (`|---|---|...` × 17)
* All 8 data rows (A–H): **16** columns each

GFM requires the delimiter row to match the header column count. With 17 delimiters vs 16 header cells, neither Incremark (`gfm:true`, `incremark-markdown.tsx:27`) nor marked treats the block as a table, so it renders as a plain paragraph — exactly the screenshot. Older chats are unaffected because their tables were well-formed; nothing in the renderer changed for this (no recent commits to `table-math.ts` / `incremark-markdown.tsx` / `marked-markdown.tsx` in the last 8; `table-math.ts` only protects `|` inside math, it never repairs column counts).

The "bunched paragraphs" is the same cause, not a second bug: a non-table pipe block has no `table { margin: 1em 0 }` separation (`markdown.css`), and the trailing `Totals flagged...` sentence is part of the same source paragraph (single `\n`, no blank line discipline from the model), so it all runs together.

Secondary aggravator (not the cause): this is a 16-column table; even well-formed, `markdown.css` gives tables `display:block; overflow-x:auto; max-width:min(wide-scale, wide-max)` — readable via horizontal scroll, not a full 16-column grid. If the user expected a full-width grid, that expectation needs the wide-table treatment, but first the source must parse as a table at all.

## Repro (deterministic, no model needed)

Paste this into any chat (or unit-test `projectTableMathSource` + parser):

```markdown
| LDC | Family | AU mgn S0 |
|---|---|---|
| A | FR cylindrical fuses | -211.1% |
```

renders a table; the failing message's shape:

```markdown
| LDC | Family | AU mgn S0 |
|---|---|---|---|
| A | FR cylindrical fuses | -211.1% |
```

renders as pipe paragraph — same as screenshot. Full failing source is msg `822fccdd` content in the session file above.

## Smallest fix directions (NOT applied — for implementation agent)

1. Do NOT "fix" the parser to accept mismatched delimiters silently — GFM compliance is load-bearing for the streaming splitter (`streaming-markdown.ts: tableRowMask`, `table-math.ts: tableLineMask`). A targeted, safe improvement: when a paragraph looks like a table but the delimiter count is off by one (header N, delimiter N+1, rows N), surface a gentle affordance (e.g. title tooltip or dev log via `summarizeTableAst` in `incremark-markdown.tsx:86-101`) rather than silently rendering soup. Even better: streaming-time hint while the delimiter row is being typed.
2. Model-side mitigation (higher leverage): the transcription prompt already dumps the dataframe as aligned text; ask for CSV/`build_proposal.py`-regenerated xlsx instead of hand-retyped Markdown tables for 16-column data — removes the human-error surface entirely.
3. If a renderer tolerance is still wanted: clamp to `min(headerCols, delimiterCols)` only when all data rows agree with the header (here 16/16 agree, delimiter is the outlier) — but this changes GFM semantics and needs streaming + marked parity; prefer option 1.
4. Verify: paste the repro pair above under both `incremark` and `marked` renderers; confirm well-formed renders as scrollable table, malformed renders as paragraph (unchanged) but with the new hint; existing table tests pass.

## User recovery (no state change)

No deletion proposed — the chat is live work, and the content is intact in the session file. Workaround: ask the model to re-emit the LDC Map with exactly 16 `---` cells in the delimiter (or as CSV), or read it from `mersen-proposal.xlsx` which the turn already rebuilt. Nothing to refresh; this is source shape, not stale cache.

## Files in this handoff

* `screenshot.png` — copy of user screenshot
* `table-render-column-mismatch.md` — this file

Original attachment (do not edit): `data/chat/files/.conduit/chats/f44563aa-0cd7-4335-8e22-4b5242da0ed2/attachments/5c28f312-16fe-4692-8af5-1a4831cfefe6--image.png`
Key paths: session JSONL above (msg `822fccdd`), `conduit-web/src/client/chat/table-math.ts`, `conduit-web/src/client/chat/incremark-markdown.tsx` (`gfm:true`, `TableNode`, `summarizeTableAst`), `conduit-web/src/client/chat/marked-markdown.tsx` (`gfm:true`), `conduit-web/src/client/chat/streaming-markdown.ts`, `conduit-web/src/client/chat/markdown.css`
