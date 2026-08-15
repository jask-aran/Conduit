# Voice dictation pipeline overhaul plan

Status: **WP4A implementation complete and awaiting manual approval. WP0,
WP1, WP2, and WP3 approved.**

This document defines the active voice-dictation work. Git history preserves
the completed polish sprint, its test counts, and its manual acceptance
records.

## 1. Goal

Make dictation fast, accurate, pause-safe, and capable of genuine live local
transcription.

The overhaul must:

- measure capture from the shortcut event, not from the end of audio setup;
- preserve speech before and after long silence;
- remove unverified signal processing from the ASR path;
- start useful local inference before the user presses Stop;
- support true stateful streaming when the selected runtime accepts live PCM;
- make capture, transport, VAD, queue, inference, and archive costs distinct;
- preserve accepted interaction, security, installation, and privacy
  behaviour.

The central design is:

- keep one authenticated browser-to-Conduit WebSocket for PCM transport;
- keep the browser responsible for permission, device capture, resampling,
  packetisation, levels, and a bounded pre-roll;
- make Conduit responsible for session state, authoritative PCM ownership,
  VAD, segment order, backpressure, runtime selection, and transcript events;
- support whole-session batch, pause-delimited progressive batch, and true
  stateful streaming as explicit inference modes;
- select a mode from verified runtime capabilities, not from a provider name
  or an SSE response format.

## Implementation record (2026-08-15)

- **Work package 0 — complete and approved.** Client and server diagnostics,
  bounded sidecars, runtime metadata, and the initial evidence path are in the
  working tree.
- **Work package 1 — complete and approved.** The
  browser now exposes Preparing microphone, Recording, Finishing capture,
  Waiting for transcription engine, and Transcribing. The waveform appears
  only after the first non-empty PCM. Audio queued before the WebSocket is
  ready is bounded by the full five-minute session limit. The worklet is
  preloaded and cached; healthy capture resources can be reused; ended tracks
  and failed contexts recover clearly; and warm microphone retention is
  opt-in. The server archives received PCM before runtime settlement and
  reports runtime-ready and waiting-for-transcription events.
- **Work package 2 — complete and approved.** The raw capture profile is the
  default candidate, adaptive ASR gain is absent, and raw/processed signal
  diagnostics are recorded.
- **Work package 3 — complete and approved.** The
  worklet emits 20 ms, 320-sample PCM packets, returns full transferred
  buffers to a bounded pool, and flushes an exact final partial packet. The
  client copies audio only when it must retain a packet before the WebSocket
  is ready. The server owns one bounded PCM accumulator and shares its views
  with the adapter and archive, so client/server byte counts and archive
  order use the same sequence. The mobile handoff test preserved the complete
  final word in the composer; the newest Q8 sidecar recorded 135 packets at
  approximately 50 packets per second, matching client/server PCM bytes, a
  cold runtime preparation interval, and a valid unclipped WAV.
- **Work package 4A — implementation complete and awaiting approval.** Conduit
  now observes the pinned Silero VAD on a copy of the complete accepted PCM.
  The existing RMS heuristic remains authoritative for ASR. Sidecars record
  Silero frame probabilities, model verification, CPU deployment posture,
  entry/exit thresholds, onset and exit frames, 240 ms pre-roll, 320 ms
  hangover, 240 ms trailing padding, maximum-region closure, and proposed
  sample ranges. The exact-zero worklet event is now a `digital_silence` /
  `device_stall` diagnostic. The complete WAV remains the archive source.
- Fresh local voice settings now default to `whisper-tiny-en-q8` through the
  embedded Transformers backend. An existing saved model selection is not
  changed.
- **Work packages 4B–11 — not started.** Package 6A has not started, so
  `transcribe.cpp` and the Unified English Q8 model are not the active backend.

WP3 manual approval is recorded below. WP4A awaits the manual comparison test
below and does not authorize WP4B.

## Deviations from the proposed plan

- The user-approved execution order implemented WP2 before WP1. WP1 is now
  filled in and no later package has started.
- The WP0 fixed-reference comparison against Unified English Q8 remains
  deferred. The target runtime and model belong to WP6A and are not installed.
  Current evidence describes the existing managed Parakeet batch path.
- The existing server already accepts PCM while `voiceRuntime.resolve()` is
  cold and the batch adapters already wait until Stop before inference. The
  WP1 follow-up adds explicit runtime-ready and waiting-for-transcription
  events, archives received PCM before transcription settlement, and updates
  the sidecar after success or failure. It does not keep the microphone open
  by default and does not change the five-minute model idle timer.
- The proposed 250–500 ms socket pre-roll was too small to protect a slow
  handshake. The pending client queue now uses the full five-minute audio cap;
  the package-size review remains deferred.
- The fresh local default is Whisper Tiny English Q8 on embedded Transformers,
  not the proposed Unified English Q8 on `transcribe.cpp`. WP6A remains
  unstarted, and the active legacy Parakeet option remains selectable.
- Context recovery uses resume-first behaviour for a suspended context. A
  failed or closed context is released and recreated on the next trusted start.
  This keeps normal browser suspension recovery clear without discarding a
  healthy reusable context.
- Empty-transcript archival and the composer false-success fix were added after
  the WP2 manual failure. They are recorded as WP2 follow-up corrections, not
  as unfinished WP1 or a new package.
- The proposed packet coalescing path was not needed for normal operation.
  The worklet now emits bounded 20 ms packets directly, and the existing
  WebSocket backpressure limit still fails directly when recovery is not
  possible. The client makes a copy only for packets held before the socket
  becomes ready, then returns the transferred worklet buffer.
- WP4A keeps the VAD implementation and model verification separate from the
  transcription adapter. The pinned Silero artifact is reused from the
  reviewed managed voice package and is also added to new Whisper manifests;
  existing installations can use any verified copy under the voice model root.
  No new settings control or lockfile dependency was added. Silero remains
  observation-only until WP4B is approved.
