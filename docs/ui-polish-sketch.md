# UI polish sketch

Status: sections 1 (interrupted turns), 2 (composer hierarchy), 5 (empty
states, reduced) and 7 (motion, but for the deferred dashboard transition)
are built and recorded below as built; 3, 4 and 6 remain proposals for
separate, bounded changes.

These proposals cover transcript density, composer hierarchy, mobile file
browsing, useful empty states, and interaction feedback. A separate autosave
proposal replaces the earlier suggestion to add save feedback only to server
settings.

The design system is still evolving. Use `DESIGN.md` as the current reference,
but review each surface on its own. This document does not authorise a global
restyle, shared-token changes, or an app-wide motion pass.

## 1. Compact interrupted turns

Interrupted turns can show struck-through text, “Interrupted, not kept”,
“Stopped”, and action icons together. These repeat the same event and make
short exchanges occupy too much space.

Sketch: show one compact interruption row. Let the user expand it to inspect
the interrupted content and its details. Keep any valid assistant output
visible; do not treat a partially completed answer as discarded content.
Keep recovery actions easy to find without repeating the status beside them.

Review with consecutive interruptions, an interruption after partial output,
and a turn with no answer. The compact view must preserve the distinction
between kept output and discarded content. This is a presentation change,
not a change to stored transcripts or backend turn states.

Status: built. A stopped turn says **Interrupted** once, as the tag on its
first row -- the word the trace and the composer use, in the text colour at
560. Rows that are not the trace carry the Stop mark where a trace has its
brain, so the two line up. Regenerate is always in the actions row under them.

```
stopped under a tool          🧠 Interrupted · 1 tool call              ⌄
                                 ↻

discarded, no trace           ■  Interrupted · not kept · T̶h̶e̶ ̶V̶i̶l̶l̶a̶g̶e̶…  ⌄
                                 ↻

discarded under a trace       🧠 Interrupted · 2 tool calls · Checking…  ⌄
                              ■  Not kept · T̶h̶e̶ ̶V̶i̶l̶l̶a̶g̶e̶…               ⌄
                                 ↻

stopped before any answer     ■  Interrupted · before answering
                                 ↻

kept, stopped part-way        …the answer so far, in full
                              Interrupted   ▷ Continue   ⧉ ↻

while stopping                Stopping…
```

- Kept text is always shown in full; discarded text is always folded to its
  struck-through preview. Opened, it is muted text under the row, no rail.
- Continue carries on the latest turn, so it appears only there, and only
  when the agent kept what it wrote. Older stopped turns and discarded answers
  offer Regenerate.
- Copy appears only where there is text the agent kept.
- A turn that ended with no answer -- stopped under a tool, or one that only
  ran commands -- still has Regenerate under its trace.

## 2. Clarify composer hierarchy

Status: built on desktop and phone. The drawings below are what shipped; the
rules that became general are in `DESIGN.md` (Dropdown menu, Composer row).

The composer places several controls on one small row. Model selection and
Send should be easy to find without making every setting equally prominent.

Sketch: give the model and primary action clear visual priority. Keep less
frequent controls quieter, with their current values available when needed.
Do not hide controls solely to make the row look cleaner; first establish
which ones users need during a conversation.

Add restrained press feedback and a smooth transition between Send and Stop.
The icon and accessible label must still show the actual action immediately.
Respect reduced-motion preferences and preserve keyboard operation.

Review with a long model name, attachments, dictation, an active response,
and a narrow viewport. Choose the control grouping before tuning motion.

### As built

Drawn for desktop and mobile. The current value is its row's gray wash (`░`)
and a heavier label -- never a tick. Rows are one line, their meta muted and
right-aligned. `›` opens a submenu, `▾` a dropdown.

Rules that hold across both, and across every composer menu:

- No explanatory notes inside menus. A choice that is not available is
  greyed out, and that is enough -- no "Locked after the first message".
- No "Manage models…" or "Manage profiles…" rows. Settings are reached from
  Settings, not from a menu that is open to choose something.
