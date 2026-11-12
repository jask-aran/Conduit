# Markup & Conduit Documents

Agreed with the user on 2026-11-12. Milestones 1, 2 and 3 and step (a) of what follows are done. Delete a part when it lands.

## Start here: the brief for the session that builds this

You are picking up a build part-way. Milestones 1 to 3, step (a), papers in panes, step (b), the mated thread and
connections, and the first half of step (c), the tool `conduit_paper`, are built. Addressing by `@name` is next, and
waits for the user's answers under "Not settled". Read "Settled with the user on 2026-11-12" first. Read this section, then the rest of this
file, then `AGENTS.md` and `DESIGN.md`. Run it at effort `high`, as a background session the user checks in on.

### Where things stand (2026-11-12, after step (b) and the tool of step (c))

- Local `main` holds milestones 1 to 3 and steps (a) and (b). `origin/main` is behind it: someone other than the
  building session pushed at 14:57 on 2026-11-12, up to `d8dcf4f9d` (margin threads). Pushing is still the user's call.
- conduit-local on :4310 runs local `main`. Try it: open the Test project in the sidebar and press "Test document";
  the header's Paper | Thread switch; the header's "Connect a chat" menu, or a chat's menu › Connect to artifact….
- Five probes pass on that build, each with `errors: []`: `markup-threads.mjs` (14 checks: the switch, the hidden
  thread, a connected chat handed a comment on the scripted profile, `conduit_paper` called as that chat, the rider,
  both ways to connect),
  `markup-artifacts.mjs` (10), `markup-document.mjs` (17), `markup-delivery.mjs`, `markup-thread.mjs`. In eight runs
  of `markup-threads.mjs` one stopped on a click that timed out; which click was not found. Not run: `npm test`,
  the headed Chrome on :9222, a real phone, Android, desktop, two people typing in one paragraph. Real models were tried
  three times on the Test document. Its mated thread (Conduit's own runtime) took a comment and answered "pong" with
  the CLI in about 20 seconds. Asked to use `conduit_paper`, the same thread said it has no such tool (see step (c)).
  A Claude Code chat connected to the paper used `conduit_paper` to add a paragraph for the comment and to reply.
  The paper and the project were put back afterwards (the change taken back, the comments resolved, that chat
  deleted); the mated thread's Thread view still holds its two turns. A margin with other open comments moves a
  card away from its text, which fails one check of `markup-document.mjs`: run the probes on a paper with none.
  Screenshots were looked at headless only.
- No Markup listener is running. The user said (2026-11-12) it need not be kept live all the time; start
  `wait --stay` when you want their markup.
- The user asked (2026-11-12) for subagents to build and check in parallel: Opus 5.5 at low or medium effort, each
  with a file list it may edit, no builds or restarts, and one that only reviews. `client/main.tsx` can be edited by
  two at once when each uses narrow edits. The review found the worst defects of steps (a) and (b) before either ran
  on real data.
- **The initial JS budget is 427,000 B gzip** (was 425,000; the user said "Ok keep going" to a raise of up to 3,000
  on 2026-11-12). The build is at 426,048. New panes and dialogs load lazily; a rider and a header switch cannot.

### Step (b) as built

- **The mated thread** is an ordinary chat whose `backend.mated` is its paper's id, made by `mated(id)` in
  `server/documents.js` through `createChatHost().openChat` (`agent/chat-host.js`; `startChat` and it share `make`),
  on the project's default profile, titled with the paper's name. `ChatStore.list` leaves such chats out unless
  `includeHidden`, so no list, dashboard, digest or agent tool shows one; it is found by id. The paper's
  `links.json` (`.conduit/artifacts/<id>/`) holds `{ thread, connections }`. An unstarted thread is a draft, which
  the client discards and the store drops after a day: `mated` makes another when the one it had is gone.
- **Who is handed what.** The Markup store takes `held` (listeners its host holds; listed first, so the mated
  thread, named `conduit`, is who a paper's comment goes to unless the person picks another). A connected chat is a
  listener by its title (a second of the same title, or one with no title, is `chat <first 8 of its id>`). `hand`
  takes the item in the listener's name (`taken.json` with `held: true` and the chat's id), tells the chat with
  `deliverApproval` (a notice that starts its agent, or steers it when busy and the harness can), then marks the
  comments as being worked on. A chat that cannot be told has not taken the item: it goes back to waiting. An item a
  `wait` session took first under the same name stays that session's. What the person writes back, or a reopen,
  reaches the chat that took the item, found by its id whatever it is called now. A resolve tells nobody.
- Routes: `POST /v0/document/<id>/thread` (the thread's chat, made if need be), `GET /v0/document/<id>/connections`,
  `PUT|DELETE /v0/document/<id>/connections/<chat>`, `GET /v0/chats/<chat>/connections`. A change tells clients
  `artifacts_changed`.
- **One tab, two views** (`client/main.tsx`): `matedThreads` (chat id → paper id, kept in a setting on the device)
  makes `tabKey` give a thread's view its paper's tab key, so `chat:<mated>` and `artifact:<id>` are one tab named
  for the paper. `showThread` asks the hub for the thread, puts it in `hiddenChats` and sets the pane's view;
  `paperModes` is the `Segmented` passed as `modes` to the paper's `PaneHeader` and to `ChatHeader` (`PaneHeader`
  of kind `pane` now draws `modes`). A thread's address, or a stored pane showing one, opens its paper.
- **The rider** is an `AgentRow` in `RunningAgents` (`client/chat/agents.tsx`) under Background: "Connected to
  <paper>", pressed to open the paper beside (window event `conduit:open-artifact`), its stop control named
  Disconnect. `AgentRow` took `icon` and `stop`. `client/document/connections.ts` is what the client knows of
  connections. The paper's header has the "Connect a chat" menu (the project's chats, ticked); a chat's sidebar menu
  has "Connect to artifact…" (`artifact-connect.tsx`, lazy; not offered in the Chats project, which has no artifacts
  listed).
