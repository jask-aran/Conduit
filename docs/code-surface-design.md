# Code workbench design

A Conduit-native file workbench built on CodeMirror 6. It starts with file
viewing and editing, then adds file comparisons through CodeMirror's merge
support.

Status: editor and comparison layers implemented; semantic IDE behavior is
deferred.

## User outcome

Clicking a text file in Files opens a capable code editor inside the existing
preview pane. The pane first shows the current working-copy file in read-only
mode. Edit changes the same surface into an editor without replacing its DOM,
losing its scroll position or changing its visual language.

The editor layer targets the interaction quality of a desktop code editor:

- Fast typing and scrolling on large files.
- Line wrapping, multiple selections, undo and redo.
- Search and replace, bracket matching, folding and syntax-aware indentation.
- Language-aware syntax highlighting.
- Keyboard, pointer, touch, IME, bidirectional-text and screen-reader support.
- Conduit typography, colours, spacing, gutters, controls and focus treatment.

Project-aware completion, diagnostics, hover information, navigation, rename,
formatting and code actions need language services. They are deferred to a
separate semantic IDE design.

## Product model

The workbench identifies a file separately from the representation shown for
that file.

| Representation | Content |
| --- | --- |
| File | Current working-copy file; can enter editing |
| Changes | Git index → working copy |
| Staged | `HEAD` → Git index |
| Agent changes | Chat start → working copy, latest turn → working copy, or historical turn start → turn end |

File, Changes, Staged and Agent changes use the same CodeMirror-based surface.
Comparisons are read-only.

The Files tab and Source Control keep separate selection state. Files opens File
by default. Source Control has Changes, Review, Graph and Patch modes. Review
uses the shared file comparison surface across the full Source Control content
area. Opening a review file in Files selects that file and its Diff
representation. Files can switch between File and Diff without changing file
identity. Files also has an Agent changes navigator. Its compact turn control
uses `0` for the latest turn and negative offsets for earlier checkpoints. A
historical checkpoint ends at the next checkpoint, so it isolates that turn.
The latest checkpoint still ends at the current working copy because no later
checkpoint exists yet.
There is no accordion surface in the current plan.

## Settled decisions

### CodeMirror remains the editor engine

CodeMirror already owns the difficult editor mechanics: viewport rendering,
wrapped-line height measurement, document changes, selection, IME, undo,
accessibility and bidirectional text. Conduit will configure and style those
mechanics instead of rebuilding them with a textarea overlay.

File preview and editing use the same `EditorView`. Read-only state, editability,
wrapping, language and other changing behaviour use CodeMirror compartments.
Entering Edit reconfigures the existing view. It does not remount the editor.

### Conduit owns the visible product

CodeMirror supplies text behaviour. Conduit owns the workbench container,
header, representation controls, file status, save actions, menus and errors.
The editor theme maps CodeMirror elements to `DESIGN.md` tokens so the pane does
not look like an embedded third-party product.

### CodeMirror owns diff rendering

Comparisons use `@codemirror/merge` for unified and side-by-side views. It owns
changed chunks, collapsed unchanged ranges, wrapping and bounded diff work.
Conduit owns range selection, file navigation and workbench controls.

### Chat highlighting remains separate

Chat code blocks continue to use `code-highlight.ts` and highlight.js. Sharing a
palette matters; forcing chat and the editor through one rendering engine does
not. The workbench uses CodeMirror's syntax tree and `HighlightStyle`.

## Why not the alternatives

### `@pierre/diffs`

A previous Conduit integration was heavy and degraded UI performance. It is not
a candidate for this work. Do not repeat the integration without new evidence
that its runtime and bundle behaviour changed enough to address that result.

### Monaco

Monaco is heavier and does not support Conduit's mobile-web and Android target.
Its closer relationship to VS Code does not offset that platform mismatch.

### Custom textarea overlay

A textarea over painted syntax can provide a small plain-text editor, but it
would make Conduit responsible for wrapped virtualization, caret geometry,
selection, IME edge cases, multiple selections and editor accessibility. It
also blocks several editor-layer features required here. The design no longer
uses this approach.

## Architecture

Keep the first change inside the existing ownership boundaries.

```text
workspace-file-slot.tsx          file load/save, representation and dirty state
workspace-editor.tsx             editable file EditorView lifecycle
workspace-editor-base.ts         shared read-only CodeMirror configuration
workspace-comparison.tsx         unified and side-by-side comparison lifecycle
workspace-review-controller.ts  shared review selection and request ownership
workspace-languages.ts           filename → lazy language-support registry
workspace.css                    workbench layout and CodeMirror presentation
```

