# Workspace panel implementation review

Reviewed on 2026-09-05. The line numbers refer to commit `dcedbc6`.

Findings marked **verified** were reproduced with a throwaway Playwright probe
against the running app, not inferred from reading. The probes were deleted after
use; where one exists, the observable symptom is quoted.

Status values:

- **Open**: observed risk or incomplete subsystem.
- **Complete**: implemented and verified in this review.

Each open finding carries a **Solution** section: the shape of the fix, the
concrete edits it implies, and what the implementer should be able to observe
once it is done. The solutions are specified, not implemented. Where a solution
depends on another finding landing first, it says so.

## P0

### Open — Working-root consistency

The Files and Source Control views use the selected project's resolved path. A generic chat maps to the shared `filesRoot` in `conduit-web/src/project-store.js:196-199`, while a non-workspace terminal starts in the server user's home directory in `conduit-web/src/server/routes/ptys.js:4-23`. The agent runtime can also have a different working directory. A user can therefore inspect one root and run commands in another root from the same panel.

Relevant code: `conduit-web/src/project-store.js:196-199`, `conduit-web/src/server/routes/ptys.js:4-23`, and the project resolution used by the routes in `conduit-web/src/server/routes/projects.js`.

**Solution.** Make the working root a single server-owned value derived once per
project, and have every consumer read it rather than compute its own.

1. Add `workingRoot(project)` to `project-store.js`, beside `managedPath`. It
   returns `project.path` for `kind: "workspace"` and `this.managedPath(project.slug)`
   otherwise, so a generic chat resolves to `filesRoot` — the same root the Files
   view already uses. It never returns the home directory.
2. Change `terminalContext` in `ptys.js:4-23` to call it instead of
   `fs.realpath(os.homedir())`. Keep the existing `projects.validate` call and the
   `workspace_identity_changed` handling for workspace projects; for managed
   projects, create the root if it is missing before spawning, so a first terminal
   in a fresh project does not fail.
3. Route the agent launch path through the same function. Grep the rest of
   `src/server` for `os.homedir()` and direct `project.path` uses and convert
   them; the function should be the only place a root is decided.
4. Expose the resolved root on the project payload the client already fetches (a
   `workingRoot` string) and show it as the panel header's title attribute, so the
   user can see what the panel is pointed at.

Acceptance: open a generic chat, run `pwd` in the Terminal tab, and it prints the
directory the Files tree is showing. Add a server test asserting `terminalContext`
and the file-listing route resolve to the same absolute path for both project
kinds.

### Open — Editor state ownership

Each `WorkspaceFileSlot` owns its draft. `WorkspacePanel` conditionally mounts the file views when tabs, split panes, detail collapse state, and panel geometry change. A mount transition can discard a draft even when the user did not close the file.

**Verified.** Edit a file, switch to Source Control and back (`Ctrl+X 2`, `Ctrl+X 1`):
the header returns from `Unsaved` to `31 B` and the draft is gone, with no prompt.
Files unmounts on tab change at `conduit-web/src/client/workspace/workspace-panel.tsx:1452`
and on detail collapse at `:1542`, and unmounting destroys the slot's signals.

This is not a missing guard so much as an invariant the code already holds and
breaks. Unsaved work *is* protected when opening another file (`:596`), closing a
slot (`:623`), promoting the secondary slot (`:629`), and renaming, moving or
deleting (`:647`). It is discarded silently on tab change, on detail collapse, and
on window unload -- there is no `beforeunload` handler anywhere in `src/client`, so
a reload or tab close loses a draft too.

Relevant code: conditional slot rendering in `conduit-web/src/client/workspace/workspace-panel.tsx:1542-1592`; local draft state in `conduit-web/src/client/workspace/workspace-file-slot.tsx`.

**Solution.** Lift the draft out of the component and leave everything else where
it is. The slot keeps owning load, save and viewer state; only the edited text and
its base revision move, so the two-slot independence the file's own comment
describes is preserved.

1. Add a module-level draft store, `workspace-file-drafts.ts`, holding
   `Map<string, { text: string; baseRevision: string; savedAt: number }>` keyed by
   project id plus path — path-keyed rather than slot-keyed, so a draft follows a
   file when the secondary slot is promoted. Export `readDraft`, `writeDraft`,
   `clearDraft` and `hasAnyDraft`.
2. In `workspace-file-slot.tsx`, seed the local `draft` signal from `readDraft` in
   the same `createEffect(on(...))` that calls `load()`, and mirror every edit into
   `writeDraft`. Call `clearDraft` on a successful save and on an explicit discard
   only. Do not clear in `onCleanup` — that unmount is exactly the case this
   finding is about.
3. If the revision returned by `load()` differs from the stored `baseRevision`,
   keep the draft and mark the slot conflicted rather than silently rebasing:
   reuse the conflict affordance defined under *Save acknowledgement race*.
