/*
 * Components v2: the unified library's styles, one file per family, imported here in cascade order (from JS, so each
 * file passes the build's CSS transforms, which skip @import). One frost material, two lifts; every size is a multiple
 * of a density unit (--u-type, --u-space, --u-icon); [data-density] sets them on any subtree, so one set of rules draws
 * desktop and phone.
 *
 *   Surfaces: a surface sets two values and the controls on it read only those: --tint, its lines and washes, and
 *   --well, the fill under an input or an outline button. The ground is the default; [data-surface=frost] (set by
 *   Frost, Menu, Card and the rest) brings frost's. No control has a rule of its own per surface.
 *
 *   reset           the base reset and the root face, size and colours
 *   foundations     tokens (type, motion, scale, space, radii, colour, surfaces) and the rules every piece shares
 *   controls        Button, Input, TextArea, Field, Keycap, Segmented, Slider, Progress, Spinner
 *   frost, orb      the material; the thinking orb's box
 *   fade            the fade at the foot of content cut short (code, a bubble, a glance)
 *   popover         Menu > Section > Item, Match
 *   reading         Reading: a gauge's totals, parts, figures and foot
 *   nav             NavPane > NavGroup > NavRow, NavFolder, RailButton
 *   dashboard       Dashboard, DashHeader, Group (GroupHeading), DashRow, ChangeRow, FolderShelf
 *   shell           AppShell > Sheet (its backdrop), SheetFill; Dock > DockSurface, DockDocument; ToolContent
 *   pane            PaneTabRow > TabPlace > PaneTab, PaneAction, PaneEdge, DropWash, DropOverlay, DragPill, ToolRail, ToolHeader,
 *                   ToolBar, ToolButton, ToolFilter, ToolNotice, Tree > TreeRow
 *   source          SourceView > SourceOverview | SourcePatch; ToolLine, CommitBox, ChangeLedger > ChangeSection >
 *                   ChangeList > ChangeItem, ChangeNav, CommitList, PatchLines
 *   history         HistoryList > HistoryRow, HistoryBranch
 *   terminal        TermHeader and its parts, TermState, TermKeys
 *   file, viewer    FilesPane > FilesTree; FileView > FileHead, FileBody, StatusBar; FileViewer's sides; FileImage, FileMedia, FileCard
 *   editor          CodeSurface > CodeHost, SearchBar, AnnotationPopup, Comparison, DiffShell
 *   header          Header, HeaderCrumb, HeaderButton, HeaderNote
 *   card, toast     Card, Notice; Toast
 *   overlay         Scrim > Overlay (Bar, List, Split, Hints, Rail, Page), Settings, Glance
 *   network         NetworkMap: devices, their environments and clients, hung from the head's
 *   leader          Leader, Crumbs, Spotlight
 *   pill            Pill*, Aura
 *   phone-composer  PhoneComposer
 *   composer        DesktopComposer, Toolbar
 *   rider           Rider, Line, Chip, Choice, the question card, RiderButton
 *   approval        ApprovalSummary (the question card's, an ApprovalCard's), ApprovalCard
 *   chat            ChatView > ChatScroller > ChatEmpty, ComposerDock
 *   transcript      Transcript, Turn, Message, Bubble, Answer, Disclosure
 *   code, trace     CodeBlock, CopyButton; Trace, Trail, Step
 *   agents          AgentRows > AgentRow (a turn's subagents), AgentRider (a chat's background agents, a line each)
 *   assistant       LevelMark, InboxRow (a run's report, opening in place), ClockRow, DayStrip (an agent's day)
 *   identity        the account and server marks
 *   connection      sign-in, first connection, server selection
 *   browser         the computer's file browser
 *   marks           harness and file-type marks
 *   voice           VoiceWaveform monitor and compact input levels
 */
import "./reset.css";
import "./palettes.css";
import "./theme.css";
import "./foundations.css";
import "./controls.css";
import "./frost.css";
import "./fade.css";
import "./orb.css";
import "./popover.css";
import "./reading.css";
import "./nav.css";
import "./dashboard.css";
import "./pane.css";
import "./shell.css";
import "./source.css";
import "./history.css";
import "./terminal.css";
import "./file.css";
import "./viewer.css";
import "./editor.css";
import "./header.css";
import "./card.css";
import "./identity.css";
import "./toast.css";
import "./overlay.css";
import "./network.css";
import "./leader.css";
import "./pill.css";
import "./phone-composer.css";
import "./composer.css";
import "./rider.css";
import "./approval.css";
import "./transcript.css";
import "./chat.css";
import "./code.css";
import "./trace.css";
import "./agents.css";
import "./assistant.css";

import "./connection.css";

import "./browser.css";

import "./marks.css";
import "./voice.css";
