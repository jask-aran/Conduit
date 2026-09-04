# Workspace panel implementation review

Reviewed on 2026-09-05. The line numbers refer to commit `dcedbc6`.

Findings marked **verified** were reproduced with a throwaway Playwright probe
against the running app, not inferred from reading. The probes were deleted after
use; where one exists, the observable symptom is quoted.

Status values:

- **Open**: observed risk or incomplete subsystem.
- **Complete**: implemented and verified in this review.

## P0

### Open — Working-root consistency

The Files and Source Control views use the selected project's resolved path. A generic chat maps to the shared `filesRoot` in `conduit-web/src/project-store.js:196-199`, while a non-workspace terminal starts in the server user's home directory in `conduit-web/src/server/routes/ptys.js:4-23`. The agent runtime can also have a different working directory. A user can therefore inspect one root and run commands in another root from the same panel.

Relevant code: `conduit-web/src/project-store.js:196-199`, `conduit-web/src/server/routes/ptys.js:4-23`, and the project resolution used by the routes in `conduit-web/src/server/routes/projects.js`.

Suspected direction: define one server-owned working-root contract for each chat and use it for Files, Source Control, Terminal, and agent launch.

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

Suspected direction: keep file-session state above the rendered slot, keyed by project, chat, slot, and path. Add an unload guard while any slot holds a draft.

### Open — Save acknowledgement race

The save request sends the current `draft()`, but the success path reads `draft()` again. If the user types while the request is active, the response can mark newer text as saved even though the server received the older text.

**Verified.** With the `PUT` delayed 900 ms and three characters typed while it was
in flight, the request body contained only the pre-save text, and when the response
landed the Save button became *disabled*. The user is given a positive "saved"
signal for text the server never received, and the difference is lost on the next
reload.

Relevant code: `conduit-web/src/client/workspace/workspace-file-slot.tsx:194-205`.

Suspected direction: capture the submitted text with its revision and only acknowledge that captured version.

### Open — Durable file replacement

File save writes directly to the target. A process or machine failure can leave a truncated file. The revision check and the write are also separate operations.

Relevant code: `conduit-web/src/workspace-inspector.js:190-218`.

Suspected direction: write a sibling temporary file, sync it when required, then replace the target atomically. Keep the revision conflict check in the same server operation.

### Open — Panel expansion animation and transcript reflow

Entering or leaving the maximized state is visibly unsteady: content flashes
across the full width including the area beside the left sidebar, and the
transcript appears to re-render from below rather than staying in place. Four
independent causes are visible in the layout rules.

**The transition animates a layout property.** `.chat-main` transitions
`flex-grow` and `margin` (`conduit-web/src/client/workspace/workspace.css:14-15`).
Interpolating `flex-grow` re-solves the flex line every frame on the main thread.
`.chat-main` also declares `container-type: inline-size`
(`conduit-web/src/client/styles.css:119`), so every frame changes a query
container's inline size and re-evaluates every container query inside the
transcript. None of this can move to the compositor.

**The two sides of the animation are governed by different clocks.** `.chat-main`
transitions its `flex-grow` from 1 to 0, while `.workspace-panel-expanded` sets
`flex-grow: 1` with no transition (`workspace.css:17`), so the panel claims the
free space on the first frame while the chat gives it up gradually. The width
curve is the sum of one stepped and one eased change.

**The panel surface does not track its shell.** The surface is absolutely
positioned, right-anchored, and sized `var(--workspace-panel-width)`, switching to
`width: 100%` only through the expanded class (`workspace.css:9,18`), with no
transition of its own. On restore the class drops instantly, so the surface snaps
back to the docked width while the shell is still wide and shrinking, leaving a
full-height gap on the shell's left for the whole duration. The shell is
`overflow: visible`, and `.chat-main` has not grown back yet because its opacity
and flex-grow are still animating. That gap is the flash that appears to span the
screen.

**The transcript is un-rendered mid-transition and restored on a timer.**
`content-visibility: hidden` is applied to `.transcript-motion-shell`
(`workspace.css:16`) for `PANEL_MOTION_DURATION_MS + 32`, set from JavaScript in
`conduit-web/src/client/main.tsx:419-431`. `content-visibility: hidden` discards
the subtree's rendering state, so the reveal re-lays out the whole transcript in a
single frame at the end of the animation, and the scroll offset inside it is not
preserved across the flip -- which is the "renders from below" behaviour. Because
the reveal is driven by a timer rather than `transitionend`, any drift between the
JavaScript constant and `--panel-motion-duration`, or one busy frame, un-hides the
transcript at an intermediate width and forces a second full re-render. The shell
also carries a permanent `will-change: transform` (`styles.css:164`), so the
composited layer is torn down and rebuilt around each flip.

Note that `opacity: 0` on the expanded `.chat-main` does not avoid any of this: the
subtree still participates in layout, and the element still paints its background,
inset shadow and rounded corners each frame while shrinking.

