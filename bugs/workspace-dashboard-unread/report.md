# Workspace dashboard Recent chats drops unread state — bug report handoff

Date (UTC): 2026-09-08
Status: investigated, NOT fixed (read-only investigation).
Reporter request: workspace `Recent chats` should consume the same component as the Conduit (app) dashboard, scoped to workspace chats, with workspace-inappropriate features disabled.

## Symptom

Unread state propagates to:

* left sidebar chat rows (blue dot)
* Conduit/app dashboard `Recent chats`

but NOT to workspace dashboard `Recent chats`.

Screenshot: `screenshot.png` in this same folder (copied from incident attachment `e32316c4-dba4-497d-98d1-e01783bf72e5--image.png`).

What the screenshot proves (color semantics from `conduit-web/src/client/styles.css:322-327,1124-1129`):

* `runtime-indicator-unread` = blue `oklch(0.68 0.17 250)`
* `runtime-indicator-success` (idle live) = green `oklch(0.62 0.17 145)`

Left sidebar row `Proxying ChatGPT Web to ...` shows a **blue** dot = `unread=true` correctly rendered via `conduit-web/src/client/navigation/sidebar.tsx:769` which passes `unread={chat.unread}`.

Right panel `conduit / Dashboard` → `Recent chats` → `Proxying ChatGPT Web to Conduit / Conduit · 8 Sept` shows a **green** dot = live/idle `RuntimeIndicator`, NOT unread. That is the bug: same chat, same `unread=true` source, different rendering.

## Identities

* Incident chat (this diagnosis chat): `f44563aa-0cd7-4335-8e22-4b5242da0ed2`, `templateId runtime v1`, `profileId runtime v1`, `binary 0.84.1`, `installation conduit-pinned`
* Chat with unread in screenshot: `9e806ec3-575c-4d76-aa6f-2a9aa8ed586a` (`Proxying ChatGPT Web to Conduit`, `template assistant v9`, `profile assistant v9`, `unread: true` per `data/sessions.json`, `model opencode/muse-spark-1.3-contributor-free: high`)
* Workspace in screenshot: header `conduit / Dashboard`, `Linked workspace /home/jask/conduit` — corresponds to `project_d63f103c-5e28-44cb-ac44-5320e571fe97` (`name Conduit`, `slug conduit`, `origin linked`, `externalPath /home/jask/Conduit` in `data/conduit.json`). Note case difference `conduit` vs `Conduit` is display only, not claimed as cause.

No version mismatch: both chats report `0.84.1 / conduit-pinned`.

## Root cause (two layers, both confirmed by reading code)

### 1. Frontend prop dropped — certain

`conduit-web/src/client/dashboard/app-dashboard.tsx:152` (Conduit dashboard, correct):

```tsx
<RuntimeIndicator process={props.runtime.getProcess(chat.id)} stale={props.runtime.stale()} unread={chat.unread} />
```

`conduit-web/src/client/project/dashboard.tsx: ~375-380` (workspace dashboard, buggy):

```tsx
<RuntimeIndicator process={props.runtime.getProcess(item.id)} stale={props.runtime.stale()} />
```

`unread` is never passed, so `RuntimeIndicator` in `conduit-web/src/client/navigation/runtime-indicator.tsx:34-60` always takes the `fallback` (live-process) branch. Hence green idle dot instead of blue unread dot. `ProjectActivityIndicator` (`sessions.some(s => s.unread)`) is not used here either.

Data is available: `visibleChats` in `ProjectDashboard` is derived from `props.project.sessions` (`ChatSummary[]` where `unread?: boolean` per `conduit-web/src/client/api/contracts.ts:22`), populated by `GET /v0/projects` in `conduit-web/src/server/routes/projects.js` via `chatView(chat)` which preserves `unread` (it only strips `piSessionId/piSessionFile/backend`). So this is a one-prop omission, not missing data.

### 2. Backend payload omits `unread` — latent, will bite if/when payload is used

