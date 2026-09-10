# bugs/ — Conduit UI issue handoffs (read-only investigations, nothing fixed)

Each folder holds one report plus its screenshot(s). Paths inside reports are relative to that folder.

| Folder | What | Report |
|---|---|---|
| `upward-scroll-blank-viewport/` | Scrolling up blanks the transcript; nudging down repaints (virtualization) | `report.md` + `screenshot.png` |
| `workspace-dashboard-unread/` | `Recent chats` drops unread state in workspace dashboard; incl. addendum: open chat goes unread and stays unread | `report.md` + `screenshot.png` |
| `workspace-preview-timestamps/` | Feature request: created + modified time in file preview header | `request.md` (no screenshot) |
| `mobile-composer-submenu/` | Mobile `Model`/`Profile` submenus: full-row tap won't open, submenu taps instant-close | `report.md` + `screenshot.jpg` |
| `retrying-masks-errors/` | Footer sticks on `Retrying`; mid-turn 429s hidden from trace until interrupt | `report.md` + `screenshot-1-retrying.png` + `screenshot-2-after-interrupt.png` |
| `table-column-mismatch/` | 16-col table with 17-cell delimiter renders as pipe-soup — model's fault, no app fix | `report.md` + `screenshot.png` |
| `table-wide-squeeze/` | Well-formed tables squeeze to per-character wrapping instead of scrolling | `report.md` + `screenshot-hr.jpg` |

Source: incident chat `f44563aa-0cd7-4335-8e22-4b5242da0ed2` (runtime v1). Original attachments under `data/chat/files/.conduit/chats/<chat>/attachments/` — do not edit.