Relevant code: `conduit-web/src/client/workspace/workspace.css:14-18`, `conduit-web/src/client/styles.css:119`, `conduit-web/src/client/styles.css:164`, and `conduit-web/src/client/main.tsx:419-431`.

Suspected direction: drive both sides from one animated value rather than two
transitions -- animate the panel shell's width (or a registered custom property
both sides read) and leave `.chat-main` as a plain `flex: 1` that absorbs the
remainder. Make the surface fill its shell (`inset: 0`) so it cannot desynchronize.
Replace `content-visibility: hidden` with a technique that preserves layout and
scroll offset, or drop the hiding entirely once the width animation no longer
reflows the transcript, and key any remaining reveal off `transitionend` rather
than a duration constant.

### Open — Replace-with-upload bypasses the revision contract

Replacing a file through the tree sends `if-match: "*"`
(`conduit-web/src/client/workspace/workspace-panel.tsx:730`), so the write
overwrites whatever is on disk regardless of concurrent modification, unlike the
editor save path which sends the known revision and surfaces a conflict. A draft
held in a slot showing that file is also discarded without the confirmation the
other mutation paths ask for. Combined with the non-atomic write above, this is the
shortest route to losing a file's contents.

Relevant code: `conduit-web/src/client/workspace/workspace-panel.tsx:730` and `conduit-web/src/workspace-inspector.js:190-218`.

Suspected direction: send the current revision, surface the 409 the same way a save
conflict is surfaced, and apply the existing unsaved-changes guard.

## P1

### Open — Large directory correctness

The server accepts the first 500 entries returned by the file system and sorts only that subset. The result is stable only when the file-system iteration order is stable. The client filter searches loaded directory data, so it can report no match when a matching item exists outside the loaded subset.

Relevant code: `conduit-web/src/workspace-inspector.js:161-179`, filter and tree traversal in `conduit-web/src/client/workspace/workspace-panel.tsx:1141-1165`.

Suspected direction: stable server-side sorting with pagination or cursor-based loading, plus explicit filter scope.

### Open — File and Source Control freshness

The Files view polls each expanded directory and each open file every 1.5 seconds. Requests grow with the number of expanded directories and open slots. Source Control does not use the same change signal, so its state can remain stale.

Relevant code: `conduit-web/src/client/workspace/workspace-panel.tsx:57`, `conduit-web/src/client/workspace/workspace-panel.tsx:876-898`, and `conduit-web/src/client/workspace/workspace-panel.tsx:988`.

Suspected direction: one project change stream or one version endpoint that invalidates both views.

### Open — Source Control scale

Patch content is requested and rendered as individual lines. Large combined diffs can create a large DOM and repeat Git work. The Git semaphore releases a slot before assigning it to a waiter, so the active counter can fall below the real process count.

Relevant code: Git slot release in `conduit-web/src/workspace-inspector.js:48-50`, bounded patch work near `conduit-web/src/workspace-inspector.js:411`, and patch rendering in `conduit-web/src/client/workspace/workspace-panel.tsx`.

Suspected direction: correct slot transfer accounting, then bound or virtualize patch rendering and cache data at file or hunk granularity.

### Open — Terminal recovery states

The terminal retries a short sequence for network loss. A lease or control conflict ends at the same broad recovery surface, although it needs a different user choice. The `ownershipConflict` signal is present but does not fully drive the rendered state.

Relevant code: `conduit-web/src/client/remotes/terminal-pane.tsx:74`, retry control at `conduit-web/src/client/remotes/terminal-pane.tsx:277-288`, and the takeover action near `conduit-web/src/client/remotes/terminal-pane.tsx:1018`.

Suspected direction: model offline, reconnecting, stopped, and control-conflict states separately.

### Open — Keyboard and screen-reader model

The file tree implements part of the ARIA tree keyboard model. The panel tab areas use tab roles inside toolbars and do not expose a complete tablist and tabpanel relationship. Split panes add a second local tab owner, which makes labels important.

Relevant code: tree keyboard handling in `conduit-web/src/client/workspace/workspace-panel.tsx:1168-1220`; pane tabs and labels near `conduit-web/src/client/workspace/workspace-panel.tsx:418-460`.

Suspected direction: complete the tree focus model and give each pane an explicit tablist and tabpanel relationship.

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

Suspected direction: namespace the keys by scope, evict a chat's entries when the
chat is deleted, and route writes through one helper that tolerates failure.

### Open — Polling ignores document visibility and never backs off

Complementing the freshness item above: the 1.5 second poll is gated on the panel
being open and the Files tab being visible, but not on `document.visibilityState`,
so a backgrounded tab keeps requesting every expanded directory and every open file
indefinitely. A poll that fails keeps retrying at the same rate forever, and since
panel failures moved to toasts, a background failure now only reaches
`console.warn` -- so a workspace that has become unreachable looks identical to one
that is simply unchanged.

Relevant code: `conduit-web/src/client/workspace/workspace-panel.tsx:986-989` and the poll body above it.