- Model search is not an inline field. The first row of the model menu opens
  the model picker dialog.
- Effort is set on the slider, whose label shows the current level. Tapping
  the label opens a submenu listing the levels, like any other submenu --
  never a list expanding in place.
- A pick whose follow-up is in the same menu keeps it open: choosing a model
  leaves the model menu up for Thinking, and a choice in a phone submenu
  returns to the options instead of closing them.

#### Desktop

Three tiers, by how often a control is reached for mid-conversation. Nothing
leaves the row; the lower tiers get quieter, not hidden, and each keeps its
current value in view.

```
╭───────────────────────────────────────────────────────────────────────────╮
│ Send a message…                                                           │
│                                                                           │
│ 📎  ◔  ◆▾  Grok 4.7 high ▾  ⛉ Prompt ▾               Working…  ┄┄┄  mic  ↑ │
╰───────────────────────────────────────────────────────────────────────────╯
```

Left to right:

- **Attach** -- tier 2, in the text colour: it is a live action, not a setting.
- **Context** -- tier 3, a ring. Hovering previews the numbers; a click holds
  them open.
- **Profile** -- tier 2, the harness mark alone; the name is in its menu.
- **Model and effort** -- tier 1, one chip at full weight.
- **Permissions** -- tier 2, icon and current value, muted.
- **Status** -- only while it says something. While dictating, the dictation
  level runs here.
- **Mic** -- tier 2, in the text colour.
- **Primary slot** -- tier 1.

Tier 1 -- the model chip and the primary slot -- are the only controls at full
weight. Tier 2 shows its current value, muted. Tier 3 is information rather
than a control, and says least.

Profile, from the mark. Other profiles are greyed once the chat has started:

```
╭──────────────────────────────────╮
│ PROFILE                          │
│░◆ OpenCode 2            opencode░│
│ ◇ Conduit                     pi │
│ ⊛ Codex                    codex │
╰──────────────────────────────────╯
```

Model and effort, from the chip, with the effort submenu the label opens:

```
╭────────────────────────────────────────╮
│ ⌕  Search all models…            [⌘ K] │
│────────────────────────────────────────│
│ XAI                                    │
│░Grok 4.7                      grok-4.7░│
│ Grok 4.7 Mini            grok-4.7-mini │
│ OPENAI                                 │
│ GPT-5.6                        gpt-5.6 │
│────────────────────────────────────────│  ╭──────────────╮
│ THINKING                        High › │  │ THINKING     │
│ ●──────●──────●──────○                 │  │ Off          │
│ ·      ·      ·      ·                 │  │ Low          │
╰────────────────────────────────────────╯  │ Medium       │
                                            │░High        ░│
                                            │ Max          │
                                            ╰──────────────╯
```

The search row's keycap is whatever opens the model picker.

Permissions, with service levels as a second group where a harness has them,
and context, which previews on hover and holds open on a click:

```
╭──────────────────────────────────────╮   ╭────────────────────────╮
│ PERMISSIONS                          │   │ Context     24k / 200k │
│░Prompt        Ask before each action░│   │ ▓▓░░░░░░░░░░       12% │
│ Auto accept          Allow each once │   ╰────────────────────────╯
│──────────────────────────────────────│
│ SERVICE LEVEL                        │
│░Standard                            ░│
│ Priority                             │
╰──────────────────────────────────────╯
```

#### Mobile

One row: vertical space is what a phone has least of. Every setting stays
behind the options button, and the menu shows each one's current value.

```
╭──────────────────────────────────────────╮
│ +  Send a message…                mic  ↑ │
╰──────────────────────────────────────────╯

working, draft typed:
╭──────────────────────────────────────────╮
│ +  Also check the tests…       mic  ■  ↑ │
╰──────────────────────────────────────────╯

third line of a draft:
╭──────────────────────────────────────────╮
│ +  Fix the flaky retry in the upload  mic│
│    path: the socket drops mid-chunk    ↑ │
│    and the resume offset is wrong        │
╰──────────────────────────────────────────╯
```

