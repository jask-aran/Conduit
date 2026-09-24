# Transcript mode

Status: seeded, not designed. Moved out of `ui-polish-sketch.md` on
2026-09-24 because walking and acting on the transcript from the keyboard
wants a more concrete design of its own, rather than being the last step of
the polish doc's keyboard section.

## Why a mode

↑ from the composer already walks the messages sent before, so it cannot
also be the way into the transcript. Walking and acting on turns becomes an
explicit **transcript mode** instead -- entered on purpose, as Codex CLI's
double Esc enters its backtrack mode, which highlights earlier messages in
the transcript to choose one and edit from there. Until the mode is entered
the transcript only scrolls, and the composer keeps every key it has today.

## Carried over from the polish doc (section 8)

- **The cursor is the wash.** A transcript turn takes the same wash as a
  sidebar row; a washed turn appearing is the signal that the cursor is
  there. No focus ring (`DESIGN.md`, List row).
- **Moving.** ↑/↓ move by turn, Home/End go to the ends, and →/← step into
  and out of a turn -- its trace, tool calls and code blocks -- opening and
  closing them through the one Disclosure (`chat/disclosure.tsx`).
- **Acting.** Turn actions -- copy, fork, edit, retry -- through the row's
  menu (Menu or Shift+F10), and later as the transcript's own leader keys:
  the context tree was drawn so that R could rename on a sidebar row and
  regenerate on a transcript turn.
- **Getting back.** Esc steps out a level at a time and, from the top,
  leaves the mode for the composer: pressing Esc enough always gets back to
  typing.
- **A region already.** The transcript is a region (`data-region=
  "transcript"`, inside the chat), so the mode's keys can be scoped to it.
  Its viewport takes focus for scrolling from the keyboard; the Go to
  transcript command has no default key.

## To design

- How the mode is entered: double Esc from the composer, a leader key, or
  both -- and what Esc already means there (a queued message, an open menu,
  a running turn) so the second press is never ambiguous.
- What the mode looks like while it is on, and where the cursor starts:
  the latest turn, or the latest message you sent, as backtrack does.
- Which turns and parts are stops: user messages, answers, traces, tool
  calls, code blocks.
- The actions and their keys, and how edit and fork from a turn hand back
  to the composer.
- How it behaves while a turn is streaming, and on a phone.
