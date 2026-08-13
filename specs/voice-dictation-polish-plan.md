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
- Let one Backspace delete the native selection and enter the existing manual
  edit cancellation path.
- Added browser coverage for selection bounds, one-key deletion, and capture
  cleanup.

## Remaining build scope

### 1. Widen the recorder monitor

Replace the narrow status-line waveform with a full-width recorder monitor in
the composer, between the text area and the action row. Reuse the same monitor
in Settings → Voice so both surfaces use the same visual language. The narrow
history remains the fallback status indicator.

The monitor must show:

- a left-to-right amplitude history, not only the latest level;
- a visible quiet section before speech starts, so the user can see that
  recording began before they spoke;
- current gain or RMS level;
- a peak-hold marker with a short decay or reset;
- a clear connecting, listening, and stopped state;
- a text label and accessible name for keyboard and screen-reader users.

Keep the history bounded to a fixed number of samples. Update the display at
animation-frame cadence, not once per audio worklet message. Respect reduced
motion by removing transitions and pulse animation while retaining the live
level and history.

### 2. Add shortcut activation behaviour

Add a persisted Voice → Activation behaviour setting with two values:

- `push_to_talk`: hold the configured shortcut to record and release it to
  finalise;
- `toggle`: press the shortcut once to start and again to stop, for hands-free
  recording.

The microphone button remains a click-to-toggle control in both modes. The
setting changes shortcut behaviour, not the button's basic accessibility or
label. Migrate old settings without changing a user's explicitly configured
shortcut or unrelated voice options.

Test both modes, including key repeat, modifier release, repeated toggle
presses, settings reload, and the settings shortcut recorder.

### 3. Make the microphone test a live recorder

Change the current fixed result-only test into an interactive in-memory test:

- start level sampling immediately when the user presses Test microphone;
- show the shared time-series monitor while the test runs;
- show current RMS or gain and peak hold;
- allow the user to stop the test explicitly, with a safe maximum duration;
- capture the test audio with `MediaRecorder` when the browser supports it;
- show Play and Stop playback controls after capture;
- keep the recording in browser memory only and revoke replaced object URLs;
- stop tracks, close the audio context, and clean all timers on completion or
  unmount;
- show a clear unsupported-browser message when `MediaRecorder` cannot create
  a playable recording.

The test must not upload or persist the recorded audio. It is a local device
check only.

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
- `conduit-web/src/client/main.tsx`: voice setting shape and persistence
  plumbing.
- `conduit-web/src/client/styles.css`: full-width monitor, gain and peak
  treatment, native-selection layout, responsive behavior, and reduced motion.
- `conduit-web/test/voice-dictation.test.js`: settings and activation rules.
- `conduit-web/test/browser/app.spec.js`: native selection, activation modes,
  live monitor, and playback controls.
- `conduit-web/README.md`: current shortcut, monitor, device test, and
  recording privacy behavior.

Do not change the authenticated WebSocket protocol. Do not send microphone
test recordings to the server. Do not remove the static model manifest or
checksum verification while changing the UI.

## Verification

Run the project checks after implementation:

- `npm run typecheck`
- focused voice unit and browser tests
- `npm test`
- `npm run build`
- `npm run test:browser:setpieces`
- a local agent-browser pass through Settings → Voice and the composer

Manual smoke test:

1. Open Settings → Voice and select the intended microphone.
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
7. Reload Settings. Confirm the activation behaviour, shortcut, and microphone
   selection persist.
8. Test a denied, missing, or silent input. Confirm the UI gives a direct
   recovery message and does not insert a hallucinated transcript.

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
  keeps the UI responsive and avoids retaining unbounded audio data.
