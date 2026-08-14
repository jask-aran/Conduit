# Mobile chat surface design

## Status

Proposed design specification. This document defines the agreed mobile
composition for the main chat surface. It does not authorize implementation
until the current overlapping worktree changes are accounted for.

## Purpose

Conduit must feel native on a phone before it is packaged with Capacitor. The
mobile chat surface must give most of the visual viewport to the transcript,
keep global navigation tools immediately available, expose live agent state
without a permanent telemetry block, and keep the collapsed composer to one
row.

The primary user is a technically capable person who monitors and directs an
agent from a phone. The surface has one main job: make the current conversation
easy to read and continue while keeping agent state and advanced chat controls
close at hand.

## Scope

This specification applies at the existing mobile layout breakpoint:
`max-width: 760px`.

It covers:

- the mobile chat shell;
- the chat top bar;
- the live agent status control and its detail sheet;
- the chat overflow menu;
- transcript spacing and presentation;
- the collapsed composer and its temporary expanded states;
- safe areas, the software keyboard, touch targets, and accessibility.

It does not cover:

- desktop or tablet composition above the mobile breakpoint;
- sidebar or Workspace drawer redesign;
- a new context-aware model for steering and queuing;
- Capacitor packaging, status-bar configuration, or native file and camera
  integrations;
- changes to transcript ownership, streaming, history loading, or tail-follow;
- a new visual theme.

## Design principles

1. The transcript owns the viewport. Permanent chrome uses only the height
   required for immediate actions.
2. Global actions stay visible. Chat-specific identity and management live in
   the overflow menu. Message-level configuration lives in the Plus menu.
3. The top bar does not show the chat title. Live agent state occupies that
   space instead.
4. The collapsed composer is one row. Message-level settings stay one tap away
   from a single Plus menu, without becoming permanent chips or controls.
5. Detail appears on demand. The current context metrics remain available
   through the status control without remaining visible below the composer.
6. Existing chat behavior stays intact unless this specification explicitly
   changes it.

## Layout

The mobile shell is full-bleed. It does not retain the desktop chat panel's
eight-pixel outer margin, rounded outer frame, or inset ring.

```text
┌─────────────────────────────────────┐
│ top safe area                       │
│ [☰] [ Ready · waveform ] [⌕] [>_] [⋯] │
├─────────────────────────────────────┤
│                                     │
│ Assistant response text uses the    │
│ full readable width.                │
│                                     │
│                         ┌─────────┐ │
│                         │ User    │ │
│                         └─────────┘ │
│                                     │
│ Copy   Retry                        │
│                                     │
├─────────────────────────────────────┤
│ [+] [ Message Pi…       ] [◉] [↑]  │
│ bottom safe area                    │
└─────────────────────────────────────┘
```

The shell continues to use the visual viewport as its height source. The
transcript remains the only vertical scroll owner between the fixed-height top
bar and composer region.

## Visual system

The redesign keeps the current charcoal and liquid-glass identity. It does not
introduce an unrelated mobile theme.

Reference palette:

| Role | Value | Use |
| --- | --- | --- |
| Frame | `#111216` | System-adjacent background and safe-area ground |
| Chat surface | `#17191e` | Transcript and top-bar ground |
| Raised surface | `#22252b` | Menus, sheets, cards, and temporary trays |
| Main text | `#f0f1f3` | Transcript and primary labels |
| Muted text | `#979ba4` | Metadata and secondary labels |
| Live state | `#9db8d1` | Focus, connection, waveform, and active state |

These values describe the intended appearance. Implementation must derive from
the existing OKLCH design tokens rather than add parallel hard-coded colors.

Typography keeps two roles:

- Geist Variable for transcript text, controls, and menu labels;
- the existing system monospace stack for live agent state and context metrics.

Mobile assistant text targets `16px` with approximately `1.6` line height.
Control labels remain compact but must not fall below `13px`. Composer input
text must be at least `16px` to prevent iOS input zoom.

The signature element is the live status rail in the top bar. It replaces a
generic title with current agent state, which is specific to Conduit's role as
an agent interface. The liquid-glass composer remains a supporting material,
not a second competing effect.

## Top bar

### Composition

The control order is fixed:

```text
[Sidebar] [Flexible live status] [Search chats] [Command palette] [More]
```

The bar does not render the chat title, breadcrumb, project name, profile
posture, share control, or Workspace control.

