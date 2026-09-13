# Workspace editor and diff split

## Goal

Separate file editing from change review without allowing the Git and agent
comparison surfaces to drift.

The workspace panel has four product views:

- **Files** — browse, preview, edit, and save workspace files.
- **Source Control** — inspect and operate on Git state.
- **Chat** — inspect chat history and agent changes.
- **Terminal** — run shells in the workspace.

Chat history and agent changes stay together because both are projections of
the selected chat. Source-control review and agent-change review use the same
diff shell and comparison renderer, but they keep separate navigation and
state owners.

## Target structure

```text
WorkspacePanel
├─ FilesView
│  ├─ FileNavigator
│  └─ FileEditorShell
│     └─ WorkspaceFileSlot
├─ SourceControlView
│  ├─ Changes
│  ├─ DiffShell
│  ├─ Graph
│  └─ Patch
├─ ChatView
│  ├─ History
│  ├─ DiffShell
│  ├─ Outputs
│  └─ Interactive UI
└─ TerminalView
```

`WorkspaceComparison` remains the only CodeMirror diff renderer. `DiffShell`
owns the shared changed-file navigator, loading and empty states, and comparison
placement. Each product view supplies its own controller and controls.

## Files view

Remove the `All files / Diff` switch and all temporary comparison state from
the file surface. A file opened from the tree always shows the working file.

Keep the file tree, the two editor slots, all current preview formats, edit,
save, wrap, search, copy, download, replace, delete, close, and the quiet Git
status mark. Keep the overflow commands for staged and unstaged review, but
make them open Source Control review with the selected file and range.

The file slot must not own diff layout, comparison range, change navigation,
or an `Edit working file` transition.

## Shared diff shell

The shell accepts presentation data and callbacks instead of a Git-specific or
chat-specific controller:

```text
title
files
selectedPath
comparison
sourceKey
rangeLabel
loading
error
controls
select(path)
setViewState(state)
```

The shell owns no source selection. Source Control keeps Git range state.
Chat keeps chat and turn range state. Their selected files and scroll positions
remain independent.

Both consumers share the file navigator, unified and side-by-side layouts,
previous and next change controls, search, wrap, line position, line counts,
range label, and working-file action.

## Source Control view

Retain Changes, Review, Graph, and Patch, plus stage, unstage, commit, fetch,
pull, and push. Review uses `DiffShell`. Changes, Graph, and Patch remain sibling
source-control modes.

## Chat view

Retain History, Agent changes, Outputs, and Interactive UI. Agent changes uses
`DiffShell` with the existing current-chat and selected-turn ranges. History and
agent changes remain in this view because both depend on chat identity.

## Migration

1. **Built:** Extract `DiffShell` and route the existing Source Control review
   and Agent changes surfaces through it without changing behavior.
2. **Built:** Route file overflow review commands to Source Control review. Add
   the reverse action from a comparison to the working file.
3. Remove `FilesMode`, temporary comparisons, and comparison rendering from
   `WorkspaceFileSlot`.
4. Rename Artifacts to Chat in code and visible labels. Keep History, Agent
   changes, Outputs, and Interactive UI inside it.
5. Remove dead diff props and crossover CSS from the file components.
6. Extract larger product views from `workspace-panel.tsx` only where the split
   produces clear ownership. Do not add a general view framework.

Each step must remain buildable and usable before the next step starts.

## Acceptance

- Opening a tree file always shows its current contents.
- Files has no diff mode or comparison chrome.
- Source Control review and Agent changes render through the same `DiffShell`
  and `WorkspaceComparison`.
- Review commands from a file open Source Control with that file selected.
- Open-working-file commands return to Files with that file selected.
- Git and chat review state persists independently.
- Chat history and Agent changes stay in the same Chat view.
- Existing source-control operations remain available.

The main migration risk is navigation state. Remove the temporary-comparison
bridge only after both directions between Files and Source Control work.
