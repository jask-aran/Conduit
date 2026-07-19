# Spec: Right-hand panel (files · diff · artifacts)

Status: draft · Priority: 3 · Pairs with `ui-parity.md`; independent files.

## Goal

A collapsible right-hand panel on the chat surface giving the working context
of the current chat's project/Workspace: a file navigator with preview, a diff
view of what the agent changed, and an artifact viewer for substantial
outputs. This is the "see what the agent is doing to my folder" half of the
local-target experience.

## Shape

- Desktop: a resizable right panel (Shadcn Resizable alongside the existing
  left Sidebar; do not nest a second `Sidebar` if it fights the shell).
  Mobile: a Sheet overlay. Lazy-loaded chunk; closed by default; state
  persists per chat. Toggles: header button, `⌘/Ctrl+.`, palette.
- Three tabs: **Files**, **Diff**, **Artifacts**.

### Files

- Server: `GET /v0/projects/:id/tree` (bounded depth, lazy per-directory
  listing) and `GET /v0/projects/:id/file?path=…` (size-capped read, text
  detection). All paths resolve through the existing workspace-path validation
  (`workspace-paths.js` / allowlist rules in `AGENTS.md`); symlinks and
  traversal fail closed. `.conduit/` internals are hidden.
- Client: tree with lazy expansion; preview pane renders text through the
  existing Shiki setup (read-only), images inline, everything else as a
  download row. No editing in v1.

### Diff

- Scope v1: git working-tree status + diff for Workspaces/projects that are
  git repositories: `git status --porcelain` list, per-file unified diff via
  `git diff` (and `git diff --cached`), run server-side in the working root
  with the same path validation. Non-git roots show an honest empty state.
- Render with a diff component (side-by-side on wide, unified on narrow),
  Shiki-highlighted. Refresh on demand and after each completed generation.
- Per-turn attribution (which turn changed which file) is out of scope for v1;
  the compact per-tool-call change card from `ui-parity.md` phase 1/3 covers
  the in-transcript view.

### Artifacts

- v1 sources: fenced code blocks and file outputs already rendered as Artifact
  cards in the transcript. The tab lists them (label, language, turn),
  selecting one shows it full-height with copy/download. This is a projection
  of the transcript — no new persistence, aligning with the vision's
  artifact-as-projection posture until real artifact records exist.

## Constraints

- Read-only surface: no writes, no shell, no file mutation endpoints.
- Respect transcript-paging economics: nothing in the panel may parse full
  JSONL on open; artifact listing reuses already-loaded turns and pages with
  them.
- Bundle budgets hold; the panel is a lazy chunk.

## Verification

Node tests: tree/file endpoints (allowlist, traversal, symlink, size cap,
hidden `.conduit`), diff endpoints against a fixture repo (clean, dirty,
staged, non-git). Browser tests: open/close persistence, file preview, diff
render from mocked API, artifact list follows transcript. Build within
budgets; responsive screenshots (desktop panel, mobile sheet) in the PR.
