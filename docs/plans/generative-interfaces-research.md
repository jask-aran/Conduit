# Generative interfaces: json-render, A2UI and AI SDK UI, against Conduit

Research of 2026-11-14, for a later decision on how an agent makes interactive interface in Conduit, in the
transcript or as an artifact. Labels: **Read** is what the source says (URL given), **Inference** is my reading,
**Not verified** is what I could not check. Nothing here is built.

## The three in one table

| | json-render | A2UI | AI SDK UI generative UI |
| --- | --- | --- | --- |
| What the model emits | JSONL of RFC 6902 patches building a flat spec | JSON messages (`createSurface`, `updateComponents`, `updateDataModel`, …) | A tool call's input; the app's component draws it |
| Who defines components | App: `defineCatalog` (Zod props) + `defineRegistry` | App: a catalog (JSON Schema), `catalogId` negotiated | App: one component per tool name |
| Actions back to the agent | Not in the format; app handlers | In the protocol: `action` messages, optional data model | `addToolOutput`, then resubmit |
| Solid | `@json-render/solid` 0.22.0 | None official; Lit web components | None current |
| Version, licence | 0.22.0, Apache-2.0 | Spec v1.0 "Current"; npm 0.15.0; Apache 2.0 | `ai` 7.0.173; Apache-2.0 |

## json-render (vercel-labs)

