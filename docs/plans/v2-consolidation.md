# v2 consolidation

The reference for refactoring the v2 component library (`conduit-web/src/components/ui`) down to one build per
family. From the 2026-11-08 audit: about 12.8k lines (8,580 .ts/.tsx, 4,247 CSS), with many families built more than
once. Tick a family when every listed build goes through its single piece and the gallery shows it.

| # | Family | How many builds | Should be one |
|---|---|---|---|
| 1 | Heads (title + actions + close) | ~12 heads, 6 close-button forms; PanelHead and PaneHeader each have their own measure-and-fit code | One Head (from PanelHead) and one CloseButton |
| 2 | Dismiss and motion | Same Escape handler twice in tray.tsx, ~8 more Escape handlers, 3 dimming layers, 3 motion systems, enter/leave keyframes copied in 4 files | A createDismiss hook, one Scrim, one enter/leave rule |
| 3 | Frost | Header pills copy the frost recipe by hand, plus a duplicated ~15-rule phone block; Tray and Ledge apply frost as attributes instead of `<Frost>` | `<Frost>` everywhere, header pills on PillButton |
| 4 | Fold / unfold | Two motion engines (Expand and the CSS `.ui-disclosure`), several folds with no motion, ~10 separate chevron-rotate rules | Expand only, plus one fold chevron |
| 5 | Rows | ~15 rows built by hand beside Row (AgentRow, AgentLine, RoomRow, ReportCard, HistoryRow, TreeRow, CommitRow…); AgentLine and RoomRow are the same shape | Row with more densities, an indent and a fold part |
| 6 | Counts, dots, chips | 7 count-badge styles, 8+ status dots, Chip and Attachment the same anatomy | Count, StatusDot with a tone, one Chip |
| 7 | Cards and notices | 6 card types on 4 different bases; 4 notice banners (Notice, NavNotice, ToolNotice, HeaderNote) | Card with a frost or outline surface; one Notice |
| 8 | Repeated CSS | The same truncate recipe 84 times, the hover-tint pair written by hand 29 times, icon sizing 111 times | Shared utility classes |

## Evidence (file:line at the audit)

1. Heads: PanelHead (tray.tsx:22, measure tray.tsx:25-36), PaneHeader 4 kinds (header.tsx:52, fit code :63-77,
   :82-102), Card head (card.tsx:12), OverlayRail/OverlayPage (overlay.tsx:118, :163), OverlayBar/OverlayHead
   (overlay.tsx:83, :327), Group head (group.tsx:63-67), WorkbenchTitle, ClientCard header, EmailItem head, Envelope
   head, ApprovalSummary head, RiderTop, DashHeader, Heading, HeaderCrumb, TraceHeader, DashPeek bar. Close buttons:
   IconButton kind=pane/tool/file, Button ghost icon-sm, Button icon-xs (Toast), raw buttons (PaneTab, Chip, OverlayChip).
2. Dismiss: Escape at tray.tsx:60 and :145; Ledge outside press tray.tsx:146-152; MenuBody pointerdown menus.tsx:185;
   Escape in menus.tsx:200, composer.tsx:125, find.tsx:29, code-search-panel.tsx:33, overlay.tsx:264,
   viewfinder.tsx:68. Rise/drop keyframes in card.css:19, popover.css:5, overlay.css:72, rider.css:7. Dims:
   .ui-tray-scrim, .ui-scrim, .ui-backdrop. Raw cssTime/getComputedStyle in expand.tsx:57, overlay.tsx:57/:155;
   matchMedia reduced-motion in overlay.tsx:52.
3. Frost: header.css:46-62 vs :82-97 (phone block twice), frost recipe at header.css:70-71, :94-95; tray.tsx:114/:155
   attributes; toast.tsx:28 class string; header strip header.css:6; --fog-blur defined twice (foundations.css:189,
   :289); popover.css:121-122 re-sets what Frost sets.
4. Fold: Expand (expand.tsx) vs .ui-disclosure (transcript.css:204-216, transcript.tsx:113/:151, trace.tsx); no
   motion in group.tsx:68, rider.tsx:46, SettingDetails <details>. Chevrons: assistant.css:65, agents.css:32,
   nav.css:61, rider.css:38, pane.css:168, dashboard.css:102, popover.css:137, reading.css:14, history.css:47,
   transcript.css:207.
5. Rows: Row (row.tsx:57). Hand rows: AgentRow agents.tsx:43, AgentLine agents.tsx:65, RoomRow assistant.tsx:43,
   ReportCard assistant.tsx:30, HistoryRow history.tsx:26, TreeRow pane.tsx:120, CommitRow source.tsx:48, ChangeItem
   source.tsx:44, ToolLine source.tsx:11, Line network.tsx:28, chain line network.tsx:110, SettingLine overlay.tsx:235,
   Choice rider.tsx:84, Summary rider.tsx:120, WorkbenchFact, Readout popover.tsx:125, ConnectionChoice, ServerControl;
   NavFolderRow rebuilds row parts by hand (nav.tsx:57).
6. Counts: nav.css:124 rail badge, header.css:58 header count, group/dashboard smalls (dashboard.css:98, :111, :141),
   controls.css:98, source.css:15, .ui-room-count, .ui-browser-count, .ui-find-count, .ui-tour-count. Dots: StatusDot
   nav.tsx:100, connection.tsx:44 raw, nav.css:127, pane.css:43, dashboard.css:178, file.css:15, assistant.css:6,
   network.css:57, overlay.css:108. Chips: Chip rider.tsx:52, Reference rider.tsx:69, Attachment card.tsx:40,
   OverlayChip overlay.tsx:96, Keycap onRemove controls.tsx:11.