4. Register one `beforeunload` listener where the panel mounts
   (`workspace-panel.tsx`, alongside `migrateWorkspaceGeometry`) that calls
   `event.preventDefault()` while `hasAnyDraft()` is true, removed in `onCleanup`.
5. Evict entries when a project is deleted and after a bounded idle period
   (checked on read, say 24 hours), so the map does not become the in-memory twin
   of the localStorage growth problem below.

Acceptance: the verified reproduction (edit, `Ctrl+X 2`, `Ctrl+X 1`) returns to the
file still showing `Unsaved` with the edited text intact, and reloading the tab
prompts. Cover both with browser tests.

### Open — Save acknowledgement race

The save request sends the current `draft()`, but the success path reads `draft()` again. If the user types while the request is active, the response can mark newer text as saved even though the server received the older text.

**Verified.** With the `PUT` delayed 900 ms and three characters typed while it was
in flight, the request body contained only the pre-save text, and when the response
landed the Save button became *disabled*. The user is given a positive "saved"
signal for text the server never received, and the difference is lost on the next
reload.

Relevant code: `conduit-web/src/client/workspace/workspace-file-slot.tsx:194-205`.

**Solution.** The submitted text is already captured in `submittedContent`
(`:196`); the defect is that the success path then treats the *current* draft as
clean. Compare rather than assume.

1. In the success branch, keep setting `preview` to
   `{ ...file, ...written, content: submittedContent }` as it does now, and do not
   touch the draft. `hasUnsavedChanges()` derives from
   `draft() !== preview().content`, so text typed during the flight stays dirty and
   the Save button stays enabled — the correct outcome.
2. Guard against a response landing after the slot moved: capture `file.path` and
   the current `loadedKey` before the request, and abandon the result if either
   changed by the time it resolves.
3. Serialise saves per slot with a `pendingSave: Promise | null`. A save issued
   while one is in flight awaits it, then re-reads `preview().revision`, so the
   second `if-match` carries the revision the first write produced and a rapid
   double-save cannot manufacture a 409.
4. On a real 409 (`workspace_file_changed`), keep the draft, mark the slot
   conflicted, and offer two named choices — *Reload and discard* and *Overwrite*.
   Neither branch clears the draft until the user has chosen. This is the shared
   conflict affordance the other two P0 findings refer to.

Acceptance: with a delayed `PUT` and typing mid-flight, the Save button remains
enabled and the header still reads `Unsaved` after the response. Add a browser test
that stubs the route with a delay.

### Open — Durable file replacement

File save writes directly to the target. A process or machine failure can leave a truncated file. The revision check and the write are also separate operations.

Relevant code: `conduit-web/src/workspace-inspector.js:190-218`.

**Solution.** Write a sibling temporary file and rename it over the target. A
rename within a directory is atomic on POSIX, so a reader sees the old file or the
new one and never a truncated one.

1. In `writeWorkspaceFile`, after the existing symlink, type and revision checks,
   write to a sibling temporary named with a `.conduit-tmp-` prefix and a random
   suffix, at mode `0o600`; fsync the handle, close it, then `fs.rename` onto the
   target. Unlink the temporary in a `catch` so a failed write leaves no debris.
2. Preserve the target's mode: read `existing.mode` and apply it to the temporary
   before the rename, or an executable script silently loses its bit.
3. Keep the create-exclusive semantics for the new-file case. That check belongs
   on the target path, so retain the current `existing == null` branch and let the
   rename publish the result.
4. Narrow the check-then-write window: open the target once (`r+`), read and hash
   from that descriptor, and hold it until the rename. This is not atomic against
   an external editor, so also add a short per-path mutex in the inspector — a
   `Map<string, Promise>` keyed by absolute path — that serialises this module's
   own writes, which is where concurrent saves actually originate.
5. Exclude the `.conduit-tmp-` prefix from `listWorkspaceDirectory` alongside
   `.conduit`.

Acceptance: extend `test/workspace-inspector.test.js` with cases asserting no
temporary survives a successful write, a stale `if-match` still returns 409, and
the target's mode is preserved across a save.

### Complete — Panel expansion animation and transcript reflow

Expansion now has one width animation, owned by the Workspace panel. A
`workspace-layout` container bounds the panel to the space beside the Sidebar.
The chat pane absorbs the remaining width without its own flex, margin, or
opacity transition. The panel surface fills its shell during expansion and
restore, so it cannot leave a gap inside the shell.

The transcript keeps its rendered width while expanded and during restoration.
It stays mounted and rendered, with its scroll position intact. Restoration
releases the width on the panel's `width` transition end; instant changes have
a separate release path. The old hide/reveal timer and permanent
`will-change: transform` declarations are removed.

The implementation preserves the existing open/close transform animation and
immediate resize path. Clipping belongs to the shared layout container, so the
panel's resize handle can still extend into the gap beside the chat. Reduced
motion retains the immediate transition behaviour.

