---
name: Conduit
description: In-app visual language for Conduit. Dark charcoal control plane, inset panes holding plain lists grouped by heading and space, frosted glass for everything that floats. No blue anywhere.
note: "Colours are the dark theme's values in components/ui/styles/theme.css. Every other value (space, type, radius, motion) is a token in components/ui/styles/foundations.css; the body names them, the code holds them."
colors:
  frame: "oklch(0.138 0.004 264)"
  background: "oklch(0.186 0.005 264)"
  foreground: "oklch(0.93 0.003 258)"
  muted-foreground: "oklch(0.63 0.006 262)"
  accent: "oklch(1 0 0 / 7%)"
  border: "oklch(1 0 0 / 7%)"
  card: "oklch(0.225 0.006 264)"
  primary: "oklch(0.95 0.002 258)"
  destructive: "oklch(0.645 0.19 18)"
  ring: "oklch(0.78 0.008 258)"
  frost-fill: "#ffffff2b"
  frost-stroke: "#ffffff4d"
  live: "oklch(0.62 0.17 145)"
  warn: "oklch(0.75 0.15 75)"
---

# Overview

Conduit is a self-hosted, always-dark agent control plane. The look is charcoal and quiet: a darker frame, inset rounded panes, plain lists grouped by a heading and space, and frosted glass for everything that floats. It is not a marketing site, not a light theme, and not a colourful dashboard.

Three surfaces are the references; copy them before inventing anything:

- **The sidebar** -- how everything is interacted with: grey at rest, the wash as the one cursor, the current item bold with no fill, driven as easily from the keyboard.
- **Chat search and the command palette** -- what anything that opens on top of the app looks like.
- **The dashboards** -- laying things out on grey without borders, in single lines grouped by heading and space.

This file holds the rules. Values live in code and examples in the gallery:

| For | Look in |
| --- | --- |
| The rules a surface, control or move follows | this file |
| Token values (space, type, radius, motion, frost) | `conduit-web/src/components/ui/styles/foundations.css` |
| The pieces themselves | `conduit-web/src/components/ui/`: one module and one `styles/` file per family, re-exported by `index.tsx` |
| Every piece drawn, measured, in every state and density | the gallery (`npm run gallery`, docs/TESTING.md) |

Write rules here, not specs: sizes, timings, exact copy, counts and fold orders belong to the code. How to verify a rule goes in docs/TESTING.md.

Stack: SolidJS, Kobalte for behaviour, Geist Variable and Paper Mono, Lucide icons. Do not add React, another icon kit, a chart library for chrome, or a second palette.

# Components v2

