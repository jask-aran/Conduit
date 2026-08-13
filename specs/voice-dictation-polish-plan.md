# Voice merge sprint implementation plan

This document is the single plan for the voice merge sprint. It combines the
managed-model integrity, microphone routing, dictation interaction, and
recorder-feedback work. Completed items remain here as the implementation
record; the final section is the remaining build scope.

## Goal

Make local voice dictation reliable and easy to understand:

- model downloads must use reviewed immutable artifacts;
- users must be able to choose and verify the input device;
- recording must start without waiting for the ASR handshake;
- the UI must show where the recording is in time and how loud it is;
- users must be able to cancel or remove dictated text with normal editing;
- the shortcut must support both hold-to-record and hands-free recording;
- microphone tests must provide live feedback and playable local audio.

## Completed work

### Managed model integrity

- Replaced live model metadata lookups with static manifests.
- Pinned model, runtime, and VAD artifacts to reviewed immutable revisions.
- Added exact byte sizes and SHA-256 values, including the corrected Parakeet
  Linux x64 artifact hash.
- Kept checksum verification before activation and added manifest tests.

### Microphone selection and signal safety

- Added Settings → Voice microphone selection and device refresh.
- Added a microphone access test with RMS and peak measurements.
- Passed the selected device into dictation capture.
- Added clear Chrome permission and device errors.
- Added worklet RMS and peak reporting.
- Blocked transcript insertion when the capture stream contains no signal. This
  prevents silence from becoming a short hallucinated word such as `you`.

### Shortcut and startup latency

- Changed the default and migrated shortcut from `Super+D` to `Ctrl+Shift+D`.
- Capture the shortcut on `window` during the capture phase, prevent its
  browser action, and stop propagation before starting dictation.
- Start microphone capture and WebSocket setup in parallel.
- Keep PCM in a bounded in-memory queue until the server sends `ready`; send no
  PCM before that event, then flush the queue.
- Added focused unit and browser tests for migration, browser shortcut
  capture, early capture, pre-ready buffering, device constraints, and silent
  input.

### Narrow status waveform and native textarea selection

- Kept the waveform in the existing narrow status line and changed it to a
  bounded left-to-right history sampled at a fixed interval. The bars now show
  the quiet lead-in and recent input instead of repeating one live level.
- Removed the mirrored `composer-highlight-layer`.
- Select the dictated range in the real textarea and focus it when a partial or
  final transcript arrives.
- Leave one trailing space after each non-empty dictated insertion so the next
  typed or dictated text remains separated.
- Let one Backspace delete the native selection and enter the existing manual
  edit cancellation path.
- Added browser coverage for selection bounds, one-key deletion, and capture
  cleanup.

### Shared waveform renderer and live microphone test

- Generalized the status-line bar waveform into the shared `VoiceWaveform`
  renderer with a configurable bar count and a bounded animation-frame sampling
  controller.
- Kept the composer at a compact 24-bar, left-to-right status-line history.
- Reused the same bars in the larger Settings → Voice monitor with current
  level, peak hold, and connecting/listening/stopped states.
- Changed the Settings microphone test to run until the user presses Stop, with
  a 60-second safety cap. The test remains in memory and does not upload audio.
- Added reduced-motion rules and browser coverage for both waveform surfaces.

### Shortcut activation behaviour

- Added the persisted Voice → Activation behaviour setting with `push_to_talk`
  and `toggle` modes. Existing settings migrate to push-to-talk.
- Kept the microphone button as a click-to-toggle control in both modes.
- Captured the configured shortcut in the window capture phase in both modes;
  key repeat does not retrigger Toggle, and modifier release does not stop it.
- Added unit coverage for normalization and persistence.

## Current build slice — reliability, diagnostics, and saved Voice settings

Status: **completed**. This slice records the approved response to the
adversarial review and the latest manual feedback. It covers points 1, 2, and
3 from the next-slice recommendation. Provider and model A/B comparison is
explicitly deferred.

### 1. Make capture and transcript insertion reliable

- Drain every PCM buffer queued before the dictation server sends `ready`
  before sending the stop frame. Add a regression test that proves binary audio
  arrives before stop and survives a stop-before-ready session.
