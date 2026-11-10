# Keyboard model

Status: agreed and built 2026-11-03 (gaps 1–8; the computer dashboard keeps native Tab, its cursor is a redesign). Reviewed by Codex for implicit state and races; fixed. Still open: entering a jbot message's own links and controls by keyboard; the find bar sits over the text it searches; Go to transcript's Ctrl+Shift+4 is the macOS screenshot chord. It extends DESIGN.md › Keyboard (2026-10-18), and wins where they differ. The
inventory it rests on is HEAD 96a382e7: the sidebar, panes, palettes and dashboards were built in October, and
Settings on 2026-11-03.

## What exists

- **One dispatcher.** The command registry (`commands/command-registry.ts`) and the shortcut manager
  (`shortcuts/shortcut-manager.ts`):
  - Contexts come from `data-region` around focus, plus the overlays' own contexts.
  - Two-stroke chords run through the leader (Ctrl+G), which opens a menu of the keys valid in each level.
  - Overrides are kept in the hub's `keybindings.json` and edited in Settings › Shortcuts.
- **Regions.**
  - The sidebar, the main pane and the panes beside it, the dock (workspace panel), and terminals.
  - Go-to chords: Ctrl+Shift+1 (sidebar), Ctrl+Shift+2 (main pane, cycling through panes when split), Ctrl+Shift+3
    (dock).
  - Stepping: Alt+[ and Alt+] step tabs; Alt+Shift+[ and Alt+Shift+] step panes.
- **Lists with a cursor.**
  - The sidebar (`sidebar-cursor.ts`), the dashboards (`split-cursor.ts`), the file tree and the palettes.
  - The cursor is drawn as the wash; the current item shows as white text.
- **Surfaces that grew their own rules.** Settings, the question card, the composer, chat search and the terminal.

Each region was built well on its own, but they don't share one grammar. The inventory found:
- four Tab models;
- lists that wrap and lists that clamp;
- no common Escape ladder, and five regions with no Escape at all;
- keys hard-coded outside the registry;
- one modal (Settings) under which app chords still fire;
- whole regions with no keyboard path at all.

## The grammar

Every region answers the same four questions in the same way.

### 1. Enter

- **Every region has one way in from anywhere:**
  - a go-to chord (Ctrl+Shift+1/2/3);
  - for anything inside a region, a leader key under that region;
  - for modals, the modal's own chord (Ctrl+K, Ctrl+Shift+K, Ctrl+Shift+X, Ctrl+,).
- **Arriving lands on the region's anchor:**

  | Region | Anchor |
  |---|---|
  | Sidebar | The current page's row |
  | Pane | Its last focus, else its composer |
  | Dock | Its tab's default |
  | Settings | Search |
  | Palette | Its input |

- **The held line follows focus; the region cue marks a keyboard arrival.** The held line (`[data-region]::after`, lit
  by `data-focus-held`) moves to whichever region focus enters, by click, Tab or chord. Only a go-to chord also draws
  it out from its middle (the region cue, `region-cue.ts`). Nothing else on screen changes. (Revised 2026-11-03: a
  line that vanished on a click read as inconsistent.)

### 2. Move

- **Tab moves between groups; arrows move inside a group.**
  - A group is a list (sidebar section, dashboard group, tree, results), a toolbar, or a form.
  - A list is **one** Tab stop, with roving focus, landing on its remembered row.
  - A form (a Settings page, a dialog) tabs control to control, because each control is a group of one.
  - This keeps the dashboards' model and makes it the rule.
  - Changes needed: the sidebar moves to roving focus (today every row is a Tab stop). The palette keeps Tab for "enter
    page".
- **Lists clamp at both ends**, they don't wrap. ↑ at the top hands on to what is above the list (a heading's
  controls, a search field), as the sidebar and dashboards already do. Change: the Settings rail and the palette clamp
  too. Hitting the end of a list is information, and wrapping hides it.
- **Inside a list:**

  | Key | Does |
  |---|---|
  | ↑ ↓ | Move |
  | Home, End | First, last |
  | → ← | Into or out of a folder, or across a toolbar |
  | Enter | Opens |
  | Menu key or Shift+F10 | The row's menu |
  | Shift+↑ ↓ | Extend a selection, where rows can be selected |
  | Typed letters | Typeahead, where the list has no field of its own; where it has a field, letters go to the field |