Relevant code: `conduit-web/src/client/main.tsx`,
`conduit-web/src/client/workspace/workspace.css`, and
`conduit-web/src/client/styles.css`.

**Verified on 2026-09-05.** The focused browser regression samples expand and
restore frame by frame: transcript width stays constant, scroll position stays
at 400, and the panel surface matches the shell. Reduced-motion restoration,
desktop and mobile maximization commands, file-panel resizing, shortcut state
transitions, and rapid open/close reversals pass their focused browser checks.
Typecheck and production build pass.

Native Windows Chrome loaded production bundle `index-DYEY8FI-.js`. Across
40 sampled frames per direction, transcript width stayed at 1730.497 px,
scroll position stayed at 400, and the shell/surface gap stayed at zero.
A separate trace without per-frame geometry reads recorded 24 layout events
per direction, one forced layout at the start of each direction, and no
transcript layout roots. Total layout time was 37.906 ms for expansion and
34.349 ms for restoration; the longest layout was 3.156 ms. These are current
observations, not a comparison against a matched baseline.

The closed-to-maximized shortcut also animates on the panel's first lazy mount.
Its entrance uses the full maximized surface width throughout the slide.
A focused frame-sampling regression covers this path; docked expansion and
rapid open/close reversal checks also pass after this correction.

### Open — Replace-with-upload bypasses the revision contract

Replacing a file through the tree sends `if-match: "*"`
(`conduit-web/src/client/workspace/workspace-panel.tsx:730`), so the write
overwrites whatever is on disk regardless of concurrent modification, unlike the
editor save path which sends the known revision and surfaces a conflict. A draft
held in a slot showing that file is also discarded without the confirmation the
other mutation paths ask for. Combined with the non-atomic write above, this is the
shortest route to losing a file's contents.

Relevant code: `conduit-web/src/client/workspace/workspace-panel.tsx:730` and `conduit-web/src/workspace-inspector.js:190-218`.

**Solution.** Route the replacement through the same contract as a save.

1. Before the `PUT`, run the unsaved-changes guard that `openFile` (`:596`) and
   `closeSlot` (`:623`) already use, against `slotForPath(target.path)`, and abort
   the replacement if the user declines.
2. Resolve the current revision — the loaded slot's `preview().revision` when
   there is one, otherwise a metadata `GET` first — and send it as `if-match`
   instead of `"*"`.
3. On a 409, surface the shared conflict affordance from *Save acknowledgement
   race*, where *Overwrite* re-issues the request with `if-match: "*"`. The force
   path stays available but becomes a deliberate act rather than the default.
4. On success, `clearDraft` for that path — the draft is genuinely superseded —
   before calling `slotHandles.get(reloading)?.reload()`.

Depends on the draft store from *Editor state ownership* and the conflict
affordance from *Save acknowledgement race*; land those two first.

Acceptance: a browser test where the file changes on disk between the tree listing
and the replacement gets a conflict prompt rather than a silent overwrite, and one
where a slot holds a draft confirms the guard fires.

## P1

### Complete — Large directory correctness

The tree now scans and sorts the complete visible directory before it returns a
page. Each response contains up to 500 directory-first/name-ordered entries,
the visible total, and an opaque cursor for the next page. The browser appends
pages through **Show more**. Refreshes reload the same number of pages, so they
do not make previously visible tree entries disappear.

Directories with more than 50,000 scanned entries return an explicit oversize
result instead of an arbitrary partial list. `.conduit` and symlinks remain
excluded. The input is named **Filter loaded files**; while a truncated listing
is filtered, the tree says that the filter only covers loaded entries.

Relevant code: `conduit-web/src/workspace-inspector.js`,
`conduit-web/src/server/routes/projects.js`, and
`conduit-web/src/client/workspace/workspace-panel.tsx`.

**Verified on 2026-09-05.** Inspector tests create 1,200 reverse-created files,
then prove the three sorted pages are disjoint and their union is complete. They
also prove the 50,000-entry limit. API coverage proves the second `after` page
contains the otherwise omitted late entry. The browser test proves **Show more**,
filter disclosure, and refresh retention. Typecheck and production build pass.

### Complete — File and Source Control freshness

The Files and Source Control views now share `GET
/v0/projects/:id/workspace/version`. The inspector holds one recursive watcher
while a panel is active, reference-counts probes, and closes it after a short
idle period. It reports changed relative paths up to a 1,000-path cap; initial,
overflow, and unavailable-recursive-watch responses return `changedPaths: null`.
The client then reloads only affected expanded directories and open files, or all
visible data for `null`, and refreshes Git status after every workspace change.
`.conduit` and `.conduit-tmp-*` events do not wake the panel. Platforms without
recursive watch compare mtime and size for the visible paths supplied by the
client.

### Open — Source Control scale

Patch content is requested and rendered as individual lines. Large combined diffs can create a large DOM and repeat Git work. The Git semaphore releases a slot before assigning it to a waiter, so the active counter can fall below the real process count.