- Known gaps: deleting a paper leaves its mated thread's chat, hidden; the routines digest does not see paper
  threads; an agent whose chat is busy on a harness that cannot steer is not told (the item goes back to waiting);
  a paper is always the view a reload opens, never its thread; switching from a chat with riders to one with none
  may play the old rows' leave in the new chat (not looked at); the row's accessible names read "Open Connected to
  <paper>"; "Comments come here" on the rider is the builder's copy.

### Step (c) so far: the tool `conduit_paper`

- `server/paper-tool.js`, in `conduitTools` (`server/conduit-mcp.js`), so it is served at Conduit's MCP endpoint to
  every harness that is handed it. One tool with an `action`: `list`, `new`, `read` (Markdown with block ids),
  `replace`, `insert`, `delete` (with `for: "<item>/<n>"` to mark the change for a comment), `comments` (what is not
  settled on the paper), `reply`, `resolve`. The paper need not be named in its own thread or in a chat connected to
  one paper (`documents.of(chat)`); an edit is written under the name the chat listens by. The Markup store took
  `answer` (a session's reply or resolve, as the CLI writes them).
- **Conduit's own runtime does not offer it.** `selectionFor` in `server/durable-runtime.js` gives each profile the
  tools its template names, plus a fixed few; `conduit_paper` is not among them, so a chat on the Assistant profile
  (every mated thread, by default) uses the CLI through its shell. Adding it there puts one more tool in every such
  chat's prompt: the user's call (see "Not settled").
- Any chat can read or change any paper it names; a connection only decides who is handed comments. The `.paper`
  file is in the project's folder, which those agents can already write.

### Step (d), read and not built: a project on another device

- Such a project has `local: false` and a `nodeId` (`remoteNode` in `place.js`); its `workingRoot` is the path on the
  device, and its `chatRoot` is on the hub's disk, where its chats and their attachments already are. Today they are
  conduitcomposer and Screenshots (the Windows device) and Writing (a third device).
- The hub's way to a device's files is `projectWorkspace(project, nodeHub)` (`workspace-host.js`), a host with
  `stat`, `list`, `read` (a Buffer), `write`, `rename`, `unlink`, `mkdir`, `watch`; under it `listFiles` lists a tree.
  The file tree and viewer use it through `workspace-inspector.js`. A device that is offline throws `device_offline`
  at once; a call otherwise times out after 60 s. The folder must be shared with `--write`.
- What it lacks, against what `server/documents.js` does with `node:fs`: a write is not atomic (write a part file,
  then `rename`), there is no exclusive create, no `realpath` (the check that a link does not leave the folder), no
  file birth time (which of two copies keeps the id), and no glob (`listFiles`, then keep `*.paper`). Changes on a
  device reach `onWorkspaceChange` only while some client has that project's file tree open.
- The smallest build: `documents.js` reads and writes the `.paper` file through a host (the local one is `node:fs`),
  polls `stat` every two seconds while a paper is open, and keeps `.conduit/artifacts/<id>/` under `chatRoot` on the
  hub, as chats do. That last part is not what was settled for local projects (threads in the project's folder), so
  it is the user's call. No test device is paired with conduit-local: trying it writes a `.paper` into one of the
  three real folders, which needs the user's go-ahead.

### Step (a) as built

- `server/documents.js` is the whole of it on the hub. Which papers exist is read from the folders, never kept: at
  start, and again when a project's files change (`filesChanged`, from `onWorkspaceChange`), each project's folder is
  listed for `*.paper` (`git ls-files`, so nothing git ignores; a bounded walk where the folder is no repository). A
  file belongs to the project whose folder holds it most closely, because every managed project's folder stands
  inside the Chats project's. A file with no id, or with the id of a paper still in another file (a copy), is given
  its own id, written into it; the older file keeps the id.
- The file wins: `take` reads it on load, every two seconds while someone has it open, and before each save and each
  agent's read or edit. A file that cannot be read is left alone and the hub writes nothing until it can be (the live
  copy goes on; what is typed meanwhile is lost when the mended file is taken). A file that has gone is looked for
  under another name by id; found nowhere, the paper is closed. Another paper's file at an open paper's path (a
  checkout) closes the open one. Writes are a temporary file and a rename.
- Routes: `GET|POST /v0/projects/<id>/artifacts` (list; make with `{ kind, name, folder? }`; `{ path }` gives the
  artifact a file is), `GET /v0/document/<id>?as=about|markdown|blocks`, `PATCH` (rename), `DELETE`. The hub tells
  clients `artifacts_changed` with the project's id. A project on another device answers 501.
- Deleting a paper deletes its file and leaves `.conduit/artifacts/<id>/`, so a file brought back from git is the
  paper it was. The hub lists every paper's Markup folder in `~/.conduit/data/documents/roots.json` for the CLI, which
  cannot ask the hub where projects are. `conduit-markup document list <project>` and `document new <name> --project
  <id>` are the agent's side.
- Client: `client/document/artifacts.ts` (what the client knows of artifacts), `artifact-pane.tsx` (the pane:
  editor, margin, Markup's tool, one for each open paper), `artifact-rows.tsx` (the sidebar's rows with their menu,
  rename and delete), `artifact-creator.tsx` (New Artifact). All four load lazily. In `client/main.tsx`:
  `renderArtifactDocument`, `openArtifact`, and `artifact` added to `isToolView` and `tabbable` (a view kind missing
  from `isToolView` is drawn as a dock tool over the pane). A `.paper` opened through `openFileDocument` opens the
  artifact. `/?a=artifact:<id>` is a paper in the first pane.
- Markup's bar stays on its pane through `MarkupHost.frame`: the tool keeps the frame's insets from the window on the
  layer as `--markup-frame-left` and `--markup-frame-right`. `DocumentSheet` and `DocumentEditor` take `bare` (no bar
  of their own in a pane) and the editor says when the hub is out of reach (`onAway`).

### Settled with the user on 2026-11-12: where an artifact lives

What opens is an **artifact**, in a pane as a tab, like a chat or a browser. The block document is the first kind of
artifact and is called a **paper** ("for now", the user said); `DESIGN.md` keeps "document" for what any pane holds.
The code keeps `document` inside the editor and the hub's service; the pane kind is `artifact:<id>`.

- **A paper is a file.** `<name>.paper` in its project's folder: the blocks as readable JSON (`conduit-document`),
  with the paper's id inside, so a rename or a move keeps its threads. Its threads, change marks and Yjs state live
  in `<project>/.conduit/artifacts/<id>/`. The hub is the only writer while Conduit runs and writes the file after
  each save. `.conduit/` is where a project's chats already keep their files, and Conduit already keeps it out of
  git through Git's local exclude file (`excludeConduitFromGit` in `attachment-store.js`), never the project's
  `.gitignore`; making a paper does the same, so threads and history are not committed by a routine commit. An artifact always belongs to a project.
- **A file changed outside Conduit wins.** When the file differs from what the hub last wrote (a checkout, a hand
  edit, a clone with no `.conduit/`), the hub takes the file as the paper, blocks matched by id. A file it cannot read
  is an error shown, never a guess.
- **No Markdown twin.** Export to Markdown is a command on the paper.
- **Listed** as rows in the sidebar under the project (for now), and seen in the file tree as the file it is;
  pressing a `.paper` there opens the artifact.
- **Verbs.** "New Artifact" (beside "New chat", and in the palette) opens the artifact creator, which offers the
  kinds; paper is the first. Open follows the one rule (plain replaces, Ctrl keeps a tab, Alt opens beside). Rename,
  move and delete are the file's. An agent makes one with `conduit-markup document new "<name>" --project <id>`.
- **Two views, one tab.** The pane header's segmented switch, Paper | Thread: Thread is the mated thread as an
  ordinary chat view. The mated thread is not in the project's list of chats. The hub starts it on the first comment
  to `@conduit`, on the project's default profile.
- **A connection is a rider.** Any other chat acts on a paper only because the person connected it ("Connect a
  chat…" on the paper, "Connect to artifact…" in the chat). The chat then shows a rider below the composer, under
  Background: "Connected to <paper>"; a press opens the paper beside, its × disconnects. The mated thread has no
  rider. One registry of listeners holds every connection; how a comment arrives differs: the hub writes it into a
  chat Conduit runs as a notice that wakes it, and a session Conduit does not run (a terminal agent) keeps `wait`.
  The user hoped for one mechanism and accepted two arrivals, since the MCP tools make a second way in anyway.
- **Projects on another node** (Writing, Screenshots, conduitcomposer) follow as their own step; the first build
  covers projects whose folder is on the hub. How the hub writes a file on a node has not been read yet.
- **`/document`** is gone. A paper in the first pane has its place in the app's address (`/?a=artifact:<id>`); no
  standalone route for now. The test document is `Test document.paper` in the Test project's folder
  (`~/.conduit/data/chat/files/test`), id `test`, with its threads.

The order, agreed: (a) done: papers in panes; (b) done: the mated thread as the second view, started by the hub, and
connections with their rider; (c) the MCP tools and addressing by `@name`; (d) projects on another node; (e) other
kinds of artifact.

What is known about the code: a pane's content is a `SplitView` (`client/workspace/workspace-types.ts`: `chat:<id>`,
`browser:<id>`, `page:<id>` and others), and every kind is also declared in the UI API (`UI_VIEWS` in `ui-api.js`),
checked each way by `SplitViewKind`; `client/main.tsx` holds the pane and tab logic; `PaneHeader` has a `modes` slot.

### Goal

Build Markup & Conduit Documents onward from milestone 3, in the order agreed under "Settled". The user marks up
Conduit's interface today and gets answers from a coding agent. They want the same loop on documents they and their
agents write together, live, and later on pages an agent makes. They ship a lot of code but are not a software
engineer: they read your prose closely and your diffs shallowly, so what you tell them is what they know.

### Done means, for each milestone

- `npm run typecheck` (from `conduit-web/`) is clean, conventions included.
- Interface feedback still works: `node scripts/probes/markup-delivery.mjs` and `markup-thread.mjs` pass (from
  `conduit-web/`, against conduit-local on :4310). Run them before a Markup change lands, not after.
- The milestone has a probe of its own beside those, and it passes. `markup-document.mjs` covers the editor (the test
  paper in a pane) and the CLI's block commands; it deletes every block it adds. `markup-artifacts.mjs` covers the
  pane, the sidebar rows and the verbs. Extend them as the work grows.
- It is committed, on local `main`, and conduit-local is restarted (`bash scripts/start-conduit.sh restart`), so the
  user can try it. Then you report (see "Reporting") and go on to the next milestone without waiting.

### What is already there

- `conduit-web/src/components/markup/` is the layer; `host.ts` states its boundary and its typed capabilities.
  `components/ui/markup.tsx` is its library pieces. `server/markup-store.js` is the receiver; the hub wraps it in
  `server/feedback.js`. `scripts/conduit-markup.mjs` is the agent's side (`wait --stay`, `reply`, `resolve`, `done`).
- `src/document-format.js` is the document format and the live socket's frames, shared by the hub and the editor.
  `server/documents.js` is the hub's document service (`/v0/document/<id>`, its `/blocks` and its `/live` socket); where
  a paper is kept is under "Step (a) as built". `components/document/` is the editor; its
  `host.ts` states its boundary (`DocumentHost`) and what it offers Markup (`DocumentMarks`). `components/ui/document.tsx`
  is its library piece. `conduit-markup document list|new|read|replace|insert|delete` is the agent's side. The old
  `scratch.md` is left where it was (`~/.conduit/data/documents/`).
- Decisions made in milestone 2, each stated where the code is: blocks are ProseMirror nodes with an `id` attribute
  (`BLOCK_TYPES`); the wire is two binary frames, `have` and `update`, over Yjs alone; an agent's edit is applied by the
  hub as the smallest change, under a Yjs client id of the agent's own, and the document's `authors` map names each
  client id; the editor is made only after the first merge with the hub; it never adds a trailing block; `y-prosemirror`
  is used directly (a small extension in `editor.tsx`), not TipTap's Collaboration extension, whose fork of it was not
  on the approved list.
- Milestone 3, as built. A document's comments live with it: `server/documents.js` makes one Markup store for each
  document, in `<project>/.conduit/artifacts/<id>/markup/`, served under `/v0/document/<id>/markup/...` by the same routes
  interface feedback has (`registerMarkupRoutes` in `server/feedback.js`). The listeners are one registry (the feedback
  folder's `.waiting`), so one `wait` is handed interface feedback and every document's comments; the CLI looks for an
  item in the feedback folder and in every paper's Markup folder. On a paper each Send is an item of its own.
- The margin is `components/markup/margin.tsx` (`MarkupMargin`), which the page mounts in `DocumentSheet`'s `margin`.
  It asks the store for its open threads (`open()`: every item with a comment the person has not resolved themselves,
  or with an answer unread) every three seconds and draws each comment's card at the height of what it is about. The host says where that is
  through `MarkupHost.margin` (`anchors`, `place`, `watch`, `revert`); the capability `sent: "margin"` makes the tool
  hand its sent comments over instead of keeping them in its corner. The editor marks an anchor with a ProseMirror
  decoration: a block id and the quoted text found again in that block, the whole block when the text has changed. It
  is not a Yjs relative position, because an agent's answer is often to change the quoted text. Where the page is too
  narrow for text and margin side by side the margin wraps under the text (CSS, at the width of the two measures) and
  the cards are a list in the text's order.
- An agent's edit sent `--for <item>/<n>` is kept in the document's Yjs map `changes` (`document-format.js` says its
  shape) until the person resolves that comment; the hub clears it on each read of the open threads. The editor tints
  those blocks and shows a line where one was deleted. `POST /v0/document/<id>/changes { op: "revert", thread }` puts back everything changed for one comment.
- Nothing leaves the margin but by the person's hand (the user's rule, 2026-11-12). An agent may resolve a comment or
  finish the item: the card then says "Agent resolved" (or "Handled") and stays, with the tint and Revert, until the
  person ticks it. Agents are trusted to resolve only what the person has agreed to. Dismissing several at once is
  allowed and not built.
- One trap, met once: the editor must never be changed inside a Yjs observer. `y-prosemirror` writes the editor's
  document back to Yjs on every editor change, so a change made before a merge has reached the editor undoes the
  merge. `editor.tsx` redraws its marks in a microtask for that reason.
- The block kinds are tools of Markup's rail (`MarkupHost.tools`, a rail of their own above the bar while the app is
  in use), with "Ask the agent" (`MarkupHost.asking`), which starts a comment about the selection or the caret's block.
  The document's own bar holds only Mark up.