- Use the textarea's native selection only when the textarea is the active
  element. If focus is elsewhere, append at the end of the draft. Preserve a
  selected start/end range so dictated text replaces an active selection.
- Track capture duration. A short intentional stop with no signal must discard
  the completion without inserting text or showing a microphone failure. Show
  the no-signal recovery error only after sustained silence, using the existing
  five-second policy for this slice.

### 2. Add useful dictation diagnostics

- Record client capture duration and PCM bytes sent.
- Return server-received PCM bytes, derived audio duration, completion reason,
  adapter, provider, and model as non-secret completion metadata.
- Raise the bounded per-session audio limit from 30 seconds to five minutes so
  normal long dictation is not truncated. Keep the duration and byte ceilings
  aligned. Show a recovery message when the server still ends a session at a
  limit instead of ending silently.
- Keep credentials out of diagnostics. Store transcript text only in the
  explicit bounded WAV/JSON archive added by the diagnostic slice below. Use
  the metadata to separate capture loss, server limits, finalisation delay, and
  model output in later accuracy work.

### 3. Make Voice settings draft-based and explicit

- Keep shortcut, activation behaviour, auto-send, and microphone selection in a
  local draft while the Voice section is open.
- Persist the browser Voice draft only through one bottom-level **Save** action.
- Persist the server transcription source and selected model through the same
  Voice save action. Keep install, cancel, uninstall, and credential removal as
  separate operations because they change server resources rather than only
  settings.
- Show visible save success/failure feedback. Retain an exact selected device
  ID until capture reports that it is unavailable; then show a toast and keep
  the unavailable selection visible instead of silently switching to the
  system microphone.

### Excluded from this slice

- Do not compare Parakeet, OpenAI, Groq, or other providers yet.
- Do not change remote provider end-of-speech pause semantics until a
  provider-specific live test establishes the required behavior.

### Verification completed

- `npm run typecheck`
- `npm test` — 415 passed
- focused voice browser coverage — 4 passed
- `npm run build`
- `npm run test:browser:setpieces` — 8 desktop acceptance tests passed, 5
  workspace tests passed, and 8 PWA/mobile acceptance tests passed; 6 mobile
  variants skipped by the project harness

## Current build slice — local microphone test playback

Status: **completed**.

Extend the interactive in-memory microphone test with local playback:

- capture the test audio with `MediaRecorder` when the browser supports it;
- show Play and Stop playback controls after capture;
- keep the recording in browser memory only and revoke replaced object URLs;
- stop tracks, close the audio context, and clean all timers on completion or
  unmount;
- show a clear unsupported-browser message when `MediaRecorder` cannot create
  a playable recording.

The test must not upload or persist the recorded audio. It is a local device
check only.

Acceptance for this slice:

- a stopped test with a supported recorder exposes Play and Stop playback
  controls;
- playback uses only the latest in-memory recording and replaces it cleanly;
- stopping, closing Settings, and unmounting release the recorder, stream,
  playback URL, audio context, and timers;
- an unsupported recorder leaves the live level monitor usable and reports why
  playback is unavailable;
- automated browser tests cover recorder cleanup, playback state, and the
  unsupported path.

### Verification completed

- `npm run typecheck`
- `npm test` — 415 passed
- focused voice browser coverage — 4 passed
- playback and unsupported-recorder browser coverage — 1 passed
- `npm run build`
- `npm run test:browser:setpieces` — 8 desktop acceptance tests passed, 5
  workspace tests passed, and 8 PWA/mobile acceptance tests passed; 6 mobile
  variants skipped by the project harness

## Current build slice — tail reliability, microphone persistence, and selection ownership

Status: **completed**.

Fix the three confirmed interaction defects from the latest voice test:

- keep the selected microphone through Voice settings close/reopen and add a
  same-origin persistence regression test;
- allow the audio worklet's final PCM messages to reach the server before the
  client sends the stop frame, so the final spoken word is not dropped;
- track whether the textarea selection came from dictation or from the user.
  Treat an unchanged automatic dictation selection as an append point for the
  next session, while preserving normal replacement for a user selection.