Relevant code: Git slot release in `conduit-web/src/workspace-inspector.js:48-50`, bounded patch work near `conduit-web/src/workspace-inspector.js:411`, and patch rendering in `conduit-web/src/client/workspace/workspace-panel.tsx`.

**Solution.** Three separable changes; the semaphore is a two-line fix and should
land first.

1. **Slot transfer.** `releaseGitSlot` (`:48-50`) decrements `gitSlots.active` and
   then resolves a waiter that does not re-increment, so the counter drifts below
   the real process count and the limit stops binding. Transfer the slot instead:
   when a waiter exists, shift and resolve it *without* decrementing; decrement
   only when the queue is empty. Add a unit test running 20 concurrent git calls
   against a limit of 4 and asserting observed peak concurrency never exceeds 4.
2. **Bound the work.** Drive the file list from `git diff --numstat`, which gives
   the summary the list needs with no patch text, and request a patch only when a
   file is expanded. Cache patches keyed by path plus blob revision.
3. **Bound the DOM.** Render at most the first N hunks with an explicit *Show
   remaining hunks* control, virtualise the line list above a threshold, and offer
   download rather than inline rendering for a patch past a size ceiling.

### Open — Terminal recovery states

The terminal retries a short sequence for network loss. A lease or control conflict ends at the same broad recovery surface, although it needs a different user choice. The `ownershipConflict` signal is present but does not fully drive the rendered state.

Relevant code: `conduit-web/src/client/remotes/terminal-pane.tsx:74`, retry control at `conduit-web/src/client/remotes/terminal-pane.tsx:277-288`, and the takeover action near `conduit-web/src/client/remotes/terminal-pane.tsx:1018`.

**Solution.** Replace the recovery flags with one explicit state machine and render
exactly one affordance per state.

1. Define a single signal of type
   `"connecting" | "live" | "reconnecting" | "offline" | "stopped" | "conflict"`,
   and derive the banner, the retry button and the takeover button from it. Delete
   `ownershipConflict` as an independent signal — it becomes the `conflict` state.
2. Assign the transitions explicitly: transport error to `reconnecting`; retry
   budget exhausted to `offline` (action *Retry*); process exited to `stopped`
   (action *Start a new terminal*); lease conflict to `conflict` (action *Take
   control*, naming the current holder). Only `reconnecting` auto-retries;
   `conflict` must never auto-retry, which is the present defect.
3. Give each state one sentence of copy and one primary action, and announce
   transitions through a polite live region so the change is not visual only.

### Open — Keyboard and screen-reader model

The file tree implements part of the ARIA tree keyboard model. The panel tab areas use tab roles inside toolbars and do not expose a complete tablist and tabpanel relationship. Split panes add a second local tab owner, which makes labels important.

Relevant code: tree keyboard handling in `conduit-web/src/client/workspace/workspace-panel.tsx:1168-1220`; pane tabs and labels near `conduit-web/src/client/workspace/workspace-panel.tsx:418-460`.

**Solution.** Complete both patterns to the APG — mostly filling gaps rather than
rewriting.

1. **Tree.** Add the missing keys: `Home` and `End` to the first and last visible
   node, `*` to expand all siblings, `ArrowLeft` on a collapsed node to move to the
   parent, and wrap the existing typeahead. Adopt roving `tabindex` so the tree is
   one tab stop, and set `aria-level`, `aria-setsize`, `aria-posinset` and
   `aria-expanded` on each node.
2. **Tabs.** Wrap each pane's tab buttons in `role="tablist"` with an `aria-label`
   naming the pane, give each button `aria-controls` pointing at its panel, and give
   each panel `role="tabpanel"`, `tabindex="0"` and `aria-labelledby` pointing back.
   Remove the toolbar role where it wraps tabs, and implement
   `ArrowLeft`/`ArrowRight` within a tablist with roving `tabindex`.
3. Give each split pane's panel a distinct accessible name — two panes can show the
   same view — by suffixing with the pane name.

Acceptance: add an axe pass over the open panel to the browser suite, plus a
keyboard test that reaches every tab and every tree node without a pointer.

### Complete — Dashboard workspace-panel continuity

Workspace and folder dashboards now use the same project-scoped open and expanded
state as chats in that project. Navigation to a project dashboard no longer closes
the panel. Navigation to the Conduit dashboard selects the Chats project before it
restores that project's panel state.

Workspace rows and pinned workspaces in the sidebar now have an **Open maximized
Workspace** context-menu action. The action opens the workspace dashboard, opens
the panel, and stores its maximized state. Restoring the split view reveals the
dashboard.

Relevant code: state ownership and dashboard navigation in
`conduit-web/src/client/main.tsx:385-441`, `:586-612`, `:760-769`, and `:825-853`;
workspace context menus in `conduit-web/src/client/navigation/sidebar.tsx:145-162`,
`:784-794`, and `:845-852`.