7. Cards: Card, ApprovalCard (approval.css:21), TourCard, ClientCard (network.css:33), ReportCard (assistant.css:41),
   .ui-network-box. Notices: Notice card.tsx:53, NavNotice nav.tsx:89, ToolNotice pane.tsx:109, HeaderNote
   header.tsx:171. Empty bypasses: .ui-client-empty, NavSkeleton, LoadingEarlier, ConnectionRecovery.
8. CSS: truncate ×84, hover/focus tint pair ×29, icon-sm ×63 / icon ×48, hairline tint border ×45,
   muted+caption ×60, button reset ×22.

## Progress

- [x] 1 Heads (688a25bb): PanelHead + createFolds (fit.ts) for PanelHead and PaneHeader tool/term; CloseButton
  (actions.tsx) for every head's x; OverlayRail/OverlayPage share OverlayPageHead. Left: Card's head (bare h3/p
  under .ui-card), OverlayHead (a bar of free children), Approval's (no close).
- [x] 2 Dismiss and motion (688a25bb): createDismiss (dismiss.ts) for Tray and Ledge; one rise/drop rule for raised
  frost (frost.css); one dim paint (overlay.css); overlay reads motion.ts. Left: element-scoped Escape ladders
  (find, composer, menus' sub-menu back, viewfinder) stay on their elements; Tray/Backdrop/Scrim keep their own
  fades (data-open, data-fade with the drawer's drag, motionOf).
- [x] 3 Frost (688a25bb): Tray, Ledge, header pills and count through <Frost>; one --fog-blur; popover's restated
  frost gone. Left: header groups are frost on a phone only, so header.css draws the recipe there; the phone
  header block is written twice (@media phone and [data-presentation="phone"], jbot's dock column), as CSS cannot
  OR a media query with a selector.
- [x] 4 Fold / unfold (688a25bb): one .ui-fold-chevron rule (foundations.css) for ten; Trace, Step, Envelope and
  Group's change fold through Expand. Left: rider Line is a clamp that grows, not a body that comes and goes;
  SettingDetails is a native <details>.
- [x] 5 Rows (662daed8): Row gains depth, fold and the line, trail and tree densities; AgentLine and RoomRow are one
  FoldLine (agents.tsx); AgentRow, HistoryRow, ReportCard's line, TreeRow, ToolLine, CommitRow, network and chain
  lines, NavFolderRow, WorkbenchFact, Choice and Summary draw through Row. Left: Readout (a menu's cursor would
  take it), SettingLine (a <label> whose clicks need label.control), ConnectionChoice and ServerControl (ghost
  Buttons), ChangeItem (its actions are menuitems).
- [x] 6 Counts, dots, chips (662daed8): Count (controls.tsx) for every inline number; Dot (nav.tsx) for every bare
  dot, sized by --dot; Chip and Attachment share ChipCopy; removes are CloseButtons. Left: the rail's count badge
  and the header's count capsule keep their forms; Chip's on-media remove badge; OverlayChip's x is its mark.
- [x] 7 Cards and notices (662daed8): Card surface="outline" (.ui-outline) for ClientCard and the network's boxes;
  one Notice (state.tsx, kinds reading/nav/tool/header); Empty and Loading kinds in styles/state.css. Left:
  ReportCard's box (a --border card with its own hover), ApprovalCard (its own padding and width), TourCard
  (Overlay-based).
- [x] 8 Repeated CSS (and after): 87 per-piece rules that only sized an icon's box, cut a line short or filled their
  box are gathered into one rule per recipe at the end of foundations.css (zero-specificity :where() rules stay put,
  as their order decides between them).
- [x] 8 Repeated CSS: .ui-truncate, .ui-size-icon(-sm) and [data-wash] (foundations.css); 20 truncate and 19
  icon-size rules moved onto them, computed styles unchanged in every family. Left: rules aimed at children the
  library does not class, partial recipes, zero-specificity :where() pieces, washes that also set colour or more
  states; the muted caption pair has no font-shorthand token to become.

## Wave 3

- Readout and SettingLine are Rows (Row takes element="label"; moveCursor skips [data-still]). ReportCard is
  Card element="button" surface="outline"; ApprovalCard is Card size="compact" (Card takes element, role, label, an
  optional title and sizes compact and row). NavNotice, ToolNotice and HeaderNote are gone: callers use Notice kind.
- The phone header is written once: a phone's root is [data-presentation="phone"] (layout.ts, and the gallery's
  phone frame), so the @media block keeps only what is a phone's own (safe areas, the lead group, phone-only
  controls).
- Still apart, as they are not the same build: ConnectionChoice and ServerControl (ghost Buttons, their wash, ring
  and pressed state are Button's), ChangeItem (a wrapper round a Row button and a sibling action), TourCard (an
  Overlay with a head bar and a ruled foot), tabs (rider Tabs, PaneTabs, ToolViews: ticks, drag/close, disabled
  views), trees (FilesTree is the column, Tree the list in it), code (CodeBlock's static HTML, CodeSurface's
  editor column, CodeExcerpt's bare mount), search (the editor's has replace and toggles; FindBar has a count).

## Size

Library (src/components/ui .ts/.tsx/.css): 12,941 lines before (c6fd6539), 12,855 after the recipes were gathered, with the shared
pieces the families now go through (dismiss.ts, fit.ts, CloseButton, Count, Dot, FoldLine, Row's densities, Notice,
state.css, the utilities) included. Checked by gallery-style-diff against builds before each wave (computed styles of
every family, desktop and phone) and screenshots of base and current builds in the headed Chrome.