- The + sits in the pill's end cap in the text colour; the mic tucks against
  Send. Both hand their width to the draft.
- The mic and Send stack the moment the draft reaches a third line. Stacked,
  the draft is a button wider and may rewrap to two lines, so they stay
  stacked until it fits on one -- the row never flips back and forth.

The empty draft is the model's name -- "Grok 4.7", cut short on one line -- which keeps it in
view at no cost in height.

The options menu shows each setting's value, not its name, as the desktop row
does: Profile heads it with context beside, then the model under its own
label, effort, permissions, attach. Values truncate rather than wrap; a
chevron says a row opens.

```
╭──────────────────────────────────────╮
│ PROFILE                  12% context │
│ ◆ OpenCode 2                       › │
│ MODEL                                │
│ Grok 4.7                           › │   ← at the chip's weight
│──────────────────────────────────────│
│ EFFORT                      High ›   │   ← the label opens the effort submenu
│ ●───────●───────●───────○            │
│──────────────────────────────────────│
│ PERMISSIONS                          │
│ ⛉ Prompt                           › │
│──────────────────────────────────────│
│ 📎 Attach files                      │
╰──────────────────────────────────────╯
```

Submenus open over the dimmed parent; a tap on the parent only returns to it.
A tap that changes the panel is over when the finger lifts: the mouse events
the phone sends after it are dropped, so they cannot land on whatever the
change left under the finger.

```
Model                                   Effort
╭──────────────────────────────────╮    ╭──────────────────────────────────╮
│ (the options, dimmed)            │    │ (the options, dimmed)            │
│ ╭──────────────────────────────╮ │    │ ╭──────────────────────────────╮ │
│ │ ⌕  Search all models…        │ │    │ │ EFFORT                       │ │
│ │──────────────────────────────│ │    │ │ Off                          │ │
│ │ MODEL                        │ │    │ │ Low                          │ │
│ │░Grok 4.7            grok-4.7░│ │    │ │ Medium                       │ │
│ │ Grok 4.7 Mini  grok-4.7-mini │ │    │ │░High                        ░│ │
│ │ GPT-5.6              gpt-5.6 │ │    │ │ Max                          │ │
│ ╰──────────────────────────────╯ │    │ ╰──────────────────────────────╯ │
╰──────────────────────────────────╯    ╰──────────────────────────────────╯

Profile                                 Permissions
╭──────────────────────────────────╮    ╭──────────────────────────────────╮
│ (the options, dimmed)            │    │ (the options, dimmed)            │
│ ╭──────────────────────────────╮ │    │ ╭──────────────────────────────╮ │
│ │ PROFILE                      │ │    │ │ PERMISSIONS                  │ │
│ │░◆ OpenCode 2        opencode░│ │    │ │░Prompt       Ask each action░│ │
│ │ ◇ Conduit                 pi │ │    │ │ Auto accept       Allow once │ │
│ │ ⊛ Codex                codex │ │    │ │──────────────────────────────│ │
│ ╰──────────────────────────────╯ │    │ │ SERVICE LEVEL                │ │
╰──────────────────────────────────╯    │ │░Standard                    ░│ │
                                        │ ╰──────────────────────────────╯ │
                                        ╰──────────────────────────────────╯
```

"Search all models…" opens the same model picker dialog, which already fills
the screen on a phone.

#### The primary slot

On both, one fixed-size button whose icon and label follow the composer's
state, so nothing beside it moves:

```
 empty draft     typed        working       working + typed
     ↑     →      ↑     →       ■      →       ■   ↑
   muted      foreground       Stop       Stop steps left;
                                          ↑ queues the draft
```

- A changing icon scales down and fades as its successor scales up from the
  same point, ~150ms. The accessible label changes at once.
- With the agent working and a draft typed, Stop steps left as a quiet square
  so the slot can queue the draft. It slides in and out rather than appearing.
  On a phone, check this at 360px with the keyboard open.
