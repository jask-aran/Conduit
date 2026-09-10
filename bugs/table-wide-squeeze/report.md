# Well-formed tables squeeze to per-character wrapping instead of scrolling — bug report handoff

Date (UTC): 2026-09-08
Status: investigated, NOT fixed (read-only investigation).

## Symptom (user wording)

> This is what they look like, and similar on desktop, they probably do need to be wider than they are rendered here, look at the header text.

Screenshot: `screenshot-hr.jpg` in this same folder (mobile Chrome HR build, 1440px wide; user confirms desktop renders similarly). The two 7-column AU/NZ tables from msg `6b619278` (well-formed — 7/7/7 columns throughout, unlike the earlier 16/17/16 mismatch) render as grids, but every column is crushed to minimum content width:

* Headers: `LDC` → `L/D/C`, `Family` → `Fam/ily`, `mgn S0` → `mg/n/S0`, `mgn S1` → `m/gn/S1`, `# lift` → `#/lif/t`, `avg lift` → `av/g/lift`, `mgn S2` → `mg/n/S2`
* Values split mid-number: `-211.1%` → `-21/1.1/%`, `23` → `2/3`, `113%` → `113/%`, `22.1%` → `22./1%` — same breakage in data cells, not just headers.

So the table neither bleeds wide (the `--transcript-wide-scale` path) nor scrolls horizontally — it stays narrow and wraps inside its cells until illegible.

## Chat + messages

* Same chat as the column-mismatch report: `e3152b4e-7e2b-4be5-8cea-c71c4933863d` (`Mersen AU/NZ ... verified`, NHP project, Assistant v9, binary 0.84.1)
* Malformed 16-col table: msg `822fccdd` (08:04:44Z) — model's fault, covered in `../table-column-mismatch/report.md`
* Well-formed 2×7-col tables: msg `6b619278` (08:07:00Z, `stop`, `openrouter/meta/muse-spark-1.3-contributor`) — this report. Both tables verified 7 header / 7 delimiter / 7 per data row from the session JSONL.
* Session: `/home/jask/Conduit/data/pi/model-profiles/brave-search/sessions/--home-jask-Conduit-data-chat-files-nhp--/2026-09-08T06-05-41-808Z_01a07f9f-4e30-7e9b-ac09-6c0ba2814441.jsonl`

## Root cause (confirmed by reading CSS, matches screenshot exactly)

`conduit-web/src/client/chat/markdown.css`:

1. `.chat-markdown { ... overflow-wrap: anywhere; }` (line 1, desktop + phone `@media` block) — minimum content width of every cell collapses to ~1 character; `anywhere` permits breaks inside `Family`, inside `%` numbers, anywhere.
2. `.chat-markdown[data-renderer^="incremark"]:not([data-inline]) > .incremark > table, ... > table { display: block; max-width: min(var(--transcript-wide-scale), var(--transcript-wide-max)); overflow-x: auto; }` — putting `display:block` on the `<table>` element itself takes it out of table layout, so columns no longer share the available width and each shrinks to that ~1ch minimum.
3. Net: the scroll container that should save wide tables never engages, because the content already collapsed to fit. The wide-bleed path (`width:max-content; min-width:100%` under `@container chat-main (--conduit-wide-chat)`) can't help either — `max-content` of an `anywhere`-wrapped table is itself tiny.

The model's claim in-chat ("this chat doesn't wrap wide tables") is wrong; the wrap/overflow machinery exists but defeats itself. Desktop shows the same because the mechanism is identical — only the column width differs. Defaults involved: `Wide blocks: default` → `--transcript-wide-scale:150%` (`transcript-appearance.css`), container-gated bleed above the wide-chat breakpoint.

## Smallest fix directions (NOT applied — for implementation agent)

1. Take `display:block` off the `<table>` itself. Wrap the table in a scroll container (or grid passthrough) so the inner table keeps `table-layout:auto` with real column sizing; `overflow-x:auto` + `max-width` live on the wrapper.
2. Scope `overflow-wrap` inside tables back to sane breaking: `th, td { overflow-wrap: normal; word-break: normal; }` (override the transcript-wide `anywhere`), plus `th, td { min-width: 4–6em; }` so headers like `Family` / `avg lift` can't compress to 2ch before scrolling kicks in. Numbers then stay intact (`-211.1%` never splits).
3. Resulting behavior: narrow tables stretch to the measure (`min-width:100%` already there), genuinely-wide tables hold readable columns and scroll sideways; above the wide-chat breakpoint the `max-content` bleed works again because max-content is real content width.
4. Verify with the two AU/NZ tables from msg `6b619278` under both `incremark` and `marked`, phone + desktop widths, `Wide blocks` off/default/wider/full: headers on one line, values unsplit, sideways scroll where needed, no change to the malformed-table fallback (still paragraph + hint per the sibling report).

## User recovery (no state change)

No deletion proposed; content is intact. Workaround until fixed: none in-app beyond `Transcript width: full` + `Wide blocks: full` (widens the column but won't cure the per-character wrapping). Ask the model for fewer columns per table if urgently needed.

## Files in this handoff

* `screenshot-hr.jpg` — HR copy of user screenshot (phone, both squeezed tables)
* `report.md` — this file

Original attachment (do not edit): `data/chat/files/.conduit/chats/f44563aa-0cd7-4335-8e22-4b5242da0ed2/attachments/a21328c4-f98b-4f29-acf5-eb4f7e013eda--Screenshot_20260908_184259_Chrome.jpg`
Key paths: `conduit-web/src/client/chat/markdown.css` (table block + `overflow-wrap:anywhere`), `conduit-web/src/client/chat/transcript-appearance.css` (wide presets), `conduit-web/src/client/chat/incremark-markdown.tsx` (`TableNode`, `gfm:true`), session JSONL above (msgs `822fccdd`, `6b619278`)
Sibling: `../table-column-mismatch/report.md` (the malformed-16-col predecessor in the same chat)
