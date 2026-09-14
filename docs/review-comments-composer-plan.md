# Review comments to composer

Select lines in a diff or a file, leave a note, and have it land in the composer
as a chip. On send the agent receives the path, the line range, the captured
excerpt, and the note. Straight-to-build plan; no separate spec.

Out of scope, deliberately: a general typed context-record union for every chip
kind, clipboard round-trip between chats, and rendering chips inside sent
messages in the transcript beyond a readable block. The wire shape below is
chosen so each is additive rather than a rewrite.

## Why this shape

Every code surface in Conduit is CodeMirror 6. `workspaceReadOnlySetup`
(`conduit-web/src/client/workspace/workspace-editor-base.ts:209`) is shared by the
comparison view and the file viewer; the comparison builds its extension array at
`workspace-comparison.tsx:62-77` and the editor at `workspace-editor.tsx:171-201`.
Both already observe selection in an `EditorView.updateListener`
(`workspace-comparison.tsx:67`, `workspace-editor.tsx:185`) to drive the
`Ln x, Col y` readout. The capture point exists. What is missing is somewhere to
put the result and a way for the composer to see it.

The composer and the workspace panel are siblings, not ancestors. `main.tsx:1988`
and `main.tsx:1989` mount `WorkspacePanel` at the shell's top level; `<Composer>`
lives inside `work-area-conversation` at `main.tsx:1940`. Threading a callback
down would add a prop to `WorkspacePanel` (already 20 props on one line,
`workspace-panel.tsx:208`), then `WorkspaceDiffView`, then `WorkspaceComparison`.
A module-level store keyed by chat id — the idiom `chat/composer-surface.ts`
already uses for a cross-tree preference — is the smaller change and leaves the
panel's prop list alone.

Comments are draft state, not chat state. They live in the browser until send,
like the draft text itself. Attachments are the counter-example and the reason
not to copy them: attachments are server-owned per chat
(`state/attachments.ts:139` `select()` refetches them), which is right for bytes
and overkill for a line range and forty characters of note.

## Phases

| Phase | Lands | New files |
| --- | --- | --- |
| 1 | Record shape, store, provider serialization, tests | `chat/review-comments.ts`, `test/review-comments.test.js` |
| 2 | Selection popup in the comparison view | `workspace/workspace-annotate.ts` |
| 3 | Chips above the composer | edits only |
| 4 | Send path and transcript rendering | edits only |
| 5 | File viewer reuse | edits only |

Phases 1–4 are the feature. Phase 5 is one extension registration once phase 2
is a shared factory.

## Phase 1 — record, store, serialization

`conduit-web/src/client/chat/review-comments.ts`. Pure except for the signal; it
is the module every other phase imports.

```ts
export interface ReviewComment {
  id: string;                          // rc_<uuid slice>
  chatId: string;                      // owner; drops when the chat changes
  path: string;                        // workspace-relative, as the diff reports it
  side: "original" | "modified";       // which half of a split comparison
  scope: DiffScope | "file";           // reuse workspace-review-source.ts:7
  from: number;                        // 1-based inclusive line
  to: number;                          // 1-based inclusive line
  excerpt: string;                     // captured lines, capped
  note: string;                        // may be empty: a bare pointer is valid
}

export const MAX_REVIEW_COMMENTS = 12;
export const MAX_EXCERPT_BYTES = 4 * 1024;
export const MAX_NOTE_LENGTH = 2000;
```

Store, mirroring `composer-surface.ts`'s module-level shape but with a signal so
Solid tracks it:

```ts
const [comments, setComments] = createSignal<ReviewComment[]>([]);

export const reviewComments = (chatId: string) =>
  comments().filter((comment) => comment.chatId === chatId);
export function addReviewComment(comment: ReviewComment): boolean;  // false at the cap
export function updateReviewComment(id: string, note: string): void;
export function removeReviewComment(id: string): void;
export function clearReviewComments(chatId: string): void;
```

`clearReviewComments` is called from `active-chat.ts` `reset()` (line 277, beside
the `setDraft("")` at line 288) and after a successful send, next to
`attachments.markAnnounced()` at `active-chat.ts:782` and `:800`.

### Serialization

One function, `projectReviewComments(text, comments)`, returns what the backend
receives. The draft the user sees is never rewritten.

```
<review_comment path="src/chat-backend.js" lines="44-51">
<excerpt>
  agentProfiles() {
    return [{ id: "assistant" }];
```
</excerpt>
<note>this literal is the thing phase 1 of the harness plan removes</note>
</review_comment>
```

Two rules that are not optional:

- **Escape the excerpt.** Captured code can contain `</review_comment>` or
  `</excerpt>`. Escape any `<` that would open or close either tag before
  embedding. Without this a reviewed file can forge a comment block, which is a
  prompt-injection boundary, not a formatting nicety.
- **Append, never interleave.** Blocks go after the prose in creation order.
  Inline positioning is what a full context-reference grammar buys; it is not
  worth a Lexical-style editor in a `<textarea>` composer
  (`composer.tsx:439` is a plain textarea bound to `chat.draft()`).

Tests in `test/review-comments.test.js`, matching the `node --test` +
direct-`.ts`-import style of `test/composer-slash-commands.test.js`: cap
enforcement, excerpt truncation on a byte boundary, escaping of a forged
closing tag, chat-id scoping, and stable ordering.

## Phase 2 — selection popup

`conduit-web/src/client/workspace/workspace-annotate.ts` exports one factory:

```ts
export function annotationExtension(options: {
  side: "original" | "modified";
  onSelect: (selection: AnnotationSelection | null) => void;
}): Extension
```

It returns `EditorView.updateListener.of(...)` that, on `update.selectionSet`,
reads `update.state.selection.main`, ignores empty ranges, and reports:

```ts
{ side, from: doc.lineAt(range.from).number, to: doc.lineAt(range.to).number,
  excerpt: doc.sliceString(doc.lineAt(range.from).from, doc.lineAt(range.to).to),
  coords: view.coordsAtPos(range.head) }