- The WP0–WP4A technical review actioned V01–V16, V18, and V19. V17 is a
  deliberate scope deferral: moving Silero to an independent shared owner
  requires its own install, readiness, migration, and uninstall lifecycle and
  belongs with the model-state package.
- The server accumulator is allocated lazily at the existing
  `maxAudioBytes` limit. Adapters receive stable views during capture and
  materialise one contiguous buffer only for batch inference; WAV creation
  remains the required final archive copy.
- The initial JavaScript bundle allowance is now 184,000 gzip bytes. This
  follows the user's instruction to defer package-size review; the current
  build is 183,486 bytes gzip, with 24,443 bytes initial CSS gzip and 185,186
  bytes largest lazy JavaScript gzip.
Raw mono PCM16 at 16 kHz uses about 32 KB/s. This bandwidth does not justify
moving authoritative VAD or provider policy into the browser. A final HTTP
upload remains suitable for a batch-only compatibility path, but it must not
replace the WebSocket needed for live VAD and streaming input.

## 2. Existing behaviour to preserve

The overhaul must preserve these shipped constraints:

- use the saved microphone as an exact device constraint and never fall back
  silently;
- support push-to-talk and toggle activation;
- catch the configured shortcut in the browser capture phase;
- buffer PCM until the authenticated WebSocket is ready;
- drain final worklet PCM before sending Stop;
- retain the five-minute session and matching byte limits;
- preserve bounded queues and direct limit errors;
- keep native textarea selection, Backspace cancellation, and auto-send
  behaviour;
- keep the Settings microphone test browser-local;
- keep the last 20 valid dictation WAV/JSON pairs under the existing privacy
  policy;
- keep archive failure non-fatal to a successful transcript;
- keep static model manifests, immutable artifact revisions, exact byte sizes,
  SHA-256 verification, and atomic activation;
- keep interrupted-install recovery and unprivileged runtime extraction;
- keep credentials, raw device identifiers, and unrestricted transcript logs
  out of diagnostics.

The pinned `achetronic/parakeet` runtime accepts complete audio uploads. Its
SSE response can emit text deltas only after it receives the complete file. It
does not accept stateful live PCM. Do not add a local PCM WebSocket adapter for
that runtime.

## 3. Current architecture and confirmed problems

### Current flow

1. `composer.tsx` catches the shortcut.
2. `voice-dictation-client.ts` requests the microphone, loads the worklet,
   resumes the audio context, builds the graph, and connects it.
3. `voice-capture-worklet.js` applies adaptive gain, converts the browser
   sample rate to 16 kHz, and posts small PCM arrays.
4. The main thread sends those arrays through the authenticated dictation
   WebSocket.
5. `dictation-stream.js` stores the PCM in the selected adapter.
6. Stop causes the adapter to concatenate PCM, optionally split silence,
   create WAV input, and start the current upload runtime.
7. Provider output updates the composer. The server then saves the bounded
   diagnostic pair.

### HTTP review correction

The current tree concatenates PCM before silence splitting.
`createHttpAdapter` and `createSnapshotAdapter` call `Buffer.concat(...)` and
then pass one `Buffer` to `splitSilence`. There is no current
array-to-`readInt16LE` defect.

Do not implement a fix for that rejected finding. Preserve the single-buffer
contract until the new VAD path replaces it.

### Capture does not start at the shortcut

The shortcut handler runs at once, but microphone permission, device
activation, worklet loading, audio-context resume, and graph construction
precede the first PCM. Current `captureStartedAt` begins after graph
connection, so it hides this delay. A pre-roll cannot recover sound spoken
before the browser opens the device.

### Transport is live but inference is final-only

The browser sends PCM while recording, but the current HTTP and snapshot
adapters buffer it. They start ASR after Stop. SSE text output does not make
the audio input live.

The current `parakeet-tdt-0.6b-v3` path is an offline upload path.
`parakeet-unified-en-0.6b` supports a different streaming use case, but the
pinned runtime does not expose that input contract. Handy uses a different
runtime, VAD policy, and hardware backend. A shared model family does not make
the execution paths equivalent.

References:

- [achetronic/parakeet v0.8.0 streaming contract](https://github.com/achetronic/parakeet/tree/v0.8.0#streaming);
- [transcribe.cpp Parakeet models](https://github.com/handy-computer/transcribe.cpp/blob/main/docs/models/parakeet.md);
- [transcribe.cpp Unified English model](https://github.com/handy-computer/transcribe.cpp/blob/main/docs/models/parakeet-unified-en-0.6b.md);
- [transcribe.cpp Node package](https://github.com/handy-computer/transcribe.cpp/blob/main/bindings/typescript/package.json);
- [Handy audio and Silero VAD integration](https://github.com/cjpais/Handy/blob/main/src-tauri/src/managers/audio.rs);
- [Handy live transcription integration](https://github.com/cjpais/Handy/blob/main/src-tauri/src/managers/transcription.rs);
- [NVIDIA NeMo Speech](https://github.com/NVIDIA-NeMo/Speech).

### The ASR path changes the signal twice

`voice-audio.ts` requests browser echo cancellation, noise suppression, and
automatic gain. `voice-capture-worklet.js` then applies adaptive gain with a
target RMS of `0.1` and a maximum gain of `12`. It also uses a box-average
sample-rate conversion.

This pipeline can raise steady noise above the silence threshold, pump gain
during pauses, alter consonant edges, clip peaks, and alias high-frequency
content. The waveform can still look correct because it reports activity, not
ASR quality.

An inspection of the 20 archived WAV files from 14th August 2026 confirms
signal damage in the stored ASR input:

- all files contain the 16 kHz mono PCM that reached Conduit;
- ten files contain samples hard-clipped at full scale;
- the worst file clips `2.473%` of all samples;
- several recent files place about half their measured spectral energy below
  300 Hz.

Adaptive gain is a scalar, not a bass equaliser. It does not directly boost
bass relative to treble. The current stage can still make speech sound boomy
because it raises low-frequency microphone rumble, room noise, and plosives by
up to 12 times before hard clamping. The box-average resampler also reduces
high-frequency detail relative to low-frequency energy. Browser DSP and the
microphone can add more colouration. The archive cannot separate those sources
because it stores only the final processed PCM.

The clipping is sufficient reason to remove the custom adaptive gain. The
low-frequency balance needs a raw-versus-processed recording before Conduit
adds a high-pass filter or other equalisation. A 16 kHz recording also sounds
less bright than full-band microphone playback because it cannot contain
frequencies above 8 kHz; that expected bandwidth limit does not explain
full-scale clipping.

### Packet size follows the render quantum

An audio worklet normally receives 128-frame render quanta. At 48 kHz, the
current code can post about 375 messages per second. It creates temporary
arrays for small PCM payloads, and the client and server make further copies.
A five-minute session can create more than 100,000 messages.

### Silence splitting is late and unsafe

`splitSilence` runs after Stop. It uses fixed energy, silence-duration,
minimum-segment, merge, and 16-segment limits. It adds no speech padding. It
can discard a short word, fail to split amplified background noise, or lose
later speech when the segment guard is reached.

The worklet's exact-zero check is not VAD. It detects digital zero or a stalled
device. Natural room silence contains non-zero samples.

### Runtime and model choices obscure speed

Conduit currently uses an upload worker and offers a large FP32 model. FP32
costs more memory and time, but the project has no local corpus evidence that
it gives a useful accuracy gain. The current model description also hides that
v3 is multilingual and offline.

Runtime startup, model load, CPU or accelerator choice, queue delay, and
inference time are not reported as separate stages. A cold CPU fallback can
therefore look like a slow model or network.

### Archive work can extend settlement

The session awaits `recordingStore.save(...)` before the completed lifecycle
finishes. Archive failure is non-fatal, but normal disk latency can still
delay composer cleanup or auto-send.

### Required timing terms

Use these terms in code, diagnostics, and acceptance records:

- **capture startup**: shortcut event to first non-empty worklet PCM;
- **transport startup**: first client PCM to first accepted server PCM;
- **runtime preparation**: adapter selection, process start, model load, and
  health confirmation;
- **queue delay**: accepted inference work to runtime work start;
- **inference delay**: runtime work start to first usable text;
- **settlement delay**: Stop to stable final text;
- **real-time factor**: inference duration divided by submitted audio duration;
- **partial text**: text that a later event can revise;
- **segment final**: stable text for one committed speech segment;
- **session final**: ordered stable text for the complete dictation.

Client and server clocks are not interchangeable. Record relative durations on
each side. Do not subtract an absolute browser timestamp from an absolute
server timestamp.

## 4. Proposed work packages

### Execution rule

Implement one work package or named subsection at a time, in the order listed
in section 5. Do not begin the next unit in the same agent turn. At the end of
the unit, run the handoff contract below, notify the user that the package is
ready to test, and wait for explicit approval.

Each unit must leave the default product functional. Keep the previous path or
an automatic fallback until a later package explicitly removes it. A package
can change internal structure, but it must expose one bounded behaviour change
that the user can test without unfinished code from the next package.

### Package handoff contract

Run this contract after every package or named subsection:

1. Finish the package's bounded behaviour and keep unrelated planned behaviour
   out of the change.
2. Run the narrowest focused checks that prove the changed server, client,
   audio, persistence, or runtime boundary. Do not change a harness to make the
   package pass.
3. Run `npm run typecheck` and `npm run build` when TypeScript, client code, or
   bundled assets changed. Run the relevant existing Node tests when server
   contracts changed.
4. Restart the managed server once with
   `bash .devcontainer/start-conduit.sh restart`.
5. Wait for `http://127.0.0.1:4310/healthz` to report ready. When the package
   changes model execution, also confirm the selected model, runtime, and
   actual compute backend are healthy.
6. Give the user the package-specific manual test named below, with setup,
   action, expected result, and any expected limitation.
7. Report the files changed, checks run, restart and health result, rollback
   path, and remaining risk.
8. Stop. Do not start the next package until the user tests this package and
   gives explicit approval.

### Work package 0 — establish evidence

Purpose: separate capture, transport, preprocessing, runtime, and archive
costs before changing behaviour.

Proposed fix:

1. Record a monotonic timestamp when `composer.tsx` accepts the shortcut.
2. Pass it into `voice-dictation-client.ts`.
3. Record microphone request start and resolution, worklet connection, first
   worklet PCM, first WebSocket send, Stop, and final event.
4. Record packet count, PCM bytes, source sample rate, requested constraints,
   effective track settings, pre-processing peak/RMS/clipping, post-processing
   peak/RMS/clipping, current worklet gain during the baseline, and maximum
   WebSocket buffered bytes.
5. Record first and last server PCM, runtime-ready time, preprocessing, queue,
   inference, first partial, first segment final, session final, and archive
   durations.
6. Add segment count, speech and silence durations, boundaries, VAD policy,
   inference mode, model, precision, and backend to the bounded sidecar.
7. Keep detailed segment data in the local sidecar and structured server log.
   Keep client completion metadata bounded.

Establish a local baseline with:

- one short utterance;
- one 60-second continuous utterance;
- speech, ten seconds of silence, then speech;
- a short word on each side of a pause;
- quiet-room, fan, and keyboard noise;
- plosives and a close-microphone phrase that reproduces the boomy sound;
- immediate Stop after the final word;
- five minutes of capture without inference.

Run the fixed-reference cases once with the current active model and again with
Unified English Q8 on the same machine. Do not run a broad precision sweep.
Use the runtime's published F32/Q8 evidence unless Unified Q8 fails Conduit's
fixed accuracy threshold.

Exit criteria:

- one record attributes total delay to named stages;
- shortcut-to-first-PCM, cold start, and warm start are visible;
- packet count and server bytes agree with captured duration;
- the archived WAV shows whether missing speech reached Conduit;
- diagnostics distinguish source clipping from clipping introduced by
  Conduit.

Package handoff test: perform one short dictation and one
speech–ten-second-silence–speech dictation. Confirm that the sidecars expose
every new timing and signal stage while inserted text and recording behaviour
remain unchanged.

### Work package 1 — shorten capture startup

Cause: browser and device setup happen after the shortcut but before PCM.

Proposed fix:

1. Add **Starting**, **Listening**, **Finishing**, and **Transcribing** states.
   Enter **Listening** only after the first PCM.
2. Cache the worklet with application assets and preload its bytes after the
   authenticated app becomes ready.
3. Create or resume the audio context on the trusted shortcut or pointer
   event. Reuse a healthy context between sessions.
4. Recreate the context after a device change, browser suspension, or failure.
   Never reuse an ended microphone track.
5. Keep 250–500 ms of PCM after the stream becomes live and until the
   WebSocket is ready. Flush it in order.
6. Offer warm microphone retention only as an explicit privacy setting with a
   persistent indicator and direct stop controls.
7. Start local runtime preparation at session start, not at Stop.

Exit criteria:

- the UI never says **Listening** before PCM exists;
- socket setup does not lose PCM captured after the track becomes live;
- diagnostics expose irreducible permission and device delay;
- permission denial, device loss, and suspended context recovery remain clear.

Package handoff test: start dictation from a cold page, speak immediately, and
stop. Confirm **Preparing microphone…** shows without a waveform; **Recording
· preparing transcription…** begins only after PCM exists; stopping shows
**Finishing capture…**, then **Waiting for transcription engine…** when the
runtime is still cold, then **Transcribing…**. Confirm the final text is added
to the composer and that a runtime or transcription failure does not discard
the received audio from the server archive.

WP1 verification record (2026-08-15): `npm test` passed 461 tests;
`npm run typecheck` passed; `npm run build` passed with 182,775 B initial JS
gzip, 24,345 B initial CSS gzip, and 185,186 B largest lazy JS gzip; the
focused server stream suite passed the cold-runtime wait event and failed-ASR
archive cases; focused desktop lifecycle, buffered-PCM, resource-reuse, and
empty-transcript browser checks passed; focused mobile lifecycle and
unfocused-composer browser checks passed; and `git diff --check` passed.
After this follow-up, Conduit was restarted with
`bash .devcontainer/start-conduit.sh restart`; health returned
`{"ok":true,"status":"ready","release":"development"}`. Manual approval
was later granted and is recorded in the WP3 section below.

### Work package 2 — simplify the signal path

Cause: browser DSP, custom adaptive gain, and an ad-hoc resampler can damage
ASR input.

Proposed fix:

1. Remove Conduit's adaptive gain from ASR PCM. Do not tune or replace the
   current 12-times stage. Calculate waveform levels without changing samples.
2. Add raw and processed capture profiles. The raw profile requests echo
   cancellation, noise suppression, and browser automatic gain off.
3. Make the raw profile the overhaul candidate and record effective track
   settings because browsers can ignore constraints.
4. Capture peak, RMS, and clipping before and after every Conduit processing
   stage. Do not run live spectral probes on the audio render thread; add
   frequency analysis only as a separate, bounded diagnostic operation if a
   later evidence review requires it.
5. If one adapter needs level normalisation, apply one bounded static
   normalisation on the server. Record its gain and reject any value that would
   clip.
6. Test whether a 16 kHz `AudioContext` produces verified 16 kHz output on
   supported browsers. Otherwise use a reviewed polyphase or FIR resampler.
7. Do not add a bass cut or other equalisation to hide the current pipeline.
   First compare raw capture with the current archive. Add a measured
   low-frequency filter only if excess rumble remains in raw PCM and the fixed
   dictation corpus shows an accuracy gain.
8. Keep `MediaRecorder` in the browser-local microphone test. Do not add a
   compressed codec to the ASR path.
9. Retain a processed browser profile only for devices or speaker-echo
   conditions where the fixed corpus proves that it helps.

Exit criteria:

- Conduit does not apply dynamic gain to ASR PCM;
- Conduit introduces no hard-clipped samples;
- source clipping and Conduit clipping are distinct diagnostics;
- archived audio has no avoidable pumping;
- resampling has a documented implementation and frequency response;
- waveform and playback work without ASR gain;
- the selected capture profile has measured support;
- any low-frequency filter has raw-capture and word-error evidence.

Package handoff test: record the same close-microphone phrase through the old
processed profile and the candidate raw profile. Confirm that the raw archived
WAV has no Conduit-introduced clipping or pumping and that dictation remains
usable.

### Work package 3 — reduce packet and buffer overhead

Cause: the worklet emits render-quantum-sized messages and creates too many
arrays and copies.

Proposed fix:

1. Add a fixed PCM accumulator inside the worklet.
2. Emit 20 ms packets by default: 320 PCM16 samples or 640 bytes. Permit 40 ms
   only when browser measurements show a useful CPU reduction.
3. Write samples directly into typed arrays.
4. Use double buffering or a small returned-buffer pool. Never reuse a
   detached transferred buffer.
5. Flush one final partial packet before Stop.
6. Coalesce packets only during bounded WebSocket backpressure. Preserve order
   and fail directly if the bound cannot recover.
7. Replace per-frame server copies with one session-owned PCM accumulator.
8. Let adapters consume committed ranges or views. Materialise complete
   buffers only for batch upload or final archive.
9. Write the archive from the same authoritative PCM sequence.

Exit criteria:

- packet rate is 25–50 messages per second;
- final PCM always precedes Stop;
- client and server PCM bytes match;
- five-minute memory and queues stay bounded;
- backpressure is visible and bounded;
- render-quanta processing does not allocate one payload per quantum.

Package handoff test: dictate a short phrase and stop immediately after its
last word. Confirm 25–50 packets per second, matching client/server bytes, the
last word in the transcript and WAV, and unchanged composer behaviour.

WP3 verification record (2026-08-15): the worklet and server focused suites
passed with 34 tests; the full Node suite passed 461 tests; `npm run typecheck`
passed; `npm run build` passed with 182,827 B initial JS gzip, 24,345 B initial
CSS gzip, and 185,186 B largest lazy JS gzip; focused desktop packet/lifecycle
browser coverage passed; focused mobile packet/lifecycle and unfocused-composer
coverage passed; focused resource-reuse and empty-transcript coverage passed;
and `git diff --check` passed. The manual approval record follows.

Manual approval record (2026-08-15): the user dictated “packet test one, two,
three, four, five” on mobile and confirmed that the complete phrase, including
the final word, entered the composer. The newest Q8 record used 86,272 client
and server PCM bytes, 135 packets over 2,696 ms, runtime preparation of
1,399 ms, and an unclipped 16-bit mono 16 kHz WAV. A second mobile record also
completed with matching bytes and a non-empty transcript. The mobile composer
button currently keeps toggle semantics even when Voice settings selects
push-to-talk; a larger touch push-to-talk control is deferred and is not part
of WP3.

WP4A implementation verification record (2026-08-15): the pinned Silero ONNX
artifact was verified at 2,327,524 bytes with SHA-256
`1a153a22f4509e292a94e67d6f9b85e8deb25b4988682b7e174c65279d8788e3`, MIT
licence, CPU execution, and an unprivileged server process. Focused VAD,
dictation-stream, model-manager, and capture tests pass. A real development
record produced high speech probabilities and two padded regions around a
synthetic ten-second pause. Manual mobile acceptance is pending.

### Work package 4A — observe Silero boundaries

Cause: the current post-Stop energy splitter uses fixed thresholds and can
discard or merge valid speech.

Proposed fix:

1. Run a separately versioned Silero VAD component in Conduit.
   `transcribe.cpp` does not include VAD. Verify the Silero model licence,
   checksum, target architecture, memory, and unprivileged deployment.
2. Feed a copy of accepted PCM into Silero without changing the PCM sent to the
   current transcription path.
3. Record speech probability, entry, exit, pre-roll, hangover, and proposed
   segment sample ranges in diagnostics and the archive sidecar.
4. Compare 200–300 ms pre-roll and trailing padding with the pause corpus.
5. Compare trailing-silence boundaries near 600–1,000 ms with the pause
   corpus.
6. Preserve the complete accepted PCM in the recording archive. Store
   boundaries as sample ranges.
7. Rename the exact-zero signal as a digital-silence or device-stall
    diagnostic.

Exit criteria:

- Silero observation cannot change transcript text or submitted PCM;
- the archive can audit every proposed boundary;
- ten-second and 30-second pauses produce separate proposed speech regions;
- short words remain inside padded proposed regions;
- noise and non-speech transients do not create unbounded regions.

Package handoff test: record speech, ten seconds of silence, and more speech.
Confirm that transcription still uses the old final path while the sidecar
shows two padded Silero speech regions that cover both spoken parts.

### Work package 4B — make Silero authoritative

Purpose: replace `splitSilence` and the exact-zero speech decision only after
package 4A has produced accepted boundaries.

Proposed fix:

1. Make Conduit authoritative for VAD. Browser activity can drive the UI but
   cannot decide which PCM Conduit keeps or submits.
2. Use the accepted Silero pre-roll, onset, hangover, trailing padding, and
   speech-exit policy from package 4A.
3. Submit padded Silero speech ranges to inference modes that require
   segmentation. Bypass Conduit segmentation for modes with a verified better
   policy.
4. Never discard detected speech only because it is shorter than 500 ms.
   Merge an uncertain range into a neighbour or submit it.
5. Treat segment count as a resource guard. Merge the remainder or use a
   bounded fallback and emit a diagnostic. Never omit the tail silently.
6. Keep the original complete PCM in the archive.
7. Remove `splitSilence` from the active Conduit segmentation path after parity
   is proven.

Exit criteria:

- ten-second and 30-second pauses preserve speech on both sides;
- short valid words survive;
- noise does not create unbounded segments;
- more than 16 speech regions cannot lose the tail;
- silence-only capture cannot reach ASR as valid speech;
- every submitted sample range maps to an archived VAD decision.

Package handoff test: dictate a short word, pause for ten seconds, then dictate
another short word. Confirm both words appear in order, the session stays
active until explicit Stop, and diagnostics show Silero supplied the submitted
ranges.

### Work package 5 — retain progressive batch as a fallback

Purpose: provide a bounded fallback for installed offline models, streaming
startup failure, and cut-over rollback. Progressive batch is not the primary
Unified English architecture.

Proposed fix:

1. Let Silero VAD commit completed utterance ranges during capture when the
   selected model cannot stream or a streaming session fails before useful
   text.
2. Give each range a sequence number and sample start/end positions.
3. Queue committed ranges for batch inference without blocking capture.
4. Emit successful ranges as stable segment finals.
5. On Stop, flush the VAD tail and await only unfinished fallback work.
6. Retain successful segments when one range fails and report the failed
   sequence.
7. Use bounded acoustic overlap and conservative duplicate-word merging.
8. Do not run progressive batch and stateful streaming on the same PCM region.
9. Retain whole-session batch only where segmentation reduces measured
   accuracy.

Exit criteria:

- an offline model preserves pause-separated speech;
- streaming startup failure can fall back without losing accepted PCM;
- session-final text contains each fallback segment once and in order;
- fallback inference cannot block capture;
- the normal Unified English path does not use progressive batch.

Package handoff test: select an existing offline model, dictate two phrases
separated by ten seconds, and keep recording after the first phrase becomes
stable. Confirm the first phrase appears before Stop, the second appends once,
and capture remains active throughout.

### Work package 6A — package `transcribe.cpp` and add batch inference

Cause: the pinned upload runtime cannot consume incremental PCM. Repeated
full-audio snapshots would decode old audio again, increase work with session
length, and create duplicate or flickering text.

Proposed fix:

1. Select the MIT-licensed `transcribe.cpp` runtime. Do not run a broad runtime
   evaluation.
2. Use its Node binding. Conduit already requires Node 22 or later, which
   satisfies the binding's current engine requirement.
   This package changes native dependencies and the lockfile. The instruction
   to start package 6A must explicitly authorize those two changes before the
   agent installs or regenerates anything.
3. Select `parakeet-unified-en-0.6b-Q8_0.gguf` as the default English model.
   Pin its CC-BY-4.0 licence, source revision, byte size, and checksum.
4. Use the published Linux x64 and arm64 CPU/Vulkan packages for the first
   cut-over. Verify their native-library contract and unprivileged deployment.
5. Do not assume that the same prebuilt package supplies CUDA. The current Node
   package lists CPU/Vulkan Linux artifacts. Add a separately built, pinned
   CUDA artifact only if target-hardware measurements justify it.
6. Add Unified English Q8 as an explicitly selectable managed local model
   without changing the saved default.
7. Convert final PCM16 to 16 kHz mono float once at the server boundary and run
   one complete batch transcription through a reusable session.
8. Preserve the current upload runtime and model selection as automatic
   rollback.
9. Measure cold load, warm batch real-time factor, settlement, peak memory, and
   word error rate on the VPS CPU and production GPU host.
10. Report the backend actually bound by the runtime. An automatic CPU
    fallback must be visible.
11. Add capability metadata for language, inference mode, partials, external
    VAD, precision, memory, and backend.

Exit criteria:

- Unified English Q8 installs through immutable, verified artifacts;
- batch dictation works through a reusable `transcribe.cpp` session;
- cancellation and idle unload release native capacity;
- CPU operation on the VPS is usable and visible;
- Vulkan operation is verified on the production GPU host before CUDA work is
  considered;
- Q8 meets the fixed accuracy threshold without FP32;
- manifests, checksum verification, and unprivileged installation remain
  mandatory;
- selecting the previous model still uses the old functional path.

Package handoff test: explicitly select Unified English Q8, restart, dictate
one fixed phrase, and Stop. Confirm final text, archived clean PCM, selected
model, Q8 precision, and actual CPU or Vulkan backend. Switch back to the
previous model and confirm it still works.

### Work package 6B — add stateful live transcription

Purpose: make Unified English Q8 consume PCM during capture and expose stable
and revisionable text without changing the default model.

Proposed fix:

1. Open one reusable streaming session for each active Unified English
   dictation.
2. Feed 16 kHz mono float PCM into the session as packets arrive. Do not resend
   earlier audio or create rolling full-session snapshots.
3. Map append-only committed text to Conduit's stable transcript region and
   tentative text to its one revisionable active region.
4. Start with a supported accuracy-oriented configuration. Exclude the 80 ms
   configuration because its documented word error rises sharply.
5. Compare only the practical 160 ms, 480 ms, 1.12-second, and 2.08-second
   configurations on the fixed Conduit corpus, then select one documented
   default.
6. Keep Silero as a separate Conduit component. Use its boundaries to preserve
   pre-roll, apply hangover, and re-anchor streaming regions without discarding
   the original PCM.
7. Finalize only after the final PCM packet and explicit Stop. Reset or dispose
   the stream on cancellation, socket loss, timeout, model change, and server
   shutdown.
8. Fall back to package 5 only if streaming fails before useful stable text.
   Never transcribe the same PCM through both paths.
9. Measure first tentative text, first committed text, revision count,
   settlement, queue depth, and backend.

Exit criteria:

- Unified English Q8 accepts incremental PCM in one stateful session;
- tentative text can revise only its own active region;
- committed text never regresses or duplicates;
- long silence does not close the Conduit session;
- Stop preserves the final PCM and final word;
- cancellation and failure release native capacity;
- partial and stable latency meet baseline-derived targets;
- the previous model and package 5 fallback remain functional.

Package handoff test: explicitly select Unified English Q8 and dictate two
phrases with a ten-second pause. Confirm tentative text appears during speech,
committed text stays stable, both phrases survive, the session stops only on
explicit Stop, and the previous batch model still works.

### Work package 7 — make adapter behaviour explicit

Cause: current adapter names do not state when inference starts, whether text
can change, who owns VAD, or whether audio input is stateful.

Proposed fix:

1. Define one lifecycle: open, accept PCM, accept a committed boundary where
   supported, stop, cancel, and close.
2. Declare whole-session batch, fallback progressive batch, or stateful
   streaming.
3. Declare Conduit Silero VAD, runtime VAD, or no VAD. The selected
   `transcribe.cpp` Parakeet path declares Conduit Silero VAD.
4. Declare revisionable partials or stable-only output.
5. Declare audio limits, packet requirements, capacity, and cancellation.
6. Validate model and adapter compatibility before capture.
7. Normalise output into revisionable partial, sequenced segment final,
   session final, and bounded diagnostic or error events. For
   `transcribe.cpp`, map tentative text to the revisionable partial and
   committed text to stable output.
8. Keep one authoritative session state machine in `dictation-stream.js`.
9. Do not infer input streaming from an SSE response.
10. Keep legacy adapters available until package 11. Mark them as legacy
    without changing the saved default.

Use this state flow:

`opening → capturing → draining → finalising → completed`

Cancellation and failure can leave any active state. Make transitions
idempotent because Stop, socket close, runtime error, and timeout can race.

Exit criteria:

- capability data explains each adapter without reading its code;
- a partial can revise only its active region;
- a partial cannot overwrite stable segments;
- Stop flushes PCM, VAD, inference queues, and runtime finalisation in order;
- cancellation releases every runtime slot.

Package handoff test: exercise Stop during speech, Stop during silence, socket
close during capture, and cancel during inference. Confirm each session reaches
one terminal state, stable text never regresses, capacity is released, and a
new dictation can start immediately.

### Work package 8 — decouple archive settlement

Cause: archive disk work can extend the user-visible lifecycle.

Proposed fix:

1. Freeze final PCM and sidecar metadata when the transcript becomes final.
2. Send session-final and completed events before awaiting archive disk work.
3. Queue a bounded server-owned archive task and drain it during orderly
   shutdown.
4. Keep atomic pair writes and 20-pair rotation.
5. Record archive duration and failure separately.
6. Keep immutable PCM alive until the archive task owns it.

Exit criteria:

- disk latency does not extend settlement;
- orderly shutdown drains accepted archive work;
- archive failures remain visible but non-fatal;
- incomplete pairs never appear valid.

Package handoff test: perform one successful dictation while archive storage is
healthy and one with an induced archive-write failure through the existing
test seam. Confirm successful text completes before disk settlement, the
healthy pair is valid, and archive failure does not fail dictation.

### Work package 9 — make model state clear

Proposed fix:

1. Show model language, batch/progressive/live mode, precision, backend, and
   warm state in Voice settings.
2. Explain that FP32 uses more resources without a guaranteed useful accuracy
   gain.
3. Recommend a measured default for the deployment.
4. Keep credentials and advanced runtime controls separate from normal
   microphone and shortcut controls.
5. Preserve saved-draft behaviour during install and progress polls.
6. Explain when the selected model cannot provide live mode and offer a
   compatible installed mode or model.
7. Report cold start separately from utterance speed.
8. Add an explicit model-preload choice and show cold, loading, warm, and
   failed states.

Exit criteria:

- the UI never presents an offline model as live;
- visible precision and backend match diagnostics;
- fallback is visible;
- install recovery and unprivileged activation remain unchanged.

Package handoff test: select each installed local model in turn. Confirm that
Voice settings show its real language scope, batch/progressive/live mode,
precision, actual backend, warm state, and fallback before saving. Reload and
confirm only the saved selection persists.

### Work package 10 — make Unified English Q8 the default

Purpose: change the English default only after packages 0–9 have left both the
new and legacy paths functional.

Proposed fix:

1. Make Unified English Q8 through `transcribe.cpp` the default for new English
   local dictation settings.
2. Preserve an existing explicit user model selection. Do not silently replace
   a saved multilingual or remote choice.
3. For an old default that was never explicitly selected, migrate to Unified
   English Q8 only after its verified artifacts are installed.
4. If installation, model load, stream start, or backend binding fails, keep
   captured PCM and use the package 5 progressive fallback or the legacy saved
   model. Report which path completed the session.
5. Keep `achetronic/parakeet`, its ONNX models, and its adapter available for a
   bounded rollback window.
6. Record the cut-over start date, rollback-window end condition, and adoption
   diagnostics. Do not remove legacy artifacts in this package.

Exit criteria:

- new English local settings select Unified English Q8;
- explicit saved choices do not change;
- first-run install and preload states are clear;
- one failed stream can complete through a visible fallback without losing
  accepted PCM;
- rollback to the legacy model requires only a settings change;
- all accepted composer and microphone behaviour remains functional.

Package handoff test: use a fresh Voice settings state and confirm Unified
English Q8 becomes the English default. Complete one live dictation, force one
stream-start failure through the existing failure seam, confirm visible
fallback text, then select the legacy model and confirm rollback works.

### Work package 11 — retire the legacy upload runtime

Purpose: remove the old runtime only after the user approves package 10 and
the bounded rollback window ends.

Proposed fix:

1. Confirm that no supported saved setting, installed-model record, or active
   session still requires `achetronic/parakeet`.
2. Migrate or reject stale legacy selections with a direct recovery message.
3. Remove the managed `achetronic/parakeet` binary, its bundled ONNX Runtime,
   legacy ONNX Parakeet manifests, and the local HTTP upload adapter path.
4. Remove runtime flags, health checks, model metadata, settings controls, and
   documentation that exist only for that path.
5. Keep generic batch and progressive adapters required by other installed or
   remote models.
6. Preserve checksum, unprivileged extraction, cancellation, archive, and
   session-limit invariants.

Exit criteria:

- no production path starts the legacy binary or loads its ONNX artifacts;
- current settings migrate without a crash or silent model change;
- Unified English live, progressive fallback, and any retained generic batch
  mode remain functional;
- installation state contains no orphaned active legacy artifact;
- current documentation describes only supported runtime behaviour.

Package handoff test: restart from a profile that previously selected the
legacy model. Confirm the recovery message and migration, then complete one
live Unified English dictation, one forced progressive fallback, uninstall and
reinstall the managed model, and restart again.

## 5. Execution order

Run the packages in this exact order:

1. Work package 0 — evidence and diagnostics.
2. Work package 1 — capture startup.
3. Work package 2 — clean signal path.
4. Work package 3 — packet and buffer efficiency.
5. Work package 4A — Silero observation.
6. Work package 4B — authoritative Silero VAD.
7. Work package 5 — progressive batch fallback.
8. Work package 6A — `transcribe.cpp` packaging and batch inference.
9. Work package 6B — stateful live transcription.
10. Work package 7 — adapter and lifecycle hardening.
11. Work package 8 — archive settlement.
12. Work package 9 — model-state presentation.
13. Work package 10 — Unified English default cut-over.
14. Work package 11 — legacy runtime removal.

After each numbered item, run the package handoff contract and wait for
explicit user approval. Approval applies only to the completed package. It
does not authorize the next package.

Check the dirty tree first. Preserve unrelated in-flight work. Do not modify
test harnesses to hide behaviour.

## 6. File ownership

Confirm the exact file set at the start of each slice.

- `conduit-web/src/client/chat/composer.tsx`: shortcut timestamp, lifecycle
  state, and ordered partial/stable text;
- `conduit-web/src/client/chat/voice-dictation-client.ts`: capture lifecycle,
  pre-roll, packets, backpressure, and client diagnostics;
- `conduit-web/public/voice-capture-worklet.js`: resampling, PCM accumulator,
  packets, raw levels, and final drain;
- `conduit-web/src/client/chat/voice-audio.ts`: capture profiles and effective
  track settings;
- `conduit-web/src/server/dictation-stream.js`: session state, capabilities,
  VAD boundaries, queues, Stop order, and server diagnostics;
- `conduit-web/src/server/voice-vad.js`: pinned Silero loading, checksum
  verification, CPU inference, probabilities, and shadow boundaries;
- `conduit-web/src/server/voice-runtime.js`: runtime selection, preparation,
  health, backend reporting, and cancellation;
- `conduit-web/src/server/voice-model-manager.js`: verified artifacts, model
  metadata, activation, and preload;
- `conduit-web/src/server/voice-recording-store.js`: immutable archive input,
  sidecar metadata, background tasks, and shutdown drain;
- `conduit-web/src/server/voice-settings.js`: validated inference-mode and
  model-capability settings;
- `conduit-web/src/client/settings/settings.tsx`: capability, precision,
  backend, warm state, and capture profile;
- `conduit-web/README.md`: input/output streaming contract, privacy, limits,
  and diagnostics.

Follow the existing testing contract during implementation. Add focused
coverage beside affected modules. Do not change the harness to make an
acceptance case pass.

## 7. Acceptance matrix

### Capture

- shortcut startup, permission prompt, denied permission, saved microphone,
  unavailable saved microphone, suspended audio context, and rapid Start/Stop;
- Chrome and Firefox at effective 44.1 kHz and 48 kHz where devices allow;
- first PCM timestamp and visible **Listening** state agree.

### Signal

- close microphone, quiet laptop microphone, speaker echo, fan noise, keyboard
  noise, plosives, the reported boomy case, clipping, and low input;
- archived-WAV listening and fixed-reference word error;
- capture profile and effective settings in the sidecar;
- pre-processing and post-processing peak, RMS, clipping, and digital-zero
  evidence; live spectral probes are intentionally excluded from normal
  capture;
- no samples clipped by Conduit under normal input.

### Pause

- ten-second and 30-second pauses;
- short words near each boundary;
- more than 16 speech regions;
- silence-only and non-speech transients;
- immediate Stop during speech and trailing silence.

### Performance

- cold and warm runtime;
- current upload runtime as the migration baseline;
- Unified English Q8 on VPS CPU and production Vulkan;
- CUDA only after a separately approved and pinned package exists;
- first PCM, first server PCM, first segment, first partial, Stop-to-final,
  real-time factor, packet rate, peak memory, and queue depth.

### Lifecycle

- socket close during capture;
- Stop with queued or active inference;
- runtime failure after earlier stable segments;
- five-minute timeout;
- shutdown with queued archive work;
- model uninstall or device change between sessions.

### Text

- cumulative and segment-style finals;
- revisionable partials;
- repeated words across acoustic overlap;
- punctuation at segment boundaries;
- composer selection, Backspace cancellation, and auto-send.

The overhaul passes only when diagnostics explain each failure class. A fast
happy path does not compensate for unowned PCM, tail loss, or an invisible CPU
fallback.

## 8. Risks and approval gates

### Risks and non-goals

- The browser cannot capture before microphone permission and device
  activation. Only an explicit warm-microphone mode can remove most of that
  delay.
- Browser audio constraints are requests. Effective track settings are the
  evidence.
- VAD can clip speech. Pre-roll, trailing padding, original PCM, and boundary
  diagnostics are mandatory.
- Progressive batch is an offline and rollback fallback, not the primary live
  path.
- Rolling full-audio snapshots are not an accepted live design.
- Vulkan requires verification in the production container with its device and
  driver. CUDA is not part of the first cut-over.
- Paid-provider accuracy comparison is out of scope.
- The overhaul does not redesign the composer, shortcut, microphone playback
  test, retention policy, or managed-install security model.
- The overhaul does not remove checksums, unprivileged extraction, bounded
  queues, byte limits, or authenticated transport.

### Additional cut-over gates

The package approval rule in section 5 applies after every package. These
packages also require an explicit decision about their wider effect:

1. Package 4A approval must accept the observed Silero boundary policy before
   package 4B can control submitted PCM.
2. Starting package 6A must authorize the native dependency and lockfile
   changes plus the pinned Unified English Q8 download manifest.
3. Package 10 approval must accept Unified English Q8 as the new default after
   CPU, Vulkan, streaming text, pause, clipping, and word-error gates pass.
4. Starting package 11 must confirm the rollback window has ended and
   authorize removal of the old runtime and installed legacy artifacts.

These gates prevent a runtime replacement from hiding current capture and
signal defects. They also prevent a successful development GPU run from
becoming an unverified production deployment.