`workspace-file-slot.tsx` owns file identity, draft and save state. The shared
workbench primitives define compact buttons, representation controls and status
layout. The review controller shares request and selection behavior without
merging Git and chat-checkpoint domain models.

### Editor state ownership

While mounted, CodeMirror's document is the authoritative editable text. Do not
copy the complete document into a Solid signal after every transaction.

The editor reports whether it is dirty. The file slot reads the complete text
only when it must cross an ownership boundary:

- Save.
- Copy complete file.
- Leave or dispose an edited file while preserving its draft.

External content enters the editor only when the project, path or server
revision changes. A local keystroke must not cause a full-document equality
check followed by a reactive write back into the same editor.

The editor handle exposes the minimum commands the file slot needs: focus,
read current text, replace from an external revision, set editable state and
run save. Keep search, selection and history inside CodeMirror.

### Persistent view

File and Edit share one `EditorView`. Reconfiguration preserves document state,
selection, history and scroll position. Changing the selected project or path
loads then commits the new file; it does not show the old file under a new
label.

An open file slot retains File and Diff representation state so switching does
not reload either representation. Inactive Workspace tabs retain selection and
draft state. Comparison document updates use CodeMirror transactions rather
than recreating the view. A layout switch between unified and side-by-side can
recreate the comparison because CodeMirror uses different view types.

### Language loading

The current `@codemirror/language-data` import exposes a catalogue of about 190
languages through the editor chunk. Replace filename matching with a curated
registry of lazy imports. Markdown and CSV keep their existing special routes.
Start with languages Conduit already highlights in chat and add a language when
a real repository needs it.

Unknown files remain editable as plain text. Language loading is an enhancement:
show the text immediately, cancel stale loads when the selected file changes,
and install support only if the request still owns the view.

Before removing `@codemirror/language-data`, measure the current production
chunk and the candidate registry build. The change must prove the reduction
rather than attribute the whole editor chunk to one import without evidence.

## Native visual treatment

Read `DESIGN.md` before changing the UI. The workbench keeps the existing pane
shape and controls. CodeMirror must consume the same presentation values as the
surrounding file preview:

- `ui-monospace` stack, size, weight, line height and tab size.
- Background, foreground, muted foreground and selection colours.
- Gutter width, padding, border and line-number alignment.
- Scrollbar, focus ring and active-state treatment.
- Tooltip, completion, search and panel surfaces.
- Syntax colours mapped through one CodeMirror `HighlightStyle` using Conduit
  data colours.

Remove stock editor chrome that has no current product use. Do not remove
capability merely to simplify styling: keyboard search, multiple selection,
wrapping, undo and accessibility remain part of the editor layer.

Preview and Edit must have the same geometry. Editing can add a caret and
selection, but it must not shift text, gutters or scroll position.

## Performance requirements

The editor must improve visual integration without making the Workspace panel
more expensive.

- Keep the editor and each language in lazy chunks. Add no editor code to the
  initial application chunk.
- Do not serialize the full CodeMirror document on each keystroke.
- Do not recreate `EditorState` or `EditorView` for a read-only/editable change.
- Do not parse or measure editors in inactive Workspace tabs.
- Do not run syntax highlighting, diffing or file loading during scroll.
- Cancel stale file and language requests when identity changes.
- Apply external file content once per accepted revision.
- Keep expensive optional extensions out until the user invokes their feature.
- Preserve CodeMirror's viewport rendering and wrapped-line height management;
  do not put a full rendered copy of the document behind it.

Measure before and after on the same files and browser profile:

- Production lazy chunk size and gzip size.
- Time from file selection to readable plain text.
- Typing latency in a large editable file.
- Wrapped and unwrapped scroll behaviour.
- Heap growth after opening and closing files repeatedly.
- Work performed while Files or Workspace is inactive.

Use the current editor as the performance baseline. A visual improvement does
not justify a measured regression. Record any accepted trade-off in this
document with its evidence.

### Measured editor-chunk result

The 9 September 2026 production build measured the language-loading change
against the stored pre-change production assets:

| Asset | Raw | Gzip |
| --- | ---: | ---: |
| Previous editor chunk | 907,162 B | 279,429 B |
| Curated registry only | 890,540 B | 276,912 B |
| Curated registry plus lazy Markdown stack | 415,760 B | 135,430 B |
| Current editor with ergonomics and native search | 426,330 B | 138,640 B |
| Markdown-only extension chunk | 297,280 B | 72,340 B |

The registry alone saved too little to justify the work. Moving Markdown and
ProseMark behind the Markdown file boundary produced the useful result: the
base editor chunk became 54% smaller raw and 52% smaller gzip. Opening a
Markdown file loads its extra chunk after plain text is readable. Other files
do not pay that cost.

The visible command and status controls add 4,970 B raw and 1,650 B gzip to the
base editor. The current editor remains 54% smaller raw and 51% smaller gzip
than the previous implementation.

`@prosemark/core` declares `@codemirror/language-data` as a peer dependency, so
the package remains installed. Conduit no longer imports its full registry into
the editor. The product registry contains 22 explicit descriptions and each
language implementation remains a dynamic import.

Text-file selection starts the content request and editor-chunk download in
parallel. The content endpoint returns classification metadata with binary and
oversize errors, so ordinary text opening no longer waits for a separate
metadata request. The client uses the old metadata request only as a fallback
when an error response lacks classification fields.

## Adoption

Each phase is independently shippable.

1. **State and performance foundation.** Stop mirroring the full document into
   Solid on every edit. Add the narrow editor handle, revision-based external
   updates and focused tests for dirty, save and identity changes. Record the
   current bundle and browser baselines before changing presentation.
2. **Conduit-native editor.** Restyle the existing CodeMirror view and surrounding
   file pane as one surface. Preserve preview/edit geometry, wrapping, search,
   selection, undo, keyboard behaviour and accessibility. Verify desktop and
   mobile behaviour in the real pane.
3. **Curated language loading.** Replace the broad language catalogue with lazy
   filename-to-language imports. Measure the built chunks and retain plain-text
   fallback.
4. **Comparison representations.** Use `@codemirror/merge` for Changes, Staged
   and Agent changes. Share review behavior between Source Control and
   Artifacts. Preserve the active comparison view when its documents update.
5. **Semantic IDE behaviour.** Write a separate design for language-server
   lifecycle, document synchronization, completion, diagnostics, hover,
   navigation, rename, formatting and code actions.

## Verification

Follow `docs/testing.md` and use the lowest tier that proves each change.

Tier 1 covers editor state boundaries: local edits do not write the full text
back through props, external revisions replace content once, save reads the
current CodeMirror document, dirty state clears only after an accepted save,
and stale file or language loads cannot update a new identity.

Tier 3 covers browser-owned behaviour and geometry:

- Preview → Edit → Preview keeps text, selection and scroll position.
- Wrapped and unwrapped editing remain aligned and scroll correctly.
- Search, undo, redo, multiple selection, Tab and `Mod-s` work.
- IME composition does not publish partial external updates.
- Keyboard and screen-reader labels distinguish preview and edit state.
- Repeated file changes leave one live editor in each visible slot.
- Inactive Workspace tabs perform no continuing editor work.

Existing `.cm-content` browser locators remain valid. Prefer workbench-level
roles and labels for new tests so styling changes do not define the contract.

The production build must pass `scripts/check-bundle.mjs`. Record the relevant
lazy chunks before and after phases 2 and 3.

## Risks

- **Visual theming can become scattered.** Keep CodeMirror presentation in one
  theme plus the narrow layout selectors in `workspace.css`.
- **Controlled-state feedback can copy large documents.** Keep the document in
  CodeMirror while mounted and synchronize only at named boundaries.
- **Broad language support can restore the current bundle cost.** Keep the
  registry explicit and each grammar lazy.
- **Retained representations can keep observers alive.** Keep the number of
  open file slots bounded. Measure idle work before increasing this limit.
- **Diff integration can expand editor scope.** Keep comparison controls
  read-only until an editing workflow has a separate product design.
- **VS Code-level wording can imply semantic IDE features.** The current scope
  is the editor layer only; language services require their own design.

## Deferred work

- Semantic IDE behaviour and language-server integration.
- Accordion review surface.
- Word-level review controls beyond what the chosen merge view provides.
- Per-hunk stage and revert actions.
- Chat adoption of the editor renderer.

## Open questions

- Which languages belong in the first curated registry? Use repository evidence,
  not the size of the old catalogue.
- Which editor features should load by default and which should load on first
  use? Decide from interaction latency and bundle evidence during phases 2 and
  3.