- The source ceiling (convention rule 10, `LIMITS.sourceLines`) is 119,000. It was 115,000 before this work and was
  raised twice on the user's word (2026-11-12): a ceiling may be raised for planned feature work and comes down after
  a cleanup. `src/` is at 115,190 after milestone 3, which added about 360 lines; the next milestone adds a pane kind,
  many documents and the mated thread, so it has 3,800 lines of room. The test and Markdown budgets (`conduit-web/budgets.json`) still only fall,
  and the bundle budget is tight: initial JS is within 1 kB gzip of 427,000, so new pieces stay out of the barrel.
- The two interface-feedback probes send real items, and a session whose `wait` is running is handed them: lines the
  listener prints while a probe runs are the probe's, not the user's. `markup-document.mjs` sends one comment, handed
  to no session, and finishes it.
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

- **Hub-held, kept as a file.** A paper belongs to a project and is a file in its folder; the hub holds the live copy
  and is the only way in while Conduit runs. See "Settled with the user on 2026-11-12".
- **Blocks.** Our own structured format: every block has a stable id; threads anchor to a block or a run of text.
- **Edited live by many.** The person on several devices and several agents at once, merged as they type: any
  signed-in session and any agent in the project. Each edit and comment records its author, for people later.
- **Editor.** Ours, from v2 pieces (blocks, menus, comment anchors, change marks), on ProseMirror through TipTap
  core (MIT) with Yjs for merging. `solid-tiptap` binds it to Solid for now; fork it when it holds us back.