New UI is built from components v2 (`components/ui`) and its tokens alone, so a change to a token or a piece reaches every use. The library draws shapes: behaviour (Kobalte menus, dialogs, the app's state) is the caller's, wrapped round the piece.

- **Nothing styles itself per component.** Sizes come from the space, control, icon and type tokens; corners from `--radius-*`; colour from the surface (Surfaces). A value a piece needs and no token gives is a new token or a new rule here, not a local number.
- **A piece owns its moves.** Entering, leaving and removing are its `motion` prop or its own state, on the Motion tokens. Callers never animate a library piece from outside.
- **One gallery family per piece.** A change to a piece updates its source and its gallery family together; the gallery's In use, Anatomy and Forms views go through the shared `gallery/specs.tsx`, never markup of their own.
- **Cutting a piece over to v2 means the app renders the library's components.** The app gives the piece data and behaviour: its state, handlers and Kobalte wrappers. All markup, structure and styling come from `components/ui`. When the app needs something the piece lacks, add it to the piece as a prop or slot and show it in the piece's gallery family. Never write it as app markup that wears v2 classes, a `useLibrary()` branch or a bridge rule. The same commit deletes the old component, its CSS and its `conduit:classic` fallback, so a cut-over piece has no classic path. The probes and selectors that read the old markup move to the piece's classes in that commit too.
- **No scaffolding is left.** `components/ui/swap.ts` (`LibraryContext`), `components/primitives.tsx` and `styles/bridge.css` are gone: the app imports pieces from `components/ui`, and Kobalte behaviour comes from `components/menus.tsx` and `components/dialog.tsx`.

## Migration

What each v2 family replaces and where it stands. Update a row in the commit that moves it; remove it once the old code is gone. Until a family is in the app, the old piece in the "Replaces" column is what app code uses.

| v2 family (gallery) | Replaces | In the app |
| --- | --- | --- |
| Controls: `Button` | raw `<button>`s in the terminal pane, sidebar, `main.tsx`, command menu, Computer dashboard | cut over: every button in the app is `Button` or a piece built on it (`HeaderButton`, `ToolButton`, `TermShortcut`, `TermKey`, `DashPath`, `Backdrop`, …); the answer's link buttons are its Markdown's own |
| Controls: `Segmented` | `settings/settings-controls.tsx`; `.split-heading-switches`, `.workspace-history-toggle` | cut over: the sidebar's section switch (`Segmented icons` on desktop, stacked on the folded rail; `PillSwitch` on a phone), Settings, the dashboards' and the workspace panel's switches (`arrows`: one Tab stop, the arrows move the choice; without it the holder steers the keys, as the sidebar's cursor does); `settings-controls.tsx` is gone |
| Controls: `Input`, `TextArea`, `SelectTrigger`, `Field` | app inputs outside Settings | cut over: every field is `Input` or `TextArea` (Settings, the composer, a question's own answer, the terminal's shortcut form); a select is `Select` from `components/menus.tsx` (`SelectTrigger` opening a `Menu` of its choices, the hidden native select owning the value). The only raw inputs left are hidden file pickers |
| Controls: `Slider`, `SliderValue`, `Gauge`, `Meter`, `Swatch` | none | cut over in the composer: the model and effort sliders (a `SliderValue` opening a submenu through `control`), the context `Gauge`, the breakdown's `Meter` and `Swatch`es; the identity editor's colour choices (`Swatch fill`) |
| Controls: `Keycap` | `Keycap` in `components/frost.tsx`, raw `kbd.keycap` | cut over: the palettes, chat search, the leader and Settings (editable chords, `SettingRecorder`); `components/frost.tsx` is gone |
| Controls: Spinner, StatusDot (the runtime dot) | the terminal pane's and server settings' `.runtime-indicator` | cut over: `RuntimeIndicator` draws a `StatusDot` wherever it is used (sidebar, dashboards, chat search); the terminal's status is `TermStatus` |
| Frost | `.composer-surface-material`, `chat/composer-surface.ts` | cut over: every frost surface is the library's (pills, menus, overlays, the composer, riders) |
| Nav: `NavPane`, `NavBrand`, `NavGroup`, `NavRow`, `NavFolder`, `NavFolderRow`, `NavNote`, `NavSkeleton`, `NavRail`, `RailButton`, `NavNotice`, `NavLinks` | `navigation/sidebar.tsx`'s own markup and `sidebar.css` | cut over: the sidebar expanded, folded to its rail and as a phone's drawer, its rows, folders, rail, update notice and installers; its right-click menus are the adapter's (`ContextMenu` with `MenuSection`, `MenuRow`, `MenuSub`, radio choices). The keys stay `navigation/sidebar-cursor.ts`'s, on the library's classes |
| Dashboard: `Dashboard`, `DashHeader`, `QuickActions`/`QuickAction`/`QuickMore`, `Group`, `GroupHeading`, `GroupToggle`, `GroupSwitches`, `GroupAction`, `DashRow`, `ChangeRow`, `Counts`, `DashDay`, `DashMore`, `DashEmpty`, `DashNote`, `FolderShelf`/`FolderTile`, `DashPath` | `split.css`, `app-dashboard.css`, `harness-dashboard.css`, `project/dashboard.css` | cut over: the Conduit, project, workspace and harness dashboards draw only these through `dashboard/primitives/split.tsx`, which keeps the behaviour (one column when the measured row needs it, the glide, folding, the keyboard cursor). `GroupHeading` is the strong section name (Geist strong, sentence case, a count in data) beside the quiet section label. A place's working path in its header is `DashPath` |
| Header: `Header`, `HeaderCrumb`, `HeaderButton`, `HeaderNote` | `chat/chat-screen.tsx`'s classic header, `header-pill.tsx` (`PillShell`), the outside-thread chip's own CSS | cut over: every chat, dashboard, harness and Computer page's header (`ChatHeader`); on a phone its lead and actions are frost pills, the ⋯ a `MenuControl`; the chip is a `HeaderNote`. A pane's tab row and a file's header are the Pane and File families' (V2-05) |
| Pane: `PaneTabRow`/`PaneTabs`/`TabPlace`/`PaneTab`, `PaneActions`/`PaneAction`, `PaneEdge`, `DropWash`, `DragPill`, `ToolRail`/`RailRule`/`LayoutGlyph`, `ToolHeader`, `ToolViews`/`ToolView`, `ToolBar`/`ToolButton`/`ToolFilter`/`ToolNotice`, `Tree`/`TreeRow`, `PaneEmpty`, `PaneLoading` | `main.tsx`'s pane tabs and edges, `workspace-rail.tsx`, the dock header, `workspace-files.tsx`'s tree and its `workspace-tree-*` CSS | cut over: every pane's tab row and controls, the split edge and dock edge, drop washes and the drag pill, the workspace rail and its layouts menu, the dock's header and phone views, the Files tree, its filter, actions and folded rail. The tab row reads its gaps from registered lengths (`--tab-gap`, `--tab-place-gap`, `--tab-more`) |
| Source: `ToolLine`, `CommitBox`, `ChangeLedger`/`ChangeSection`/`ChangeList`/`ChangeItem`/`ChangeEmpty`, `CommitList`/`CommitRow`, `PatchLines` | `workspace-source-control.tsx`, `workspace-review.tsx` and their `workspace-change-*`/`workspace-commit-*` CSS | cut over: Source Control's branch line, commit box, staged and unstaged groups, history and patch; Chat review's file list. Rows are `ChangeRow`s (Dashboard) |
| History: `HistoryList`, `HistoryRow`, `HistoryBranch` | `workspace-chat-view.tsx`'s `workspace-history-*` rows | cut over: Chat review's history (timestamps, folded tool runs, side branches), its toolbar a `ToolBar` |
| Terminal: `TermHeader`, `TermLead`, `TermIdentity`, `TermStatus`, `TermContext`, `TermShortcuts`/`TermShortcut`, `TermOverflow`, `TermActions`, `TermState`, `TermError`, `ShortcutForm` pieces, `TermKeys`/`TermKey` | `terminal-pane.tsx`'s header, states and shortcut form, their `terminal-pane.css`/`styles.css` rules | cut over: the terminal pane's header, status, shortcuts row, empty and recovery states and the shortcut editor's form. Its sessions and shortcuts menus are adapter menus; the shortcut editor's list is `TermShortcutRow`s; a phone's key bar under it is `TermKeys` of `TermKey`s (a modifier `armed`) |
| File: `FileView`, `FileViewer`, `FileHead`, `FileName`, `FileGit`, `FileDirty`, `FileActions`, `FileTools`, `FileSuffix`, `FileButton`, `FileMore`, `StatusBar`, `StatusText`, `StatusPicker` | `workspace-preview-*` headers, `WorkbenchButton`/`WorkbenchStatus` (`workspace-workbench.tsx`, gone), `workspace-editor-status` | cut over: every file's header (fitted by the app: `data-compact`, `data-folded`, lowest `data-fold` first) and status bar, in panes and the dock |
| Viewer: `FileImage`, `FileMedia`, `FileCard`, `FileBody`, `FileDivider`, `FileSwap`, `FileScope`, `FileChanges`, `FileEmptySide`, `FileEmpty` | `workspace-file-slot.tsx`/`workspace-file-viewer.tsx` bodies, `file-viewer-*` | cut over: image, media and too-large cards, the editor's host, a viewer's divider and swap, an empty side |
| Editor: the code surface, search bar, annotation popup and comparison pieces in `components/ui/editor.tsx` | `workspace-code-*`, `workspace-search-*`, `workspace-annotation`, `workspace-comparison*.css`, `workspace-diff-shell` | cut over: CodeMirror's surface and find bar, line comments, the review comparison and its navigator |
| Popover: `Menu`, `Section`, `Item`, `Readout`, `SearchList` | `.menu-row` (terminal pane, leader) | cut over: every menu, submenu, context menu and popover is the adapter's (`components/menus.tsx`: `DropdownMenu`, `ContextMenu`, `Popover`) over these; the composer's: the + menu, model, profile and permission pickers, the context breakdown (`Menu wide`), the folder and project pick lists (`SearchList`), the phone's options menu (phone submenus, opened by `MenuPillTrigger` without taking the typing's focus) and the chat header's menu (`HeadingSection`, the context row opening the breakdown in place); a menu is as big as its rows inside its caps (a phone's narrower and shorter by default; `Menu width`, `height` for its own) and the room the adapter leaves it inside the safe area, scrolling past them; the rest with their sections |
| Connection | standalone browser sign-in, native first connection, server selection and recovery | v2 cutover complete; desktop and phone share the Kobalte submenu adapter, with phone layout owned by v2 |
| Overlay, Glance, `Backdrop` | `FrostOverlay` (`frost.tsx`), command menu, chat search, Settings | cut over: the command palette, its pages, the model selector and chat search and Settings, through `OverlayDialog` (`components/dialog.tsx`: Kobalte round `Scrim` and `Overlay embedded`). `OverlayBar` (lead, `OverlayChip`s or `Crumbs`, the field, end, close), `OverlayList managed` of `Section`s of `Item`s (a tree's `opens`/`onOpens`, `indent`, an edit's `picked`, a `reveal`ed end), `OverlayEmpty`, `OverlaySplit` with the preview's `Glance`, `OverlayHints` (an action's hint is its button; `count`) and, on a phone, `OverlayActions`. Settings is `OverlayDialog layout="rail"`: `OverlayRail` (a tablist of `NavRow`s, the About facts its foot, its own close as a phone's screen) beside `OverlayPage` (save status: `busy`, `failed` with `why` and Retry), pages of `SettingGroup`/`SettingLine`; `LiveNote` says what an action did. A phone's drawers (the sidebar, the workspace panel) dim the page with `Backdrop`, one layer under each (`--layer-drawer`, `--layer-panel`) |
| Leader | `navigation/leader-palette.tsx`, `frost-card` | cut over: `Spotlight fixed` and `Leader placement="foot"` (above the composer), `Crumbs` for the levels, `Item keysFirst` rows, `OverlayHints` |
| DesktopComposer | `chat/composer.tsx` (desktop) | cut over: `DesktopComposer` (riders above, state riders `under`, the question as its takeover), `ComposerField` with `Completion`, `Toolbar` (status, aside, primary, `StopGlyph`) and its `Picker`s |
| Rider | queued messages, attachment strip, file references, question card | cut over: `Rider` with `Lines`/`Line` (measures its own clipping), `Chips`/`Chip` (open, retry, remove), `References`/`Reference` (also under a sent message), and the question as a card of `Tabs`/`Tab`, `Choices`/`Choice` (own answer), `Summary`, `Hints`; attachment and review-comment dialogs use the shared v2 `Dialog` |
| Pill, PhoneComposer | sidebar header, `chat/composer.tsx` (phone: the voice bar, a phone's only composer) | the voice bar is cut over: `PhoneComposer` (riders, `Captions`) and `Pill*`; the header's pills are `Header`'s groups |
| Assistant: `LevelMark`, `InboxRow`, `ClockRow`, `DayStrip`, `ReportCard` | the agent page's inbox, feeds and schedules as plain `SplitRow`s | cut over: the agent's page draws its inbox (each entry opening in place to its report), its Timed group (every clock, next first, over its day) and its recent runs' levels from these; a heartbeat's quiet line is `HarnessPrompt` with its icon; the page's main column is jbot's messages (the message log's app room, `DashConversation`: the person's bubbles, jbot's answers, a report as a `ReportCard` opening a reader) over its composer, every group beside |
| Transcript, CodeBlock | `chat/transcript.tsx`, the Markdown renderers | cut over: rows (`TranscriptRow`), the user's `Message`, the answer's `Turn`, `Answer`, `MessageFoot`, `Failure`, `HarnessPrompt`, `Inbound` and `Outbound` (messages in and out), `Changes`, the `RiderButton`s (riding over it: `ride` centre or beside), the empty chat's `Welcome`, the Markdown, drawn by `Answer` through `ANSWER_MARKDOWN` (the renderers' wrappers, tables, links, citations, formulas, streamed words, a wide block's bleed)., the code block (`CodeBlock`, the renderer's highlighted lines grown in place as its children; `codeBlockHtml` for the marked renderer) |

**Shared dialogs and notifications are cut over.** `components/dialog.tsx` supplies Kobalte behavior around the library's `Scrim` and `Card`; `components/notifications.tsx` supplies Sonner behavior around `Toaster` and `Toast`. App callers supply content and handlers. Dialog shell, headings, actions, close controls, fields, spacing and motion come from v2, with no caller surface classes or classic path. The embedded Computer explorer, workspace identity editor, server connection form, camera preview and code excerpt also render v2 components. Their callers keep domain state and engine behavior; `Browser`, `IdentityEditor`, `ConnectionForm`, `CameraPreview` and `CodeExcerpt` own their presentation and tokens. The editable file viewer remains part of the workspace-tools migration.

Internal confirmations and prompts use `createDecisionScope` from `components/decision-dialog.tsx`. Await the answer before changing state. Its shared queue restores focus before resuming the caller, cancels pending requests when its host unmounts, and rejects answers when the caller unmounts or its target changes. Supply a `valid` guard for targets that can change within the same view. Only browser-owned tab-close protection (`beforeunload`) remains native: browsers require their own synchronous safeguard there.

**Large overlays:** a palette or a search is `OverlayDialog` from `components/dialog.tsx` around the library's Overlay pieces; so is Settings (`placement="center" layout="rail"`). `npm run build` rejects a hand-rolled Kobalte dialog or a direct notification call that bypasses the shared adapter (`scripts/check-bundle.mjs`).

| Building | Use |
| --- | --- |
| a palette, search or anything that filters | `OverlayDialog` with `OverlayBar`, `OverlayList`, `OverlayHints` (`placement="center"` for one that does not filter) |
| a confirm, a one-field prompt, a small piece of content | `Dialog` from `components/dialog.tsx` (`alert` for a destructive choice, `size="wide"` or `"large"` for content, `size="split"` with `CardColumns`/`CardColumn` for two flows side by side, each one QR wide (Connect), `close`, `actions`); `CardForm`, `CardBody` and `CardActions` for its form |
| a migrated menu or context menu | `components/menus.tsx` supplies Kobalte behavior around v2 `Menu` and `MenuAction` |
| a pick list anchored to a control | `Popover`/`PopoverContent` in `components/menus.tsx` holding `SearchList` |
| a card that floats without covering the page | `frost-card` alone |

Inside them rows take `frost-row`, keys `Keycap`, the foot `frost-rail`, a shared dialog's buttons `CardActions`; material, dim, radius and arrival come from those pieces and the `--frost-*` tokens, and a surface's own CSS sets only its layout.

# Surfaces

Every surface is one of three materials. Choose it first, before any colour, border or radius.

| Surface | Material | Holds |
| --- | --- | --- |
| **Frame** | near-black `frame` | permanent navigation: the sidebar, the collapsed rail, the workspace rail |
| **Pane** | charcoal `background`, no borders | where you work: chats, pages, file viewers, tools |
| **Frost** | `Frost` | anything that floats |

**The test is "does it float?", not "is it where you work?".** Frost is for overlays (palette, chat search, model selector, leader, menus, Settings, dialogs; where one covers the page, the page dims) and for floating chrome inside a pane (the composer, user bubbles, the header pill, scroll to latest, the attachment strip, a composer takeover), centred on the reading column. Inside frost, content follows the pane's rules: one-line rows, headings and space, no boxes. Never frost a row, a list, the workspace tree or the transcript. Something genuinely new is composed inside these surfaces, not beside them.

**Controls take their look from the surface under them.** A surface sets `--tint` (its lines and washes) and `--well` (the fill under an input or an outline button), and controls read only those. Over frost there is no well: an input there is a hairline with nothing inside. Set `data-surface` on the surface, never a per-surface rule on a control.

**On a phone an overlay is a full-screen bubble** filling the visual viewport inside the status and navigation bars (`--phone-overlay-padding`, never its own inset), with larger tap targets. It stays a dialog, never a route -- Settings included.

# Interaction

One grammar for every list, menu, picker, palette, tab and setting, taken from the sidebar.

- **Rest.** Grey text, muted icons, harness marks greyed with their row.
- **Cursor.** The row under the pointer, under keyboard focus or being pressed takes the `accent` wash and goes white; a harness mark shows its own colour. There is one cursor, only one row at a time, and pointer and keyboard move the same one (`moveCursor`). It never changes weight. On something already washed (a chosen segment) it brightens that wash a step. It stays where it was while the window is in the background.
- **Current.** Where you are -- the open chat and the folder or workspace holding it, the active tab, the current section, the chosen option -- is white at the current weight with a heavier icon stroke, and **no fill**. Open but not where you are (the other pane's chat) is white at the resting weight. Cursor and current can always be told apart.
- **Selection.** Several chosen items are the wash on each. A checkbox column appears only in an explicit edit mode (chat search's Edit).
- **Never** focus rings or outlines, from the browser or a component, in any colour; coloured bars or slivers; boxes round a row; a tick for the current choice. Keyboard focus is the wash.
- **Fold, don't squeeze.** Controls keep their size. When a row of them stops fitting, the least used fold, last first, into a ⋯ listing only what folded; what must stay (a title, the active tab) truncates only once nothing is left to fold. The fold point is measured from the controls, never a tuned px width.

# Colour

The app is locked to `.dark`; the light tokens in `styles.css` are leftovers, never paint them. The charcoal is cool-neutral at chroma ~0.005, and that grey is the brand: do not raise it to "read as blue".

- **Near-monochrome.** Muted text for timestamps, hints, empty states and icons at rest. `border` hairlines for inputs, a header or footer rule and dividers; grouping is a heading and space, with at most one hairline between groups, never a box or a fill. `card` solids are left on tool cards only. `primary` is the one bright action.
- **Hue only for state:** `destructive` for errors and destructive actions, `live` and `warn` as small dots and glyphs (never fills, rails or washes). Workspace glyph colours and git dots are data, kept on the glyph.
- **No blue anywhere** -- not for selection, focus, links, status, audio, waveforms or "active" surfaces, and no `--accent-cool` or slate tint. Connecting states are muted; success is foreground or `live`. Two exceptions: syntax highlighting inside code, and a status dot's own colour. Leftover blue (`--accent-cool` in `project/dashboard.css`, `styles.css`, `sidebar.css`) is removed when touched. It is frontend-design skill output: don't follow that skill's urge for a signature accent colour; frost is the signature.

# Typography, scale and shape

- **Faces.** Geist Variable for UI; Paper Mono (shipped) for section labels (the same on a phone, at its unit), keycaps, data (model ids, paths, times, counts) and code; Meslo Nerd Font for the terminal, the one face the user is expected to change. No serif but the first-launch wordmark. Tabular figures wherever numbers tick or line up.
- **Roles, not sizes.** Five sizes (`--text-label`, `caption`, `row`, `body`, `heading`) and five weights (`--weight-light`, Paper Mono data that sits under a heavier line; `--weight-rest`; `lift`, for text over frost, which reads thinner; `strong`, for titles, buttons and values; `current`, for where you are and a match lit while typing). Every section heading is the section label: Paper Mono, uppercase, letter-spaced, muted. Meta is muted mono beside a row's title, right-aligned, truncating before the title does.
- **Everything is drawn in the density unit** (16px on both densities; the desktop's was 12.8px until the app stopped living at 125% zoom) times a scale: the user's **Interface size** (Settings · Interface, `--ui-scale`, the one control they get) times the **region's size** (`--scale-<region>-<density>`: chrome, sidebar, frost, composer, transcript), which we tune so the regions sit right against each other (gallery Space · Scale). Browser zoom is never the app's scale. Gaps are one of the `--space-*` steps, controls one of the `--control-*` heights, icons one of the `--icon-*` sizes, and a width of its own (a card, a column, an overlay) one of the `--measure-*` lengths, and a column's room from its pane's edges `--page-gutter`. Lines are `--hairline`, `--stroke-thin`, `--stroke` or `--track-size` (whole pixels, never scaled); line heights a `--leading-*`; text falling back from the foreground a `--tone-*`; a faded part an `--opacity-*`; an effect's time a `--duration-*`. Rows keep a finger's height on a phone (40px floor: full width, so the finger has the width), and a popover sits `--popover-gap` from the control that opens it. An offset that lines something up is worked out from what it lines up with. Never a one-off multiplier or a px gap.
- **Radii.** `--radius-control` (rows, buttons, inputs, chips; `--radius-inset` nests it for keycaps and inline code), `--radius-surface` (popovers, cards, overlays: the control's plus the inset, so rows nest), `--radius-message` (the composer and the user's message: under half a one-line bubble's height, so one line is a rounded box, not a pill), `--radius-round` (pills, which never grow, and small round bits), and the pane's. Do not round section titles or metadata.
- **Icons** are Lucide, muted at rest, one size per context; a stroke a tenth of the icon's size, an eighth when current. Harness marks and the context gauge draw their own. The composer's + and mic wear the text colour, as live actions.
- **Depth.** Panes and lists have none. Frost carries it: one material, resting or raised (`data-lift`), never redeclared per component. No stacked shadows, coloured glows, mesh gradients or SaaS card grids; the voice composer's Aura is the one allowed colour field.
- **The top line.** The sidebar header and every pane header centre on one line. A chat's breadcrumb names its place in caps before the title, with no slash; a page that is a place has no crumb.

# Motion

Motion explains a change of place. A surface that does not change place does not animate.

- **Quick out, gentle in.** Leaving is `--duration-quick` on `--ease-leave`; arriving is `--duration-gentle` on `--ease-arrive`; a change in place is quick on `--ease-change`; panes easing to new widths beside each other start from rest on `--ease-settle`. A move is a fade, a rise, a drop back the way it came, a grow or a slide (`styles/foundations.css` keyframes). Effects that are not moves (the copied wash, a breathing mic) keep their own time.
- **Leave the way you came, then arrive.** Something of the bottom edge leaves downward; a panel leaves toward its control's edge. The outgoing surface goes first; they never cross-fade in place.
- **Transform and opacity only**, except a Disclosure unfolding, an unfolding menu's edge, pane widths easing, the composer across a layout switch, and the phone composer's pills.
- **The invariants every piece's moves keep** (`styles/foundations.css`): parts stack in one order in every state; one transition list per part, states setting only values; room opens before a part fades in and goes after it fades out; two parts never share a spot at once; a change is one move from its first frame; a frost fades itself, never through an ancestor. A new state fits these, never an exception: state them per piece and check every pair of states, not one-off fixes.
- **Hold the reading position.** A swapped surface keeps its room while away; the transcript moves only through its tail spring.
- **The first open settles, then shows.** Only the frame shows until every pane's document is laid out and holding still; then every region fades in once, with no rise. Nothing arrives or moves after the fade starts.
- **A send moves at once.** A new chat's first message, or one sent from a dashboard, takes the composer to the chat's foot in the frame the layout changes.
- **Cards belong to the composer.** Queued messages and attachments rise out of it and drop back into it when it takes them; removed by hand, a card fades in place. Anything keyed for animation is keyed by identity, so an update never replays an entrance.
- **A layout switch** happens in the frame the width crosses. Nothing crosses the pane: a section that changes place fades in where it now is; the composer alone eases to its new column. Both layouts share their gutters.
- **Floating controls follow.** Anything anchored to a surface is re-measured when that surface is swapped or lands.
- `prefers-reduced-motion` drops the move and keeps the end state (the meteor field excepted).

# Layout

Desktop is a darker frame with inset rounded panes; the frame's margin is also the gutter you drag. Mobile drops the inset and goes full-bleed, with safe-area padding on edge controls. Layouts change at widths measured from their content, never a tuned breakpoint.

- **Chat.** The sidebar on the frame; the chat in its pane; the workspace rail on the right and, when open, the dock -- a second inset pane showing one tool at a time (Files, Source Control, Chat review, Terminal), not a floating card. Answers fill the reading column with no bubble; the user's message is a frosted bubble at the right; the composer floats at the foot in frost. A phone keeps the tools as tabs in the dock's header.
- **Dashboards** (Conduit, project, workspace, harness pages) are one layout (`dashboard/primitives/split.tsx`): a header with the place's mark, name, a one-line muted status and quiet quick actions -- only verbs nothing else on the page offers; managing the place lives in its ⋯. Below, the composer with the chats under it beside a narrower column of places and state, each scrolling on its own; one column when narrow. On a phone, sections fold under their headings, filters fold into one Filters menu, and the composer docks at the foot. No hero of metric boxes.
- **The Conduit dashboard is the new-chat screen**, the composer focused; a new chat in a place lands on that place's page. Where a chat lives is chosen from the composer's place button.
- **The chats list is one component everywhere** (`primitives/chat-list.tsx`), scoped to where you are, rows grouped by day. Empty lists read "Nothing here yet." with no action of their own.
- **Untracked threads.** A harness's own thread that no Conduit chat owns is still a whole chat page, hidden from Conduit's lists, with a pill offering Track.
- **Palettes** (command palette, chat search, model selector) pin near the top so filtering shrinks them from the bottom. One search row: a leading mark, chips for scope or view (`in:Japan`; Backspace on an empty query removes the last, Esc steps out), the query, a quiet close. A drill-down puts Back in the header, never a Back row. Rows are one line, keeping their groups, best match first; typing lights the matched letters. Chat search previews the highlighted chat beside the results once the cursor rests. A footer rail of the view's actions and its keys; on a phone, a bar of buttons. `docs/design/palette-sketch/` is the reference.
- **Settings** is a centred frost overlay whose rail is drawn as the sidebar is (on a phone, a screen of its own). It saves as it changes: no Save button; the header says Saving, Saved, or Not saved with Retry; a value not valid yet says why under its field. Credentials and one-off actions keep their own buttons.

# Panes and windows

The panes smoke and `test/file-tabs.test.js` assert these; a change to a rule changes its test.

**Documents and room**

- **A pane holds one document** (chat, page, file viewer, tool, shell). Pane A holds the route; panes beside it are opened, never navigated to.
- **A document declares its minimum width** (chats and pages `MIN_MAIN_PANE_UNITS`, viewers and tools `MIN_SPLIT_PANE_UNITS`, in the unit so they grow with the Interface size; the dock takes whatever it shows). Containers lay out from those, never their own guesses. A desktop window too narrow for the sidebar beside a chat at its minimum scrolls sideways; the chat is never drawn narrower.
- **Room runs out in one order.** The dock narrows first, then panes move to the dock, last first, document and state kept, and come back when the width holds them. A dragged edge takes room from its neighbour down to its minimum, then the next. Up to three panes, with Equalise and presets at the rail's foot; not on a phone.

**Focus and opening**

- **One pane has the keyboard**; a click anywhere in it gives it. Everything that acts "here" acts on it: the palette, the leader, the model selector, the composer's keys and dictation, the dock's Files. Ctrl+Shift+2 and Alt+Shift+[ / ] go round panes, landing where each one's focus last was; Alt+[ / ] step tabs. In a pane with columns, the current column receives what opens.
- **One verb per modifier** from every place you open from: plain replaces what the focused pane shows, Ctrl keeps it as a tab, Alt opens it beside (a new pane when the width holds it, else the neighbour) and leaves the keyboard where it was. A document is open once; opening it again goes to it.
- **A pane says it is loading**, never shows an empty chat meanwhile. Opening a chat hands focus to its composer; a file viewer takes the keyboard once its editor has drawn, unless focus has moved.

**Tabs**

- **A pane of chats or a viewer's column holds documents as tabs**, its header the tab row; a lone document is a row of one. Where you are is text alone: the active tab at the current weight with its ×, the others grey.
- **Switching moves nothing**: tabs keep their order and their bold width; drafts and scroll are kept per document.
- **Chat tabs group by place**, the place named once in caps. A full row drops the tab used longest ago, never the one showing or one with a draft; closing the active tab goes to the one used last. Headers fold, then truncate.
- **A file viewer can stand empty** ("No file open") and split into two columns; a chat pane cannot stand empty.

**Dragging, the dock and the window**

- **Anything that opens can be dragged**, and a drop says what it will do: the target washes the band it lands in and a pill names the result. An edge opens a new pane; the middle replaces, joins as a tab, or swaps two panes; a drop that would do nothing does not wash.
- **The rail opens the dock**, one tool at a time; pressing the open tool closes it. Files follows the pane with the keyboard. Tools open in the dock by default; Alt or dragging opens one as a pane. Any pane can move into the dock (its header, the leader's D, or dragging) and back, keeping its document, state and tabs, with a rail icon of its own; pane A docks only while another can take its place. The dock sits beside the panes or over them, per device.
- **A pane's swap and close** sit once at its right edge.
- **The layout is in the address**: every pane, tab and column is in the URL; Back restores it, a copied link reproduces it.
- **Resizing holds the content still.** Pressing a handle moves nothing, not a pixel. While dragging, a transcript keeps its shape and slides to stay centred until it would clip, then reflows keeping the reader's place; releasing lays it out once.
- **Panes ease; documents don't travel.** Opening eases the others to their new widths, then fades the pane in; closing fades it out, then the rest ease into its room; a swap holds both panes' last frames until loaded, then crossfades. None of this on first load, Back, a phone or reduced motion.

# Keyboard

One model for every surface, so no surface grows keys of its own.

- **Regions.** The app is a tree of regions following focus; shortcuts resolve innermost first, then outward. Ctrl+Shift+1/2/3 go to the sidebar, the panes and the dock, opening and focusing, never closing; Ctrl+B and Ctrl+. stay plain toggles.
- **The leader** (Ctrl+G, then a key) acts within the current region, innermost first, and lists only keys that would do something. Numbers inside a region mean positions, never other regions.
- **Lists:** ↑/↓ move skipping headings, Home/End, →/← into and out of a level, Shift+↑/↓ extends, Menu or Shift+F10 opens the row's menu. ↑ from the top reaches a segmented switch above.
- **Tab** is one stop per section, landing where the cursor last was; entering a page puts focus in its composer. **Enter** acts. **Esc** steps outward a level at a time and always gets back to the composer. A key on a bare pane goes to the composer or the list.
- **New global chords** go in the settings shortcut manager; every scoped key is findable in the leader under its region.
- **Held focus.** A region reached by a go-to shortcut shows a thin `ring` line along its bottom edge, the rest dimming briefly; it stays while focus is in it or nowhere, and goes when focus reaches another region another way. A click or Tab never lights one. Not on a phone.

# Transcript

**Nothing moves once drawn**, at every width and pixel density:

- Every block holds its real height before it is drawn, so scrolling back or a reload's fade moves nothing.
- Starting or ending an interaction (pressing a handle, opening a panel, hovering) shifts no text, not even a device pixel.
- Only the reader (opening a trace, a resize) and the tail spring following new content move an answer.

A "sizzle" -- text that shifts and settles -- is a broken rule: find the structure that changes geometry, not a delay that hides it. docs/TESTING.md has the probes.

## Rhythm

The room above a part is set by how it relates to the part above it, never by what either is. Six relations, each a
`--flow-*` token (Space › Flow), each a step looser than the last, so a change of kind never reads as a paragraph:

| Token | Relation | Example | Units |
|---|---|---|---|
| `--flow-line` | lines of one block | list items | 0.125 |
| `--flow-work` | lines of work in rows of their own | reports that landed under the trace before them | 0.125 (the trail's gap) |
| `--flow-attached` | belongs to the part above | a foot under its answer or bubble, an approval under its trace | 0.375 |
| `--flow-block` | blocks of one text | paragraphs, headings, tables (`--answer-gap`) | 0.75 |
| `--flow-step` | the next part of one reply | text to a trace, a trace to text, the answer under its trace | 1 |
| `--flow-answer` | an answer under the work it came from | "While that ran…" under Reported; Folded's answer under a trace that did something | 2 |
| `--flow-exchange` | a reply under its message | the first row of a reply | 1.25 |
| `--flow-turn` | one exchange to the next | a reply's foot to the next message | 2 |

- Parts carry no outer margin; the transcript gives the room. Drawn row by row, each row says its relation
  (`TranscriptRow flow`, worked out from the row above: a message -- the person's or one the harness sent -- is a
  `turn`, the row after one an `exchange`; reports under work are `work`, an answer (not commentary) under work is
  `answer`; anything else in a reply a `step`). Composed of parts, the parts do.
- A line's last glyph ends on the column's edge, as the bubble's and the answer's do: a line's wash bleeds past the
  column by its padding at both ends, and a step's chevron (hover, open) takes the place of its time, which steps aside.
- Folded and Narrated share it: Folded's answer is a step under its trace; Narrated's every change between text and
  work is a step.
- The tokens are in the unit, so they follow `--scale-transcript`; phone and desktop are the same rhythm.

## Turns: segments, narration and the frontier

One model draws every turn, a chat's and jbot's alike; they differ in one policy, not in renderer.

- **A turn is segments, in the order they came:** *reasoning* (the model's own thinking), *text* (prose it wrote) and *activity* (a run of tool calls with no text between them). Text is either *commentary* ("I'll check your calendar": the model talking as it works) or the *final answer* (the text after the turn's last activity). A provider that labels its text says which from the text's first word; Conduit carries that label (`phase`: `commentary` | `final_answer`) on every text block, live and saved, and the transcript places text by it.
- **The one policy is who commentary is for.** `fold` (Folded): working-out, for the model -- it goes into the turn's one trace, and the final answer alone stands in the transcript (a chat's default). `show` (Narrated): addressed to the person -- every text stands in the transcript in order, with a trace per activity run between them (jbot, and what most chat products do). Reasoning folds under both.
- **A step says what it did, on what, in its kind's face.** Icon, verb, subject, then what qualifies it (the *aside*, quieter and the first to give way: `on shirakawa-go.gr.jp`, `and 2 more`, `in src/client`, `lines 120–180`), and at the end an edit's lines added and removed in the data colours, then its time -- only from a second, since a column of `2ms` beside every read says nothing. A query or a page is prose (a query in quotes); a command or a file is code. `site:` is where a search looked, not what it looked for. An edit opens to its changed lines (`StepDiff`), not its tool's input; open, a trace's latest line hides, the trail being it. A script is said as its calls (`Checked Gmail “in:anywhere”`, `and 2 more`), counted by what they were (`2 reads, 1 search`, never `4 scripts`); a connector write is `Requested`, true whether it ran or only asked. The adapter states this (`ToolFacts` on `tool.open` and on a script's calls: verb, kind, subject, aside, changes), from its own harness's input shapes; the browser never parses a tool's input.
- **The trace is the frontier, not a container.** Only a turn's last segment is live. Under `show`, an activity run between texts that is one step is that step's own trail line (icon, verb, subject, its time). A run of several is one disclosure, closed, worded as Folded's header: live, what it is doing, its time, its counts and its latest step (`Searching · 12s · 3 searches, 2 edits`); settled, what it did and its time (`9 edits, 7 searches, 5 fetches · 2m 23s`), nothing under it. It opens to the same lines Folded's disclosure lists, so the two views never describe the same work differently. The orb sits beside the live run's first line (`TraceOrb`), never in its header; the text draws below it, and the next run opens under that. Done, Interrupted and Failed say how a whole turn ended, so they head a turn (Folded's one trace), never a step. Under `fold` the same frontier absorbs commentary instead of leaving it behind.
- **The orb is Folded's.** A Folded turn's orb sits on its trace header, in the gutter: what the turn is doing, and how it ended. Narrated has no orb: what it is doing is its trail's live line (a spinner on the step, "Starting" before anything has shown). Copy, regenerate and the time belong to a turn's last answer only, never to narration.
- **Nothing is reclassified on screen.** What text is depends on what the stream can say, and when. Measured 2026-10-30 through pi-ai (`ModelRuntime.streamSimple`) on one multi-step tool task (calendar, then weather per place, then advice):
  - *Phased* -- OpenAI Responses (`gpt-6.1-terra`; the OpenAI, ChatGPT-login and Azure providers alike): every text is labelled `commentary` or `final_answer` when its message opens. pi-ai carries it in the text's `textSignature` (`TextSignatureV1.phase`) but set it only at `text_end`; `conduit-web/scripts/patch-pi-ai.mjs` (run on install) sets it at `text_start` too, until pi-ai does upstream. Reasoning summaries come and go (pi-ai asks for `summary: "auto"`): none in four calls at medium, one short line in four at high; the GPT-5.6 models sent them most calls, and wrote little commentary.
  - *Typed, narrating in text* -- Google direct (Gemini 3.5 Flash: a thinking summary every call, then text, plus an empty text part after each tool call), Gemini via OpenRouter (reasoning signature-only, no words), Muse Spark (summary on some calls, signature-only on others), MiniMax M3 (full reasoning, then text). Text carries no label: it is narration once a tool call follows it in the same message, the answer once the message stops without one.
  - *Typed, narrating in reasoning* -- DeepSeek V4 Flash, Qwen3 32B, Nemotron 3.5: no text at all until the answer. Told to say what they are checking, they say it in reasoning. Under `show` such a turn is its traces, then the answer.
  - *Untyped* -- reasoning in the content as `<think>` tags: not seen. OpenRouter hands reasoning on its own channel, which pi-ai makes thinking. OpenCode Zen's completions endpoints are untested (its key had expired).

  So reasoning is optional on any call, even one model's (`thinking` with no words but a signature is "Reasoning not shared by the provider"), and a turn may have no narration in text at all.
  The adapter says each text's label as soon as the block has it, before its first word (an `assistant_content` delta carrying `textPhase`), and a saved message is commentary unless one of its texts is the final answer; nothing provider-specific reaches the browser. It reads labels through pi-ai's own shapes (`TextSignatureV1`, a message's `stopReason`, its content parts) rather than per provider. A labelled text is placed by its label from its first word (`textBlockClassifications`): under `fold` commentary goes straight into the trace and never draws as an answer. Unlabelled text is *pending* until its message shows what it was, and the policy decides only where pending text draws. Under `show` it draws as text at once: commentary and final answer look the same, so learning which it was changes nothing. Under `fold` it streams as the final answer, and folds into the trace when a tool call starts in the same message (per message, never across the turn) -- a brief draw-and-take-back, measured from first words to the tool call's start at 0-0.25 s on Gemini, 0.2-0.3 s on MiniMax (OpenAI, before the label: 0.2-0.7 s). Holding unlabelled text back until its message ends would end the flash only by losing the streamed answer. Untyped reasoning under `show` reads as commentary, so a model that streams its thinking as content is better under `fold`; which providers offer `show` at all is per provider. Reasoning summaries come on their own channel on every provider measured, so they never draw as text.

- **Answer.** Markdown with no bubble at the body role, in a gutter the composer shares. One gap between blocks and none outside the first and last. Wide tables and code may grow past the column up to the composer's gutters, centred, then scroll inside themselves; the page never scrolls sideways. Links are the text colour with a muted underline; everything else is monochrome but code's syntax colours. The transcript's scrollbar is hidden; panes that scroll as ledgers keep thin thumbs.
- **Formulas.** A display formula is centred; one wider than the column starts at its left and scrolls, never clipped at both ends. Inline math sits on the baseline at the text's size. Partial TeX never shows raw, and a drawn formula never blinks out.
- **Code blocks** fold when long (a fading cut, a foot saying how many lines it hides); the caption stays pinned while the block scrolls by. **Copied** turns Copy's icon to a check and washes what was copied with the tint, fading -- never a ring or a toast.
- **Streaming** appears at a steady pace, not in network bursts; the optional fade is opacity, never colour. An answer's actions and time wait until it has finished appearing. A stopped answer inside a formula draws what was written of it.
- **Message time** is a muted caption at the head of the message's action row, never a line of its own. The row's time and actions (`MessageFoot`) show while the message's row is hovered or focused, on the latest exchange (the person's last message and the last answer); on touch, the latest exchange's and an older message's once tapped (its bubble or plain text; a link, code or control keeps its meaning); its status and Changes always show (a trial since 2026-11-01).
- **Trace.** Every activity run has a trace header (under `fold`, a turn's one run), live and settled: the orb when it is the frontier, then `Status · time · work`, and the trail's latest line under it, held open while live. A turn starts as its header. A turn with no thinking or tools is its first line alone. A stopped turn is one row: Interrupted, with discarded text struck under "Not kept".
- **Thinking orb.** Its motion says what the turn is doing; changes hold briefly and crossfade, so bursts don't flicker and no frame is empty. Settled, it turns slowly for Done and sputters in `destructive` for Interrupted and Failed. Every orb shares one frame loop; reduced motion is a still frame. A turn's own orb hangs in the gutter on desktop; a phone has none, so it takes a line of its own above the latest generation and never indents its text. Frames: `docs/design/orb-catalogue/`.
- **Trace trail.** The opened trace: one light line per step, no boxes; repeated steps of one kind are one line; any line opens in place to its output or text. A call a codemode script makes is drawn as the same call made directly -- the same line, agent row, approval or notice: how the model chose to express it never changes what the person sees.
- **Hung marks.** Every line of text a turn writes starts on the column's edge: the answer, commentary, a step's verb, an agent's task, an envelope's sender. A row that starts with a mark (a step, an agent row, an envelope) hangs the mark in the gutter (`--mark-hang`: the mark and its gap); the turn's orb hangs beyond it. Rows inside a fold keep their marks in the column, one indent under the fold's head. A phone has no gutter: its marks stay in the column. Where a narrow pane makes the turns step in for the orb, envelopes step in by as much, so every row keeps one edge. The transcript's text column is the composer's width, edge to edge (`.ui-chat-column` has no room of its own beside the text); what hangs, hangs past it into the pane. Narrated turns never step in (no orb to make room for); a Folded turn steps in only where the pane has no room for its orb.
- **Riders: message above, state below.** Riders about the message being written ride on the composer's top edge: queued messages, attachments, references, the voice, the question (which takes the composer's place). Riders about the state of work under way sit below it, in `DesktopComposer`'s `under` row: the agents running (`AgentRider`), in three lists under Paper Mono labels, Foreground (what the turn waits for), Background, then Runs (`AgentRiderGroup`), only while something runs (a rider is what is current, never a history). Room motion: the under row opens its room as a rider comes (the composer, and a transcript following the bottom, glide up) while the rider fades in; a going rider slides down and fades, and the room closes behind it, the composer following it down. A row or list in the rider that ends closes its room the same way, and a takeover taller than the composer closes its room as it goes. Nothing is squeezed, and room that closes under something following it uses `--ease-room` (even at both ends). A phone keeps them above: its bottom edge is the keyboard's and the home bar's.
- **Subagents: branch and join.** A subagent is not a tool call; the calls are its two ends, the spawn where it branches off and the answer where it joins. Agents are drawn on one kind of line (`AgentRow line`: mark, id, task, how it is, time), and agents taken together on one quiet line that drops down theirs: a turn's foreground agents, which it waits for, are one live `AgentRow`, or one `AgentDelegate` line ("Delegated · 3 agents") for a fan-out; background ones are an `AgentSpawn` line where they started ("Started bg-1, bg-2", how they are doing taken together, Report to jump to the answer), the composer's `AgentRider` while they work, and an `AgentReport` line where the answers landed ("Reported bg-1, bg-2", reports that came in one after another are one line, each agent's answer under its line, Started to jump back). Every agent has an id, `fg-N` for a turn's own and `bg-N` in the background (`sa-N` in older chats), so one place names them all. A run enters from outside, with no Started line: a `RunLine` marks where its report entered, whether it woke the agent or stayed quiet. While it works it sits in the rider's Runs list.
- **Messages in and out.** A thread is drawn as the agent had it: nothing it was given or sent is hidden or reworded.
  Anything that crosses the thread's edge other than the person's own words is an envelope (`Inbound`, `Outbound`), at
  the left: a header of who and when (the sender's mark, its name, what it was, the time, Open when it has a
  transcript), then the text on a hairline rule hung from the mark, folding past 8 lines.
  - *In*: a prompt the person did not write, exactly as the agent received it -- a run reporting back (its routine's
    mark and name, its id and how it ended; Open run), Conduit saying how an approval was answered. The text is muted:
    it is what the agent reads, not what it says. What Conduit added to it for the agent sits apart, labelled "Conduit
    added", at caption size: the stop, update and time notes before the text (and before the person's own bubble,
    at its side), the decision a report asks for after it.
  - *Out*: what the agent sent the person outside the thread (a `message` tool: a notification now, messages later),
    in the text colour, as its own row after the work it ended -- never a line inside a disclosure.
  - A **harness prompt** with nothing more to read (a background task finishing, a heartbeat's quiet line) stays one
    muted line with its mark, no bubble and no actions. A line the agent was never given says so after it ("never
    sent to the agent"): the thread shows only what the agent had, or says when it does not.
  - *Context*: what the agent was given besides messages is a step, never left out -- the system prompt a thread
    opened with, above its first message (its pieces and how many tools); each later change in the trail where it was
    given (a section such as jbot's inbox or files, the tools that were added, removed or changed by name, "System
    prompt changed" when it was edited), a compaction's summary. The step names what changed; opened, each piece's
    text under its name, fetched then. Every runtime chat has them, not only jbot's.
  - A run's report and a notification start as their header line (who, what, when), opening in place to the text.
- **Disclosure.** Everything that folds is one piece: a header, one turning chevron, a body that unfolds in height and folds to nothing. Opened at the tail, it lets go of the tail rather than being chased.

# Pieces

What each kind of piece does; how it looks is its gallery family.

- **List row.** Follows Interaction exactly. In the sidebar the current row and the folder or workspace holding it are white at the current weight, so where you are reads up the tree. A pinned row looks like its unpinned row. A sidebar action is a row, not a small button by a heading, and is also on the collapsed rail.
- **Menu.** A section label, then one-line rows: an optional mark, the title, muted meta at the right, trailing actions that appear on hover or focus (always on touch). One footer action ("+ New …") under a hairline. Use a popover rather than a menu when rows hold inputs.
- **Unfold.** A menu row that opens what it holds in place (the chat menu's Context and Details, the gauge's parts): its section grows under it on the fold (Expand), the menu's edge running with it, up to the room the menu has before it scrolls; shut, it gives the height back. Nothing inside an unfolded section draws a rule. Used where a submenu has nowhere to go (a phone), never for a choice.
- **Reading.** What a gauge measures, read at a glance: the bar, then the session's lines -- its totals, the parts as a legend (a dot, a name and a share), the cache, and where it compacts beside Compact now; last, the account's figures (a plan's windows) as tiles under their name. All at the caption's size, numbers in the data face, so nothing outweighs the bar. It reads as the menu opens, before it is unfolded.
- **Choosing in a menu.** The current choice is bold, not ticked. A choice not available here is dimmed and struck through, with no note. No Manage rows: settings are reached from Settings. A menu over a long list starts with "Search all …", which opens the matching palette. It stays open when the follow-up is in the same menu. Ordered choices are a slider whose label opens the levels. A pick list that is not a menu still uses menu rows, the search keeping focus while the arrows walk them. Something edited in place is an inline form in its row; a one-field rename is a dialog. A tap ends where it lifts.
- **Dialog.** A narrow frost card over the dim, centred, small on a phone too. The title and the choice, nothing else: no line repeating the title; a detail only when it asks something; a one-field prompt drops its label. An input is a hairline that brightens on focus. The primary action a white outline, the others a ghost outline, a destructive confirm filled red.
- **Settings list.** The sidebar's language, not tiles: section labels over one-line rows, no box, no dividers between rows, one light hairline between groups. A value is quiet (a select is its muted value and a chevron); descriptions go in a title. Every row's control sits in one column of one width, and the name truncates before the control. Buttons are ghost unless they are the one action waiting. Focus anywhere in a row is the row's wash. On a phone a line keeps its name and its control on one row: the page runs nearly edge to edge, a field shrinks (to a third of its column) before the line wraps, and a title gives way with an ellipsis; a chord, a link or a status never wraps.
- **Segmented choice** for two to four named peers; a long or open list stays a select. **Switch** for on or off; a checkbox is for choosing items, not settings.
- **Composer.** Controls in tiers by how often they are reached for: the model and the primary slot at full weight, settings showing their value muted, folding into the + as the composer narrows, least used first, and coming back exactly when they fit. The primary slot is one fixed button: Send, Stop while the agent works, Send again with Stop beside it once a draft is typed. Nothing in the row is a white filled button; recording, the mic breathes, with no fill, ring or colour. On a phone: +, the draft, mic and the primary slot, every setting in the + menu.
- **Takeover.** Anything the agent is blocked on (questions, approvals, choices) replaces the composer in its slot rather than stacking above it, and never scrolls inside itself. One question at a time, several as tabs ending in a Submit tab that summarises them; answers are numbered one-line rows, a typed answer last. It takes the keyboard (arrows, a number or Enter chooses, Tab turns the page), and Esc dismisses (a dismissed approval is a denial). A single question with a single answer skips the tabs.
- **User bubble.** A message being edited goes muted and italic in its bubble with no outline, and a frost "Cancel editing" pill floats above the composer.
- **Attachment strip.** Every attachment for the draft in one short strip directly above the composer: images as thumbnails, files as chips. Remove on hover or focus (always on touch); uploading a thin ring; failed a red outline with retry. More scroll sideways, fading at the edge.
- **Toast.** One sentence about what just happened, never a second line or a title: its kind a glyph in the state's colour, at most one action, a ×. Bottom right on desktop, the top on a phone.
- **Leader menu.** What Ctrl+G can do from here, shown after a pause: a small frost card above the composer, the page dimmed but the current region. The region path along its top, rows with keycaps at the left, the go-to chords in its rail.
- **Pane header.** The document's name or tab row at the left; its modes as a segmented switch; quiet ghost controls at the right in the order they are reached for, folding into a ⋯; the pane's swap and close last.
- **Workspace rail.** Mirrors the sidebar's collapsed rail on the right edge: one icon per tool, the dock's tool current; chat search and the palette below a hairline. It is out of the tab order; the tool keys and Ctrl+Shift+3 reach the dock.
- **Harness mark.** Greyed with its row; its own colour on the cursor or the current row. Live activity or an unread reply shows in its place first.
- **Runtime dot.** Colour on the dot only, a label only when it has something to say, a spinner in its place while busy, one per surface, worst state first.
- **App icons.** Only platform-required assets, derived from `public/favicon.svg`: the release C white on black, every dev build inverted; the Windows caption keeps the icon but no text. The Conduit mark is `public/brand/conduit-mark.svg`.

# Intentional exceptions

- **Phone header pills** -- buttons sharing a pill are capsules narrower than tall, concentric with it -- several controls read as one floating object over the transcript.

# References

- `docs/design/palette-sketch/palette-sketch.html` -- chat search, the command palette and their states (serve the repository root).
- `docs/design/orb-catalogue/contact-sheet.html` -- every thinking-orb frame and which state uses it.
- `docs/design/dashboard-layout/`, `docs/design/conduit-home-dashboard/` -- the dashboard sketches.

## Context: blocks, documents, roles

What every thread Conduit starts is given, in three words (Settings › Prompts and Blocks; `conduit-web/src/context/context-store.js`).

- **Block**: one named piece of context. *Text* blocks are editable: a profile's own lines, the shared base, a skill, chat naming, the web tools' instructions, jbot's run rules and each routine's instructions (files in jbot's folder, which jbot can change too), blocks the person makes; jbot and run blocks may use `{{slots}}` (person.name, assistant.name, timezone, now), listed with their values in Blocks. *Live* blocks are templates Conduit fills when the model runs, read-only: each written out in the tags the model reads it in (`<cwd>`, `<codemode>`, `<agent-memory>` with `<soul>`/`<user>`/`<memory>`/`<diary>`, `<agent-inbox>`) with `{{slots}}` for what changes, shown beside how it stands now.
- **Document**: the whole context a role starts a thread with: its text blocks in order (reorder, swap, add, remove), then the live blocks Conduit adds, then -- for a run or a subagent -- the first message. A block sits in any number of documents; edited once, it changes in all of them. The runtime assembles every prompt from its document, so the page is the source of truth.
- **Role**: what a document starts a thread as: each profile, jbot, each routine's run, the default subagent, chat naming.
- **Slot**: a `{{name}}` Conduit fills. *Fixed* slots (`person.name`, `person.home`, `assistant.name`, `timezone`) fill system-prompt blocks when a thread starts; a later change reaches the thread as an update notice, never as an edit to its prompt. The *current* slot (`now`) is never in a system prompt; it travels on notices.
- **Notice**: a whole message Conduit writes into a thread on its own: a run's wake (routine, check-back, event, webhook), a report (a run's, the brief's, a background subagent's), an approval result, jbot steering a chat, and the short stop, update and time notes put before the next message in one `<conduit_note>`. Each is a block (wording editable, slots and what Conduit appends fixed); a document lists the notices its role receives, drawn in the chain with an inbound mark under "Notices it receives". The full list and what each carries is in docs/plans/persistent-agent.md, "Slots, tags and notices".
- **The prefix is append-only.** pi-durable keeps the prompt and each section where it was sent and appends only what changed, and every request asks for long cache retention; so nothing that changes per turn (an age, the clock) goes in a prompt or a section. What changes arrives later, as a notice.
- **Prompts** and **Blocks** are both Workbenches (below). Prompts: the document as the title (reset beside, the role under it); the side column its `ChainMap` -- blocks numbered in reading order, then under "Conduit adds" what Conduit places (live links dashed, with their tag), then "First message"; the pane the chosen block, read-only, its bar holding edit, move up/down, swap and add after (`Select look="icon"`), remove; a live block switches Template | Now there. Blocks: the block as the title (New block beside, where it comes from under it); the side column its name (your blocks), the documents it is in (each opening in Prompts) and the `{{slots}}` it can use with their values; the pane its text, edited, Save in the bar (Mod-S), reset and delete beside. Sizes in tokens (four characters each).

## Settings patterns

What these pages settled, for every page that follows.

- **Workbench** (`components/ui/workbench.tsx`): a page that works on one thing at a time. Its title *is* the thing -- a `Select look="title"`, pressing it chooses another from the same searchable popover -- with its actions as icon buttons beside and what it is in one quiet line under. `WorkbenchSplit` takes the rest of the height so the page never scrolls: a side column (a `ChainMap`, `WorkbenchSection`s of rows and `WorkbenchFact`s) that scrolls on its own, and the main column one pane that fills it. A workbench page opens Settings wider (settings-core `WIDE_SECTIONS`), eased (below).
- **A pane carries its own actions and facts.** The pane's bar names what it holds and holds what can be done to it (icon buttons; a choice of something else as `Select look="icon"`; the one action waiting -- Save -- as the only filled button). Its foot, a file's status bar, says what is known of it (tokens, where it comes from, how many share it) and where the caret is. Nothing about the thing is repeated above the pane.
- **Text is edited in a pane, not on the page.** Settings scroll only when there are too many settings; text sits in a `TextEditor` (`components/ui/text-editor.tsx`): the workspace editor's setup (`code-setup.ts`, `code-search-panel.tsx`, shared with the workspace editor) -- markdown, line numbers, find and replace -- with prompt tags quiet and `{{slots}}` marked; its bar finds, undoes, redoes and wraps; Mod-S saves; read-only it is the same pane without a caret. It brings CodeMirror, so it is never exported from the library's barrel: import it from its file, lazily where the app loads it (the initial bundle budget is 400 kB gzip).
- **Nothing hides behind hover.** A choice is made by a click and its actions are visible buttons; a chosen item is the only wash in its list (`ChainLink current`). Hover washes say "this one thing is a target" -- every settings row washes when pointed at or focused, a switch's row too.
- **Segmented** is as wide as its words; its thumb and a pointed-at segment sit inset 2px from the hairline with the same gap between segments, so two washes never touch.
- **Size changes ease, never snap.** An overlay changing width settles as panes do (`--duration-fold`, `--ease-settle`), its content holding the width it lands at while the frame clips it, so nothing re-wraps mid-motion. Time tokens are read with `cssTime` (the build writes 240ms as .24s).
- **Save status.** Saving is held until its spinner has made one whole turn before Saved shows; a failure shows at once.
