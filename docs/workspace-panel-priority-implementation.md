# Workspace panel priority implementation

> Short-lived working document. The durable findings and their history remain
> in `docs/workspace-panel-implementation-review.md`. Delete this document when
> these slices are complete and committed.

## Working rules

Implement one slice at a time. After each slice:

1. Run its focused tests.
2. Report the test list and results.
3. Pause for user validation.
4. Commit the slice before starting the next one.
5. Mark the matching finding **Complete** in
   `docs/workspace-panel-implementation-review.md`.

Do not include the deferred full text-editor work in these slices:

- Editor state ownership
- Save acknowledgement race
- Durable file replacement
- Replace-with-upload revision checks
- Workspace content search
- Source Control capability expansion

## 1. Terminal recovery states

Source finding: **P1 — Terminal recovery states**.

Replace separate recovery flags with one explicit state model:

`connecting` → `live` → `reconnecting` → `offline`

The model also supports `stopped` and `conflict`.

State behaviour:

- `connecting`: show that the terminal is starting.
- `live`: show the terminal normally.
- `reconnecting`: retry short network failures automatically.
- `offline`: stop automatic retries and show **Retry**.
- `stopped`: show **Start a new terminal**.
- `conflict`: show **Take control** and never retry automatically.

Give each state one short message and one primary action. Show the current
owner for an ownership conflict when the server provides it. Announce state
changes through a polite `aria-live` region.

Publish PTY lifecycle changes through the existing runtime SSE. Every client
refreshes its terminal list when the server reports an exit or removal. A
conflict or offline pane clears a dead selection and reports the remote exit
with one informational toast.

Acceptance:

- Network loss enters `reconnecting`, then `offline` after the retry budget.
- **Retry** starts a new connection.
- Process exit enters `stopped` and offers a new terminal.
- Ownership conflict enters `conflict`, names the holder, and does not retry.
- Focused unit and browser tests cover each state and action.

## 2. Persisted panel state — implemented

Source finding: **P1 — Persisted panel state grows without bound and is
unguarded**.

Add `conduit-web/src/client/workspace/workspace-panel-storage.ts` with
`readSetting`, `writeSetting`, and `dropScope`. Route all panel storage through
it. Catch storage and quota errors, warn once per session, and use an in-memory
fallback so normal panel actions do not fail.

Keep the existing key prefix during migration. Collapse settings into one JSON
object per chat or project, remove entries for deleted scopes, remove unknown
scopes during startup, and keep the 100 most recently written scopes.

Acceptance:

- Existing panel settings survive migration.
- Storage failures do not break tab selection or file opening.
- Deleting a chat or project removes its stored panel state.
- Unknown scopes are removed at startup.
- Focused unit tests cover migration, cleanup, quota failure, and the scope cap.

Implemented in `conduit-web/src/client/workspace/workspace-panel-storage.ts`.
The review finding is marked **Complete**. The operator accepted the viewers
and progressive browser loading on 2026-09-06. Final changes were not tested or
built by the agent, at the operator's request.

## 3. Binary and media handling — implemented

Source finding: **P1 — Binary and media handling stops at images**.

Extend file metadata with `kind` and `mime`, plus the existing size, revision,
and modification data. Classify from a bounded content sniff with an extension
fallback. Use these client file kinds:

- `text`: text editor or read-only text view
- `image`: existing image viewer
- `pdf`: browser PDF viewer
- `audio`: native audio controls
- `video`: native video player
- `binary`: bounded type and size preview with download

Keep object URL ownership in the image file slot and revoke URLs during cleanup.
Keep the inline size limit separate from the download path. Revalidate unchanged
images instead of downloading them on every refresh. Binary files show a bounded
hex prefix and offer *Open as text anyway*. Large text files offer a bounded,
read-only first 25 MiB view. Media previews have a separate 100 MiB limit.

No current server CSP blocks embedding. The separate CSP work must preserve
blob PDF and media support. Unsupported browser formats retain download access.

Acceptance:

- Server metadata classifies text, image, PDF, audio, video, and unknown binary
  files.
- Symlink and workspace-root boundaries still fail closed.
- Large files remain downloadable even when they are not shown inline.
- User validation must confirm PDF display, audio/video playback, and the binary
  fallback. Viewer changes have not been tested or built, at the user's request.

Implemented in `conduit-web/src/workspace-inspector.js`,
`conduit-web/src/server/routes/projects.js`, and
`conduit-web/src/client/workspace/workspace-file-slot.tsx`.
The review finding is marked **Complete**. Validation remains paused until the
focused test results are handed to the operator.

## 4. Source Control scale

Source finding: **P1 — Source Control scale**.

First fix the Git semaphore so a waiting request receives a transferred slot.
Prove that 20 concurrent Git calls never exceed the four-process limit.

Then split Git work into summary and detail:

- Load file names and change statistics first.
- Request patch text only when a file expands.
- Cache patches by file path and Git revision.
- Bound patch size and hunk count.
- Render a bounded number of lines or hunks, with a **Show remaining hunks**
  action or a download option for large patches.

Acceptance:

- Git concurrency stays within the configured limit.
- The initial Source Control load does not request patch text.
- Expanding a file requests only that file's patch.
- Large patches stay within the server and browser limits.
- Focused inspector and browser tests cover concurrency, lazy loading, caching,
  and bounded rendering.

## Completion

After all four slices pass validation and are committed, update the matching
findings in `docs/workspace-panel-implementation-review.md` to **Complete**.
Then delete this working document.