`conduit-web/src/project-dashboard.js: `recentChatView()` returns `id, projectId, status, title, templateId, runtime, createdAt, updatedAt, lastMessageAt, lastMessagePreview, liveStatus, liveActivity, liveActive` — NO `unread`.

`DashboardChat extends ChatSummary` (`contracts.ts:64`) allows `unread?`, but `buildProjectDashboard()` never sets it. Currently `ProjectDashboard.visibleChats` ignores `payload.recentChats` and uses `props.project.sessions`, so this is latent. If anyone switches the list to `payload.recentChats` (which already carries preview + `lastMessageAt` logic), unread will still be missing.

### 3. Feature divergence (user's refactor request)

`AppDashboard`:

* `chatScope` Unscoped/All (`slug === "chat"` filter)
* `chatVisibility` All/Unread (`chat.unread` filter) — `app-dashboard.tsx:64,76,140`
* `chatSort` Latest/Created (shared hook `useChatSort`)
* row: `RuntimeIndicator + title + project.name · compactDate + relativeActivity + Arrow`
* full context menu incl. `pin-chat` gated by `isConduitManagedProject`

`ProjectDashboard`:

* `visibleChats`: `props.project.sessions` filtered `active`, sorted by shared `compareChatsBySort`, sliced 10 — no scope (correct, already scoped), no `Unread` filter
* header actions: only sort Latest/Created + workspace search
* row: same `project-chat-row` markup/CSS but without `unread`, and `small` shows `project.name · compactDate` (redundant in single-workspace context; app dashboard shows owning project, workspace dashboard could show preview or last-activity instead — design decision, not bug)

CSS is already shared in spirit: `project/dashboard.css` and `dashboard/app-dashboard.css` duplicate `.project-chat-row` rules with identical grid. Good candidate for shared component.

## Repro

1. Have a workspace chat with `unread=true` (e.g. `9e806ec3...` in `project_d63f103c...`). Confirm `data/sessions.json` shows `"unread": true` and sidebar shows blue dot.
2. Open Conduit/app dashboard → `Recent chats` → row shows blue unread dot, `Unread` filter includes it.
3. Open that workspace's dashboard (`/conduit` → `Dashboard`) → `Recent chats` → same chat shows green/idle dot, no `Unread` filter exists.
4. Inspect DOM: workspace row's `.project-chat-runtime` lacks `.runtime-indicator-unread`; app dashboard row has it.

## Smallest safe fix (NOT applied — for implementation agent)

1. `conduit-web/src/client/project/dashboard.tsx`: pass `unread={item.unread}` to `RuntimeIndicator` in `visibleChats` row. One prop, matches `app-dashboard.tsx:152`.
2. `conduit-web/src/project-dashboard.js`: include `unread: Boolean(chat.unread)` in `recentChatView()` return so `GET /v0/projects/:id/dashboard → recentChats: DashboardChat[]` carries it (keeps contract `DashboardChat extends ChatSummary` truthful).
3. Optional, per reporter: extract shared `RecentChatsList` component used by both dashboards with props like `{ chats, projectScope?: Project | null, showProjectName: boolean, enableScopeToggle: boolean, enableVisibilityFilter: boolean, enablePin: boolean, onOpenChat, onPrefetchChat, onContextAction, ... }`. Workspace instance passes workspace-scoped chats, `showProjectName=false`, `enableScopeToggle=false`; app instance keeps current toggles. Keep `compareChatsBySort/useChatSort` shared. Keep context-menu items identical except `pin-chat` already gated by `isConduitManagedProject`.
4. Verify: blue unread dot in both dashboards, `Unread` filter (if added to workspace) matches app behavior, no change to `chatView` stripping or session persistence (`main.tsx:928-929` clears `unread` on open via `catalogue.patchChat` — unchanged).

## Addendum 2026-09-08 — open chat goes unread and stays unread (investigated, NOT fixed)

### Symptom (user wording)

> even if a chat is open on the users screen, it goes unread, and then i can click away to another thread and that first one stays unread because the only thing that clears the unread status is the act of clicking into an unread chat. This is wrong.

Confirmed by code reading: the only clear path is `openChat()` clicking into a chat that is already `unread:true`. Passively watching the open chat complete never clears it.

### Set path (unconditional, ignores visibility)

* `conduit-web/src/server.js:440-452` — on every terminal event (`agent_settled` / `generation_stopped` / `agent_end && !willRetry`) calls `registry.syncFile(..., { markUnread: true })`.
* `conduit-web/src/chat-store.js:386-401` — `commitSession(chat,{markUnread})` sets `chat.unread = true` whenever `session.lastAssistantCompletedAt` changed, with no check for "is this chat currently open/visible".
* `conduit-web/src/server.js:475` (codex settled path) — `registry.update(..., { unread: true })` unconditionally.
* Client then receives the flipped `unread:true` via catalogue/`chat_changed` SSE, so the open chat's own sidebar/dashboard dot flips blue before the user's eyes.

### Clear path (click-in only)

* `conduit-web/src/client/main.tsx:929-933` (`openChat`):
  ```tsx
  if (target.unread) {
    catalogue.patchChat(target.id, { unread: false });
    void api(`/v0/sessions/${id}/read`, { method: "POST" });
  }
  if (target.id === catalogue.selectedId() && routeKind() === "chat") return;
  ```
  Clear happens before the same-chat early return, so re-clicking the open row clears — but merely viewing stream completion, scrolling the transcript, or remaining on the route does not call `openChat` again.
* Server clear: `POST /v0/sessions/:id/read` → `registry.markRead()` (`conduit-web/src/server/routes/sessions.js:68-74`, `chat-store.js:473-479`). No other server caller clears `unread`. `markUserMessage`/`update` do not touch it except explicit patch.
* No clear on: transcript render/visibility, tail-follow reaching bottom, window focus, route change away (leaving preserves `unread:true`), streaming deltas.

So the sequence is: watch chat A → generation settles → server marks A `unread:true` → click away to chat B (no clear for A, since `openChat(B)` only clears B) → A stays blue forever until explicitly re-clicked. This also pollutes the `Unread` filter in `app-dashboard.tsx:76` with chats the user already read.

### Repro

1. Open chat A, send a message, stay on A while it completes. Observe sidebar/A dashboard row flip to unread blue despite being viewed.
2. Click away to chat B. Observe A remains `unread:true` in `data/sessions.json`, sidebar, and Conduit dashboard `Unread` filter.
3. Only re-clicking A clears it (`PATCH` catalogue + `POST /read`).

### Smallest safe fix direction (NOT applied — for implementation agent)

* Option A (preferred, matches "reading clears"): when a terminal completion lands for the currently selected/visible chat (`catalogue.selectedId()`, `routeKind()==="chat"`, transcript following or viewport visible), auto-clear: `catalogue.patchChat(id,{unread:false})` + `POST /read`, same as `openChat`. Guard against background tab (`document.visibilityState`) if product wants background completions to stay unread.
* Option B (narrower): gate the set path — pass `isVisible` into `syncFile/commitSession` or skip `markUnread` server-side when the completing chat equals the requester's open chat. Harder: server does not reliably know client visibility per connection; Option A is client-local and simpler.
* Keep `markRead` idempotent (already is: returns early if `!chat.unread`). Add clearing on transcript bottom-reached/seen if Option A alone still leaves scrolled-up readers marked read prematurely — design decision, default to selected+visible.
* Verify: open-chat completion leaves no lingering blue dot after fix; background-chat completion still goes blue; `Unread` filter no longer lists the chat just watched; existing `openChat` click-in path unchanged.

## User recovery (no state change)

No data cleanup needed. Workaround is to rely on sidebar blue dot or Conduit dashboard `Unread` filter until workspace dashboard is fixed. Do not delete either chat ID above; no disposable-chat removal proposed.

## Files in this handoff

* `screenshot.png` — copy of user screenshot
* `workspace-dashboard-unread-state.md` — this file

Original attachment source (do not edit): `data/chat/files/.conduit/chats/f44563aa-0cd7-4335-8e22-4b5242da0ed2/attachments/e32316c4-dba4-497d-98d1-e01783bf72e5--image.png`
Key source paths: `conduit-web/src/client/dashboard/app-dashboard.tsx`, `conduit-web/src/client/project/dashboard.tsx`, `conduit-web/src/client/navigation/runtime-indicator.tsx`, `conduit-web/src/client/navigation/sidebar.tsx`, `conduit-web/src/client/api/contracts.ts`, `conduit-web/src/project-dashboard.js`, `conduit-web/src/chat-store.js`, `conduit-web/src/server/routes/projects.js`
