# Workspace onboarding and clone operations

Draft for approval. Combines GitHub issues #16 and #25; implementation starts
only after this document is approved. This is a current design contract, not a
history of the earlier flows.

## Product boundary

A Workspace is a registered, allow-listed directory in which Conduit can run
agents and terminals. The New workspace flow must make its filesystem action
explicit before it occurs:

| Choice | Preconditions | Filesystem action | Unlink behaviour |
| --- | --- | --- | --- |
| Link existing folder | Existing safe directory within an allow-list root | Register only | Leaves every file untouched |
| Create new folder | A missing final directory whose existing parent is safe and allow-listed | Create that empty directory, then register it | Leaves the created folder untouched |
| Clone repository | Safe HTTPS repository URL and a missing target below an allow-listed parent | Clone through a Conduit-owned sibling staging directory, then publish the target | Leaves the cloned repository untouched |

Conduit-managed Projects in `data/chat/files` remain a separate product
concept. “Create new folder” creates an external Workspace; it does not infer
that a failed link request should create anything, and it does not claim
ownership of the resulting directory after registration.

The browser supplies a requested path only for server-side resolution. It
never obtains permission to use that path as a Pi cwd or as a filesystem target
until the server has resolved it against `CONDUIT_WORKSPACE_ALLOWLIST`, rejected
symlinks, dangerous roots, duplicate canonical identities, and unsafe
`.conduit` paths.

## User experience

New workspace opens a three-choice flow rather than one ambiguous path field.
Each choice shows its resolved absolute target and its unlink semantics before
the final action is enabled.

### Link existing folder

The user selects or enters an existing directory. The dialog validates it
before submission and explains: “Conduit will use this folder; unlinking never
deletes it.” A missing path is an invalid link, with a direct switch to Create
new folder rather than an implicit fallback.

### Create new folder

The user chooses an allow-listed parent and supplies one directory name. The
preview displays the exact final target and explains: “Conduit will create this
empty folder; it remains yours if you later unlink it.” The server permits no
intermediate creation, path traversal, symlinks, existing target, or target
outside an allow-list root.

### Clone repository

The user supplies an HTTPS clone URL and chooses an allow-listed parent; the
default child name derives from the repository name but remains editable. The
server reserves the identity and returns a provisional Workspace immediately.
Its sidebar row and dashboard visibly show `Cloning`, the destination path, and
a Cancel action. It cannot receive chats, terminal sessions, inspection, or
runtime changes until publication completes.

The browser refresh, tab close, and request cancellation do not define clone
ownership. Cancel is an explicit operation against the server-owned operation
ID. Browser cancellation and the existing timeout remain fallback signals only.

## Domain model and recovery

Keep the existing `origin` distinction and add `created` for a user-selected
new external folder:

```ts
type WorkspaceOrigin = "linked" | "created" | "cloned";
type WorkspaceState = "ready" | "cloning";
```

`created` and `cloned` use the same external-root identity validation as
`linked` and always set `deletesFilesOnRemove: false`.

Clone reservation remains one transaction with its existing durable marker:

```text
reserved
  -> provisional catalogue row (state: cloning) + operation ID
  -> git clone into sibling .conduit-clone-<id>.part
  -> published (atomic rename to final target)
  -> catalogue row state: ready
  -> marker removed
```

The marker is the durable recovery record for staging, target, phase, and the
provisional row. The catalogue row is the browser-visible Workspace state; do
not create another durable clone-status store. Cancellation, failure, and
unpublished startup recovery remove only Conduit’s staging directory and the
provisional row. A published target is never deleted automatically: startup
either completes registration after identity validation or leaves the target
and recovery marker intact for operator recovery.

An in-memory operation controller owns the live subprocess and cancellation
signal. It is keyed by the durable operation ID, reports bounded lifecycle
updates, and disappears after terminal cleanup. A server restart cancels no
published tree; it recovers from the marker using the rules above.

## API contract

All routes remain behind `requireAuth`.

- `POST /v0/workspaces/preview` validates a proposed `link`, `create`, or
  `clone` target and returns the canonical display path plus ownership text. It
  performs no filesystem mutation.
- `POST /v0/projects` accepts the explicit workspace mode. Link and create
  return a ready project. Clone returns `202 Accepted` with
  `{ project, operation: { id, state: "cloning" } }` once reservation and the
  provisional row are durable.
- `GET /v0/workspace-operations/:id` returns the requesting operation’s
  current lifecycle state while it exists. It exposes no command output beyond
  the existing bounded, user-safe clone diagnostic.
- `DELETE /v0/workspace-operations/:id` requests cancellation. It is
  idempotent for a terminal operation, waits for staging cleanup, and never
  removes a published target.

The catalogue and global runtime stream publish additive workspace/operation
updates so an open sidebar and dashboard converge without polling. A clone
failure or cancellation removes the provisional row and gives the initiating
client a useful, bounded error; a detached client simply observes that the row
is gone.

## Quick implementation slices

### 1. Explicit link/create contract

Add server-side preview resolution and `created` Workspace creation. Rebuild
the dialog’s first step as the three explicit choices, retaining existing link
and clone paths behind their selected modes. Cover existing link, missing link,
safe create, existing create target, allow-list escape, symlink rejection,
unsafe `.conduit`, and unlink preservation.

### 2. Durable asynchronous clone operation

Split clone reservation from execution. Persist the provisional `cloning` row
and extend the current clone marker/recovery logic to keep catalogue and marker
consistent. Add operation lookup/cancellation, block all Workspace activity
while cloning, and cover cancellation, timeout, refresh/disconnect, startup at
every phase, and a failure after publication.

### 3. Progress UI and convergence

Add the provisional sidebar/dashboard treatment, destination display,
operation updates, cancel confirmation, and terminal failure feedback. Cover
the complete flow in mocked browser tests plus one server-boundary test for
the cancellation route.

### 4. Acceptance and documentation

Run the full suite, inspect recovery markers, and update the current README
and HTTP contract. Manual acceptance: link a real directory; create and unlink
a new one; clone a slow repository, refresh, cancel, retry, and confirm that
the final repository is never deleted by unlink or cancellation.

## Non-goals

- Creating arbitrary intermediate paths or bypassing the Workspace allow-list.
- Deleting user folders or cloned repositories when a Workspace is unlinked.
- Resuming a `git clone` process across a server restart.
- Progress percentages invented from Git output; v0 exposes lifecycle state and
  destination, not unreliable byte progress.
- Provisioning language runtimes, containers, or environment templates. Those
  can build on the explicit Workspace ownership model later.

## Completion criteria

- A user can distinguish link, create, and clone before any mutation.
- Every displayed target is server-resolved and its ownership is clear.
- A clone appears immediately, is visibly unavailable while active, and can be
  explicitly cancelled independently of browser connection lifetime.
- Clone publication, cancellation, and crash recovery preserve the existing
  atomic staging/rename and external-root identity invariants.
- No browser-supplied path becomes a Pi cwd or filesystem target without the
  established server validation.
