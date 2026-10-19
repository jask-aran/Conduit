# Components v2 migration tracker

Track complete app subsystems here. [DESIGN.md](../../DESIGN.md#components-v2)
defines the component rules and tracks the remaining component families.
[TESTING.md](../TESTING.md) defines verification. Update this tracker in each
migration commit, with the files, evidence and remaining work.

**Status:** Open means the full subsystem migration has not started. Partial
means some pieces use v2, but the subsystem still has old paths. Complete means
the full scope meets the completion criteria below. A v2 preview or a migrated
control does not make its subsystem complete.

## Subsystems

| ID | Subsystem | Full scope | Status and evidence | Ownership |
| --- | --- | --- | --- | --- |
| V2-01 | Settings | Settings overlay, section navigation, all settings pages, fields, switches, selectors, shortcut recording, save and error states. | Partial. Switches use v2 (`e43ebf72`). The rest of Settings remains to migrate, including its native reset confirmation. | Unassigned |
| V2-02 | Sidebar and navigation | Expanded sidebar, collapsed rail, project and chat rows, server switcher, header controls, status indicators, context menus. | Open. Shared dialogs used here already use v2; navigation and its menus still need their own cutover. | Unassigned |
| V2-03 | Search and commands | Chat search, command palette, leader palette, results, keyboard hints, empty and loading states. | Open. The shared delete confirmation uses v2; the palettes and their controls remain. | Unassigned |
| V2-04 | Dashboards | Conduit, project, workspace, harness, and Computer screens; headings, lists, actions, menus, and empty states. | Open. Include the Computer explorer and workspace identity editor used inside dialogs. Coordinate dashboard composers with Claude. | Unassigned; composer changes require coordination |
| V2-05 | Panes and workspace tools | Pane headers, tabs, resize and drag controls, dock, Files, file viewer, Source Control, Chat review, and Terminal controls. | Open. Include browser-native unsaved-change confirmations, file prompts and confirmations, and the embedded code viewer. Preserve navigation and discard decisions. | Unassigned |
| V2-06 | Notifications and shared dialogs | Toasts, confirmations, prompts, previews, and other dialogs used across subsystems. | Partial. All notification calls and former `FrostDialog` surfaces use v2 (`84a154e7`, `164f3679`, `08b8564d`). Native prompts and embedded domain widgets remain; see the boundary tasks below. | Shared surface work delivered in this session; remaining work unassigned |
| V2-07 | Connection and access screens | Sign-in, first connection, server selection, reconnect, and connection error states. | Open. The Add server and pairing dialog surfaces use v2. Include the embedded server connection form. | Unassigned |
| V2-08 | Composer and transcript | Composer, riders, questions, approvals, pickers, message rows, answers, traces, Markdown, code blocks, and message actions. | Partial; Claude's scope. Recent commits record substantial cutover, including `d7ac7e33` and `17731746`. The remaining pickers, header pills and migration scaffolding need an ownership and source check before edits. | Claude; confirm remaining scope before touching it |
| V2-09 | Shared v2 foundations | Controls, navigation rows, menus, cards, overlays, keycaps, loading indicators, and status indicators. | Partial. Extend these as each subsystem needs them. Use DESIGN.md's family table for the remaining old implementations. | The agent migrating a subsystem owns its required extensions; coordinate shared-file edits |

## Completion criteria

- The live app renders actual v2 components throughout the subsystem. App
  code supplies content, state, handlers and behavior adapters.
- Missing functionality becomes a supported v2 prop, slot or shared piece.
  Update its gallery family, including the real behavioral host when a static
  example cannot show the behavior.
- Colour, typography, spacing, size, radius, surface and motion use v2 tokens.
  Styling and fixes belong in the library. Caller CSS must not override shared
  appearance, and callers must not animate a library piece from outside.
- Retain actions, values, validation, loading and error states, keyboard
  control, focus return, dismissal rules and unsaved-change protection.
- Remove the old component, its CSS, bridge rules and classic fallback in the
  same change. Update selectors and probes that read the old markup.
- A change to a shared component or token reaches every migrated use. Verify
  propagation on a representative live use; list any exception explicitly.
- Run the single relevant verification seam from TESTING.md. Record what ran,
  what it proved, and what still needs user confirmation. Commit the bounded
  change and update this tracker. Do not mark unverified behavior as verified.

## V2-06 boundary tasks

The shared in-app surfaces are delivered. These tasks remain part of the full
dialog scope and must not disappear behind a Complete label:

- [x] Route all app notifications through `components/notifications.tsx` and
  v2 `Toaster`/`Toast`, with Sonner retaining notification behavior.
- [x] Replace all former `FrostDialog` surfaces with `components/dialog.tsx`
  and v2 `Scrim`/`Card`, with Kobalte retaining modality and focus behavior.
- [x] Move shared dialog forms, fields, actions, close controls, attachment
  previews, pairing details and path previews to v2; remove old surface CSS.
- [x] Fix toast frost at the shared frame. The element that fades carries the
  frost; no partially transparent ancestor sits above a nested frost surface.
- [x] Add real notification controls under Gallery → Toast → Live engine.
- [ ] Replace native `window.confirm` and `window.prompt` paths in Settings,
  file/workspace tools and pane navigation. Assign these with V2-01 and V2-05.
  Custom dialogs require asynchronous decisions; preserve cancellation,
  navigation order and unsaved-change protection.
- [ ] Migrate the domain widgets supplied as dialog content: Computer
  explorer and workspace identity editor (V2-04), code viewer (V2-05), and
  server connection form (V2-07). They must not override the shared surface.

### Recorded verification

The shared surface migration passed typecheck, gallery build, production build
and bundle checks. Browser checks covered open/Escape/focus return, an alert's
backdrop guard, a busy dialog's Escape guard and disabled close, and the live
New folder dialog. Changing the shared Card padding token changed its live
padding from 16px to 32px; removing the override restored 16px.

For `08b8564d`, headed Chrome recorded 70 samples across two stacked toasts,
including 28 partial-opacity samples. Every animated frame carried
`blur(24px)`, with no partially transparent ancestor and no nested frost.
Repeating an ID left one toast, its action ran once, and 13 exit samples,
including seven partial-opacity samples, kept the same invariant. The user
confirmed that the dialogs and corrected toast appearance looked good.

These checks do not prove every dialog action, native-client interaction or
embedded widget. Keep that distinction when planning the next subsystem.