**Verified.** The desktop Chromium browser tests in
`conduit-web/test/browser/app.spec.js:1173-1246` cover folder, Conduit, and
workspace dashboard state restoration, pointer activation of the context-menu
action, persistence across reload, and restoration from maximized to the
workspace dashboard.

### Open — Persisted panel state grows without bound and is unguarded

The panel persists roughly eleven key shapes per chat or project: `:tab`,
`:secondary-tab`, `:file`, `:file-secondary`, per-tab `:detail-open` and
`:detail-height`, plus `:width`, `:tree-width`, `:tree-collapsed`, `:show-hidden`,
`:kept-visible`, `:split-ratio` and `:file-split-ratio`. Nothing removes them when
the owning chat or project is deleted, so the store grows for the life of the
installation. Every write is a bare `localStorage.setItem`, so a quota error, or a
browser that refuses storage, throws inside ordinary interactions such as selecting
a tab or opening a second file. `migrateWorkspaceGeometry` shows there is already a
place to sweep these keys.

Relevant code: key construction throughout `conduit-web/src/client/workspace/workspace-panel.tsx`, and the existing migration pass in the same file.

**Solution.** One storage module, one key shape, one sweep.

1. Add `workspace-panel-storage.ts` exporting `readSetting(scopeId, name)`,
   `writeSetting(scopeId, name, value)` and `dropScope(scopeId)`. Every write goes
   through a `try/catch` that warns once per session and then degrades to an
   in-memory map, so a quota error or a storage-blocking browser can never throw
   inside a tab selection. Replace all 19 `localStorage.setItem` call sites in
   `workspace-panel.tsx` with it.
2. Keep the existing `conduit:workspace-panel:<scopeId>:<name>` prefix — it is
   already scope-first, so `dropScope` is a prefix scan and delete. Do not rename
   keys; that discards everyone's current geometry for no gain.
3. Collapse the eleven keys into one JSON object per scope, migrating inside the
   existing `migrateWorkspaceGeometry` pass (rename it
   `migrateWorkspacePanelStorage` and bump its sentinel key). One object per scope
   makes eviction and quota accounting trivial.
4. Call `dropScope` wherever a chat or project is deleted in `main.tsx`, and add a
   startup sweep in the same migration pass that deletes any scope id absent from
   the loaded project and chat lists, plus an LRU cap keeping the 100
   most-recently-written scopes.

Acceptance: a unit test that fills the store, deletes a chat and asserts its keys
are gone; and one that makes `setItem` throw and asserts tab selection still works.

### Complete — Polling ignores document visibility and never backs off

The shared probe runs only while the panel is open, Files or Source Control is
visible, the document is visible, and the browser is online. It polls immediately
on visibility or network return. A self-scheduled timer prevents overlap, doubles
the delay for consecutive failures up to 30 seconds, and resets after success.
After two failures, both headers show `Not updating · Retry`; Retry starts a new
probe immediately, and the strip clears on the next successful response.

### Open — Binary and media handling stops at images

Image files are detected by extension, capped at 25 MB inline, fetched as a blob
and rendered through an object URL whose lifetime the slot owns. Everything else
binary still reaches the text reader and returns "Binary files cannot be
previewed": PDFs, audio, video and notebooks among them. Detection trusts the
extension rather than the content. A changed image re-downloads in full on each
poll rather than revalidating. There is no zoom or one-to-one view for an image
larger than its pane, and no escape hatch for a text file rejected over a single
null byte or for one past the 1 MiB text ceiling.

Relevant code: `conduit-web/src/client/workspace/workspace-file-slot.tsx` (image branch and `MAX_INLINE_IMAGE_BYTES`), and `conduit-web/src/workspace-inspector.js:182-188`.

**Solution.** Let the server classify the file and let the slot dispatch on the
classification, so adding a viewer becomes a table entry rather than a new branch.

1. Server: return `{ path, size, modifiedAt, revision, kind, mime }` from the file
   metadata response, where `kind` is one of `text`, `image`, `pdf`, `audio`,
   `video`, `binary`. Classify from a sniffed magic-number prefix of the first
   4 KiB, falling back to the extension. Have the `file_not_text` rejection in
   `readWorkspaceFile` (`:182-188`) carry `kind` and `mime` too, so the client can
   offer the right fallback instead of a dead end.
2. Client: replace `imageExtension` with a viewer table keyed by kind — text
   editor, image, PDF through `<object>` on the blob URL, media through
   `<audio>`/`<video>`, and a binary fallback showing size, type, a hex head and a
   Download button. Each viewer receives a blob URL the slot still owns and revokes
   in `onCleanup`, exactly as the image branch does today.
3. Add *Open as text anyway* on the binary fallback, re-requesting with a
   `?force=text` flag, for the file rejected over a single null byte; and *Load
   first 1 MiB* for a file past the text ceiling — a `Range` request rendered
   read-only behind a banner saying it is truncated.
