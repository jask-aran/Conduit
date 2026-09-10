# Code surface cleanup review

## Purpose

This review records implementation cleanup for Conduit's file editor, file
comparison, Source Control review, and Agent changes surfaces. It does not
replace `docs/code-surface-design.md`. That specification defines product
direction. This file describes defects and duplication in the current
implementation, plus an ordered cleanup path.

## Current product model

The Files tab owns the general file surface. It can show the working file or a
temporary comparison. The same surface can later support more file
representations without changing file navigation.

Source Control owns four modes: Changes, Review, Graph, and Patch. Review shows
the repository comparison from `HEAD` to the working copy. Agent changes uses
the same review layout, but compares either chat start or the latest turn to the
current working copy.

These surfaces must share editor behavior and controls where their meaning is
the same. They must not share product state that has different ownership or
lifetime.

## Findings

### 1. Comparison updates recreate CodeMirror

`workspace-comparison.tsx` creates its editor inside an effect that depends on
the complete comparison value. A comparison update destroys and recreates the
`EditorView` or `MergeView`. This can reset scroll position, selection, search
state, the focused side, and collapsed unchanged ranges.

Update the documents inside the existing CodeMirror instance when the layout
does not change. A switch between unified and side-by-side layouts can create a
new view because CodeMirror uses different view types for those layouts. Keep
the user's position and compatible view state across that switch.

### 2. Agent comparison requests can apply an obsolete baseline

`loadArtifactComparison` captures the selected baseline before it starts its
request. Its completion guard checks the project, chat, and path, but it does
not check the baseline or checkpoint. A slow Chat-start response can overwrite
a newer Latest-turn response for the same file.

Include the baseline and checkpoint identity in the completion and busy-state
guards, or cancel the obsolete request when either value changes.

### 3. Source Control mode uses overlapping booleans

`sourceDetailOpen`, `fileDiffMode`, and `diffDetailOpen` encode the four Source
Control modes. Some combinations are invalid or ambiguous, and each render or
request condition must reconstruct the intended mode.

Replace them with one exhaustive value:

```ts
type SourceControlMode = "changes" | "review" | "graph" | "patch";
```

Persist this value directly. Derive request needs and visible content from it.
This makes invalid combinations impossible and makes mode changes atomic.

### 4. File and Diff modes use separate editor lifecycles

`workspace-file-slot.tsx` removes the normal file editor when a temporary
comparison becomes active. It mounts `WorkspaceComparison`, then reloads
`WorkspaceEditor` when the user returns to the file. The user experiences Diff
as a replacement surface even though it is an alternate representation of the
same open file.

Create one persistent file-surface owner. It must retain the open path, normal
editor state, comparison state, and shared chrome. File and Diff become
representations inside that owner. A representation switch must not reload the
file or reset unrelated state.

### 5. CodeMirror configuration is duplicated

`workspace-editor.tsx` owns the complete editor configuration.
`workspace-comparison.tsx` creates a smaller independent configuration. The
comparison omits normal editor features such as bracket matching, selection
matches, folding, indentation guides, special-character rendering, and common
keymaps. Theme or behavior changes can drift between the two implementations.

Extract a shared read-only CodeMirror base. It must own the theme, syntax
highlighting, language loading, line numbers, search panel, wrapping,
accessibility attributes, and common navigation. Add editing extensions only
for an editable working file. Add merge extensions only for a comparison.

### 6. Control ownership is inconsistent

The file header contains file actions and Git state. The editor footer contains
editing, search, wrap, indentation, language, and position controls. The
comparison footer uses another arrangement and another set of controls. The
same file therefore changes its control grammar when its representation
changes.

Use one workbench chrome contract:

- The top bar contains file identity, dirty or repository state, Save, Copy,
  Download, and Close.
- The bottom-left contains the File or Diff representation selector and
  representation-specific navigation.
- The bottom-right contains the comparison range, wrap, indentation, language,
  cursor position, and read-only state when those values apply.
- Search opens from the bottom bar in both representations.
- Unified and side-by-side controls appear only in Diff mode, in the same
  bottom-bar control group.

Controls that do not apply must disappear without moving the shared controls to
a different bar.

### 7. Comparison view state has hidden two-way ownership

`ComparisonViewState` arrives as prop data, but `WorkspaceComparison` mutates
that object with `Object.assign` during cleanup. This makes ownership implicit
and ties state capture to component destruction.

Keep view state in the surface owner. Report changes through explicit callbacks
or a small comparison controller. Capture scroll and selection while the view
is active, not only during cleanup.

### 8. Review layout is shared, but review behavior is duplicated