The bar is approximately `48px` high, excluding
`env(safe-area-inset-top)`. Each icon button has at least a `44px` touch target.
Visual icons can remain smaller inside those targets.

The live status control consumes the flexible centre width. At narrow widths it
truncates its text. If text cannot fit, it retains the state icon or spinner and
an accessible label.

### Persistent controls

The following actions remain directly visible:

- toggle Sidebar;
- Search chats;
- open Command palette;
- open chat overflow menu.

Search and Command palette must not be duplicated in the overflow menu.

### Live status control

The collapsed control shows one current state:

- `Ready`;
- the active runtime activity label, such as `Starting…`, `Thinking…`,
  `Using tool…`, `Retrying…`, `Compacting…`, or `Stopping…`;
- `Listening…` plus the compact waveform during dictation;
- a clear offline or failure state.

Long activity labels truncate. They do not wrap or increase the top-bar height.
The state remains available to assistive technology through a polite live
region without moving focus.

The visual treatment is a flat segment of the bar, not a detached floating
bubble. It uses a subtle raised fill, restrained corners near `10px`, and the
existing cool live-state accent. It must remain readable without relying on
colour alone.

### Status detail sheet

Tapping the live status control opens a top-anchored modal sheet directly below
the top bar. The sheet overlays the transcript and does not change transcript
geometry or scroll position.

The sheet reuses the existing activity and context formatters. It presents:

- full current activity state;
- the active voice waveform when applicable;
- every context metric selected in Settings;
- context tokens and percentage;
- context-window size;
- session token totals;
- cache statistics;
- session cost;
- queued-message count;
- runtime connection or failure state.

The detailed metric presentation preserves the current power-line structure and
monospace treatment. Unlike the collapsed control, it can use multiple lines
inside the bounded sheet.

The sheet:

- is no wider than the viewport minus `24px`;
- respects the top, left, and right safe areas;
- scrolls internally if its content exceeds the available height;
- traps focus while open;
- closes on Escape, system Back, outside tap, or its close action;
- returns focus to the live status control;
- updates live without reopening.

## Chat overflow menu

The More button opens a viewport-bounded menu or compact top sheet. It contains
chat-specific identity, navigation, and management.

The menu begins with a non-interactive identity block:

- full chat title;
- owning folder or Workspace, when applicable;
- optional runtime label when it helps distinguish Host Pi from Isolated Pi.

The chat title appears nowhere else in the mobile top bar.

The menu then provides chat-specific actions:

1. **Open Workspace panel** — appears when the current surface supports it.
2. **Share chat** — uses the existing share behavior.
3. **Rename** — uses the existing chat rename behavior.
4. **Delete** — remains visually separated and requires the existing
   confirmation.

Unavailable actions are omitted when they do not apply. Disabled actions must
explain why they are unavailable.

The menu must remain within the visual viewport, respect safe areas, trap focus
while open, and return focus to More when it closes.

## Transcript

The transcript uses the full mobile chat surface instead of sitting inside an
inset desktop card.

Mobile presentation:

- horizontal content inset: `16px` to `20px`;
- transcript top inset below the top bar: approximately `20px`;
- transcript bottom inset above the composer: approximately `16px`;
- assistant content: unboxed and full readable width;
- user bubble: right-aligned and no wider than approximately `82%`;
- tool and trace content: full available width with no desktop left offset;
- scroll-to-latest control: positioned above the composer and inside the
  transcript viewport.

The first implementation retains current message timestamps and action
availability. It can reduce excess spacing, but it must not hide edit, copy,
regenerate, continue, or stop actions behind a new gesture without a separate
interaction decision.

The ambient meteor field must not compete with transcript text. On mobile it is
limited to the empty state or reduced until streaks cannot read as dividers or
stray marks across messages.

History loading, transcript visibility, Markdown rendering, automatic table
layout, streaming reconciliation, and tail-follow behavior remain unchanged.

## Composer

### Collapsed composition

The collapsed composer contains one row:

```text
[Plus] [Flexible single-line input] [Voice dictation] [Primary action]
```

It does not contain:

- the permanent status line;
- context metrics;
- a second action row.

The composer keeps the existing liquid-glass material. Its target collapsed
height is approximately `52px`, excluding
`env(safe-area-inset-bottom)`. The composer stack uses small horizontal gutters
and no unnecessary vertical padding.

