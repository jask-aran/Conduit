# Markup & Conduit Documents

Agreed with the user on 2026-11-12. Milestones 1 and 2 are done. Milestone 3 is designed (see "Milestone 3, as designed") and no
code of it is written. Delete a part when it lands.

## Start here: the brief for the session that builds this

You are picking up a build whose design is settled. Read this section, then the rest of this file, then
`AGENTS.md` and `DESIGN.md`. Run it at effort `high`, as a background session the user checks in on.

### Goal

Build Markup & Conduit Documents from milestone 3 onward, in the order under "Milestones". The user marks up
Conduit's interface today and gets answers from a coding agent. They want the same loop on documents they and their
agents write together, live, and later on pages an agent makes. They ship a lot of code but are not a software
engineer: they read your prose closely and your diffs shallowly, so what you tell them is what they know.

### Done means, for each milestone

- `npm run typecheck` (from `conduit-web/`) is clean, conventions included.
- Interface feedback still works: `node scripts/probes/markup-delivery.mjs` and `markup-thread.mjs` pass (from
  `conduit-web/`, against conduit-local on :4310). Run them before a Markup change lands, not after.
- The milestone has a probe of its own beside those, and it passes. `markup-document.mjs` covers the editor at
  `/document` and the CLI's block commands; it deletes every block it adds. Extend it as the editor grows.
- It is committed, on local `main`, and conduit-local is restarted (`bash scripts/start-conduit.sh restart`), so the
  user can try it. Then you report (see "Reporting") and go on to the next milestone without waiting.

### What is already there

- `conduit-web/src/components/markup/` is the layer; `host.ts` states its boundary and its typed capabilities.
  `components/ui/markup.tsx` is its library pieces. `server/markup-store.js` is the receiver; the hub wraps it in
  `server/feedback.js`. `scripts/conduit-markup.mjs` is the agent's side (`wait --stay`, `reply`, `resolve`, `done`).
- `src/document-format.js` is the document format and the live socket's frames, shared by the hub and the editor.
  `server/documents.js` is the hub's document service (`/v0/document/<id>`, its `/blocks` and its `/live` socket), each
  document kept as Yjs state in `~/.conduit/data/documents/<id>.yjs`. `components/document/` is the editor; its
  `host.ts` states its boundary (`DocumentHost`) and what it offers Markup (`DocumentMarks`). `components/ui/document.tsx`
  is its library piece. `client/document/document-page.tsx` is `/document`: the one test document, id `test`.
  `conduit-markup document read|replace|insert|delete <id>` is the agent's side. The old `scratch.md` is left where it was.
- Decisions made in milestone 2, each stated where the code is: blocks are ProseMirror nodes with an `id` attribute
  (`BLOCK_TYPES`); the wire is two binary frames, `have` and `update`, over Yjs alone; an agent's edit is applied by the
  hub as the smallest change, under a Yjs client id of the agent's own, and the document's `authors` map names each
  client id; the editor is made only after the first merge with the hub; it never adds a trailing block; `y-prosemirror`
  is used directly (a small extension in `editor.tsx`), not TipTap's Collaboration extension, whose fork of it was not
  on the approved list.
- The source ceiling (convention rule 10, `LIMITS.sourceLines`) is 117,000, raised from 115,000 for this work on the
  user's word (2026-11-12): a ceiling may be raised for planned feature work and comes down after a cleanup. `src/` was
  at about 114,830 when milestone 3 began. The test and Markdown budgets (`conduit-web/budgets.json`) still only fall,
  and the bundle budget is tight: initial JS is within 1.1 kB gzip of 425,000, so new pieces stay out of the barrel.
- The two interface-feedback probes send real items, and a session whose `wait` is running is handed them: lines the
  listener prints while a probe runs are the probe's, not the user's.
- Convention rule 9 (`conduit-web/scripts/check-conventions.mjs`) keeps Markup's boundary and the editor's: each
  imports only solid-js, its own folder and the library (the editor also the format and its packages). Extend the rule
  to each new seam rather than working round it.
- Decisions you make yourself, and say in your report: how the workspace copy and its Markdown twin are written.
  How the editor feels (block menus, margin layout, the phone) cannot be decided on paper: build it, look at it in the
  headed Chrome on :9222, and tell the user what to try.