`WorkspaceReview` shares the visible two-column layout. Source Control and
Agent changes still implement separate file selection, request state, status
mapping, comparison loading, and stale-response handling in
`workspace-panel.tsx`.

Create a common review controller with a narrow source adapter. Each adapter
provides the file list, comparison identity, comparison loader, range label,
and open-in-Files action. The controller owns selection retention, first-file
selection, loading state, stale-response rejection, and unchanged-result
deduplication.

Do not force Git and chat checkpoint data into one domain type. Share the
behavioral contract, not their backend models.

### 9. Local buttons duplicate Conduit component behavior

The editor and review surfaces contain raw buttons and local CSS for quiet
actions, icon buttons, and segmented controls. This repeats focus, hover,
disabled, size, and selected-state behavior that Conduit already defines.

Use Conduit's shared button and segmented-control componentry where its sizing
fits the compact workbench. Add a compact shared variant if the current
component cannot express this density. Keep raw buttons only for controls with
editor-specific interaction that the shared component cannot represent.

### 10. Responsive CSS has too many local overrides

Editor, comparison, review, and workspace CSS repeat fixed heights, gaps,
borders, and breakpoint overrides. Later rules override earlier component
rules, so visual changes have a wide and unclear effect.

Define shared workbench variables for bar height, compact control height,
horizontal padding, divider color, and narrow-layout behavior. Keep component
CSS responsible for component layout. Keep workspace breakpoints responsible
only for placement and available space.

### 11. The syntax palette needs a documented design exception

`DESIGN.md` says that blue must not appear in the interface. One Dark Pro uses
blue as a syntax category. This is intentional semantic color inside code, not
general interface accent color.

Document syntax colors as a constrained exception. Keep blue out of workbench
chrome, selection controls, and status indicators.

### 12. The code-surface specification has stale navigation text

`docs/code-surface-design.md` still describes Diff as a separate tab in places.
The current product model uses Source Control Review and an alternate Diff
representation inside Files.

Update the specification after the implementation terms settle. Use one name
for each surface and one name for each comparison range.

## Performance constraints

The cleanup must not repeat the initial heavy `pierre/diffs` implementation.
CodeMirror remains the editor and rendering engine. Conduit should own the
workbench chrome, state model, data loading, and product-specific comparison
behavior.

Keep these invariants:

- Do not tokenize a file twice for one visible representation.
- Do not recreate CodeMirror when only comparison documents or metadata change.
- Do not poll or fetch data for an invisible Source Control mode.
- Reject obsolete responses before they update visible or busy state.
- Preserve referentially equal comparison payloads when their content did not
  change.
- Keep CodeMirror virtualization enabled for unwrapped content.
- Preserve wrapping as a required editor capability. If wrapped virtualization
  is not safe, prefer a responsive wrapped editor over virtualization.
- Load language support on demand and share the loaded module between File and
  Diff representations.
- Keep collapsed unchanged ranges inside CodeMirror. Do not build a second DOM
  row virtualization system around it.

## Build-versus-buy decision

Continue with CodeMirror 6. Do not replace it with Monaco, Shiki, or another
complete editor stack.

CodeMirror already supplies the difficult generic parts: document state,
transactions, selection, accessibility, syntax trees, language packages,
search, folding, viewport rendering, and merge views. Monaco would provide a
more VS Code-like default editor, but it would add a larger runtime and a second
visual system that Conduit would still need to restyle. Shiki produces
high-quality static highlighting, but it is not an editor and would create a
separate tokenization and rendering path for previews and diffs.

Conduit-specific work is still necessary. The application must define file and
comparison representations, Git and agent ranges, shared controls, request
lifetimes, status display, and navigation between Source Control, Agent
changes, and Files. Similar products also build this integration layer around
an editor engine. Rebuilding CodeMirror's engine would be unnecessary;
building Conduit's surface and state model is product work.

## Ordered cleanup

1. Replace the Source Control booleans with `SourceControlMode`.
2. Guard Agent changes comparison requests by baseline and checkpoint.
3. Extract the shared CodeMirror read-only base configuration.
4. Define and apply one workbench chrome contract.
5. Update comparison documents without recreating CodeMirror.
6. Make File and Diff persistent representations of one file surface.
7. Extract the common review controller and source adapters.
8. Consolidate compact controls and responsive workbench CSS.
9. Update `DESIGN.md` and `docs/code-surface-design.md` to match the final
   product terms and syntax-color exception.

The first two items reduce invalid and stale state without changing the visible
design. Items three through six form the editor-layer cleanup. Item seven then
removes duplicated review behavior on top of a stable editor surface.