- Stop is its mark alone: a small solid rounded square in the text colour,
  no fill, the ghost wash on hover -- as Send is drawn.
- Dictating does not change the slot. The mic breathes from the text colour to
  muted and back, with no fill, size change or wash. (The slot finishing
  dictation, with the text area as the waveform, was not built.)
- Attach, +, mic and Send draw at stroke 2, heavier than the app's 1.5
  hairline; the up arrow is drawn a size up, as it fills less of its box.
- A question from the agent is not a state of the row: it is the composer
  takeover in `DESIGN.md`, and the whole composer leaves.

## 3. Move settings towards autosave

The desired direction is automatic saving whenever a setting changes, with
feedback in the top bar. This replaces the narrower server-settings proposal.
“Everything” here means editable settings and preferences, not actions such
as sending a message, installing an update, or deleting a resource.

Sketch: a valid adjustment starts saving without a separate confirmation.
Show a small spinner while a save is pending, then a “Saved” indicator. A fast
save can go straight to “Saved”; do not delay it to manufacture a spinner.
Keep the indicator readable without shifting neighbouring controls.

Text fields need a short debounce so typing does not send a request for every
character. Toggles and selections can save immediately. Invalid or incomplete
input stays editable and gets local feedback rather than a false “Saved”.

The indicator must describe confirmed persistence of the latest edits. If
another edit arrives during a save, completion of the older request must not
mark the newer value as saved. A failed save keeps the user's input and shows
a persistent failure state with Retry.

An optional Save button can provide assurance. It should trigger the same
save process and flush pending edits, rather than introduce a second save
mode. It must not report success before the write succeeds.

Start with one settings surface. Decide which top bar owns its feedback and
what happens when the user leaves with a save pending. Expand only after the
interaction works for rapid edits, slow saves, failures, and navigation.

## 4. Refine the file browser on mobile

Desktop icon sizes are acceptable. Scope this work to mobile viewports,
especially modern phones with high pixel density.

Sketch: preserve the compact visual style while making touch targets,
spacing, labels, and toolbar overflow work at phone widths. A larger touch
target does not require a larger icon. Keep file names useful and make
essential actions reachable when horizontal space runs out.

Assess viewport width, browser scale, and touch use together. Device pixel
density alone should not select a larger or smaller layout. Review on real
phones in portrait and landscape, including the file picker and an open
keyboard. Desktop density changes are outside this proposal.

## 5. Make empty states useful

Status: built, reduced. Reviewing the sketch below, an empty section does not
need its own action: the ways to start a chat or add a project or workspace
already sit in the sidebar, and a second target in every empty section would
only repeat them. Empty dashboard chat and workspace lists now read "Nothing
here yet."; Live terminals stays a live reference list with no action, since
there is nowhere useful for "Open terminal" to go. Instead, the sidebar's own
actions were made rows: **New project** is a wide row under New chat and
**New workspace** one under Files, each also on the collapsed rail, replacing
the small buttons beside the Projects and Workspaces headings. Telling
loading and a failed request apart from empty was not taken up.

The dashboard currently uses messages such as “No recent chats”, “No
Workspaces yet”, and “No live terminals”. These describe an absence but do
not provide a next step within the empty section.

Sketch: pair a short explanation with the relevant existing action: start a
chat, add a workspace, or open a terminal. Reuse the established action flow.
Keep each state compact and avoid tutorial copy or decorative illustrations.

Distinguish an empty result from loading or a failed request. An unavailable
server should offer recovery rather than suggest that the user's data does
not exist. Review both a new account and an established account with an empty
section.

## 6. Develop interaction feedback surface by surface

Consistent hover, pressed, focus, and completion feedback is a priority, but
the app does not yet have a settled design system. Do not apply blanket
changes across existing controls.

Sketch: choose one bounded surface, such as the composer actions or sidebar
actions. Define its resting, hover, pressed, keyboard-focus, disabled, and
pending states. Use brief motion only when it helps explain an action or a
state change. Touch users must receive feedback without hover.