### 3. Act

- **Enter does the row's main thing.** The row's other actions go in its menu, never on bare letters.
  - Exception: edit modes the user turned on (chat search's edit mode keeps M and D).
- **Commands with a modifier act from anywhere in their context.** They live in the registry, so they show in the
  leader menu and Settings › Shortcuts and can be rebound.

### 4. Leave: the Escape ladder

Escape always steps out exactly one level. It never does an action, and never jumps more than one level.

1. A layer opened inside the region closes: menu, popover, slash menu, rename field.
2. A transient state clears: query, selection, filter, recording, pending leader.
3. Focus inside a group goes to the group's anchor: a folder's link, a list's heading, the Settings rail.
4. Focus leaves the region:
   - a modal closes;
   - any other region hands focus to the main pane's composer (the app's home).
5. In the composer, Escape does nothing. Stopping a turn moves to its own chord, because today the same key means both
   "back out" and "stop the agent". The chord is still to be picked: Ctrl+. is the dock, and Ctrl+Shift+Escape belongs
   to Windows. The stop button stays.

Regions that need an Escape:
- the transcript (→ composer);
- the dock (→ composer of the pane it belongs to);
- the file viewer (→ its pane's composer);
- the browser address field (→ the page, not the body).

Terminals keep Escape for the TUI. They leave by chord only, which the terminal already allows.

## Look

- **Cursor = wash; current = white text.** They are never drawn the same way.
  - Change: Settings' search results draw their cursor with the wash, not with `current`.
- **Controls show their own focus.** A button tints, a field's line brightens, a switch's border lights. Rows that are
  not one target (setting lines) have no wash (17a0f688).
- **While the window is blurred, the held state keeps the cursor visible** (`data-held`).

## Ownership

- **Every key is a command in the registry.** That includes keys inside a surface: the composer's Enter variants, its
  history keys, chat search's Ctrl+P, `/` and Space, Settings' `/` and Ctrl+F, the file tree's Alt+Enter and the
  question card's digits.
  - Each is declared with the context it works in.
  - Text-editing keys are the exception: typing, Backspace, the caret.
- **A modal is an exclusive context.**
  - While Settings or a dialog is open, app chords don't fire underneath (today Ctrl+B and Ctrl+Shift+1 do).
  - The modal's own chord is the exception and closes it.
  - Settings becomes exclusive; its rail and search keys become its commands.
- **One leader key means one thing at every level, or the menu says which one runs.** Today D is Changes on a
  dashboard and "Move to dock" in a pane. Proposal: Move to dock becomes Shift+D everywhere.

## Gaps, in order

1. Make Settings exclusive, have its result cursor use the wash, and make its rail clamp (small; done with the model).
2. The Escape ladder: rung 5 (the stop chord) and an Escape out of the transcript, dock, file viewer and address
   field.
3. Sidebar roving focus (one Tab stop).
4. Move the hard-coded keys into the registry (Settings › Shortcuts then lists everything).
5. The transcript as a list: a turn cursor (↑ ↓ between turns, Enter expands, Menu key to copy, retry and so on).
6. Find in chat (Ctrl+F in a pane) to replace the browser's find. This needs a decision because of the leader:
   Ctrl+G is the browser's "find next". Proposal: in-app find uses Enter and Shift+Enter for next and previous, so it
   doesn't need Ctrl+G.
7. Keyboard paths where there are none:
   - closing and swapping tabs and panes (leader keys under the pane);
   - the tool rail's extras (docked panes, layouts, Equalise; leader keys under the dock);
   - the jbot messages column (a list, like the transcript);
   - the computer dashboard (moves onto `SplitDashboard`).
8. Leader keys for the sidebar (new chat, new folder, filter) so its level isn't empty.

## Checking it

- One probe per region drives enter, move, act and leave in the headed Chrome. Settings' probe from 96a382e7 is the
  pattern.
- The shortcut-manager tests cover exclusivity and the Escape ladder's dispatch order.
