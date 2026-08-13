# Clipboard file attachments

## Decision

Add native file paste to the existing attachment pipeline. A user who copies one
or more files in Windows File Explorer, focuses Conduit's message textarea, and
presses Ctrl+V will see those files upload exactly as if they had selected them
through the attachment picker. Keep ordinary text paste unchanged.

Do not add a package, native bridge, Electron API, or `navigator.clipboard.read()`
flow. The browser already exposes files for a user-initiated `paste` event through
`ClipboardEvent.clipboardData`, a `DataTransfer` object. The existing picker and
drag-and-drop paths already end at `attachments.addFiles(...)`; paste will use the
same method.

This is an implementation plan only. No production code is changed by this
document.

## Investigation findings

### The requested Windows interaction is a web-platform feature

The relevant browser APIs are:

- `paste` event on the composer textarea.
- `event.clipboardData.items`, whose file items can be converted with
  `DataTransferItem.getAsFile()`.
- `event.clipboardData.files` as the compatibility fallback.

A normal paste event gives the page clipboard data only for that user action. It
does not grant background access to the user's clipboard or expose a Windows
filesystem path. The browser materialises a read-only `File` when it supports the
OS clipboard representation.

Chrome documents desktop file reads from the clipboard, and Firefox 116 release
notes explicitly say that files copied from the operating system can be pasted
into Firefox. Current Chromium-based Edge is expected to follow the Chromium
path, but Edge must be included in the manual acceptance pass rather than being
assumed from the API name alone.

Sources:

- [Chrome 91: reading files from the clipboard](https://developer.chrome.com/blog/new-in-chrome-91)
- [Firefox 116 release notes](https://www.firefox.com/en-US/firefox/116.0/releasenotes/)
- [MDN: `ClipboardEvent.clipboardData`](https://developer.mozilla.org/en-US/docs/Web/API/ClipboardEvent/clipboardData)
- [MDN: `DataTransferItem.getAsFile()`](https://developer.mozilla.org/en-US/docs/Web/API/DataTransferItem/getAsFile)
- [web.dev: how to paste files](https://web.dev/articles/clipboard/paste-files)

### Why not `navigator.clipboard.read()`

`navigator.clipboard.read()` is the wrong primary API here. It is asynchronous,
permission-sensitive, limited by secure-context and browser policy, and is not
needed when the user has already pressed Ctrl+V. The paste event is the browser's
scoped user-gesture boundary and is the API that exposes arbitrary clipboard file
items in the browsers that support this interaction.

Using `navigator.clipboard.read()` would also create a second ingestion path,
make permissions part of the feature, and make arbitrary Windows filenames less
reliable. It is not a fallback for a browser that does not expose a file in its
paste event: the page cannot recover a local Windows path safely or legally from a
string clipboard value.

### Current Conduit state

The feature is mostly present at the server and UI layers already:

- `conduit-web/src/client/main.tsx` provides a hidden multiple-file input.
- `conduit-web/src/client/state/attachments.ts` validates the configured size
  limit, creates previews, uploads through XHR, limits concurrency to three,
  reports progress, cleans up failed/abandoned uploads, and exposes
  `addFiles(...)`.
- `conduit-web/src/client/main.tsx` already handles file drag-and-drop over the
  chat surface and calls `attachments.addFiles(...)`.
- `conduit-web/src/client/chat/composer.tsx` renders the shared attachment tray
  above the textarea and attachment button.
- `conduit-web/src/client/chat/attachments.tsx` displays thumbnails/icons,
  progress, errors, sizes, and remove controls.
- `conduit-web/src/server/routes/attachments.js` accepts streamed raw bytes and
  enforces the server-side limit.
- `conduit-web/src/attachment-store.js` publishes uploads atomically, rejects
  unsafe paths and symlinks, validates known raster image signatures, and stores
  the result inside the chat's attachment directory.
- `conduit-web/src/attachment-envelope.js` and the live-session protocol already
  send uploaded attachment IDs to Pi.

Drag-and-drop therefore does not need a new upload implementation. It should be
routed through the same small `DataTransfer` extractor as paste so both browser
entry points handle file items consistently.

## Product and UX contract

### Composer appearance

No new modal, menu, permission prompt, or native dialog appears for paste. The
user sees the existing composer tray:

```text
┌──────────────────────────────────────────────────────────────┐
│  [thumbnail]  design-notes.pdf                         [×]   │
│               38% uploading                                  │
│  [thumbnail]  screenshot.png                           [×]   │
│               1.2 MB                                         │
├──────────────────────────────────────────────────────────────┤
│  Review these files                                           │
│                                                              │
│  [mic] [paperclip] [model ▾] [profile ▾]              [↑]    │
└──────────────────────────────────────────────────────────────┘
```

The tray is the existing `.attachment-tray`, above the composer. Each pasted
file immediately becomes an ordinary upload card, uses the existing preview URL
or object URL for images, shows upload progress, and exposes the existing remove
button. Once uploaded, the attachment is included in the next prompt or queued
follow-up exactly like a picker or dropped file.

Pasting does not alter the draft text or caret. If the draft is empty, the files
still upload and remain queued, but the existing send button remains disabled
until the user supplies a message. This plan does not change the current
text-required send contract or add image-only prompting.

### Input behaviour

| User action | Result |
|---|---|
| Focus composer; paste one Windows file | Upload one file; do not insert a path or filename into the draft. |
| Focus composer; paste several Windows files | Upload all files in clipboard order, subject to the existing three-upload concurrency limit. |
| Paste a screenshot or image copied from an image tool | Upload the browser-provided image file, normally named `image.png` or similar; show the image preview when the MIME type is available. |
| Paste ordinary text | Preserve the browser's current textarea text-paste behaviour. No upload and no `preventDefault()`. |
| Paste clipboard content containing both text and files | Treat it as a file paste: upload the files and suppress the text representation. This avoids inserting a local path or duplicate clipboard text. |
| Drop files on the chat surface | Preserve the existing full-chat drop overlay and upload cards, but use the shared `DataTransfer` extractor. |
| Choose files with the paperclip button | Preserve the existing hidden file input flow. |
| Paste while Pi is generating | Preserve the existing attachment queue. The files are available for the next follow-up or steering message. |
| Paste while offline | The textarea is already disabled; no paste handler runs. |
| Remove a pasted file before send | Use the existing remove path, aborting an active request and deleting a completed unannounced upload. |

### Filename and MIME rules

1. Preserve `File.name` exactly when the browser supplies it. Windows Explorer
   filenames therefore appear in the tray and in the server's sanitized stored
   name.
2. Never expose or derive a local filesystem path from clipboard text.
3. If a browser supplies an empty filename, display and upload it under the
   fallback name `attachment`. `addFiles` must apply this fallback to the
   displayed and upload name (`file.name || "attachment"`) without copying the
   file into a second `File` object. The server already applies the same
   fallback to its sanitized stored name, but without the client fallback the
   tray would show an empty name and send an empty `?name=` query until the
   upload response replaces the item.
4. Preserve `File.type` for the upload request. If it is empty or generic, the
   existing server-side extension and signature checks remain authoritative.
5. The server continues to preview only PNG, JPEG, GIF, and WebP. Other files
   upload and download normally but remain icon cards unless a separate image
   format feature expands server MIME support.
6. Clipboard files and dropped files are not recursively expanded. Folders,
   shortcuts, URI strings, and arbitrary string clipboard items are ignored.

## Technical design

### One shared extractor

Add this exported helper to `conduit-web/src/client/state/attachments.ts`:

```ts
export function filesFromDataTransfer(dataTransfer: DataTransfer | null): File[]
```

Its exact algorithm is:

1. Return `[]` for a null transfer.
2. Iterate the item list with `Array.from(dataTransfer.items)` or an index loop,
   not `for...of`, since `DataTransferItemList` historically lacks the iteration
   protocol in some engines.
3. Keep only items whose `kind === "file"`.
4. Call `getAsFile()` for each file item. Ignore null results and continue if a
   browser throws for an unavailable clipboard item.
5. If at least one item file was returned, return those files in item order.
6. Otherwise return `Array.from(dataTransfer.files)`.

The item-first rule matters for clipboard paste: some browsers expose an OS
file through `items` even when `files` is empty or incomplete. The fallback keeps
ordinary drag-and-drop compatible with browsers that populate only
`dataTransfer.files`. The helper must not inspect string items, call
`navigator.clipboard.read()`, or attempt to resolve a path.

Keep `addFiles(files)` as the only function that turns files into upload state.
The helper only extracts browser data; it does not validate size, create object
URLs, start XHR, or display errors. That keeps picker, paste, and drop behaviour
identical after ingestion.

### Composer paste handler

In `conduit-web/src/client/chat/composer.tsx`:

1. Import `filesFromDataTransfer` alongside the existing `AttachmentsStore`
   type.
2. Add a `paste` handler adjacent to `attach`, `keydown`, and
   `selectionChanged`.
3. Read `filesFromDataTransfer(event.clipboardData)`.
4. Return without changing the event if the result is empty.
5. Call `event.preventDefault()` when at least one file exists.
6. Call `props.attachments.addFiles(files)`.
7. Add `onPaste={paste}` to the existing `textarea`.

The handler must not be installed on `window` or `document`. Scoping it to the
composer prevents a file copied for another application from being intercepted
while the user is working in Settings, the terminal, a palette input, or another
browser control. It also means the user must focus the message textarea, which is
clear and consistent with ordinary paste semantics.

The handler must not call `change(...)`: pasting a file is not text editing, so it
must not cancel voice-dictation selection state, open the slash menu, move the
caret, or rewrite the draft.

### Drag-and-drop integration

In `conduit-web/src/client/main.tsx`:

1. Import `filesFromDataTransfer` from the attachment state module.
2. Keep the existing `dragenter`, `dragover`, and `dragleave` overlay logic.
3. In `onDrop`, extract with `filesFromDataTransfer(event.dataTransfer)`.
4. Call `attachments.addFiles(files)` only when the result is non-empty.
5. Preserve the current overlay text, depth counter, event cancellation, and
   whole-chat drop target.

The picker `change` handler remains unchanged and continues to call
`attachments.addFiles(event.currentTarget.files)` directly.

### Upload and Pi protocol

No server changes are required:

- `PUT /v0/chats/:chatId/attachments/:attachmentId?name=...` remains the upload
  endpoint.
- XHR progress, authentication, request cancellation, the 100 MiB default cap,
  atomic publication, and cleanup remain unchanged.
- `pendingIds()` continues to select completed, unannounced uploads.
- `active-chat.ts` continues to copy those IDs into `prompt`, `steer`,
  `follow_up`, and `fork_and_prompt` commands.
- The server continues to resolve IDs within the selected chat and construct the
  attachment envelope before Pi receives the prompt.

This is deliberately a client ingress change, not a protocol change. Existing
transcripts, attachment persistence, message rendering, and Pi profiles remain
compatible.

## File-by-file implementation checklist

### `conduit-web/src/client/state/attachments.ts`

- Export `filesFromDataTransfer(dataTransfer: DataTransfer | null): File[]`.
- Implement item-first extraction with `getAsFile()` and `files` fallback.
- Leave `addFiles` responsible for all existing size, preview, queue, and upload
  behaviour.
- Apply `name: file.name || "attachment"` in `addFiles` so an empty browser
  filename never shows an empty card or an empty `?name=`; do not clone the
  `File` body to rename it.

### `conduit-web/src/client/chat/composer.tsx`

- Import the extractor.
- Add the file-only paste handler.
- Attach it to the existing `textarea`.
- Do not change text paste, voice dictation, slash completion, send gating, or
  composer layout.

### `conduit-web/src/client/main.tsx`

- Route the existing drop path through the extractor.
- Leave the hidden picker input and drop overlay unchanged.
- Do not add a second upload queue or a global paste listener.

### `conduit-web/test/browser/app.spec.js`

Add focused browser coverage near the existing
`uploads picker and dropped files through the same attachment surface` test.
Use the existing upload route interception so the test proves the public client
behaviour without writing repository data.

The test should:

1. Open the normal chat fixture and intercept attachment PUT requests.
2. Fill the composer with `Review these files`.
3. Construct a `DataTransfer` containing two `File` objects, one text file and
   one PNG, and dispatch a cancelable `ClipboardEvent("paste")` on the
   `Message Pi` textarea.
4. Assert that the paste event becomes `defaultPrevented`.
5. Assert that the draft remains exactly `Review these files`.
6. Assert that both files appear in the existing attachment tray.
7. Assert that both upload bodies and names reach the existing PUT route.
8. Assert that the tray is above the composer and that the image receives the
   existing preview treatment after the mocked upload response. The mocked
   response must echo an image MIME type so the persisted preview URL is
   asserted; `image/*` files already carry an object-URL preview from the moment
   they are queued, so distinguish the two preview sources in the assertion.
9. Send the message and assert that both files appear under `Message
   attachments`, as the picker/drop test already does.
10. Dispatch a text-only paste event and assert that no upload occurs and the
    event is not prevented.
11. Retain the existing picker and drop assertions; they prove those paths still
    use the same upload lifecycle.

Add one focused case for a transfer where `items` contains the file but
`files` is empty. This is the important difference between the shared helper
and the current drop-only implementation.

Because Node's test environment does not provide a native `DataTransfer`, this
is browser coverage rather than a new Node unit test. If the helper is kept
structural and extracted into a separate pure module, add a unit test with a
small fake transfer as well; do not manufacture a second production path just
for testability.

### `conduit-web/README.md`

After implementation, update the current client composition/runtime description
to say that the composer accepts files through the picker, chat-surface
 drag-and-drop, and Ctrl/Cmd+V when the browser exposes clipboard file items.
State that ordinary text paste remains text paste and that server limits still
apply. This keeps the current-state contract aligned with the UI.

## Manual Windows acceptance

Automated browser tests can synthesize a `DataTransfer`, but they cannot prove
that Windows File Explorer has populated the browser's clipboard with file
items. A real Windows pass is therefore required before calling the feature
complete.

Use the authenticated Conduit instance in a real Windows browser. Test with
small files first so a failure is clearly a clipboard-bridge failure rather
than an upload-size failure.

### Chrome on Windows

1. Open a chat and focus the message textarea.
2. Type `Review these files` and leave the caret in the textarea.
3. In Windows File Explorer, select a `.txt`, `.png`, and `.pdf` file and press
   Ctrl+C.
4. Return to Conduit and press Ctrl+V.
5. Confirm that the draft is still exactly `Review these files`; no path,
   filename, or text representation is inserted.
6. Confirm that three cards appear above the composer, retain the Windows
   filenames, and upload without opening the attachment dialog.
7. Confirm that the PNG card previews when the upload completes and that the
   text/PDF cards use file icons.
8. Send a message and confirm all three cards appear under the user message.
9. Repeat with a screenshot copied from Snipping Tool or Win+Shift+S. Confirm
   it becomes an image attachment.
10. Copy ordinary text from Notepad and paste it into the composer. Confirm it
    inserts text normally and does not create an attachment.

### Edge on Windows

Repeat the Chrome cases. Record the exact browser version and whether Explorer
files arrive through `clipboardData.items`, `clipboardData.files`, or both if
diagnostics are temporarily added locally. Do not ship diagnostics merely to
support this test.

### Firefox on Windows

Repeat the same cases on Firefox 116 or newer, with emphasis on a real Explorer
file and a multi-file selection. Firefox's release notes explicitly cover OS
file paste, but the actual file-item shape and generated MIME/name values still
need to be observed.

### Negative and boundary cases

- Paste a file while the textarea has an existing selection: the selection and
  draft must remain unchanged.
- Paste an oversized file: the existing attachment-limit error must appear and
  no published attachment may remain.
- Paste, remove during upload, then navigate to another chat: the existing
  abort/delete/cleanup behaviour must hold.
- Paste a folder or shortcut: no path string may enter the composer and the app
  must not crash. No recursive folder upload is promised.
- Drop the same three files: the existing overlay and upload behaviour must be
  unchanged.

Record results by browser and version. A synthetic Playwright test is not
sufficient evidence for the Windows Explorer cases.

## Compatibility and failure policy

### Release support target

| Environment | Plan |
|---|---|
| Current Chrome desktop on Windows | Release target; verify Explorer single- and multi-file paste manually. |
| Current Edge desktop on Windows | Release target if the manual pass exposes files through the paste event. |
| Firefox 116+ desktop on Windows | Release target; the platform explicitly supports OS file paste. |
| Safari desktop | Preserve ordinary text paste and picker/drop. Do not claim file-paste support until separately verified. |
| Mobile browsers and installed PWA shells | Preserve picker/drop where available. File paste is not a release requirement for this slice. |
| Old browsers with no file item in the paste event | No upload; preserve ordinary text paste. No native fallback is possible. |

If the browser exposes only a string path or URI, ignore it. Never fetch a local
path, pass it to the server, or attempt an OS-specific API from the web client.

### Error handling

Use the existing attachment errors without new wording:

- Oversized files are rejected by `addFiles` before upload.
- Failed uploads mark the card as error and call the existing error handler.
- Network failure, chat navigation, and removal use the existing XHR lifecycle.
- A browser that exposes no file items produces ordinary text-paste behaviour.

The only new event rule is that a paste event containing at least one extracted
file is cancelled so the browser cannot also insert its text representation.

## Non-goals

- Reading the clipboard without a user paste action.
- Uploading folders, directory trees, Windows shortcuts, or local paths.
- Adding a native Windows integration or Electron/Tauri bridge.
- Supporting arbitrary image formats in server previews.
- Changing attachment size limits, concurrency, persistence, or Pi protocol.
- Sending an attachment without a user message.
- Adding a paste button or clipboard permission settings.
- Making file paste work in every mobile browser.

## Acceptance criteria

The implementation is accepted when all of the following are true:

1. Picker, drop, and paste all call the same `attachments.addFiles(...)` upload
   path.
2. A file-bearing paste on the focused composer prevents default text insertion.
3. A text-only paste is not prevented and behaves as it did before.
4. One and multiple files paste in order and retain browser-provided names.
5. The draft and caret do not change when files are pasted.
6. Existing cards, progress, previews, remove controls, send behaviour, and Pi
   attachment envelopes work unchanged.
7. Automated browser coverage proves the handler, the `items`-only case, text
   preservation, upload requests, and the existing drop path.
8. Real Windows Chrome, Edge, and Firefox tests record the result of copying
   files from Explorer and pressing Ctrl+V.
9. The README describes the resulting browser-dependent behaviour.
10. `npm run typecheck`, `npm run build`, and `npm test` pass, and the focused
    browser test passes under the project-prescribed Playwright command from
    `docs/operations/testing.md`. `npm test` runs only the Node unit suite; the
    synthetic paste coverage ships in `test/browser/app.spec.js` and is not
    native Windows evidence.

## Estimated implementation size

The code change is small: one shared extractor, one textarea event handler, a
drop-path refactor, and focused browser coverage. Allow roughly half a day for
the implementation and automated test, plus a separate manual Windows browser
pass. The main uncertainty is not Conduit's upload plumbing; it is whether each
target browser exposes a Windows Explorer file as a `File` in its paste event.
