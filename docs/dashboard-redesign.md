# Dashboard redesign

Status: seeded, not designed. Moved out of `ui-polish-sketch.md` on
2026-09-24 because the dashboards need an overhaul rather than more polish:
the wish is to redesign them and arrive at a more concrete design before
anything else is fitted to them. Keyboard navigation of their lists was the
next polish step, and was deferred for that reason -- it should come with the
new design rather than be fitted to the old one.

Covers the app dashboard (`dashboard/app-dashboard.tsx`) and the project
dashboard (`project/dashboard.tsx`). `DESIGN.md` stays the reference for the
visual language; the design here is to be written.

## What is there today

The app dashboard is an intro title ("Start where the work is."), a launch
row -- the composer, with a Search chats quick action beside it -- and a grid
of sections: Recent chats, Recent Workspaces and Live terminals. The project
dashboard is the same shape, scoped to one project.

## Carried over from the polish doc

### Empty states (polish section 5, built reduced)

An empty section does not need its own action: the ways to start a chat or
add a project or workspace already sit in the sidebar, and a second target
in every empty section would only repeat them. Empty dashboard chat and
workspace lists read "Nothing here yet."; Live terminals stays a live
reference list with no action, since there is nowhere useful for "Open
terminal" to go. The sidebar's own actions were made rows instead (New
project under New chat, New workspace under Files). Telling loading and a
failed request apart from empty was not taken up.

The original sketch, for reference: the dashboard used "No recent chats",
"No Workspaces yet" and "No live terminals", which describe an absence but
give no next step. It proposed pairing a short explanation with the
relevant existing action, keeping each state compact with no tutorial copy
or illustration, distinguishing empty from loading or a failed request (an
unavailable server offers recovery rather than suggesting the data does not
exist), and reviewing both a new account and an established one with an
empty section.

### Keyboard navigation of the lists (polish section 8, step 4, deferred)

The sidebar's cursor (`navigation/sidebar-cursor.ts`) is the model the lists
were to follow: the focused row is the wash, with no focus ring; ↑/↓ and
Home/End move; Enter opens and enters the page at its composer; Menu or
Shift+F10 opens the row's menu; the pointer and keyboard share one cursor;
Esc goes back to the composer. The sketch for the dashboards added that a
dashboard is a grid of sections rather than one list, so ↑/↓ would stay
within a section and stop at its ends and Tab would move to the next
section, and it suggested making the sidebar's cursor a shared list cursor
that takes a region, its rows and its section boundaries, so the sidebar and
both dashboards use one implementation. All of this waits on the redesign.

### What the redesign must keep

- **The first open.** Only the frame shows until the page is laid out; then
  the composer is simply there and everything around it fades in, once
  (`DESIGN.md`, Motion). Anything that shapes the layout must be in place
  before the fade.
- **Sending from a dashboard.** The message goes at once; the dashboard
  around the composer leaves (~200ms, quick), and the chat arrives once the
  message is in it, its composer travelling from the dashboard's spot to the
  foot in one move (`sendFromDashboard` in `main.tsx`). A new layout keeps a
  composer the chat's can travel from.
- **Entering the page.** Opening a dashboard from the sidebar, Ctrl+Shift+2,
  or a route change that drops focus puts focus in its composer.

## To design

The layout, what each section is for and whether it earns its place, the
project dashboard's relation to the app dashboard, and then the list cursor
on top of whatever results.