### Ownership

This codebase is yours: what it's for and how it's built are your call, and you'll keep building on it.

Markup, the document editor and the document service may change as the work needs. Change how any other existing
Conduit feature behaves only with a go-ahead from the user in the conversation.

### Limits and approvals

Get a go-ahead from the user in the conversation, naming the exact command, before you:
- run `git push` (pushing `main` deploys conduit-dev, the always-on server);
- change anything on a server other than conduit-local (prod changes only through releases);
- delete data under `~/.conduit/data` that you did not create yourself;
- write outside the project, except build outputs `AGENTS.md` allows and the document store under
  `~/.conduit/data/documents`;
- start a desktop or Android build;
- add a package other than `@tiptap/core` and TipTap's MIT extensions, `solid-tiptap`, `yjs` and `y-prosemirror`.

These need no approval: editing repo files; typecheck, `node --test`, the gallery and the probes; restarting
conduit-local; commits with explicit paths (`git commit -- <your files>`, because other sessions commit in this
checkout and a bare commit takes their staged work); fast-forwarding local `main` to your branch; adding the packages
named above; adding v2 library pieces or props the editor needs (list each in your report); adding `/v0/document`
routes and the document store's files; changing the hub's session code so it can start a document's mated thread;
retrying a check or probe that failed for a reason unrelated to your change.

Also hold to these, each for its reason:
- Build UI only from v2 library pieces and tokens, never magic sizes: the library is how the interface stays one thing.
- Sign out every hub session a probe mints (`lib.mjs`'s `close()` does): they count toward a 20-session cap and push
  the user's real devices out.
- Never name the product whose document comments the user pointed to as a reference, in any tracked file.

### How to work

Please avoid stopping while you still owe work the user asked for. Be persistent and do not stop unless needed.

While status notes are welcome, as is clarifying with the user on open decisions, carry on with work that does not depend on the user's answer without unnecessary stops.

If you notice yourself inviting the user to redirect you or offering to wait, instead proceed on the next part of the task. You may meet ordinary obstacles like errors, timeouts, locked files, empty results or failing tools. Diagnose them first, and when they are not real blockers, work through them with the access you have (wait and retry, fix the request, use another tool or source) rather than stopping unnecessarily.

If someone clearly decided something is a hard blocker, such as a file marked not to be touched, access that was intentionally withheld, or a safety guardrail, leave it alone, say plainly what you found, and look for another safe way to finish the task. Stopping before the task is complete is very rarely merited, as in when the task can't move forward without user input, or where the blocker is deliberate and should not be worked past. This does not override the need for confirmation on risky or destructive actions.

- Commit each finished piece as you go. Keep this file true: delete a part when it lands, and write down a decision
  you made where the next reader will look for it.
- Take the user's markup while you work: keep `node scripts/conduit-markup.mjs wait "<what you are working on>" --stay`
  running under the Monitor tool, answer with `reply`, and re-arm it when it expires.
- A subagent costs its own context and returns only a summary, so do the main build yourself. Use one for side work
  that is independent of what you are doing (research, a review you want unanchored, a mechanical sweep), on Opus at
  low or medium effort, and brief it with the goal, what is ruled out, and the files to read.
- Every few tool calls, give the user a one-line update on where things stand.

### Reporting

Write for an intelligent but low-context reader. The person reading has not seen your tool calls, your reasoning or the files you opened, and may be switching in from other work. Messages should generally be self-contained: the reader should understand what you mean without having to dig for other context. Put the key points in the first few sentences. Practice progressive disclosure in your sentence order, and do not use undefined references and ideas in line 1 that won't make sense until the reader reaches line 12.

Use plain words, and write in clear, understandable full sentences. Do not use a term or abbreviation that you made up during the work. Say what the thing is in a way any reader would understand. Write mostly in the style of ASD-STE100 Simplified Technical English: short sentences, one idea per sentence, active voice, and consistently using the same word for the same thing. Use a paragraph of flowing prose where ideas connect, and keep bullets for lists of separate items. Leave out unnecessary details unless the reader asks and practice concision, but do ensure that your messages have the key context. Aim to make your user-facing text as human-readable and clear as possible.

At each milestone, report: what the user can now do and how to try it; what behaviour changed; what you ran and what
it printed, kept apart from what you did not run; the decisions you made on their behalf; what is still unproven.
List every change, small ones included, because the user checks the diff against your list. Use the code's real
names (`MarkupHost`, the mated thread, the margin thread), and say so when something has no name yet.

## Milestone 3, as designed

Not started. Build it in this order and commit each piece. The reasons are here because the design was worked out
against `tool.tsx`, `markup.tsx` and `markup-store.js` and is not yet in code.

**What Markup's tool is today** (`components/markup/tool.tsx`). One sitting is a store of `selections` (comments being
written, each with its marks on the page) and one followed item (`held.item`, polled by `follow(id, only)`); `replyTo`
is a comment's number within that one item. A comment is written in a float `MarkupNote` beside its place, then stands
in the corner stack (`MarkupNotes`); once sent, its card is the thread. Boxes are read once a frame (`frame()`).
`addQuote(range)` makes a comment from a DOM Range. `send()` builds the item and calls `host.under(box)`. After a
reload an item is only in the "sent before" list, with no marks. None of this suits a document, where every open
thread belongs on the page for every device.