The composer was the first such surface, with section 2: its row, menus,
primary slot and dictation state are settled and written into `DESIGN.md`.

The sidebar is the second, built. Hover and the current page were the same
grey wash, so the open chat and the one under the pointer looked alike. With
keyboard navigation coming, the wash is now the cursor -- pointer, keyboard
focus and a press share it, as in the palette and menus -- and the current
page is white and semibold with no fill, its harness mark lit, against
resting rows in grey; a current rail icon is white with a heavier stroke.
Several selected chats are the wash on each, nothing more. The
Conduit/Computer switch keeps its wash as a two-state toggle. Recorded in
`DESIGN.md` under List row.

Review that surface with the user before extending the treatment elsewhere.
Record accepted choices in `DESIGN.md` when they are ready to become a rule.
Promote a treatment into shared components only when it fits more than one
reviewed surface; similarity alone is not enough reason to migrate the app.

## 7. Motion where a surface changes place

The question tool established the rules now in `DESIGN.md` under Motion: leave
the way you came, one leaves before the other arrives, quick out and gentle in,
and a swapped surface keeps its room. These are the other places the same
treatment would explain something. Each is its own change, built in this
order and checked before the next; none is a pass over the app.

Status: steps 1 to 3 are built, and the attachment strip (7a below), which
came up while checking step 2. Step 4 is deferred: it belongs with the whole
UI fading in on load, so that sending from the dashboard can fade the rest of
the UI out while the composer slides over, and is built with that.

1. **Approvals as a composer takeover.** Built. Every approval, choice or
   typed request a harness makes is drawn as one question of one answer on the
   takeover: Approve / Approve for session / Deny as numbered rows with keys,
   choosing is answering, and Esc reads "deny" where a dismissed approval is a
   denial. The old card above the composer is gone. Each adapter still turns
   its harness's native request into Conduit's request kinds and the answer
   back; the browser draws those kinds as the question.
2. **Cards that belong to the composer.** Built. Queued messages and
   attachment cards rise out of the composer (~8px and a fade, ~300ms, gentle),
   drop back into it when it takes them (sent, or put back to edit; ~200ms,
   quick), and fade in place when removed by hand (~150ms). A failed removal
   puts the card back. Reduced motion is instant.
3. **Trace rows.** Built; tool-call rows unfold the same way. "1 tool call · Executing tool" opens and closes in one
   frame. Opening or closing, the body unfolds in height (~200ms) with a short
   fade -- a second exception to "transform and opacity only", beside the
   discarded-answer fold, because pushing what is below is what the reader
   asked for. Steps arriving in an open trace fade in with a 4px rise and no
   height change. At the tail the tail spring keeps the reader there;
   otherwise nothing above them moves.
4. **Dashboard to chat.** Deferred, see Status. Sending from the dashboard composer cuts to the chat.
   A View Transition gives the dashboard composer and the chat's composer one
   identity, so the browser moves one into the other; the first message rises
   into the list and the rest cross-fades. The send happens first and the
   transition only draws the route change after it. Browsers without View
   Transitions, and reduced motion, keep today's cut. The most delicate of
   these, so it is last.

Not proposed: the Workspace panel. It already slides in, and maximising slides
over the chat on purpose rather than squeezing it, because the chat's contents
misbehave at a narrow width.

### 7b. Other pieces built alongside

- **One Disclosure.** The trace, a tool call and a discarded answer's
  "Interrupted · not kept" row are one component (`chat/disclosure.tsx`):
  the header, one turning chevron, and the body that unfolds in height. A
  disclosure opened at the tail lets go of the tail rather than being chased,
  so it opens downward from where it was clicked; its body folds all the way
  to nothing, gap included, so closing ends without a snap.
- **The Conduit mark** is the wordmark's Druk Wide capital C, converted to a
  path (`public/brand/conduit-mark.svg`).
- **Sidebar harness marks** stay greyed with their row and show in their own
  colours while it is hovered or focused: Codex's gradient, Claude Code's
  orange, the rest at full foreground. The sidebar only, as an experiment.