Acceptance for this slice:

- Save, close, and reopen Voice settings retains the selected `deviceId`;
- a selected device remains an exact capture constraint and never falls back
  silently to the system default;
- a PCM frame emitted at stop is sent before the WebSocket stop command;
- the final transcript includes audio delivered during the stop drain;
- a second dictation appends after an untouched automatic selection;
- a user-created selection still gets replaced by dictation;
- manual editing clears automatic-selection ownership.

The selected device is stored in same-origin browser storage. `localhost`,
`127.0.0.1`, and an installed PWA have separate storage, and Chrome can rotate
device IDs after a device or permission profile changes. In those cases the
settings surface keeps the exact ID as unavailable and asks the user to choose
and save the device again; it does not fall back silently.

### Verification completed

- `npm run typecheck`
- `npm test` — 415 passed
- focused voice browser coverage — 3 passed
- `npm run build`
- `npm run test:browser:setpieces` — 8 desktop acceptance tests passed, 5
  workspace tests passed, and 8 PWA/mobile acceptance tests passed; 6 mobile
  variants skipped by the project harness
- `git diff --check`

The real-profile browser check was not available because the local server
redirected to its login screen and no credentials were supplied.

## Current build slice — pause-resilient dictation sessions

Status: **completed**.

The stop-tail fix does not cover a provider speech-end event. A remote/live
adapter can emit `end_of_speech` during a long pause, and the current bridge
then stops the session before later speech can reach the provider. Managed
Parakeet currently uses a buffered HTTP snapshot, so its pause path must also
keep capturing until the explicit user stop or the five-minute server limit.

This slice will:

- treat provider `end_of_speech` as an informational boundary, not a Conduit
  stop command;
- keep the browser capture active after that event and accept PCM spoken after
  the pause;
- add a server regression test for speech, `end_of_speech`, more PCM, and an
  explicit stop;
- add browser coverage for audio before and after a long simulated pause and
  the final PCM drain;
- surface a diagnostic when server-received audio bytes are lower than client
  bytes sent, so transport loss is distinct from model transcription quality.

Acceptance:

- a long pause does not complete or stop dictation;
- speech after the pause reaches the server before the explicit stop;
- the final tail remains included;
- a provider boundary does not trigger an automatic `stop` frame;
- a client/server audio-byte mismatch is visible as a recovery error.

### Verification completed

- `npm run typecheck`
- `npm test` — 417 passed
- focused voice browser coverage — 3 passed
- `npm run build`
- `npm run test:browser:setpieces` — 8 desktop acceptance tests passed, 5
  workspace tests passed, and 8 PWA/mobile acceptance tests passed; 6 mobile
  variants skipped by the project harness
- `git diff --check`

## Current bug-fix slice — recording tail, microphone selection, and paused snapshot output

Status: **completed**.

The latest manual test found three separate failure surfaces. The settings
recorder can finalize its MediaRecorder at the same moment as the stop click,
which can omit the final encoded packet. The saved microphone ID can remain in
browser storage while the settings `<select>` displays its first option because
the device list loads after the selected value. Upload adapters can also emit
multiple final transcript events for pause-separated segments; replacing the
previous final with the newest event loses earlier speech.

This slice will:

- drain the settings recording encoder briefly after Stop so the final spoken
  tail is available during playback;
- reapply and test the saved exact microphone selection after asynchronous
  device enumeration and settings reopen;
- merge cumulative and segment-style SSE finals instead of overwriting earlier
  transcript text;
- start the managed Parakeet runtime with its long-audio processing path;
- add regressions for all three boundaries and preserve completion byte
  diagnostics for manual verification.

Acceptance:

- playback contains the final test phrase when Stop is clicked immediately
  after speaking;
- the saved microphone remains displayed and is used as an exact device
  constraint after closing and reopening Voice settings;
- pause-separated final transcript events retain every segment in order;
- a long local Parakeet utterance is sent through the configured long-audio
  path without reducing the five-minute Conduit session limit.

The SSE reader also processes a final buffered frame when the provider closes
without a trailing blank line. This was a real final-segment loss path, not
only a test adjustment.

### Verification completed