4. Revalidate rather than re-download: send `if-none-match` with the known revision
   on the image fetch and treat 304 as unchanged, which removes the full
   re-download per poll.
5. Give the image viewer a *Fit* / *1:1* toggle with scroll-to-pan when zoomed,
   stored per slot and not persisted.
6. Make `MAX_INLINE_IMAGE_BYTES` govern inline rendering only. It should never
   block downloading the file.

The PDF and media viewers depend on the CSP finding; agree `object-src` and
`media-src` before adding them.

### Open — No workspace content search

No server route searches file contents, and the tree filter matches only
directories already loaded into the client. For a panel whose purpose is to work
alongside an agent that writes files, find-in-files is the most conspicuous absent
capability, and its absence also makes the large-directory limitation above harder
to work around.

Relevant code: the route surface in `conduit-web/src/server/routes/projects.js`, and the client filter in `conduit-web/src/client/workspace/workspace-panel.tsx`.

**Solution.** A bounded server-side search sharing the existing path boundary,
surfaced as a filter mode in the Files view rather than as a new tab.

1. Add `GET /v0/projects/:id/search?q=&regex=&case=&glob=&limit=` in `projects.js`,
   implemented in `workspace-inspector.js` beside the directory listing so it
   reuses `resolveInspectorPath`, the `.conduit` exclusion and the symlink
   rejection. Every returned path must pass the same `safeSegments` check as the
   file routes.
2. Implement it as a bounded walk: skip symlinks and `.conduit`, skip files failing
   the null-byte text check, cap at 200 matching files and 2 000 matches total,
   cap per-file size at the existing 1 MiB preview limit, and enforce a 2 s
   wall-clock deadline after which the response returns `truncated: true`. Run it
   under the same concurrency-semaphore pattern as the git calls so a search cannot
   starve the server.
3. Return `{ matches: [{ path, line, column, preview }], truncated, scanned }`,
   with the preview line clipped to roughly 200 characters around the match.
4. Client: add a mode toggle beside the existing filter input — *Filter names* and
   *Search contents* — rendering results grouped by file. Selecting a result opens
   the file in the focused slot and scrolls to the line. Debounce at 250 ms and
   cancel the in-flight request through the existing `requestControllers`
   machinery.
5. If `rg` is on `PATH`, shell out to it with `--json` and the caps above;
   otherwise use the JavaScript walk. The response shape is the same either way.

Acceptance: an inspector test asserting the traversal boundary holds — a match
outside the root or behind a symlink is never returned — and that the caps apply.

### Open — Source Control capability set is thin

The available actions are stage, unstage, commit, fetch, pull and push
(`conduit-web/src/client/workspace/workspace-panel.tsx:28`). There is no discard or
restore, no branch switch or create, no stash, no amend, no per-hunk staging and no
conflict resolution. Discard matters most in this product: an agent writes files
into the workspace, and the only way to reject its changes today is the git command
line in the terminal tab.

Relevant code: `conduit-web/src/client/workspace/workspace-panel.tsx:28` and `conduit-web/src/workspace-inspector.js:270`.

**Solution.** Add discard first, then branch operations, both through the existing
git action plumbing so the semaphore, timeouts and output limits apply unchanged.

1. **Discard.** Add `discard` to the action set: `git restore --` for a tracked
   modified file, `git restore --staged --worktree --` for a staged one, and the
   existing delete path for an untracked one. The three cases need different
   commands and the confirmation should say which it will run. Require an explicit
   confirmation naming the file, matching the discipline the destructive file
   operations already use, and refuse while a slot holds an unsaved draft for that
   path.
2. Offer discard per file and across a selection, never a bare "discard everything"
   button without an itemised confirmation.
3. **Branches.** Add list, switch and create-from-current. Switch refuses while any
   slot holds a draft, and must surface git's own refusal rather than forcing when
   git reports it would overwrite local changes.
4. Leave stash, amend, per-hunk staging and conflict resolution to a follow-up so
   this pass stays reviewable.
5. Refresh every new action through the change signal from *File and Source Control
   freshness* rather than its own refetch.

## P2

### Open — Artifacts contract

The Artifacts view exposes Outputs and Interactive UI modes but has no backing artifact data or lifecycle. Its controls imply a subsystem that is not present.

Relevant code: `conduit-web/src/client/workspace/workspace-panel.tsx:1646-1651`.

**Solution.** Remove the inactive modes now; design the contract before rebuilding
them.

1. Short term: delete the Interactive UI mode and the mode switcher, and either
   hide the Artifacts tab for a project with no artifacts or render one explicit
   empty state saying artifacts are not yet available. Controls implying an absent
   subsystem are worse than an absent tab.
2. When it returns, the contract should be: an artifact is produced by a transcript
   output; it has an id, a mime type, a producing message, and a lifetime tied to
   the chat. The view lists them and opens each through the viewer table from
   *Binary and media handling*. Interactive artifacts need the CSP and a sandboxed
   frame settled first — see below.