### 7a. Attachment strip (side piece, from step 2)

Checking step 2 showed two things. Each attachment card flashed three times:
an upload's progress replaces its item with a new object, the card list is
keyed by object, so the card is rebuilt and its rise replays -- on paste, on
the first progress update and on done. And several attachments stack as full
cards with no bound, climbing over the transcript.

Sketch: every attachment for the draft sits in **one strip above the
composer** -- the queued pill's width and material, about twice its height
(~64px desktop, ~56px phone), never taller. More attachments scroll sideways.

```
╭────────────────────────────────────────────────────────────────╮
│ ┌──────┐ ┌──────┐ ┌──────┐ ┌─────────────────────┐ ┌──────┐  ⤢ │
│ │ ▓▓▓▓ │ │ ▓▓▓▓ │ │ ▓◔▓▓ │ │ 📄 notes.md          │ │ ▓▓▓▓ │›   │
│ │ ▓▓▓▓ │ │ ▓▓▓▓ │ │ ▓▓▓▓ │ │    4 KB              │ │ ▓▓▓▓ │    │
│ └──────┘ └──────┘ └──────┘ └─────────────────────┘ └──────┘    │
╰────────────────────────────────────────────────────────────────╯
╭────────────────────────────────────────────────────────────────╮
│ Send a message…                                                 │
╰────────────────────────────────────────────────────────────────╯
```

- **Chips.** An image is a 48px square thumbnail, cropped to fill, 8px radius
  -- legible enough to tell screenshots apart; its name is the tooltip and is
  in the dialog. A file is a 48px-tall chip: type icon, name cut short at
  ~160px, size muted beneath. Remove is a small × at the chip's top-right,
  shown on hover or keyboard focus and always on touch. Uploading, a thin
  progress ring sits over the chip and it is slightly dimmed until done; a
  failed upload is a red outline with a retry mark where the ring was, and
  tapping retries.
- **Retry.** A failed upload is sent again from the file still held for it;
  one restored with the draft has no file, so it can only be removed.
- **The strip.** Scrolls sideways with snap to chips, with a soft fade at an
  edge that has more; on desktop a vertical wheel scrolls it sideways. New
  chips go on the end and the strip scrolls to show them, which is what
  pasting several screenshots needs. A quiet expand button (⤢) at the right
  end opens the dialog; it is always there.
- **Place.** Directly above the composer, because it belongs to the message
  being written. A queued-message pill, already sent, sits above the strip.
- **The dialog.** Centred on desktop, a bottom sheet on a phone. A list, one
  row per attachment: a large preview (images up to ~160px tall, not
  cropped), name, size and type, remove. The heading gives the count and total
  size; the footer has Remove all, and Done closes it. There is no image
  viewer to open one in yet; the dialog's preview is the large view.
- **Motion** (step 2's rules). The first attachment raises the strip out of
  the composer; an added chip fades and scales in at the end; a removed chip
  fades, then the chips after it slide over to close the gap by transform
  (FLIP), not by animating width; sending drops the whole strip into the
  composer. Chips are keyed by attachment id, so an upload's progress never
  replays an entrance -- which fixes the flash.
- **Not in this change.** Opening the workspace panel on the chat's
  attachments folder needs that folder exposed first -- separate work, and it
  could replace the dialog later. Attachments already sent, under a prompt in
  the transcript, keep today's cards; they could become read-only chips after.

## Suggested order

Interrupted turns, composer hierarchy, empty states and motion are done; the
composer was the first interaction-feedback pass. Left: mobile file browsing
(4), the autosave pilot (3), and keyboard navigation, which the sidebar's
cursor was shaped for (6).
The dashboard-to-chat transition waits for a whole-UI fade on load, and is
built with it.

Each implementation should identify its affected surface, use the smallest
relevant check from `testing.md`, and leave a concrete result for user review.
The sketches above are review criteria, not claims of completed verification.