**Read** (https://github.com/vercel-labs/json-render, README and `packages/core/README.md`). "The Generative UI
framework": the app declares a catalog of components and actions, the model writes JSON "constrained to components you
define", and a `Renderer` draws it through a registry. `catalog.prompt()` writes the system prompt from the catalog. The
spec is flat, a `root` id and an `elements` map, each element `type`, `props`, `children`, optional `visible` and
`watch`. Streaming is "SpecStream", one RFC 6902 patch per line:

```jsonl
{"op":"add","path":"/root","value":"card-1"}
{"op":"add","path":"/elements/card-1","value":{"type":"Card","props":{"title":"Hello"},"children":["btn-1"]}}
```

`createSpecStreamCompiler().push(chunk)` returns `{ result, newPatches }`. There is an inline mode
(`createJsonRenderTransform`) that splits prose from patches in one stream, and refinement edits by patch, merge
(RFC 7396) or diff. Props can be dynamic: `{ "$state": "/path" }`, `$bindState` (two-way), `$cond`/`$then`/`$else`,
`$template`, `$computed`. A component calls `emit("press")`; the built-in `setState` action writes the state model;
other actions are app handlers passed to `JSONUIProvider`. Guarding: Zod prop schemas, `validateSpec` (dangling
children, malformed `visible`, bad `repeat`) and `autoFixSpec`, whose fixes are marked lossy or lossless with the advice
to re-prompt rather than prune. Theming is whatever the registry's components do.

Renderers: React, Vue, Svelte, **Solid** (`@json-render/solid`, peers `solid-js ^1.9.0` and `zod ^4.0.0`), React Native,
plus shadcn, PDF, email, image, terminal, and `@json-render/mcp`, which ships a json-render page as an MCP App
(https://github.com/vercel-labs/json-render/blob/main/packages/mcp/README.md). Maturity: created 2026-01-14, about 19.6k
stars, commits daily (GitHub API, 2026-11-14); 0.x with `experimental_` APIs that "may change in any release".

**Inference.** A rendering library, not a protocol: nothing in the format says how a press reaches the agent, so the
host supplies that. The Solid renderer is the nearest thing to a drop-in, but it brings Zod, which Conduit does not use
(it has Effect 4).

## A2UI

**Read** (https://a2ui.org/, https://github.com/a2ui-project/a2ui README). "Agent-to-User Interface": a protocol, agent
SDKs and native renderers, so agents send "natively rendered widgets, in addition to text". UI is "data, not code"; "Agents
place only components you registered". Three layers: inference (the model writes an inference format such as "A2UI
Express", an ANTLR grammar in `specification/inference_formats/express/Express.g4`), transport (the agent SDK validates,
expands macros and emits wire messages), rendering (`@a2ui/web_core` builds a framework-agnostic model; an adapter maps it
to widgets; a catalog lists what may be used). Official renderers: React, Lit, Angular, Flutter, SwiftUI, Jetpack Compose;
community Svelte and Vue. No Solid.

Wire format (https://github.com/a2ui-project/a2ui/blob/main/specification/v1_0/docs/a2ui_protocol.md): a stream of JSON
messages, each with exactly one of `createSurface`, `updateComponents`, `updateDataModel`, `deleteSurface`,
`callRendererFunction`, `agentFunctionResponse`. Components are a flat adjacency list, one of id `root`:

```json
{"version": "1.0", "updateComponents": {"surfaceId": "user_profile_card", "components": [
  {"id": "root", "component": "Column", "children": ["user_name", "user_title"]},
  {"id": "user_name", "component": "Text", "text": "John Doe"}]}}
```

Binding is `{"@path": "/contact/email"}` (RFC 6901) and `{"@call": "required", "args": {…}}`; inputs are two-way and stay
local "until an action is sent". A button's `action.event` sends `{ name, surfaceId, sourceComponentId, context }` to the
agent; with `sendDataModel` the whole data model rides along, "exclusively to the agent that created the surface".
Safety: named functions only ("This avoids sending executable code"), `allowedCallers`, `requiresUserActivation` for
things like `openUrl`, regex patterns checked statically, catalog `$ref`s never fetched. Theming: v1.0 "removes rigid
theme properties"; "A v1.0 `createSurface` that carries `theme` is invalid", so the renderer's own theme rules
(https://a2ui.org/specification/v1.0-a2ui/). Transports: AG-UI, A2A, **MCP** ("tool calls, tool outputs, or resource
subscriptions"), SSE, WebSockets.

Maturity: spec v1.0 "Current", last updated 8 Jun 2026; packages at 0.15.0 (npm, 2026-11-02); about 17.3k stars, 481 open
issues. `github.com/google/A2UI` now redirects to `a2ui-project/a2ui`. Roadmap lists v1.1 and "Sandboxed logic".
**Not verified:** who governs the project now; I read nothing beyond the redirect.

**Inference.** The most complete answer to actions and state flowing back, and built for a renderer per framework: a
Solid adapter over `@a2ui/web_core` with Conduit's own catalog is the path its architecture expects. Hard parts: the spec
is large (1,694 lines), the Basic Catalog is generic (`Card`, `Row`, `TextField`) rather than Conduit's pieces, and
`web_core`'s cost per update is unmeasured.

## AI SDK UI generative user interfaces

**Read** (https://ai-sdk.dev/docs/ai-sdk-ui/generative-user-interfaces). Not a UI format: a tool (`description`, Zod
`inputSchema`, `execute`) is called, and the client draws its message part by name, `part.type === 'tool-displayWeather'`,
switching on `part.state` and rendering `<Weather {...part.output} />`. States include `input-streaming`,
`input-available`, `output-available`, `output-error`, `approval-requested`, `approval-responded`, `output-denied`; a
client-side tool answers with `addToolOutput` and `sendAutomaticallyWhen` resubmits
(https://ai-sdk.dev/docs/ai-sdk-ui/chatbot-tool-usage). The stream is SSE with `x-vercel-ai-ui-message-stream: v1` and
lines such as `{"type":"tool-input-delta","toolCallId":"call_…","inputTextDelta":"San Francisco"}` and custom
`data-*` parts (https://ai-sdk.dev/docs/ai-sdk-ui/stream-protocol). The RSC route (`streamUI`) "is currently
experimental. We recommend using AI SDK UI for production." (https://ai-sdk.dev/docs/ai-sdk-rsc/overview). Packages for
React, Vue, Svelte, Angular are current (7.0.x family, 2026-11-13); `@ai-sdk/solid` was last published at 1.2.13 in
May 2025 (npm). Backed by Vercel; Apache-2.0, "Copyright 2023 Vercel, Inc."

**Inference.** This is the pattern Conduit already uses and the roadmap names, not something to adopt: Conduit has its own
live-session protocol, and the hooks are React's. What is worth taking is the part state machine.

## What Conduit already has

- **Host UI requests** (`HostUiRequest` in `client/api/contracts.ts`; `client/chat/host-ui-card.tsx`;
  `server/host-ui.js`): kinds `confirm`, `select`, `input`, `editor`, `question`, every harness's ask turned into one
  `QuestionCard`, answered through `respondHostUi`. That is already a tiny fixed catalogue with actions back.
- **The roadmap item** "Render tools (generative UI)" (`docs/plans/surfaces-roadmap.md`): `render_table`,
  `render_chart`, `render_choice`, drawn "from library components", "a Conduit-owned tool, over MCP for Codex and Claude
  Code. No model-written HTML."
- **The site kind**: `<name>.site.html`, drawn in `<iframe sandbox="allow-scripts" srcdoc>`, polled every two seconds,
  marked up through `site-bridge.ts` (`under.elements`); `edit: []`; Markup in the corner, `grounded: true`.
- **Kinds as typed entries**: `ARTIFACT_KINDS` (`client/document/artifact-kinds.ts`) and `KINDS` (`server/documents.js`);
  comments attach through `MarkupHost` and `MarkupMarginHost` (`anchors`, `place`, `watch`) in
  `components/markup/host.ts`; agents reach artifacts through `conduit_artifact` and `conduit-markup`.

## Options

| Option | Costs | Buys |
| --- | --- | --- |
| A. Adopt json-render as is (`@json-render/solid`) | Zod; its spec and expression language become Conduit's; actions still Conduit's to wire; 0.x churn | Fastest working renderer; streaming patches; prompt from catalog |
| B. A2UI wire format, Solid adapter over the library | Write the adapter and a Conduit catalog; follow a large spec; `web_core` unmeasured | A protocol with actions, data model, MCP binding, other clients could talk to Conduit |
| C. Conduit's own small catalogue (grow host UI requests and the roadmap's render tools) | Design the format; no outside tooling | Fits Effect, the library, the typed seams; smallest; nothing to track upstream |
| D. Sites for free-form UI, a declarative format for in-chat widgets | Two paths to explain | Each where it is strong (below) |
| E. C now, shaped like A2UI's messages | Discipline in naming | C's fit, a cheap later move to B |

**Inference on the shape of C/E.** A flat list of `{ id, component, …props }` with `children` by id, a data model
addressed by JSON Pointer, and named actions is what both outside formats converged on; there is no reason to differ.
The catalogue entries would be library pieces (`Row`, `PillButton`, `Segmented`, a table, the `QuestionCard`), each
with a typed props schema in Effect Schema, declared beside the piece the way a kind is declared in `ARTIFACT_KINDS`.

## As an artifact kind

**Inference.** A `ui` kind (say `<name>.ui.json`) fits the existing seams better than a site does:

- **File and side folder.** The tree is the file, plain JSON an agent can write with its own tools; the id lives in
  `<project>/.conduit/artifacts/paths.json` as a site's does; the data model (what the person typed, chose) in the
  side folder, so the file stays the agent's and the person's state is Conduit's.
- **Comments.** Every component has an id, so a comment's `under` is `{ component: "<id>" }` and `MarkupMarginHost.place`
  is that element's box. That is margin comments (`sent: "margin"`), which a site cannot have because its elements have
  no stable names; a site gets corner comments and `under.elements` guesses.
- **Agent verbs.** `conduit_artifact` gains a place parameter of component ids (the roadmap's open item about `block`)
  and actions `update` (patch components) and `data` (set a path), mirroring `updateComponents` and `updateDataModel`.
  Keep, Revert and Try again work per component.
- **Edit tools.** `edit` stays `[]` at first; the person acts through the components, not by editing the tree.

## As transcript widgets

**Inference.** The hub owns the tool (`conduit_ui` or the roadmap's render tools) in `conduitTools`, so any harness that
is handed Conduit's MCP endpoint can draw one. The call's arguments are the tree; the hub validates them against the
catalogue, refuses with readable issues (json-render's lossy/lossless split is a good model for what to say), and the
transcript draws the result as a block keyed by tool call, as host UI requests are. A press goes back either as the
tool's result (the call waits, as an ask does, with `server/host-ui.js`'s deadline) or as a new user turn carrying
`{ name, sourceComponentId, context }`. The waiting form works on every harness; the turn form suits widgets that live
on after the turn.

## Against the site kind

| | Site | Declarative UI |
| --- | --- | --- |
| What can be made | Anything HTML can do | Only the catalogue |
| Look | The agent's own CSS, light by default | The library and its tokens |
| Comments | Corner, located by guessing elements | Margin, anchored by component id |
| Runs | Agent script in a sandboxed frame, can reach the internet | No agent code; Conduit's own components |
| Phone, 144 Hz | A frame per site, polled every 2 s | Native rows, patched in place |

The site stays right for free-form pages (a mock-up, a visualisation, a game). A declarative tree is right for
anything Conduit should own the look and behaviour of.

## Security

**Inference.** Declarative UI runs no agent code, which is the point all three make. What remains: text props must go
through the same Markdown sanitising as messages (`client/chat/markdown-security.ts`); no URL may be opened without a
user gesture (A2UI's `requiresUserActivation`); a widget's data model goes only to the chat that made it (A2UI's
"targeted delivery"); no expression language beyond named functions. The site's open gaps (internet access, the hub's
sign-in page through relative links) do not arise.

## Streaming and performance

**Inference.** An MCP tool call reaches the hub whole, so over MCP a widget arrives at once, not token by token. Progressive
build would need either several calls (create, then data updates, as A2UI streams) or the harness's own partial tool input,
which Conduit's adapters may see. **Not verified:** whether the Claude Code and Codex adapters surface partial tool input
today. Rendering cost is the library's: a patch touches only the elements it names, and Solid updates those nodes. A
format with a general expression language (`$computed`, `@call`) adds evaluation per update; keep it to named,
precomputed functions. Validation runs once per message on the hub, off the client's frame.

## Across harnesses

**Inference.** Only a Conduit-owned MCP tool reaches all three harnesses alike; text-stream formats (json-render's inline
JSONL) depend on parsing each harness's prose and fail when a model wraps them in a code fence. Conduit's own runtime does
not offer `conduit_artifact` today (`selectionFor` in `server/durable-runtime.js`), so the same choice of adding a tool to
every Assistant chat's prompt applies here.

## Recommendation

Option E: a small Conduit catalogue of library pieces, carried by one Conduit-owned MCP tool, shaped like A2UI's
messages (flat components by id, a data model by JSON Pointer, named actions), validated on the hub with Effect Schema.
Start in the transcript by growing host UI requests and the roadmap's render tools; make the `ui` artifact kind second.
Keep sites for free-form pages. Do not adopt the AI SDK (React, its own stream); read json-render's validation and
patch code as prior art rather than depending on it.

## Decisions for the owner

Decided 2026-11-19: the format is A2UI v1.0 exactly (option B), not a Conduit-shaped one. The recommendation above
(option E) is superseded on format; the spike below sends A2UI messages. Still open:

1. **How a press reaches the agent.** The tool call waits for it (every harness, one answer), or it becomes a new user
   turn (widgets that last), or both.
2. **Artifact or widget first,** and whether Conduit's own runtime gets the tool in every chat.

## First spike

The biggest unknown is whether models across harnesses produce valid trees from a catalogue described in a tool schema,
and how the result feels at 144 Hz. Spike: one MCP tool `conduit_ui` with five components (`Text`, `Row`, `PillButton`,
`Segmented`, `Table`) and one action, rendered in the transcript from the library in the Test profile. Ask the same
three prompts of Claude Code, Codex and the Assistant profile; record how many calls validate first time, what the
refusals say, and one trace of a 200-row `Table` update against the 6.94 ms budget.
