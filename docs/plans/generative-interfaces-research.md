# Generative interfaces: interactive interface an agent makes

How an agent makes interactive interface in Conduit, in the transcript or as an artifact. Nothing is built. The
roadmap's "Generative UI" item is the first use. json-render, A2UI and the AI SDK's generative UI were compared on
2026-11-14 (in git history).

## Decided

- **The format is A2UI v1.0 exactly** (2026-11-19, the owner's call): a stream of JSON messages (`createSurface`,
  `updateComponents`, `updateDataModel`, `deleteSurface`, …), components as a flat list by id with one `root`,
  bindings by JSON Pointer, named functions and actions only. Spec: https://a2ui.org/specification/v1.0-a2ui/. There is
  no Solid renderer: Conduit writes an adapter whose catalogue is v2 library pieces (`Row`, `PillButton`, `Segmented`, a
  table, `QuestionCard`), each with a typed props schema declared beside the piece, as a kind is in `ARTIFACT_KINDS`.
- **Carried by one Conduit-owned MCP tool**, the only thing that reaches every harness alike: text-stream formats
  depend on parsing each harness's prose and break when a model fences them. The hub validates each call against the
  catalogue and refuses with readable issues; the transcript draws the result as a block keyed by tool call, as host
  UI requests (`server/host-ui.js`, `client/chat/host-ui-card.tsx`) are. The name `conduit_ui` is already taken by the
  UI control tool.
- **Sites stay** for free-form pages (a mock-up, a visualisation, a game); a declarative tree is for anything Conduit
  should own the look and behaviour of: the library's look, no agent code, comments anchored by component id.
- **Security**: text props go through the same Markdown sanitising as messages; no URL opens without a user gesture; a
  widget's data model goes only to the chat that made it; no expression language beyond named, precomputed functions.
- **Streaming**: an MCP call reaches the hub whole, so a widget arrives at once; progressive build means several
  calls (create, then data updates).

## As an artifact kind

A `ui` kind (`<name>.ui.json`): the tree is the file, which an agent writes with its own tools; the data model (what
the person typed or chose) lives in the side folder. Every component has an id, so a comment's `under` is
`{ component: "<id>" }` and comments sit in the margin, which a site cannot have. `conduit_artifact` gains a place
parameter of component ids and actions mirroring `updateComponents` and `updateDataModel`; `edit` stays `[]`.

## Open

1. **How a press reaches the agent**: the tool call waits for it (every harness, one answer, with `host-ui.js`'s
   deadline), or it becomes a new user turn carrying `{ name, sourceComponentId, context }` (widgets that last), or
   both.
2. **Artifact or widget first.**
3. **The first spike**: one tool with five components (`Text`, `Row`, `PillButton`, `Segmented`, `Table`) and one
   action, drawn in the transcript in the Test profile. Ask the same three prompts of Claude Code, Codex and the
   Assistant profile; record how many calls validate first time, what the refusals say, and one trace of a 200-row
   `Table` update against the 6.94 ms budget. Unknown: whether the Claude Code and Codex adapters surface partial tool
   input.
