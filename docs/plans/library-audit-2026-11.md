# The component library: a fresh audit (November 2026)

Status: audit and proposal, 2026-11-02. Nothing in it is approved yet. It supersedes the inventory in
`component-system-storybook-generative-ui.md` (Milestone 0, October), which predates most of the library.

The library is `conduit-web/src/components/ui` ("v2"), seen in the gallery (`npm run gallery`, port 5180). Contact
sheets of each family below were drawn from the gallery itself: every tile is the component as the gallery renders it,
named with its file, how many app files use it, and what it would become. The sheets are in
`library-audit-2026-11/` beside this file (rows, states, headers, buttons, bars, groups, fields, marks, tabs).

## What the library is today

| Measure | Value |
|---|---|
| Component exports (not counting icons) | 407, in 57 files |
| Used by exactly one app file | 268 |
| Used by no app file | 8 (an early count of 36 missed components passed as `as={…}` or renamed on import) |
| Not drawn on any gallery page | 14 |
| Library CSS | 3,810 lines in `styles/` |
| Font sizes, radii, spacing written as literals | none: all `var(--…)` |
| Raw `<button>` left in the app | 1 (`incremark-markdown.tsx`) |
| App CSS of its own | 324 lines in 7 files |

Two things follow.

- **The migration into the library is done.** The app draws almost nothing itself, and the tokens are used
  throughout, so the token panel the old plan called milestone 4 is mostly done.
- **The library is screen-shaped, not part-shaped.** Two thirds of its components serve one screen each. A family of
  them does one job (a row, an empty state, an icon button) in a dozen markups, each with its own CSS. That is what
  to consolidate: fewer, deeper building blocks, and the screen pieces as thin compositions of them.

## Families

Each family: what it is today, and the proposal. "Keep" marks a member that is a different material or behaviour and
should stay itself.

1. **Rows** (sheet `rows`): 17 → `Row` at three densities (nav, list, menu) with lead, title, detail, meta and end
   slots, depth, and the states current, selected, disabled and destructive; a button, link or plain element. NavRow,
   NavLine, NavFolderRow, DashRow, SettingLine, Item, TreeRow, ToolLine become it; ChangeRow, ClockRow, RoomRow,
   AgentRow, CommitRow and InboxRow become compositions of it with their slots fixed (ClockRow and ChangeRow already
   are DashRows underneath). FolderTile stays a tile.
2. **Empty, loading and notes** (sheet `states`): 25 → three. `Empty` (centred or inline), `Loading` (inline, a corner
   capsule, or skeleton rows), `Note` (quiet, warn or error; an optional action; inline, banner or capsule). ChatEmpty
   (the greeting) stays.
3. **Headers and headings** (sheet `headers`): 15 → two. `PaneHeader` for Header, ToolHeader, FileHead and
   TermHeader: four tops of a pane with their own markup, three of them measuring and folding their own controls
   (terminal.tsx, file.tsx, pane.tsx); `Heading` (strong, quiet label, or large title; a count; an action) for the rest.
4. **Buttons** (sheet `buttons`): 12 → `Button` and `IconButton` (its label required, as its name and tooltip; sizes;
   folds into a ⋯ menu when asked). DashIconButton, FileButton, ToolButton, PaneAction and RailButton are IconButtons
   at different sizes; GroupAction is a small link Button. Pill, Rider and Quick actions stay.
5. **Action rows and toolbars** (sheet `bars`): 16 → `Actions` (a run of controls: start or end, wrapping or folding
   into ⋯) and `ToolBar` (a hairlined strip). The composer's Toolbar and the file StatusBar stay.
6. **Groups and sections** (sheet `groups`): 12 → `Group` (built 2026-11-02 as `Group`, not `Section`: the menu's
   `Section` keeps its name, and `components/menus.tsx` already has a `MenuSection`) with a kind for each family
   (setting, column, nav, workbench, card, agent, dash, change), and `Columns`.
7. **Search and address fields** (sheet `fields`): 9 → `Input` with a lead slot and a state (none, checking, ok,
   failed), and one `SearchField`. OverlayBar, the palette's whole top, stays.
8. **Status, facts and counts** (sheet `marks`): 11 → `StatusDot` (tones, hollow, spinning, a label) taking in
   TermStatus and LevelMark; `Fact` (label and value, inline or stacked); one `LineCounts` (Counts and
   ComparisonCounts are the same thing twice).
9. **Choices and tabs** (sheet `tabs`): PillSwitch is Segmented in the pill material; rider Tabs and the dock's
   ToolViews become `Tabs`. Pane tabs keep their own drag and close.

Together: about 130 components become about 20 building blocks plus thin compositions.

## Unused

Removed 2026-11-02 (Fittings step 1): Meta, Disclosure, InboxRow, NavLine, ChainHead, PillGroup, ClientFact and
ClientAdd, the components nothing referenced but the gallery. The first count (23) looked only for `<Name` in JSX
and missed components used another way: passed to Kobalte as `as={MenuAction}`, imported under another name
(`TraceError as LibraryTraceError`), or rendered by name in a dashboard (BrowserGrid, BrowserEntry, CommitRow,
FileView, Picker, ServerControl, SelectTrigger, Scrim, RowAction, MenuPanel). Those stay.

Used only inside the library (fine, but not public): Field, SliderValue, Swatch, Counts, SearchBar, SearchField,
SearchActions, Frost, OverlayHead, Aura, Menu, TraceHeader, Bubble.

## Outside the library

`src/components/menus.tsx` (32 importers) and `dialog.tsx` (14) are the Kobalte-backed menus and dialogs, still
outside `ui/`; `decision-dialog.tsx` and `notifications.tsx` likewise. They belong in the library as the behaviour
layer under its menus and cards. `src/client/dashboard/primitives/split.tsx` is the dashboards' own layer over
`dashboard.tsx` (SplitGroup, SplitRow); it folds into `Section` and `Row`.

## Order

1. Remove the unused (one commit; no screen changes).
2. `Row` and `Group` (the audit's `Section`) first: they are the most repeated, and the Settings, nav, dashboard and menu screens all
   change at once, which the gallery shows side by side.
3. `Empty` / `Loading` / `Note`, then `IconButton` and `Actions`.
4. `PaneHeader`, which is behaviour (the folding by measure) more than looks, with the panes smoke.
5. Fields, marks and tabs.
6. Move menus and dialogs into the library.
7. Motion: catalogue every animation the phone's pill composer plays (the composer arriving and leaving, each pill
   and part coming and going) and formalise them as named, generic motion primitives in the library (keyframes,
   duration and easing tokens, applied through `motionOf`), then move the composer and the other animated pieces
   onto them. Nothing it does today may be lost: checked frame by frame before and after (`scripts/motion-check`).

Each step: the gallery page for the new building block first, the old components as compositions of it (so screens
keep working), then the callers moved and the old names removed. DESIGN.md's catalogue changes with each.

## A name

"v2" says only that there was a v1. Candidates:

- **Fittings**: in electrical work, the standard pieces (couplings, elbows, boxes) that join runs of conduit. It
  names exactly what this is for Conduit: the standard parts its screens are joined from. Recommended.
- **Switchboard**: where conduit's wires meet; good for an app shell, less for a parts library.
- **Groundwork**: plain, but says foundation rather than parts.
- **Loom**: threads woven into cloth; fits a chat product, but is a common name elsewhere.
