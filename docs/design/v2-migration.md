# Components v2 migration tracker

Track complete app subsystems here. [DESIGN.md](../../DESIGN.md#components-v2)
defines the component rules and tracks the remaining component families.
[TESTING.md](../TESTING.md) defines verification. Update this tracker in each
migration commit, with the files, evidence and remaining work.

**Status:** Open means the full subsystem migration has not started. Partial
means some pieces use v2, but the subsystem still has old paths. Complete means
the full scope meets the completion criteria below. A v2 preview or a migrated
control does not make its subsystem complete.

## Subsystems

| ID | Subsystem | Full scope | Status and evidence | Ownership |
| --- | --- | --- | --- | --- |
| V2-01 | Settings | Settings overlay, section navigation, all settings pages, fields, switches, selectors, shortcut recording, save and error states. | Complete cutover. Settings opens in `OverlayDialog layout="rail"`: `OverlayRail` of `NavRow` tabs, `OverlayPage` with the save status, every section as `SettingGroup`/`SettingLine` with v2 controls (the library `Select`, `Segmented arrows`, `Switch`, `Input`, `TextArea`, `Keycap`, `SettingRecorder`). `FrostOverlay` (`components/frost.tsx`), `settings-controls`, `save-status` and the Settings CSS are gone. See V2-01 evidence below. | Claude |
| V2-02 | Sidebar and navigation | Expanded sidebar, collapsed rail, project and chat rows, server switcher, header controls, status indicators, context menus. | Complete cutover. The sidebar is cut over: `NavPane` and the Nav pieces (`components/ui/nav.tsx`), `Segmented`/`PillSwitch` for its sections, `StatusDot` for every `RuntimeIndicator`, and its right-click menus through the adapter's `ContextMenu` (now with sections, radio choices and submenus, the phone's panels included). `sidebar.css` is gone. The chat and project menus are one piece with the dashboards' (`item-menus.tsx`). Every page's header is `Header` (`components/ui/header.tsx`): crumb, `HeaderNote` for the outside-thread chip, `HeaderButton`s, frost pills on a phone; `header-pill.tsx`, `PillShell`, the composer-surface setting and `bridge.css` are gone. The Move chat dialog (the palette's Move) is a v2 `Dialog`. A pane's tab row and the file viewer's headers stay with V2-05. See V2-02 evidence below. | Claude |
| V2-03 | Search and commands | Chat search, command palette, leader palette, results, keyboard hints, empty and loading states. | Complete cutover. The command palette, its pages, the model selector, chat search (its tree, edit, move, rename, chips, preview and phone actions) and the leader render v2 through `OverlayDialog` and the Overlay, Glance and Leader pieces; their classic markup and CSS are gone. Keyboard transcript matches the baseline; see V2-03 evidence below. | Claude |
| V2-04 | Dashboards | Conduit, project, workspace, harness, and Computer screens; headings, lists, actions, menus, and empty states. | Done 2026-10-20 (see the V2-04 section). Section headers have two roles: the quiet section label and `GroupHeading` (Geist strong, sentence case, optional count) for dashboards and big lists; a phone's section label takes the group heading's style. | Claude |
| V2-05 | Panes and workspace tools | Pane headers, tabs, resize and drag controls, dock, Files, file viewer, Source Control, Chat review, and Terminal controls. | Open. Confirmations, file prompts and the embedded code excerpt now use v2; pane controls and the editable file viewer remain. | Unassigned |
| V2-06 | Notifications and shared dialogs | Toasts, confirmations, prompts, previews, and other dialogs used across subsystems. | Complete cutover. Sonner and Kobalte retain engine behavior. All internal native decisions and the embedded widgets now render v2. `npm run smoke:panes -- --project NHP` passes 8/8 (2026-10-20); see below. | Delivered in this session |
| V2-07 | Connection and access screens | Sign-in, first connection, server selection, reconnect, and connection error states. | Complete cutover. Browser sign-in, first connection, server/route selection and recovery render v2. Desktop and phone share Kobalte submenu behavior; the phone initial-focus blocker is resolved. See V2-07 evidence below. | Delivered in this session |
| V2-08 | Composer and transcript | Composer, riders, questions, approvals, pickers, message rows, answers, traces, Markdown, code blocks, and message actions. | Partial; Claude's scope. Shell `d7ac7e33`, riders `17731746`; the menus and pickers now use `components/menus.tsx` (+ menu, model, profile, permissions, folder and project lists, context gauge and breakdown, the phone options menu with shared phone submenus). The composer and transcript no longer use `LibraryContext`, graduation or bridge rules; the riding buttons and the welcome are library pieces. Composer and transcript markup is v2 throughout. The chat header's menu (its context row and breakdown on the phone) is v2 too: `HeadingSection`, the adapter's rows, `Menu fit`; its old classic branches and CSS are gone. The phone + trigger is the adapter's `MenuPillTrigger`, with no private Kobalte import. Outside V2-08: the chat pane's empty-chat placement (`.chat-main-empty`, `.composer-stack`) is screen layout. | Claude |
| V2-09 | Shared v2 foundations | Controls, navigation rows, menus, cards, overlays, keycaps, loading indicators, and status indicators. | Partial. Extend these as each subsystem needs them. Use DESIGN.md's family table for the remaining old implementations. | The agent migrating a subsystem owns its required extensions; coordinate shared-file edits |

## Completion criteria

- The live app renders actual v2 components throughout the subsystem. App
  code supplies content, state, handlers and behavior adapters.
- Missing functionality becomes a supported v2 prop, slot or shared piece.
  Update its gallery family, including the real behavioral host when a static
  example cannot show the behavior.
- Colour, typography, spacing, size, radius, surface and motion use v2 tokens.
  Styling and fixes belong in the library. Caller CSS must not override shared
  appearance, and callers must not animate a library piece from outside.
- Retain actions, values, validation, loading and error states, keyboard
  control, focus return, dismissal rules and unsaved-change protection.
- Remove the old component, its CSS, bridge rules and classic fallback in the
  same change. Update selectors and probes that read the old markup.
- A change to a shared component or token reaches every migrated use. Verify
  propagation on a representative live use; list any exception explicitly.
- Run the single relevant verification seam from TESTING.md. Record what ran,
  what it proved, and what still needs user confirmation. Commit the bounded
  change and update this tracker. Do not mark unverified behavior as verified.

## V2-06 boundary tasks

The full dialog scope includes shared surfaces, async decisions and embedded
content. All paths below now use v2:

- [x] Route all app notifications through `components/notifications.tsx` and
  v2 `Toaster`/`Toast`, with Sonner retaining notification behavior.
- [x] Replace all former `FrostDialog` surfaces with `components/dialog.tsx`
  and v2 `Scrim`/`Card`, with Kobalte retaining modality and focus behavior.
- [x] Move shared dialog forms, fields, actions, close controls, attachment
  previews, pairing details and path previews to v2; remove old surface CSS.
- [x] Fix toast frost at the shared frame. The element that fades carries the
  frost; no partially transparent ancestor sits above a nested frost surface.
- [x] Add real notification controls under Gallery → Toast → Live engine.
- [x] Replace native `window.confirm` and `window.prompt` paths in Settings,
  file/workspace tools and pane navigation.
  Custom dialogs require asynchronous decisions; preserve cancellation,
  navigation order and unsaved-change protection.
- [x] Migrate the domain widgets supplied as dialog content: Computer
  explorer and workspace identity editor (V2-04), code viewer (V2-05), and
  server connection form (V2-07). They must not override the shared surface.

### Recorded verification

The shared surface migration passed typecheck, gallery build, production build
and bundle checks. Browser checks covered open/Escape/focus return, an alert's
backdrop guard, a busy dialog's Escape guard and disabled close, and the live
New folder dialog. Changing the shared Card padding token changed its live
padding from 16px to 32px; removing the override restored 16px.

For `08b8564d`, headed Chrome recorded 70 samples across two stacked toasts,
including 28 partial-opacity samples. Every animated frame carried
`blur(24px)`, with no partially transparent ancestor and no nested frost.
Repeating an ID left one toast, its action ran once, and 13 exit samples,
including seven partial-opacity samples, kept the same invariant. The user
confirmed that the dialogs and corrected toast appearance looked good.

These checks do not prove every dialog action, native-client interaction or
embedded widget. Keep that distinction when planning the next subsystem.

### Full decision and content cutover

`components/decision-dialog.tsx` replaces every internal `window.confirm` and
`window.prompt` call. Pane/file callers await Cancel or acceptance before
changing state; scoped identity and per-target guards reject stale answers.
The queue restores focus before resolving and cancels requests if its host
unmounts. Browser-owned `beforeunload` tab-close protection remains native.

The embedded content now uses `components/ui/identity.tsx`, `browser.tsx`,
`connection.tsx` and `code-excerpt.tsx`. Domain state stays with the app;
CodeMirror, Kobalte and Sonner retain their engine roles. The old identity,
Computer, connection, scanner and excerpt presentation CSS was removed.
Card → Forms covers real decisions and the embedded content at both densities.

Executed: typecheck, gallery build, production build and bundle checks passed.
Headed Chrome covered prompt initial selection, Escape, queue ordering, empty
prompt values, stale-target rejection and focus return. The live file viewer
also kept an unsaved edit after Cancel, asked again on close, then closed after
Discard; no file was saved. Explorer search, details, hidden files and context
menus passed. Identity icon search, custom colour and monogram controls passed;
changing its v2 text token changed the live input from 10.4px to 20px and was
then removed.

`npm run smoke:panes -- --project NHP` first passed 7/8: `file still bold once
focus leaves` failed and the default run picked Conduit, whose API tree counted
hidden files the Files list does not show. The smoke now counts only visible
files. On 2026-10-20 (after the composer cutover) it passed 8/8 on NHP and the
bold check passed on the default project too; a direct probe showed the marker
turning `shown` within 600ms of the click. The earlier failure did not
reproduce, so its cause stays unknown. The default run picked deriv-dash, whose
last scenario failed only on an unrelated `409` from
`/v0/harnesses/opencode/threads` for that folder.
Camera hardware, server discovery/sign-in, push and destructive filesystem
actions were not exercised.

## V2-07 connection and access cutover

All access rendering now comes from `components/ui/connection.tsx`, the v2
controls/status pieces, and `Menu`/`Section`/`Item` with Kobalte behavior.
`ServerSwitcher` retains probing, identity checks, automatic/pinned routes,
browser/native restrictions, downloads, update checks, pairing and sign-out.
The shared submenu adapter owns phone placement, parent-tap consumption and
one-level Back handling. Old server-picker,
first-connection, sign-in and root-error markup/CSS and the picker library
preview branches were removed.

The browser login page remains a plain server-rendered form. The normal Vite
build renders its templates from the actual v2 components and emits their
hashed CSS. The server substitutes only escaped error and redirect data. It
reads the template from the configured client distribution. There is no
second stylesheet or legacy fallback. The server reads the template again when a rebuild replaces
it, so new hashed stylesheet names reach the page without a restart. A
missing build fails with a message naming the file. `styles/theme.css` owns the shared dark
colour tokens for both the app and standalone page.

Executed: typecheck, gallery build, production build and bundle checks passed.
Three selected existing auth-server tests passed: access enforcement,
login/logout/rate limiting and safe redirects. A built-template check passed
escaped error/redirect values and error accessibility. Headed Chrome confirmed
the live `/login` page has zero scripts, autofocus, the original POST target,
the hidden redirect, and a shared input token that changes from 10.4px to 20px
and restores. The live server control uses v2 with no old sidebar-user node.
Gallery desktop checks covered checked/disabled radio rows, keyboard submenu
opening and route selection. The phone panel stays within a 412px touch
viewport; Escape returns to the parent. Selecting a manually focused route
closes both layers and restores the trigger.

**Resolved phone focus blocker:** desktop and phone now use the same
`KMenu.Sub`, `SubTrigger` and `SubContent` in `components/menus.tsx`. The
separate `PhoneMenuPanel` focus scope, arrow-key loop and caller-owned panel
state are removed. Kobalte owns child registration, focus, selection and
navigation. The adapter supplies phone anchor geometry, parent dimming,
parent-tap consumption and one-level Escape. V2 owns the panel material,
size and stacking tokens. The composer's menus use the same adapter.

Executed for the adapter change: typecheck, gallery build and production
build/bundle checks passed. Headed Chrome keyboard checks confirmed initial
child focus, arrow navigation, Escape to Route, selection closing both menus,
and trigger focus restoration. Desktop ArrowRight/ArrowLeft checks passed.
Dispatched touch-pointer/click sequences confirmed opening does not select a
route and tapping the dimmed parent returns without activating a parent row.
The UID-click tool did not deliver pointer events in this emulated gallery;
this is not physical-touch evidence. The rebuilt live app also passed phone
initial focus, viewport bounds, parent dimming and Escape restoration at
412×860. No live route was changed. Production bundle observations: initial
JS 328419 B gzip, initial CSS 56526 B gzip, largest lazy JS 122467 B gzip.

Hardware sign-in, secure token storage, discovery, camera scanning and native
Android Back were not exercised. Their domain logic was retained.

## V2-02 sidebar cutover

`navigation/sidebar.tsx` renders `NavPane` (head, list, foot), `NavGroup`,
`NavRow`, `NavFolder`/`NavFolderRow` (the measured-height slide moved into the
piece, `--duration-fold`), `NavRail`/`RailButton`, `NavNote`, `NavSkeleton`,
`NavNotice` and `NavLinks`. The pane's widths, the folded rail and the phone's
drawer are library state (`collapsed`, `folded`, `instant`, `drawer`); the app
keeps the edge's panel-motion sampling. The section switch is `Segmented` on
desktop (stacked when folded) and `PillSwitch` on a phone, whose open drawer has
no toggle (the library preview's decision). `RuntimeIndicator` draws
`StatusDot`, so dashboards and chat search change with it. Rail buttons say
their names in a `title` rather than the classic tooltip. The chat, folder and
pinned menus use `ContextMenu` with `MenuSection`, `MenuRow`, `MenuSub` and
radio items; the selection menu and Move to folder are submenus there.
The Move lists carry each place's glyph (`PlaceGlyph`). Every v2 popover is
capped (a phone's at `--measure-sm` wide and `--measure-lg` tall by default;
`Menu width`/`height`, and the adapter's `ContextMenuContent`/`MenuSubContent`,
for a menu's own), scrolls past its caps, and keeps a gutter plus the safe area
from the window's edges (`edgePadding`), so it never runs under a phone's
navigation bar; `Menu fit` is gone.
A chat's and a place's menu are one piece wherever their rows are
(`navigation/item-menus.tsx`: `ChatMenuItems`, `PlaceMenuItems`, and `MoveTo`
for every Move list): the sidebar binds them to its own dialogs, the app and
project dashboards to one `ItemActions` from `main.tsx`, so the dashboards'
chat and project menus are v2 and match the sidebar's (Move to folder is a
submenu there too). Their terminal menus are v2 too (V2-04).

The header is the library's `Header`: `HeaderCrumb` (the place in caps, a
link when it opens), `HeaderNote` beside it (the outside-thread chip),
`HeaderButton`s (`only` phone or desktop: search, palette and ⋯ on a phone,
share on a desktop) and the pane's own actions last; a tab row's strip is frost
through `frost` (the Tab row setting, `tabFrostOn`). On a phone its lead and
actions groups are frost pills; the title and the status line are not shown
there (the status line stays retired). The ⋯ opens through the adapter's
`MenuControl as={HeaderButton}`. The composer-surface setting, its module,
test, rules and `bridge.css` are gone; `check-bundle.mjs` now checks the
library's `.ui-frost` keeps both blur spellings.

Executed: typecheck passed. In headed Chrome (:9222): a desktop chat's header
(crumb and share) and the dashboard's; a phone's (412×860) pills, lead
78×44 and actions 116×44 on a chat, the ⋯ opening by keyboard there and by a
touch tap in headless (a mouse click under touch emulation does not, which is
the emulation). The gallery's Header family and the Phone preview were looked
at in the same Chrome.
`sidebar-cursor.ts`, `focus-shown.ts` and the go-to (`main.tsx`) select the
library's classes (`.ui-nav-row`, `.ui-nav-link`, `.ui-nav-toggle`,
`.ui-nav-folder-*`, `.ui-rail-button`, the switch's `[aria-checked]`). The
workspace glyph's base rules, the chat header's leading controls and the
dashboards' `.sidebar-context-menu` rules moved to `styles.css`; dashboard rows
keep their harness-mark rules in `dashboard.css`.

Executed: typecheck and the production build passed. A headless keyboard
transcript (desktop 1280×900) was recorded before the change and replayed
after it: go-to, ↑/↓, Home/End, ↑ to the switch and ←/→/↓ on it, → open and
step into a folder, Esc and ← out and shut, Shift+↓ selection and Esc, Shift+F10
menu rows and focus return, pointer-moves-cursor, the still pointer's resting
row, the held cursor on blur, Esc to the main pane, Enter into a chat, and the
folded rail's ↓/↑. Every focus step, stop count, selection count and menu row
matched. The differences were the switch's look (the library's tint and lift
weight in place of the old brighter wash) and a row's rest ink (`--foreground`
at the rest tone for `--sidebar-foreground`). Sidebar preferences were restored
by the probe. Headless shots compared the desktop sidebar, its rail and the
phone drawer (412×860, touch) with the old ones; the chat menu and its Move to
folder submenu opened on desktop (keyboard) and phone (tap, the shared phone
panel), and Escape returned focus to the row. The gallery's new Nav family
(Forms at both densities, the pane open and folded) was screenshotted. Not
exercised: drag to a pane, long-press on a real phone, the reduced-motion
path, the Computer area's harness rows with a harness not ready.