Plus, Voice, and the primary action have at least `44px` touch targets. The
input takes all remaining width. Plus is labelled `Message options`, not
`Attach files`.

### Plus menu

Plus opens an anchored action menu or compact sheet. It is the single home for
message-level settings and future message-scoped additions. It must not add
chips above the composer or increase the collapsed composer height.

The first-level actions are:

1. **Model and effort** — opens one combined sheet containing the model list
   and thinking-level choices. This is reachable in two taps from the
   composer: Plus, then Model and effort.
2. **Profile** — opens the existing profile choices. It remains available while
   the chat is a draft and shows its locked state after the first message.
3. **Attach files** — preserves the existing picker and attachment behavior.

The menu is intentionally extensible. Future message-level actions such as
**Add skill**, **Add plugin**, tool posture, or other prompt settings belong in
this menu. They should be added as first-level rows or grouped under a clear
section, not as permanent composer controls.

The current model and profile can appear as secondary values on their menu rows,
but no value chip remains visible when the menu is closed. Model and effort are
one combined entry so the user does not need to open separate menus for related
runtime choices.

### Input expansion

An empty input and an unfocused collapsed composer remain one row. Focus alone
does not increase the height.

When entered text wraps, the input can grow to a small bounded editing height.
The action controls remain aligned in one row at the bottom of the composer.
The input scrolls internally after it reaches its limit. Losing focus returns
the surface to its collapsed one-row presentation without deleting or
truncating the draft.

### Primary action states

The first implementation preserves current send, stop, steer, and follow-up
semantics.

| Runtime state | Draft state | Visible actions |
| --- | --- | --- |
| Idle | Empty | Plus, Voice, disabled Send |
| Idle | Has text | Plus, Voice, Send |
| Submitting | Any | Plus, Voice, submitting indicator |
| Generating | Empty | Plus, Voice, Stop |
| Generating | Has text | Plus, Voice, Stop, Steer, Send follow-up |
| Stopping | Any | Plus, Voice, stopping indicator |
| Dictating | Any | Plus, Stop dictation, disabled Send |

Busy-state actions can temporarily reduce the input width, but they must stay
inside the same row. This specification does not replace them with the proposed
context-aware button system. A later design can decide whether the composer
should prioritize steering or follow-up based on runtime context.

### Temporary composer content

Attachments, queued-message notices, dictation errors, and host UI requests can
temporarily expand above the composer row. They are content, not permanent
composer chrome.

On mobile:

- attachments use a compact horizontal chip or thumbnail tray where practical;
- queued-message notices remain concise and keep Restore to draft available;
- dictation errors remain visible and actionable;
- host UI requests remain fully operable and can scroll within a bounded area;
- temporary content must not push the composer below the visual viewport.

## Responsive and native-shell behavior

The existing visual viewport binding remains the source of mobile shell height.
The redesign must preserve:

- composer movement above Android and iOS software keyboards;
- `viewport-fit=cover`;
- `interactive-widget=resizes-content`;
- bottom safe-area padding;
- top safe-area padding for the top bar;
- overscroll locks while a drawer, menu, or sheet is open;
- pull-to-refresh behavior on the empty transcript only.

The full-bleed layout must work in a browser, installed PWA, and future
Capacitor WebView without assuming that native status bars have identical
overlay behavior.

## Interaction and accessibility

- All permanent icon controls have accessible names and at least `44px` touch
  targets.
- Visible focus indicators remain present for keyboard and switch users.
- Menus and sheets announce their title and purpose.
- Opening an overlay moves focus into it. Closing restores focus to its trigger.
- System Back closes the topmost mobile overlay before it navigates away.
- Status changes use `aria-live="polite"` and do not repeatedly announce every
  token or waveform update.
- The waveform has a text state equivalent.
- Reduced motion removes sheet and control transitions without changing final
  geometry.
- No interaction depends only on hover.
- The mobile layout keeps existing keyboard shortcuts when a hardware keyboard
  is connected.

## Motion

Motion stays subordinate to reading.

- Menus and top sheets use the existing short panel-motion duration near
  `160ms`.
- The status control can cross-fade its label and morph between spinner,
  waveform, and state icon without changing its outer geometry.
- The composer primary action can change between Send, Stop, and progress
  states without moving the composer.
- Transcript messages do not gain entry animations.
- Reduced-motion mode commits every state immediately.

