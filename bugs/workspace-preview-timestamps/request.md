# Feature: show created + modified time in workspace file preview pane

Date (UTC): 2026-09-08
Type: minor feature (not a bug), same `bugs/` handoff folder for implementation agent.
Status: investigated, NOT implemented (read-only investigation).

## Request (user wording)

> workspace panel file explorer file preview pane should show created and modified time, helps with making sure that conduit has refreshed after e.g. a conduit agent modifies something.

## Current behavior (confirmed by reading code)

Preview component: `conduit-web/src/client/workspace/workspace-file-slot.tsx`

* Text header (`preview()` branch):
  ```tsx
  <small>{hasUnsavedChanges() ? "Unsaved" : file().truncated ? "Truncated" : formatFileSize(file().size)}</small>
  ```
* Asset header (image/pdf/audio/video/binary):
  ```tsx
  <small>{[dimensions, formatFileSize(size), mime].join(" · ")}</small>
  ```
  Binary card: `{mime} · {size}` + hex head.

No created or modified timestamp is rendered anywhere in the preview pane. Title tooltip is only the file path.

Backend already supplies half of what is needed:

* `conduit-web/src/workspace-inspector.js: readWorkspaceFileMetadataAt()` returns `{ path, size, modifiedAt: stat.mtimeMs, revision, kind, mime, head }`
* `readWorkspaceFile()` spreads that metadata, so `FilePreview` also carries `modifiedAt`
* `writeWorkspaceFile()` returns `{ path, size, modifiedAt: written.mtimeMs, revision }`
* `resolveInspectorPath()` returns full Node `stat` (`fs.stat`), so `birthtimeMs` / `ctimeMs` are available but never exposed.
* Frontend types in `workspace-file-slot.tsx`: `FilePreview { path, size, modifiedAt, revision, ... }`, `FileMetadata { path, size, modifiedAt, ... }`, `FileAsset`, `FileWriteResult` — none have `createdAt`.

Routes (`conduit-web/src/server/routes/projects.js:312-344`):

* `GET /v0/projects/:id/file?metadata=1` → `readWorkspaceFileMetadata(...)` (has `modifiedAt`, no `createdAt`)
* `GET /v0/projects/:id/file` → `readWorkspaceFile(...)` (same)
* `PUT .../file` → `writeWorkspaceFile(...)` (same)

So modified time is fetched on every preview load but discarded for display; created time is not fetched at all.

## Why this helps the stated use case

After a Conduit agent modifies a file outside the preview slot, the user currently has only file content/size to judge freshness. Size often does not change (e.g. small edit, formatting). A visible `Modified: 8 Sept 11:42:03` that updates on `slot.reload()` gives an explicit refresh signal. `Created` helps distinguish “new file just wrote” from “old file touched”.

Caveats for implementation agent:

* Linux `birthtimeMs` reliability: on ext4/overlayfs/Docker it can be `0`, equal to `ctime`, or change on copy. UI must tolerate missing/zero birthtime (hide `Created` or show `—`, never `1970`). Prefer `stat.birthtimeMs` if `> 0`, else omit.
* `mtimeMs` is the refresh authority; `revision` (sha256 of content or `dev:ino:size:mtime` for metadata) already drives `ETag` / `if-match` / `if-none-match` — timestamps are display-only, not correctness.
* Timezone: existing dashboard code uses `Intl.DateTimeFormat(undefined, ...)` and `toLocaleTimeString`; follow that, with `title=` absolute + visible relative/compact text. Keep the existing `<small>` one-line constraint; consider `Modified 2m ago · 3.1 KB` with full timestamp in `title`.
* Unsaved/Truncated states currently replace size text — timestamps must not overwrite those; append, e.g. `Unsaved · Modified 11:42 · 3.1 KB`.

## Smallest proposed change (NOT applied)

1. `conduit-web/src/workspace-inspector.js`:
   * `readWorkspaceFileMetadataAt()`: add `createdAt: Number.isFinite(stat.birthtimeMs) && stat.birthtimeMs > 0 ? stat.birthtimeMs : null`
   * `readWorkspaceFile()`: inherits via spread (no extra work, verify `...classification` does not clobber it)
   * `writeWorkspaceFile()` return: add same `createdAt` from `written.birthtimeMs` (+ keep `modifiedAt`)
2. `conduit-web/src/client/workspace/workspace-file-slot.tsx`:
   * extend `FilePreview`, `FileMetadata`, `FileAsset`, `FileWriteResult`, `FileSummary` with `createdAt?: number | null; modifiedAt: number`
   * add `formatTimestamp()` helper (absolute in `title`, compact/relative visible — reuse `compactDate`/`relativeActivity` patterns from `project/dashboard.tsx` / `dashboard/app-dashboard.tsx`)
   * text header: `<small title={absolute}>` showing `{status/size} · Modified {rel} [· Created {rel}]</small>`; asset header: append `· Modified ...` to existing `dimensions · size · mime` chain; binary card second line likewise.
   * ensure `save()` (`setPreview(next)`) and `loadMedia`/`loadText` preserve new fields so timestamp updates immediately after save/reload without extra fetch.
3. Verify: open text + image + pdf + binary previews, missing-birthtime filesystem (shows only Modified), save flow updates Modified instantly, agent-external write + slot `reload()` updates Modified, long paths still truncate (existing `title={path}` moves to combined tooltip or keeps path + adds time tooltip).

Out of scope (do not bundle): full file-properties dialog, owner/permissions, version-history list, auto-polling indicator. This is header-line display only.

## Repro / acceptance

1. Open any workspace → Files → preview a text file and an image. Note header shows only size/mime today.
2. After change: header shows `Modified` (and `Created` where filesystem provides it).
3. Have an agent (or `touch`/`echo >>`) modify the open file externally, trigger preview reload; `Modified` advances. Create a new file; `Created ≈ Modified`.

## Key paths

* `conduit-web/src/client/workspace/workspace-file-slot.tsx` (render + types)
* `conduit-web/src/workspace-inspector.js` (`readWorkspaceFileMetadataAt`, `readWorkspaceFile`, `writeWorkspaceFile`, `resolveInspectorPath`)
* `conduit-web/src/server/routes/projects.js:312-370` (`GET /file`, `PUT /file`)
* Reference date formatting: `conduit-web/src/client/project/dashboard.tsx` (`compactDate`, `relativeActivity`), `conduit-web/src/client/dashboard/app-dashboard.tsx`
* Styles: `conduit-web/src/client/workspace/workspace.css` (`.workspace-preview-header`, `.workspace-preview-file`)