Suspected direction: gate on visibility, back off on repeated failure, and give the
view an explicit stale state rather than silence.

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

Suspected direction: give the slot an explicit viewer contract keyed by detected
type, with a fallback viewer and an "open anyway" path for near-text files.

### Open — No workspace content search

No server route searches file contents, and the tree filter matches only
directories already loaded into the client. For a panel whose purpose is to work
alongside an agent that writes files, find-in-files is the most conspicuous absent
capability, and its absence also makes the large-directory limitation above harder
to work around.

Relevant code: the route surface in `conduit-web/src/server/routes/projects.js`, and the client filter in `conduit-web/src/client/workspace/workspace-panel.tsx`.

Suspected direction: a bounded server-side content search with the same path
boundary as the other file routes, surfaced as its own view or as a filter mode.

### Open — Source Control capability set is thin

The available actions are stage, unstage, commit, fetch, pull and push
(`conduit-web/src/client/workspace/workspace-panel.tsx:28`). There is no discard or
restore, no branch switch or create, no stash, no amend, no per-hunk staging and no
conflict resolution. Discard matters most in this product: an agent writes files
into the workspace, and the only way to reject its changes today is the git command
line in the terminal tab.

Relevant code: `conduit-web/src/client/workspace/workspace-panel.tsx:28` and `conduit-web/src/workspace-inspector.js:270`.

Suspected direction: add discard and branch operations first, behind the same
confirmation discipline the destructive file operations already use.

## P2

### Open — Artifacts contract

The Artifacts view exposes Outputs and Interactive UI modes but has no backing artifact data or lifecycle. Its controls imply a subsystem that is not present.

Relevant code: `conduit-web/src/client/workspace/workspace-panel.tsx:1646-1651`.

Suspected direction: connect it to transcript outputs and interactive resources, or remove the inactive modes until that contract exists.

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

Suspected direction: use one shared project-kind contract or include the server value in the client union.

### Open — Workspace panel size

`WorkspacePanel` contains file management, editor-slot orchestration, Git controls, artifacts, terminal composition, keyboard behavior, caching, polling, and geometry in one file. Its CSS also carries a full mobile density copy.

Relevant code: `conduit-web/src/client/workspace/workspace-panel.tsx` and the repeated mobile block beginning at `conduit-web/src/client/workspace/workspace.css:319`.

Suspected direction: split by subsystem after the state-ownership issues are resolved; remove copied mobile declarations when their required differences are explicit.

### Open — No Content-Security-Policy

Nothing in the server sets a Content-Security-Policy. The panel already renders
workspace file content, markdown and blob-backed images, and the Artifacts view
reserves a boundary its own copy describes as "sandboxed, explicitly trusted". That
boundary cannot ship without a policy and an explicit frame or sandbox story, and
the policy also governs the `blob:` image rendering that exists today.

Relevant code: the server setup in `conduit-web/src/server.js`, and the artifact boundary copy in `conduit-web/src/client/workspace/workspace-panel.tsx`.

Suspected direction: define the policy before the interactive artifact contract,
not after.

### Open — The failure surface has fragmented

Panel failures are now toasts, background poll failures reach only the console, git
action errors render inline, terminal recovery has its own banner, and the mobile
overlay differs again. There is no stated rule for which failures are silent,
transient or blocking, so each surface has picked one.

Relevant code: toast reporting in `conduit-web/src/client/workspace/workspace-panel.tsx`, terminal recovery in `conduit-web/src/client/remotes/terminal-pane.tsx`.

Suspected direction: classify failures into a small set of modalities and route
every surface through it.

### Open — Focus is unmanaged after destructive actions

Closing a slot, deleting an open file, or promoting the secondary slot into the
primary leaves focus wherever it was and announces nothing. This is adjacent to the
ARIA item above but distinct: it concerns what happens after state changes, not the
static roles.

Relevant code: slot close and promotion in `conduit-web/src/client/workspace/workspace-panel.tsx:614-645`.

Suspected direction: move focus to a defined target for each destructive action and
announce the result.

### Open — Test coverage map

Browser coverage of the panel is tabs, split panes, two file slots, image preview
and the file menu. Not covered: save conflicts, git actions, poll-driven refresh,
upload and replace, terminal lifecycle inside the panel, and tree keyboard
navigation. Separately, the `@setpiece` suite passes test by test but fails as a
group on a development machine, so the timing-sensitive half of the suite is
effectively unverified rather than green.

Relevant code: `conduit-web/test/browser/app.spec.js` and `conduit-web/playwright.config.js`.

Suspected direction: cover the mutation paths first, since those are where the P0
items above live, and decide whether the setpieces run somewhere with the headroom
to be trusted.

## Existing strengths

The file boundary rejects traversal, hidden Conduit internals, and symlinked paths. File saves use revisions and return conflicts for stale writes. Workspace requests have ownership and cancellation. Git commands have time and output limits. Directories load on demand. Terminals survive view changes through the server-side terminal manager. The panel respects reduced-motion settings and uses pane-local width checks.
