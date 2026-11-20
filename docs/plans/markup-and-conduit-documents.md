# Markup & Conduit Documents

Agreed with the owner on 2026-11-12 and built since: papers and sites as artifacts in panes, the mated thread,
connections, `conduit_artifact` and `@name`, papers on another device, suggesting, the `markdown` and `sheet` kinds.
This file holds the rules the code follows and what is still unsettled; the open items on kinds are in
`surfaces-roadmap.md` under "Artifact kinds".

## What it is

Markup is the layer a person marks a surface up with (select, quote, draw, comment) and the threads those comments
become with an agent. It began as feedback on Conduit's own interface, and that use stays.

- **The layer and the surface are separate.** A surface (Conduit's interface, the document editor, a site) is a host:
  it gives Markup everything through `MarkupHost` and declares what applies there. A new host is a declaration, never a
  fork. Convention rule 9 keeps the boundary: extend it to each new seam rather than working round it.
- **Interface feedback is not compromised.** It keeps its item folder, its `wait` listener and its corner stack.
  `markup-delivery.mjs` and `markup-thread.mjs` run before a Markup change lands.

## Rules the code follows

- **An artifact is a file** in its project's folder (`.paper`, `.site.html`, `.md`, `.csv` or a `.sheet/` folder), with
  its id inside or in `.conduit/artifacts/paths.json`, so a rename or move keeps its threads. Its threads and state
  live in `<project>/.conduit/artifacts/<id>/`, kept out of git through Git's local exclude file, never the project's
  `.gitignore`. An artifact always belongs to a project.
- **A file changed outside Conduit wins**: the hub takes it as the artifact, blocks matched by id. A file it cannot read
  is an error shown, never a guess. No Markdown twin: export is a command.
- **One addressee per comment**, and only it is told. The mated thread (an ordinary hidden chat, on the project's
  default profile) is the default; `@name` in a comment's words sends it to that listener. The person's persistent
  agent is not a listener on artifacts for now.
- **A connection is a rider**: any other chat acts on an artifact's comments only because the person connected it. One
  registry of listeners; two arrivals: a chat Conduit runs is woken by a notice, a session it does not run keeps `wait`.
  Any chat can read or change any artifact it names; a connection only decides who is handed comments.
- **Nothing leaves the margin but by the person's hand.** An agent may resolve: the card then says so and stays, with
  the tint and Revert, until the person ticks it. Agents resolve only what the person has agreed to.
- **An agent's edit for a comment is the smallest change**, under a Yjs client id of its own, tinted until the comment
  is resolved, with Revert.
- **Never change the editor inside a Yjs observer**: `y-prosemirror` writes the editor back to Yjs on every editor
  change, so a change made before a merge reaches the editor undoes the merge.
- **A site runs in `<iframe sandbox="allow-scripts" srcdoc>`**: no origin, so its scripts cannot read Conduit's page
  and its requests to the hub carry no sign-in; it may reach the internet, as a browser pane can. Keys pressed in it
  stay its own and are never passed on, since a site could then press Conduit's shortcuts itself.
- Never name the product whose document comments the owner pointed to as a reference, in any tracked file.

## Not settled

- How the editor feels, judged by use: the margin's rules (a resolved comment leaves once its item is settled; a
  drawing on a paper keeps only the blocks under it; a phone has the cards under the text), the rider's wording, the
  Artifact | Thread switch on a phone.
- Not built: other people's carets; keeping what is typed while the hub is away if the page closes first; dismissing
  several comments at once; a person told that an artifact's file cannot be read or its device is away.
- Every person's client is recorded as author `person` until there is a name to give it.
- A paper on another device is unproven on a real device (checked only with a made-up one).
- The site, none of it judged by the owner: its name and that it is one file (images and scripts beside it are not
  served); `srcdoc` takes the hub's address as its base, so a relative link opens the hub's sign-in page in the frame;
  marks do not follow it when it scrolls; a site on another device is asked for every two seconds; the first comment
  on an artifact starts a model with no word to the person.
- Deleting an artifact leaves its mated thread, hidden; whether it should go with it.
- Moving Markup and the editor into the shared components package: parked until the package's scope is decided.
