# Markup: marking things up with an agent, and the documents it grows into

Agreed with the user on 2026-11-12. Milestone 1 is done; the rest is not started. Delete a part when it lands.

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
2. Hub document service with live merging; the block editor at `/document` on one test document; CLI block
   commands. The phone reads and comments; phone editing must not corrupt, its polish is later.
3. Margin threads and Markup tools on the document; agent edits shown as changed, with Revert.
4. The hub-started mated thread; the MCP tools; addressing by `@name`.
5. Documents in projects: the file tree, many documents, the saved workspace copy and its Markdown twin.
6. Artifacts: agent-made pages with Markup over them.

## Not settled

- How the editor feels (block menus, margin layout, the phone): tried in milestone 2, not decided on paper.
- Whether live merging from the start is worth its cost. It is what makes the document hub-owned and structured;
  "the person plus agents, a block at a time" would make milestone 2 much smaller. Raised, not revisited.
- The hub starting a thread touches its session code, which Markup has not needed before.
- Moving Markup and the editor into the shared components package: parked until the package's scope is decided.