## Comments and agents

- **Where threads live.** With the document. Shown in the margin beside what they are about; the thread says when
  the agent is working on it and folds to its latest line. The person's tick resolves it and puts it away; an
  agent's resolve only marks it.
- **One bar.** Markup's rail, extended for documents with the block tools (text style, table, image, checklist,
  lists, quote, code, divider, date) and "ask the agent". Which tools show is the host's declaration.
- **Making a comment.** With a Markup tool, or by typing `@name` inline. Both make the same thread.
- **Who answers.** One addressee per comment, and only it is told. `@conduit` is the document's mated thread and
  the default: one per document, started by the hub on the first comment, on the project's default profile. The
  person's persistent agent and any agent connected to the document's listener can be addressed by name.
- **How agents reach a document.** One hub API, as MCP tools and as the `conduit-markup` CLI: read as Markdown
  with block ids; replace, insert after and delete a block; reply; resolve.
- **An agent's edit** lands at once, tinted until the person resolves the thread that asked; that thread carries Revert.

## Milestones

1. Done: the code is named Markup; one delivery (Send now per comment, or Send for what is outstanding).
2. Done: the hub's document service with live merging; the block editor at `/document` on the test document; the
   CLI's block commands. Phone editing merges; its polish is later.
3. Done: margin threads and the block tools in Markup's rail on the document; agent edits shown as changed, with Revert.
4. to 6. were: the hub-started mated thread, the MCP tools and addressing by `@name`; documents in projects (the
   file tree, many documents, the saved workspace copy and its Markdown twin); artifacts (agent-made pages with
   Markup over them). Reordered on 2026-11-12: see "Settled with the user on 2026-11-12" for steps (a) to (e).