## Implementation seams

The implementation should extend the current Solid components instead of add a
parallel mobile runtime.

Likely scope:

- `conduit-web/src/client/main.tsx`
  - mobile top-bar composition;
  - chat overflow actions;
  - status-detail-sheet ownership.
- `conduit-web/src/client/chat/composer.tsx`
  - mobile one-row composition;
  - Plus message-options menu for model/effort, profile, attachments, and
    future message-scoped actions;
  - removal of permanent mobile model, profile, and status chrome;
  - preservation of busy and dictation states.
- `conduit-web/src/client/chat/transcript.tsx`
  - no state-model change expected;
  - only public seams needed for mobile presentation.
- `conduit-web/src/client/styles.css`
  - full-bleed mobile shell;
  - top bar, status rail, status sheet, menu, composer, and safe-area rules.
- `conduit-web/src/client/chat/markdown.css`
  - mobile transcript type and spacing only if required.
- `conduit-web/test/browser/pwa-mobile.spec.js`
  - public mobile geometry, touch targets, menus, sheets, keyboard, and composer
    states.

Reuse:

- `formatContextMetrics()` and the selected context-metric preferences;
- existing model and profile menus or their data sources;
- existing share, rename, delete, Workspace, Search, and Command palette
  actions;
- existing visual viewport and mobile overlay helpers;
- existing dictation waveform and activity state.

Do not duplicate context calculations or introduce a second source of chat,
runtime, model, profile, or transcript state.

## Acceptance criteria

### Geometry

- At widths from `320px` through `760px`, the top bar does not show the chat
  title or breadcrumb.
- Sidebar, status, Search, Command palette, and More remain usable at `320px`.
- The collapsed composer is one row and approximately `52px` high before the
  bottom safe area.
- The collapsed surface has no permanent status or context block below it.
- The transcript is full-bleed within the device viewport and is not obscured
  by the top bar or composer.
- No control or overlay crosses a safe-area boundary.

### Behavior

- Search and Command palette open directly from the top bar.
- More shows the full title and applicable chat-specific actions.
- Model and Profile can be inspected and changed under the same rules as
  desktop.
- Model and effort are reachable from the collapsed composer in two taps or
  fewer: Plus, then Model and effort.
- Profile is reachable from the collapsed composer through Plus, with its
  existing draft-only lock rule.
- Attach files remains available through Plus.
- Future message-level actions have one defined extension point in Plus.
- The status control reflects live runtime and dictation state.
- The status sheet displays every selected context metric and updates live.
- Send, stop, steer, follow-up queueing, attachment, and dictation behavior
  remain available.
- Opening and closing any top-bar overlay preserves transcript position and
  tail-follow ownership.
- The composer follows the software keyboard without leaving a gap or becoming
  obscured.

### Viewports and states

Validate at minimum:

- `320 × 568`;
- `360 × 740`;
- `390 × 844`;
- `430 × 932`;
- portrait and landscape;
- browser, installed PWA, and a representative Capacitor WebView when
  available;
- empty chat;
- long transcript;
- streaming response;
- drafted follow-up during streaming;
- active and stopping dictation;
- attachments;
- queued messages;
- host UI request;
- offline and runtime failure;
- open Sidebar and Workspace drawers;
- open status sheet and overflow menu;
- software keyboard open and closed;
- reduced motion.

## Verification

Follow `docs/operations/testing.md`.

The implementation is complete only after:

1. focused component or helper tests pass;
2. `npm run typecheck` passes;
3. `npm run build` passes;
4. relevant Node tests pass;
5. authenticated mobile agent-browser review confirms the intended appearance;
6. the mobile Playwright set pieces cover the public geometry and interaction
   seams above;
7. transcript tail-follow and Markdown browser fixtures show no regression;
8. manual review accepts the visual hierarchy at the representative phone
   sizes.

## Deferred decisions

The following ideas remain deliberately outside the first implementation:

- replace busy-state composer buttons with a context-aware steering or queueing
  control;
- decide whether chat-specific model/profile shortcuts should also appear in
  More after observing Plus-menu usage;
- define gesture-only message actions;
- add native Camera, Photos, and Files choices through Capacitor;
- change the status sheet into a persistent remote-control panel;
- revise the Settings model for context metrics;
- redesign the Sidebar or Workspace drawer;
- change desktop chat chrome.