1. **The document's own receiver.** Threads live with the document: `server/documents.js` makes one
   `createMarkupStore` per document, its folder `~/.conduit/data/documents/<id>.markup/`. Its routes are
   `/v0/document/<id>/markup/...`: make `registerFeedbackRoutes` (`server/feedback.js`) take a base and a store per
   request, and give `/v0/document` the 4 MB JSON limit `/v0/markup` has (`server.js`, before the app's own parser).
   The page's transport is then `httpTransport(api, "/v0/document/test/markup")`. The store gains: an option that
   points its `.waiting` folder at the hub's (listeners are one registry); `quote` and `under` on each comment of
   `thread()`; and `open()`, every unfinished item's thread in one answer (a transport method too). In
   `scripts/conduit-markup.mjs`, `wait` watches the feedback folder and every `documents/*.markup`, and `reply`,
   `resolve`, `done` and `take` find an item's folder by its id across those.
2. **Margin threads.** A new `components/markup/margin.tsx`, `MarkupMargin`: it asks `transport.open()` every few
   seconds and draws every comment as a `MarkupNote` in a margin column beside what it is about, sorted by where that
   is and pushed down so no two overlap, with reply and resolve as the cards have now. It shows whenever the document
   is open, the tool closed too. The host says where things are through two new `MarkupHost` members: `anchors(list)`,
   told each open comment (`key` "<item>/<n>", its `quote` and `under`) so the surface marks them, and `place(key)`,
   the box of one now. A new capability says where sent comments stand, `corner` or `margin`; with `margin` the tool
   stops drawing sent cards and following the item in the corner, and tells the page when it has sent. The editor marks
   anchors with ProseMirror decorations. An anchor is a block id and the quoted text, found again inside that block,
   falling back to the block when the text has changed. It is not a Yjs relative position: an agent's answer is often
   to change the quoted text, and an agent can read a block id and a quote. A phone has no margin: decide there
   (under the block, or the corner stack as now) by looking at it.
3. **An agent's edit shown as changed, with Revert.** `conduit-markup document replace|insert|delete … --for
   <item>/<n>` says which comment an edit answers. The hub keeps, in the document's Yjs map `changes`, block id →
   `{ for, before, after, by, at }` (`before`: the block as it was, none for an inserted one; `after`: the block a
   deleted one followed; the first `before` is the one kept). The editor tints those blocks. A change is settled
   (removed) when its comment is resolved: the hub checks on every `open()` read, which covers an agent's resolve (a
   line appended to the folder, with no hub in the path) as well as the person's. Revert is `POST
   /v0/document/<id>/changes { thread, op: "revert" }`, which puts each `before` back; the card shows it through a host
   member (`revert: { can(key), run(key) }`) and a `MarkupNote` prop.
4. **One bar.** The block kinds leave the document bar's menu (`KINDS` and the `DropdownMenu` in `editor.tsx`) for
   Markup's rail: a rail of their own above the bar while the app is in use (the options rail shows only while
   annotating, so the two never stand together), declared by the host as tools (name, label, icon, active, run).
   "Ask the agent" makes a quote comment from the document's selection, or the caret's block, through `addQuote`.
   Image and date need block types the format does not have yet: add them then or say why not.
5. **Proof.** Extend `markup-document.mjs` (a comment's card stands beside its block on a second page; an edit sent
   `--for` it tints the block; Revert restores the block; resolving clears the tint), add the margin and the rail to
   the gallery, run the three probes, then commit, restart and report.

## What it is

Markup is the layer a person marks a surface up with (select, quote, draw, comment) and the threads those comments
become with an agent. It began as feedback on Conduit's own interface and that use stays. It now grows a second
use, documents, and later artifacts (pages an agent makes) and other kinds such as whiteboards. Drawing over a
document stays possible: a comment may be a mark, not only words.

- **The layer and the surface are separate.** A surface (Conduit's interface, the document editor, an artifact
  viewer) is a host: it gives Markup everything through `MarkupHost` and declares what applies there. The editor
  ships with Markup as an optional part and may integrate tightly, but through declared seams only.
- **Typed capability declarations at every internal seam.** Host to layer (`MarkupCapabilities`, today), editor
  to layer, document service to agent, receiver to listener: each side states in a type what it offers, and nothing
  undeclared is shown or callable. A new host is a declaration, never a fork.
- **Interface feedback is not compromised.** It keeps its item folder (`~/.conduit/data/feedback`), its `wait`
  listener and its corner stack of cards. It may gain what documents bring. Its probes run before a change lands.

## The document

- **Hub-owned.** A Conduit document belongs to a project; the hub holds the live copy and is the only way in. It
  saves a copy into the workspace with a readable Markdown twin, both output only (git, backup, other tools).
- **Blocks.** Our own structured format: every block has a stable id; threads anchor to a block or a run of text.
- **Edited live by many.** The person on several devices and several agents at once, merged as they type: any
  signed-in session and any agent in the project. Each edit and comment records its author, for people later.
- **Editor.** Ours, from v2 pieces (blocks, menus, comment anchors, change marks), on ProseMirror through TipTap
  core (MIT) with Yjs for merging. `solid-tiptap` binds it to Solid for now; fork it when it holds us back.

## Comments and agents

- **Where threads live.** With the document. Shown in the margin beside what they are about; the thread says when
  the agent is working on it, a tick resolves it, and it folds to its latest line.
- **One bar.** Markup's rail, extended for documents with the block tools (text style, table, image, checklist,
  lists, quote, code, divider, date) and "ask the agent". Which tools show is the host's declaration.
- **Making a comment.** With a Markup tool, or by typing `@name` inline. Both make the same thread.
- **Who answers.** One addressee per comment, and only it is told. `@conduit` is the document's mated thread and
  the default: one per document, started by the hub on the first comment, on the project's default profile. The
  person's persistent agent and any agent connected to the document's listener can be addressed by name.
- **How agents reach a document.** One hub API, as MCP tools and as the `conduit-markup` CLI: read as Markdown
  with block ids; replace, insert after and delete a block; reply; resolve.
- **An agent's edit** lands at once, tinted until the thread that asked is resolved; that thread carries Revert.

## Milestones

1. Done: the code is named Markup; one delivery (Send now per comment, or Send for what is outstanding).
2. Done: the hub's document service with live merging; the block editor at `/document` on the test document; the
   CLI's block commands. Phone editing merges; its polish is later.
3. Margin threads and Markup tools on the document; agent edits shown as changed, with Revert.
4. The hub-started mated thread; the MCP tools; addressing by `@name`.
5. Documents in projects: the file tree, many documents, the saved workspace copy and its Markdown twin.
6. Artifacts: agent-made pages with Markup over them.

## Not settled

- How the editor feels. Milestone 2 has one block menu in the bar (the caret's block kind, opening the kinds) and
  Markdown typing rules; the user has not yet said how it feels. Milestone 3 moves the block tools to Markup's rail.
  Not built: other people's carets, a placeholder, images and dates, the library's own checkbox in a checklist, and
  keeping what is typed while the hub is away if the page is closed before it answers.
- Who an author is: every person's client is recorded as `person` until there is a name to give it.
- The hub starting a thread touches its session code, which Markup has not needed before.
- Moving Markup and the editor into the shared components package: parked until the package's scope is decided.