### Complete — File operations and narrow two-file layout

The Files view now creates empty files and folders at the root or in a selected folder. It renames and moves files and folders without overwriting an existing entry. It deletes folders recursively after confirmation and refuses to delete the workspace root. Rename, move, and folder deletion stop when an affected open file has unsaved changes.

The server operations share the existing path traversal and symlink rejection boundary. Relevant code: `conduit-web/src/workspace-inspector.js:227-267` and `conduit-web/src/server/routes/projects.js:293-324`. The controls and open-path remapping are in `conduit-web/src/client/workspace/workspace-panel.tsx:641-873` and `conduit-web/src/client/workspace/workspace-panel.tsx:1331-1402`.

Both open file slots now remain mounted below the 520 px file-layout threshold. The narrow view divides the existing preview height between them and stacks the secondary slot below the primary slot. Alt-click and **Open as second file** work at narrow widths. Relevant code: `conduit-web/src/client/workspace/workspace-panel.tsx:598`, `conduit-web/src/client/workspace/workspace-panel.tsx:1476`, and `conduit-web/src/client/workspace/workspace-panel.tsx:1542-1592`.

Verification:

- `npm run typecheck`: passed.
- `node --test test/workspace-inspector.test.js`: 9 passed.
- Focused Playwright run for narrow two-file rendering and file operations: 2 passed.
- `node --test test/server-api.test.js`: passed.
- `npm run build`: passed, with the existing large-chunk warning.
- `npm test`: 630 passed and 1 unrelated test failed. `test/config.test.js:10` expects chat template version `8`, while the current template reports `9`.

### Open — Client project contract

The server uses an `unstructured` project kind for generic chats, but the client `Project.kind` union accepts only `project` and `workspace`. This hides a real runtime value from TypeScript.

Relevant code: `conduit-web/src/project-store.js:193` and `conduit-web/src/client/api/contracts.ts:34-40`.

**Solution.** Add `"unstructured"` to the `Project.kind` union in
`contracts.ts:34-40`, then fix the exhaustiveness errors `npm run typecheck`
reports — each is a place the client silently assumed a generic chat was a
`project`. Export the kind list as a `const` array from `contracts.ts` and import
it into the server store so the two cannot drift, with a server test asserting
every kind the store can write appears in that list.

### Open — Workspace panel size

`WorkspacePanel` contains file management, editor-slot orchestration, Git controls, artifacts, terminal composition, keyboard behavior, caching, polling, and geometry in one file. Its CSS also carries a full mobile density copy.

Relevant code: `conduit-web/src/client/workspace/workspace-panel.tsx` and the repeated mobile block beginning at `conduit-web/src/client/workspace/workspace.css:319`.

**Solution.** Split along the seams the other findings already create, after they
land — splitting first means moving the same code twice.

1. Extract in this order, each a pure move with no behaviour change:
   `workspace-file-drafts.ts` and `workspace-panel-storage.ts` (from the P0 and P1
   work above), then `workspace-tree.tsx` (tree render plus keyboard model),
   `workspace-source-control.tsx`, `workspace-artifacts.tsx`, and
   `workspace-geometry.ts` (resize handlers, split ratios, wide/narrow thresholds).
   `workspace-panel.tsx` keeps tab composition and the panel shell.
2. CSS: derive the mobile block from custom properties rather than duplicating
   declarations. Define the density tokens once on `.workspace-panel`, redefine
   only the tokens inside the mobile query, and delete any mobile declaration that
   merely restates its desktop value.
3. Run `npm run typecheck` and the browser suite after each extraction, and keep
   each extraction in its own commit so a regression bisects cleanly.

### Open — No Content-Security-Policy

Nothing in the server sets a Content-Security-Policy. The panel already renders
workspace file content, markdown and blob-backed images, and the Artifacts view
reserves a boundary its own copy describes as "sandboxed, explicitly trusted". That
boundary cannot ship without a policy and an explicit frame or sandbox story, and
the policy also governs the `blob:` image rendering that exists today.

Relevant code: the server setup in `conduit-web/src/server.js`, and the artifact boundary copy in `conduit-web/src/client/workspace/workspace-panel.tsx`.

**Solution.** Ship a policy for what exists today, report-only first and then
enforced; design the artifact frame only after that.

1. Add a policy header for document responses in `server.js`. Starting point:
   `default-src 'self'; img-src 'self' blob: data:; media-src 'self' blob:;
   object-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline';
   connect-src 'self' ws: wss:; frame-ancestors 'none'; base-uri 'none';
   form-action 'none'`.
2. Deploy it as `Content-Security-Policy-Report-Only` with a report endpoint first,
   run the browser suite and the native builds against it, then remove
   `'unsafe-inline'` from `style-src` by moving inline styles to nonces or classes.
   The native builds may need their own origin in `connect-src` — check before
   enforcing.