## Not settled

- How the editor feels: the block tools in the rail, Markdown typing rules, the margin. The user has not yet said.
  Not built: other people's carets, a placeholder, the library's own checkbox in a checklist, table controls, and
  keeping what is typed while the hub is away if the page is closed before it answers.
- Image and date blocks. The format has neither. An image needs somewhere to keep the file, which comes with
  documents in projects (milestone 5); a date is an inline node the format does not have. Neither is in the rail.
- The margin's rules, to be judged by use: a comment the person has resolved leaves the margin once every comment of
  its item is resolved (so Reopen is only reachable until then); a drawing made on a document is not kept on the page
  once sent, only the blocks under it; a phone has the cards under the text, not beside a block; while annotating, the
  layer has every press, so a card is pressed only while the app is in use.
- How the artifact creator, the Paper | Thread switch on a phone and the connection's rider feel: build, then the user judges.
- Rough edges of step (a), none yet judged by the user: in a narrow pane Markup's bar wraps to two rows (the compact
  bar is chosen by touch, not width); while one paper is being annotated its layer takes presses over the whole
  window, other panes included, and comments not yet sent stack at the window's right edge; a person with a paper
  open is not told when its file cannot be read; the Chats group shows no artifacts; a project with papers and no
  chats still says "No chats" above them; a tab not yet shown that is renamed keeps its old name until shown; the
  Computer dashboard's own file list still opens a `.paper` in the file viewer; a paper in a folder git ignores is
  listed only once it has been opened from the file tree.
- **Addressing by `@name`, not built, waiting for the user:** (1) whether `@name` typed in a Markup comment's words
  sends that comment to that listener instead of the bar's; (2) what typing `@name` in the paper's own text does
  (the plan says it makes a thread: on which words, sent when, and whether the mention stays in the text); (3)
  whether the person's persistent agent is a listener on every paper; (4) whether `conduit_paper` goes into every
  chat of Conduit's own runtime.
- **Step (d), waiting for the user:** whether a paper's threads and state for a project on another device are kept
  on the hub (recommended: where that project's chats already are) or in the folder on the device; and a go-ahead to
  make a test paper in one of those folders.
- Who an author is: every person's client is recorded as `person` until there is a name to give it.
- Rough edges of step (b), none yet judged by the user: the first comment on a paper goes to its mated thread, on
  the project's default profile, with no word to the person that a model is about to run; the rider's wording and
  mark; whether the thread should be kept when its paper is deleted; whether an agent's tools should see a paper's
  thread; "Connect a chat" uses the chat icon, since the library has no link icon.
- Moving Markup and the editor into the shared components package: parked until the package's scope is decided.