- `npm run typecheck`
- `npm test` — 418 passed
- focused voice browser coverage — 3 passed
- `npm run build`
- `npm run test:browser:setpieces` — 8 desktop acceptance tests passed, 5
  workspace tests passed, and 8 PWA/mobile acceptance tests passed; 6 mobile
  variants skipped by the project harness
- local Conduit restarted and `/healthz` returned ready

## Current diagnostic slice — bounded persisted dictation pairs

Status: **completed**.

The next manual tests need inspectable evidence when a transcript loses words.
Conduit will persist the last 20 successful dictation sessions under the data
root. Each pair will contain a timestamped 16 kHz mono WAV and a JSON sidecar
with the transcript, completion reason, adapter/provider/model, capture and
server byte counts, and derived duration.

The archive will save only sessions with at least one second of server-received
PCM and non-empty transcript output from the transcription pipeline. Empty,
short, failed, or transcript-free sessions will not create files. Older pairs
will be removed when a new pair exceeds the 20-entry bound. Settings → Voice
microphone tests remain browser-local and are not part of this archive.

Acceptance:

- a valid local Parakeet dictation creates one matching WAV/JSON pair;
- the sidecar identifies whether capture, transport, finalization, or model
  output needs investigation without storing credentials;
- empty and sub-one-second sessions create no pair;
- the archive never contains more than 20 complete pairs;
- incomplete writes and orphan files do not appear as valid recordings.

Implementation: `CONDUIT_VOICE_RECORDINGS_ROOT` selects the archive location;
the default is `data/voice/recordings`. The server stores the PCM accepted by
the dictation WebSocket as a 16 kHz mono PCM16 WAV and writes the timestamped
JSON sidecar only after the pair is complete. The browser sends its PCM byte
count in the optional stop diagnostic field so the sidecar can distinguish
capture/transport loss from provider or model output. Archive failures do not
fail an otherwise completed dictation.

### Verification completed

- `node --test test/config.test.js test/voice-recording-store.test.js test/voice-stream-api.test.js` — 9 passed
- `npm run typecheck`
- `npm test` — 424 passed
- focused voice browser coverage — 3 passed
- `npm run build`
- `git diff --check`
- local Conduit restarted and `/healthz` returned ready

## Manual acceptance record

Status: **accepted for the current voice scope**.

On 2026-08-13, the user reported matching manual acceptance passes in Chrome
and Firefox, including the clipboard file-paste flow and the voice features.
Browser versions, operating-system version, and device identifiers were not
recorded. This is user-reported validation; it does not replace the automated
checks listed above.

No active voice implementation slice remains in this document. The only open
item is the explicitly deferred provider comparison below.

## Remaining deferred scope

### 1. Provider-specific pause and accuracy testing

Status: **deferred**.

Compare local Parakeet, OpenAI, Groq, and remote provider behavior after the
capture and pause lifecycle surfaces are stable. Use the completion byte
diagnostics to separate transport loss from model accuracy.

This is the only remaining voice-dictation implementation scope in this
document. It stays deferred until provider credentials and a comparison plan
are available.

## Implementation seams

Expected changes are grouped by responsibility:

- `conduit-web/src/client/chat/voice-waveform.tsx`: shared bounded history,
  level meter, peak hold, status, and playback-adjacent visual primitives.
- `conduit-web/src/client/chat/composer.tsx`: recorder placement, native
  textarea selection, activation behaviour, and dictation monitor wiring.
- `conduit-web/src/client/chat/voice-dictation.js`: activation setting,
  normalization, migration, and persistence.
- `conduit-web/src/client/chat/voice-audio.ts`: live test lifecycle,
  `MediaRecorder`, audio levels, playback URL cleanup, and error formatting.
- `conduit-web/src/client/settings/settings.tsx`: activation control and live
  microphone test controls.
- `conduit-web/src/server/voice-recording-store.js`: timestamped WAV/JSON
  diagnostic pairs, minimum-duration validation, atomic writes, and 20-entry
  rotation.
- `conduit-web/src/client/main.tsx`: voice setting shape and persistence
  plumbing.