3. SVG images already render through `<img>` on a blob URL, which cannot execute
   script. Keep that invariant explicit in a comment, and never move an SVG to
   `<object>` or to inline injection.
4. Only then define the artifact boundary: an `<iframe sandbox="allow-scripts">`
   served from a distinct origin with its own stricter policy delivered as a header
   on that origin, and a `postMessage` contract validated against an allowlist.
   Never grant `allow-same-origin` together with `allow-scripts`.

### Open — The failure surface has fragmented

Panel failures are now toasts, background poll failures reach only the console, git
action errors render inline, terminal recovery has its own banner, and the mobile
overlay differs again. There is no stated rule for which failures are silent,
transient or blocking, so each surface has picked one.

Relevant code: toast reporting in `conduit-web/src/client/workspace/workspace-panel.tsx`, terminal recovery in `conduit-web/src/client/remotes/terminal-pane.tsx`.

**Solution.** Three modalities, one router, written down.

1. Define them. **Transient**: a user-initiated action failed and the state is
   otherwise fine — a toast. **Persistent**: a subsystem is degraded until
   something changes — an inline strip in that view's header with a retry action,
   cleared on success. **Blocking**: the user must choose before work continues —
   save conflict, ownership conflict, unsaved-changes guard — a dialog with named
   choices. Nothing is silent; anything reaching only `console.warn` today is
   persistent.
2. Add `reportFailure(error, { modality, scope, retry? })` in one module and route
   every existing surface through it: panel toasts, the poll's `console.warn`, git
   inline errors, terminal recovery, and the mobile overlay. The mobile difference
   becomes a rendering choice inside the router rather than a separate decision at
   each call site.
3. Record the rule in this repo's docs beside this review, so future surfaces
   inherit it instead of re-deciding.

### Open — Focus is unmanaged after destructive actions

Closing a slot, deleting an open file, or promoting the secondary slot into the
primary leaves focus wherever it was and announces nothing. This is adjacent to the
ARIA item above but distinct: it concerns what happens after state changes, not the
static roles.

Relevant code: slot close and promotion in `conduit-web/src/client/workspace/workspace-panel.tsx:614-645`.

**Solution.** Name a focus target for each action and announce the result once.

1. Targets: closing the secondary slot moves focus to the primary slot's editor;
   closing the primary while a secondary is open moves it to the promoted slot's
   editor; closing the last slot moves it to the tree node for the file that was
   open, or the tree itself when that node is gone; deleting a file moves it to the
   sibling node after the deleted one, else the parent; renaming or moving moves it
   to the node at its new path.
2. Reuse the `restoreFocus` and `focusFirst` helpers already used for the mobile
   overlay (`workspace-panel.tsx:975-985`) rather than adding new ones, and move
   focus in a `queueMicrotask` after the state update as that code does.
3. Add one polite `aria-live` region in the panel and announce the outcome:
   "Closed notes.md", "Deleted notes.md", "notes.md moved to docs/notes.md".
4. Cover both in the keyboard test added for the ARIA finding.

### Open — Test coverage map

Browser coverage of the panel is tabs, split panes, two file slots, image preview
and the file menu. Not covered: save conflicts, git actions, poll-driven refresh,
upload and replace, terminal lifecycle inside the panel, and tree keyboard
navigation. Separately, the `@setpiece` suite passes test by test but fails as a
group on a development machine, so the timing-sensitive half of the suite is
effectively unverified rather than green.

Relevant code: `conduit-web/test/browser/app.spec.js` and `conduit-web/playwright.config.js`.

**Solution.** Cover the mutation paths first, since that is where the P0 items
live, and decide where the setpieces run.

1. Write each test alongside the fix it guards rather than as a separate pass —
   every P0 solution above names its acceptance test. Priority order: save conflict
   and mid-flight typing, replace-with-upload conflict, draft survival across tab
   change and reload, then upload, git actions against a fixture repository,
   poll-driven refresh, terminal lifecycle inside the panel, and tree keyboard
   navigation.
2. Prefer server-side tests where they are cheaper than browser ones: atomic write,
   directory paging, search boundary, git semaphore concurrency.
3. For `@setpiece`, measure before changing: run the group with `--workers=1` and
   tracing on to find whether the failure is contention or a genuine ordering
   dependency. If contention, pin the project to one worker and raise the per-test
   timeout in `playwright.config.js`; if ordering, isolate the shared fixture.
   Either way the group must run in CI on a machine with headroom, and until it
   does, report it as unverified rather than green.

## Existing strengths

The file boundary rejects traversal, hidden Conduit internals, and symlinked paths. File saves use revisions and return conflicts for stale writes. Workspace requests have ownership and cancellation. Git commands have time and output limits. Directories load on demand. Terminals survive view changes through the server-side terminal manager. The panel respects reduced-motion settings and uses pane-local width checks.
