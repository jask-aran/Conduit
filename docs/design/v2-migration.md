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
| V2-01 | Settings | Settings overlay, section navigation, all settings pages, fields, switches, selectors, shortcut recording, save and error states. | Partial. Switches use v2 (`e43ebf72`). Reset confirmation uses the shared v2 decision queue; the rest of Settings remains to migrate. | Unassigned |
| V2-02 | Sidebar and navigation | Expanded sidebar, collapsed rail, project and chat rows, server switcher, header controls, status indicators, context menus. | Open. Shared dialogs used here already use v2; navigation and its menus still need their own cutover. | Unassigned |
| V2-03 | Search and commands | Chat search, command palette, leader palette, results, keyboard hints, empty and loading states. | Open. The shared delete confirmation uses v2; the palettes and their controls remain. | Unassigned |
| V2-04 | Dashboards | Conduit, project, workspace, harness, and Computer screens; headings, lists, actions, menus, and empty states. | Open. Computer explorer and workspace identity editor now render v2; the other dashboard presentations remain. Coordinate dashboard composers with Claude. | Unassigned; composer changes require coordination |
| V2-05 | Panes and workspace tools | Pane headers, tabs, resize and drag controls, dock, Files, file viewer, Source Control, Chat review, and Terminal controls. | Open. Confirmations, file prompts and the embedded code excerpt now use v2; pane controls and the editable file viewer remain. | Unassigned |
| V2-06 | Notifications and shared dialogs | Toasts, confirmations, prompts, previews, and other dialogs used across subsystems. | Complete cutover. Sonner and Kobalte retain engine behavior. All internal native decisions and the embedded widgets now render v2. Verification has one pane-smoke failure; see below. | Delivered in this session |
| V2-07 | Connection and access screens | Sign-in, first connection, server selection, reconnect, and connection error states. | Partial. Rendering is fully cut over, including browser sign-in, first connection, server/route selection and recovery. Phone route-panel initial focus blocks completion; see V2-07 evidence below. | This session; verification blocker recorded |
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

The full dialog scope includes shared surfaces, async decisions and embedded
content. All paths below now use v2:

- [x] Route all app notifications through `components/notifications.tsx` and
  v2 `Toaster`/`Toast`, with Sonner retaining notification behavior.
- [x] Replace all former `FrostDialog` surfaces with `components/dialog.tsx`
  and v2 `Scrim`/`Card`, with Kobalte retaining modality and focus behavior.
- [x] Move shared dialog forms, fields, actions, close controls, attachment
  previews, pairing details and path previews to v2; remove old surface CSS.
- [x] Fix toast frost at the shared frame. The element that fades carries the
  frost; no partially transparent ancestor sits above a nested frost surface.
- [x] Add real notification controls under Gallery → Toast → Live engine.
- [x] Replace native `window.confirm` and `window.prompt` paths in Settings,
  file/workspace tools and pane navigation.
  Custom dialogs require asynchronous decisions; preserve cancellation,
  navigation order and unsaved-change protection.
- [x] Migrate the domain widgets supplied as dialog content: Computer
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

### Full decision and content cutover

`components/decision-dialog.tsx` replaces every internal `window.confirm` and
`window.prompt` call. Pane/file callers await Cancel or acceptance before
changing state; scoped identity and per-target guards reject stale answers.
The queue restores focus before resolving and cancels requests if its host
unmounts. Browser-owned `beforeunload` tab-close protection remains native.

The embedded content now uses `components/ui/identity.tsx`, `browser.tsx`,
`connection.tsx` and `code-excerpt.tsx`. Domain state stays with the app;
CodeMirror, Kobalte and Sonner retain their engine roles. The old identity,
Computer, connection, scanner and excerpt presentation CSS was removed.
Card → Forms covers real decisions and the embedded content at both densities.

Executed: typecheck, gallery build, production build and bundle checks passed.
Headed Chrome covered prompt initial selection, Escape, queue ordering, empty
prompt values, stale-target rejection and focus return. The live file viewer
also kept an unsaved edit after Cancel, asked again on close, then closed after
Discard; no file was saved. Explorer search, details, hidden files and context
menus passed. Identity icon search, custom colour and monogram controls passed;
changing its v2 text token changed the live input from 10.4px to 20px and was
then removed.

`npm run smoke:panes -- --project NHP` passed 7/8 scenarios. The remaining
failure is `file still bold once focus leaves`. A direct empty-main-space
focus check changes the file marker to `shown`; the smoke's coordinate click
remains unproven. The default smoke selected Conduit, which has only five
visible files despite enough API entries including hidden files; its first
two scenarios timed out waiting for the sixth. That run was stopped. The
fixture selection needs a test-tool follow-up. The remaining assertion needs
further diagnosis; its cause is not established.
Camera hardware, server discovery/sign-in, push and destructive filesystem
actions were not exercised.

## V2-07 connection and access cutover

All access rendering now comes from `components/ui/connection.tsx`, the v2
controls/status pieces, and `Menu`/`Section`/`Item` with Kobalte behavior.
`ServerSwitcher` retains probing, identity checks, automatic/pinned routes,
browser/native restrictions, downloads, update checks, pairing and sign-out.
The phone behavior keeps its tap guard and Back handling. Old server-picker,
first-connection, sign-in and root-error markup/CSS and the picker library
preview branches were removed.

The browser login page remains a plain server-rendered form. The normal Vite
build renders its templates from the actual v2 components and emits their
hashed CSS. The server substitutes only escaped error and redirect data. It
reads the template from the configured client distribution. There is no
second stylesheet or legacy fallback. `styles/theme.css` owns the shared dark
colour tokens for both the app and standalone page.

Executed: typecheck, gallery build, production build and bundle checks passed.
Three selected existing auth-server tests passed: access enforcement,
login/logout/rate limiting and safe redirects. A built-template check passed
escaped error/redirect values and error accessibility. Headed Chrome confirmed
the live `/login` page has zero scripts, autofocus, the original POST target,
the hidden redirect, and a shared input token that changes from 10.4px to 20px
and restores. The live server control uses v2 with no old sidebar-user node.
Gallery desktop checks covered checked/disabled radio rows, keyboard submenu
opening and route selection. The phone panel stays within a 412px touch
viewport; Escape returns to the parent. Selecting a manually focused route
closes both layers and restores the trigger.

**Open blocker:** opening the phone route panel leaves initial focus on the
parent Route row. Two fixes were attempted, then work on that error stopped
under the operator's two-attempt rule. The nested Kobalte scope now permits
focus to enter and stay in the child, but the initial activation still leaves
focus on Route. Separate scope instances were ruled out by installed-source
inspection; a focus trace confirms manually focusing a child row succeeds.
The leading hypothesis is an activation handler restoring focus after mount.
The next diagnostic is to trace focus calls across the opening keydown/keyup
and scope mount. Do not mark V2-07 Complete until that check passes.

Hardware sign-in, secure token storage, discovery, camera scanning and native
Android Back were not exercised. Their domain logic was retained.