- `conduit-web/src/client/styles.css`: full-width monitor, gain and peak
  treatment, native-selection layout, responsive behavior, and reduced motion.
- `conduit-web/test/voice-dictation.test.js`: settings and activation rules.
- `conduit-web/test/browser/app.spec.js`: native selection, activation modes,
  live monitor, and playback controls.
- `conduit-web/README.md`: current shortcut, monitor, device test, and
  recording privacy behavior.

Do not change the required authenticated WebSocket protocol. The optional
`audioBytesSent` stop field is diagnostic metadata and remains backward
compatible. Keep Settings microphone tests browser-local; only successful
dictation sessions enter the explicit bounded diagnostic archive. Do not remove
the static model manifest or checksum verification while changing the UI.

## Verification

Run the project checks after implementation:

- `npm run typecheck`
- focused voice unit and browser tests
- `npm test`
- `npm run build`
- `npm run test:browser:setpieces`
- a local agent-browser pass through Settings → Voice and the composer

Manual smoke test:

1. Open Settings → Voice, select the intended microphone, choose the shortcut
   and activation behavior, then press **Save Voice settings**. Confirm the
   visible Saved state and that the browser setting changes only after Save.
2. Start Test microphone. Speak after a short pause. Confirm the monitor shows
   a quiet history followed by voice activity, current level, and peak hold.
3. Stop the test and play it back. Confirm the recording is audible. Stop
   playback and repeat the test after selecting another device.
4. Hold `Ctrl+Shift+D`. Confirm the composer monitor starts at once, shows the
   quiet lead-in, and does not open Chrome's bookmark command.
5. Speak, release the shortcut, and confirm the dictated range is selected in
   the textarea. Press Backspace once and confirm the text is removed.
6. Switch Activation behaviour to Toggle. Press the shortcut once to start and
   once to stop. Confirm that holding the key does not repeatedly start or stop
   the session.
7. Reload Settings. Confirm the saved activation behavior, shortcut, and
   microphone selection persist. Change one value without saving, close and
   reopen Settings, and confirm the unsaved value is discarded.
8. Stop an empty dictation quickly. Confirm it does not show a microphone
   failure or insert a hallucinated transcript. Test sustained silence and
   confirm the UI gives a direct recovery message.
9. Speak for more than 30 seconds. Confirm the session continues. If the
   five-minute limit is reached, confirm the partial result remains editable
   and the completion reason is visible in the recovery message/diagnostics.

## Risks and boundaries

- Chrome or the operating system can consume a browser shortcut before a page
  receives it. Capture-phase handling is the strongest page-level mitigation;
  the manual test remains required.
- A native textarea selection disappears when focus moves elsewhere. The
  composer must focus the textarea when it commits dictated text so the
  one-key Backspace cancellation works as requested.
- `MediaRecorder` support and playable MIME types vary by browser. Detect
  support instead of assuming `audio/webm` works.
- The monitor draws a bounded amplitude envelope rather than raw PCM. This
  keeps the UI responsive and avoids retaining unbounded test audio data.

## Abandoned slice — Local Parakeet continuous live transcription

Status: **abandoned after transport investigation**.

The earlier plan assumed that the managed `achetronic/parakeet` worker exposed
a local PCM WebSocket path. It does not. The pinned `v0.8.0` binary exposes an
HTTP transcription endpoint and long-audio chunking flags, but no WebSocket or
live-input endpoint. Its `stream=true` option returns SSE deltas only after the
complete audio file is uploaded. See the upstream [Parakeet API reference](https://github.com/achetronic/parakeet#streaming).

A direct local probe confirmed the contract: the worker registered
`POST /v1/audio/transcriptions`, accepted a complete WAV, and then returned
`transcript.text.delta` and `transcript.text.done` SSE events. The current
`openai_audio_sse_v1` route in `voice-runtime.js` and `dictation-stream.js` is
therefore correct for local Parakeet. It remains final-only during capture.

Do not add a local `parakeet_pcm_ws_v1` handshake, fallback path, or capacity
guard. That adapter remains available for separately configured remote
WebSocket providers. True local live transcription would require a new local
streaming runtime or a separate rolling-snapshot design, neither of which is
planned in this voice sprint.