## V2-03 search and commands cutover

- Pieces: `OverlayDialog` (`components/dialog.tsx`) gives Kobalte's modality and focus to `Scrim` and `Overlay embedded`. The Overlay family gained `OverlayChip`, `OverlayEmpty`, `OverlayActions`, `OverlayBar` `chips`/`field`/`closeLabel`, `OverlayList managed` and hints that are their action's button (`count` for an edit). `Item` gained `onOpens` (a disclosure chevron of its own), `indent`, `picked` (an edit's check column) and `reveal`. `Match` lights letters in order when the run is not there. `Leader` gained `label` and `placement="foot"`, and `Spotlight` gained `fixed` and `motion`. `--layer-leader` is a foundation token.
- App: `navigation/command-menu.tsx`, `chat-preview.tsx` (Glance), `command-hint-bar.tsx` (OverlayHints) and `leader-palette.tsx` render only library pieces. `leader-palette.css` and the palette, chat-search, hint-bar and leader rules in `client/styles.css` are gone. `components/frost.tsx` remains for Settings alone.
- Keys: a headless keyboard transcript (palette, pages, model selector, chat search tree, scope, chips, preview, edit, rename, move, delete confirm, leader levels) was recorded before the change and replayed after it. Three things differ, all intended:
  - `aria-selected` now follows the cursor; it was stale before.
  - Move mode keeps focus in the list, so Esc steps back to the results rather than closing the search.
  - Leader ←/→ where no level has keys no longer crashes the app (`shortcut-manager.ts`).
- Look: checked in headed Chrome on desktop and the phone layout. The gallery's Overlay family has new cards for the bar's chips and crumbs, a tree with an edit and an empty list, and `OverlayActions`.

## V2-01 Settings cutover

- Pieces: `OverlayDialog` gained `layout` (Settings is `placement="center" layout="rail"`). `OverlayRail` takes a behaviour's attributes (the tablist) and `onClose` for a phone's screen of its own; its foot is a column of facts (About). `OverlayPage` gained `busy`, `why` and `onRetry` for the save status. `SettingLine` takes JSX `label`/`state` and a `title`, and wraps its control under its name only when the two cannot share a line (on a phone fields shrink first). `SettingRecorder` became the capture itself (`onKeyDown`, `label`, `onCancel` as the Esc hint's button, `saveDisabled`). New `LiveNote`. `Segmented` gained `arrows` (one Tab stop, the arrows move the choice), `disabled`, `id`, an option's `title`; `SelectTrigger` forwards a button's attributes; `Select` in `components/menus.tsx` is the library's select (a hidden native select owns the value). `Keycap` never wraps.
- App: `settings-core.tsx`, `shortcuts-settings.tsx`, `servers-settings.tsx`, `desktop-settings.tsx`, `about-settings.tsx` and `voice-local-catalogue.tsx` render only library pieces, with no classes. The dashboards' and workspace panel's switches moved to v2 `Segmented arrows`. `components/frost.tsx`, `settings-controls.tsx`/`.css`, `save-status.tsx`, `shortcuts-settings.css`, `voice-settings.css` and about 940 lines of Settings rules in `client/styles.css` are gone.
- Keys: a headless transcript (open, the rail's ↑/↓/Home/End, every section's groups and controls, Tab order, the recorder, Esc) recorded before and replayed after, desktop and phone. Same sections, groups, selection and order. Intended differences: a select is named by its setting, not its value; closing the recorder returns focus to its line (it fell to the page, after which Esc no longer closed Settings); on a phone, opening a section focuses its title and Back focuses its row (focus fell out of the dialog), and the rail's arrows move between rows rather than opening each one.
- Look: headed Chrome on desktop; phone geometry headless (no line overflows on any section at 412px); gallery Settings cards (sections, a section with Not saved and Retry, recording a shortcut).

## V2-04 dashboards cutover

- Pieces: `components/ui/dashboard.tsx` and `styles/dashboard.css` (Dashboard, DashHeader, quick actions, Group with GroupHeading/GroupToggle/GroupSwitches/GroupAction, DashRow, ChangeRow, Counts, DashDay/More/Empty/Note, FolderShelf/FolderTile). Every size is a unit, so a phone's sizes come from its density; `data-compact` changes only the layout. `--dash-aside` and `--dash-gutter` are registered lengths the adapter reads back when it measures the two-column breakpoint.
- App: `split.tsx` keeps the behaviour and draws only library pieces; `split-cursor.ts` selects `.ui-dash-*` with unchanged keys. `app-dashboard.tsx`, `chat-list.tsx`, `harness-dashboard.tsx` and `project/dashboard.tsx` render library pieces and `@/components/menus` (no `@/components/primitives`). The harness folder picker is a v2 Dialog (Home and Up as the list's first rows, Use folder its action); the clone notice is an embedded Card. `split.css`, `app-dashboard.css`, `harness-dashboard.css` and `project/dashboard.css` are deleted.
- Keys: the headless transcript over `/`, `/project/test` and `/computer/harness/claude-code` (composer Tab into rows, ↑ to heading controls, ←/→/Home/End, Tab/Shift+Tab between groups, Shift+F10 menus, Esc back to the composer) recorded before and replayed after on desktop and phone: identical.
- Look: desktop and phone shots of the three dashboards before and after, side by side (rows hold v1's 26px on desktop; the current folder keeps its wash); gallery Dashboard family (forms and an assembled page).