```

`coordsAtPos` returns viewport coordinates, which is all the popup needs.

Wire it in `workspace-comparison.tsx` beside the existing listener at line 67.
The extension array at line 62 is shared by both halves of a `MergeView`
(line 83: `a: { doc: data.original, extensions }, b: { doc: data.modified, extensions }`),
so `side` cannot be baked into that array. Split it:

```ts
const extensions: Extension[] = [ /* unchanged, lines 63-77 */ ];
const sideExtensions = (side: "original" | "modified") =>
  [extensions, props.onAnnotate ? annotationExtension({ side, onSelect: setPendingSelection }) : []];
```

then `a: { doc: data.original, extensions: sideExtensions("original") }`,
`b: { ... sideExtensions("modified") }`, and the unified branch at line 87 uses
`sideExtensions("modified")` — the unified merge view's own doc is the modified
one, with deletions rendered as widgets.

The popup itself is Solid, not a CodeMirror tooltip. A `<Show>` over
`pendingSelection()` rendering an absolutely positioned button inside
`.workspace-comparison` (the section at `workspace-comparison.tsx:156`), styled in
`workspace-comparison.css`. This keeps the styling in the file that already owns
comparison chrome and avoids `@codemirror/view`'s tooltip plumbing for a
single-button affordance.

Two states:

1. **Collapsed** — a single "Comment" button at the selection head.
2. **Expanded** — a textarea for the note plus **Add**. `Enter` adds, `Escape`
   collapses, clicking outside collapses. Empty note is allowed: the chip is
   then a bare pointer at the lines.

Clear `pendingSelection` when the selection empties, when the comparison's
`identity()` memo changes (`workspace-comparison.tsx:40`), and in the existing
`onCleanup` at line 144.

`WorkspaceComparison` gains one optional prop, `onAnnotate?: (selection) => void`,
passed through `WorkspaceDiffView` (`workspace-diff-view.tsx:15-32` props
interface, forwarded at line 65) from the two call sites in
`workspace-panel.tsx:1863` and `:1886`. The panel supplies
`props.artifactChatId?.()` as the owning chat and does not pass the prop at all
when that is null — the `/computer` mount (`main.tsx:1988`) has no chat behind it
and must not offer commenting.

## Phase 3 — chips

`AttachmentCards` already occupies the slot above the textarea
(`composer.tsx:423`). Review chips render immediately below it, from the same
`<Show when={props.attachmentsSupported !== false}>` guard, as a
`.composer-review-comments` row.

Each chip: file icon, `name.ts:12-18`, the note truncated, a pencil that reopens
the note field inline, and an `×` calling `removeReviewComment`. Reuse
`FileTypeIcon` from `workspace/file-type-icon.tsx` — it is already imported by
`workspace-review.tsx:4` and has no workspace-panel dependency.

Hovering a chip shows the excerpt in a popover. Clicking it is a no-op in this
phase; "jump back to the source" needs the panel to be open on that scope and is
worth its own change.

## Phase 4 — send

`active-chat.ts` `send()` builds `text` at line 766. Insert the projection
between the trim and the optimistic message:

```ts
const text = draft().trim();
const comments = reviewComments(loadedId() ?? "");
const outbound = projectReviewComments(text, comments);
```

`outbound` goes on the wire (lines 781, 803, 949 — steer, first send, and
`interrupt_and_send` all need it). `text` stays in the optimistic `Message` at
line 771 so the transcript shows what the user wrote. On success, clear the
comments beside `attachments.markAnnounced()`. On failure, the existing
`setDraft(text)` restore at line 783 and line 813 must leave the comments in
place — they were never cleared, so this is automatic as long as clearing
happens after the socket send resolves, not before.

Transcript rendering: the sent message content is the prose only, so nothing
changes by default. To show what was attached, persist the projected blocks
alongside the message and render them as static chips. Defer that. The honest
interim is that the user sees their prose and the agent sees prose plus blocks,
which is the same asymmetry attachments already have.

## Phase 5 — file viewer

`workspace-editor.tsx:171` builds its own extension array (`stateExtensions`) and
already has a selection listener at line 185. Add `annotationExtension({ side: "modified" })`
there with `scope: "file"` and the same popup component, hoisted into a shared
`workspace/workspace-annotate.tsx` alongside the extension. The record's `from`
and `to` mean file lines rather than diff lines; nothing else changes.

The terminal is the natural third surface and is explicitly not in this plan: it
needs excerpt capture out of the ghostty renderer, which is a different problem.

## Verification

| Check | How |
| --- | --- |
| Cap, truncation, escaping, scoping | `node --test test/review-comments.test.js` |
| Popup appears on selection in unified and split | Manual, both layouts, `workspace-comparison.tsx` view menu |
| Correct side reported in split | Comment on a deleted line; record says `original` |
| Line numbers match the gutter | Compare against the `Ln x` readout at `workspace-comparison.tsx:69-70` |
| Comments survive scope changes | Switch diff scope; chips stay, popup clears |
| Comments drop on chat switch | `reset()` clears; open another chat, composer is bare |
| Agent receives the block | Send with a comment, check the harness transcript |
| No commenting on `/computer` | Panel at `main.tsx:1988` renders no popup |
| Forged tag is inert | Comment on a file containing `</review_comment>` |
