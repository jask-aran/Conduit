# Voice dictation pipeline overhaul plan

Status: **WP7 complete and checkpointed on 2026-08-17. WP0, WP1, WP2, WP3,
WP4A, WP4B, WP5, and WP6A approved. WP8–WP12 have not started.**

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
- expose After Stop, During pauses, and Live as explicit execution choices;
- implement After Stop and During pauses through a common batch port and Live
  through a verified persistent stream port;
- select a valid model, artifact, runtime, execution, and segmentation tuple
  from catalogue data, not from a provider name or SSE response format.

The local runtime strategy is model-specific. Conduit will retain these four
tracks rather than treat one runtime as the universal target:

- Transformers.js for Whisper ONNX models and progressive Silero range batch;
- `transcribe.cpp` for the Unified English GGUF model and verified stateful
  streaming, with bounded batch fallback;
- the `achetronic/parakeet` ONNX loopback worker for Parakeet TDT models,
  including a dedicated evaluation of progressive range batching;
- `transcribe-rs` as a candidate Parakeet ONNX/ONNX Runtime track, with live
  behaviour enabled only after its model and streaming contract are verified
  in Conduit.

An ONNX or GGUF artifact does not determine the hardware backend. Each runtime
must report its model format, execution scheduler, segmentation provider,
compiled compute backends, actual compute backend, and resource cost.

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
- **Work package 4A — complete and approved.** Conduit
  now observes the pinned Silero VAD on a copy of the complete accepted PCM.
  Its accepted observation policy became the input to WP4B. Sidecars record
  Silero frame probabilities, model verification, CPU deployment posture,
  entry/exit thresholds, onset and exit frames, 240 ms pre-roll, 320 ms
  hangover, 240 ms trailing padding, maximum-region closure, and proposed
  sample ranges. The exact-zero worklet event is now a `digital_silence` /
  `device_stall` diagnostic. The complete WAV remains the archive source.
- Fresh local voice settings now default to `whisper-tiny-en-q8` through the
  embedded Transformers backend. An existing saved model selection is not
  changed.
- **Work package 4B — complete and approved.**
  The live batch path now waits for the server-side Silero observation, submits
  its padded ranges, retains short ranges, and merges any excess regions into
  a bounded tail with an explicit diagnostic. The complete accepted PCM still
  goes to the archive. Silence-only sessions submit no PCM to ASR. The
  adapters retain an explicit external-policy path for a future runtime with
  a verified segmentation contract; current runtimes use server-side Silero.
  The user accepted WP4B after mobile testing and recorded one follow-up:
  low-level ambient noise produced a Silero positive and Parakeet returned
  `Mm-hmm.` during silence. This is a false-positive/noise rejection issue,
  not an accepted-audio loss, and remains deferred to later audio/VAD quality
  work.
- **Work package 5 — complete and approved.**
  Local batch adapters now use an incremental Silero stream to commit closed
  ranges during capture, queue bounded range inference without blocking PCM,
  emit ordered cumulative segment finals, retain successful ranges when one
  fails, and flush the final VAD tail at Stop. The progressive coordinator
  reserves one bounded tail slot, records sequence/sample diagnostics, and
  falls back to whole-session batch when progressive VAD cannot complete.
  Remote providers and future stateful streaming remain outside this fallback.
- **Work package 6A — complete and approved.**
  The pinned `transcribe-cpp@0.1.3` Node binding and its Linux CPU/Vulkan
  optional packages are in the lockfile. Settings can install and select the
  pinned `parakeet-unified-en-0.6b-Q8_0.gguf` artifact. Conduit loads one
  reusable batch session, converts the accepted PCM16 to one 16 kHz mono
  float32 buffer, reports the native ABI and actual compute backend, and keeps
  the legacy models selectable. Unified English uses complete-session batch;
  it does not use the WP5 progressive range path or claim live partials.
- **Work package 6B — complete and approved with a latency follow-up.**
  Unified English now opens one `transcribe.cpp` stateful session per
  dictation and feeds each accepted 20 ms PCM packet once as 16 kHz mono
  float32. The selected `parakeet_buffered` profile is 480 ms latency with a
  5.6 s left context, 160 ms chunk, and 320 ms right context; the 80 ms
  profile is excluded. Stable-prefix agreement is three updates. The stream
  emits cumulative text with separate stable and tentative fields, revision
  number, committed-audio time, and buffered time. Stop finalizes the same
  session after the last packet. A stream-open failure before capture is
  recorded and falls back to the WP5 batch path without running both paths in
  parallel. The complete accepted PCM remains the archive source, and Silero
  remains a separate Conduit observation and fallback-range component.
- **Work package 7 — complete and checkpointed (2026-08-17).** The live
  adapter now copies packets into one bounded queue and drains them through one
  worker. It coalesces eight 20 ms packets into one 160 ms native feed, keeps
  accepted, submitted, committed, and optional processed cursors separate, and
  reports the server queue and native buffer as separate lag layers. The queue
  limit is 5,000 ms. Pre-stable overflow uses the existing batch fallback from
  sample zero; post-stable overflow fails visibly and preserves the WAV. Stop
  closes input, drains the queue, finalises once, and emits one terminal result.
  The current CPU Live profile is the existing 1,120 ms profile
  (`5,600/560/560` ms left/chunk/right). The model selection, browser packets,
  archive source, and all other runtimes remain unchanged. The checkpoint
  evidence and deferred accuracy work are recorded below.
- **Four-runtime direction — recorded, not yet implemented.** The user wants
  all four local runtime tracks retained and iterated until their speed,
  accuracy, pause behaviour, resource use, and feedback are acceptable.
  Current user evidence makes Whisper progressive batching the best interaction
  baseline: a Silero-closed range often completes during a thinking pause,
  before the next phrase starts. The user also prefers the accuracy and general
  behaviour of `achetronic/parakeet`, but wants its progressive batching verified
  and improved rather than replacing that runtime. `transcribe-rs` is not yet
  integrated; WP10 is the dedicated package for that fourth runtime.
- **Work packages 8–12 — not started.**

WP3, WP4A, WP4B, WP5, WP6A, WP6B manual approval, and the WP7 checkpoint are
recorded below. WP7 owns the recorded live-latency follow-up.

## Deviations from the proposed plan

- The user-approved execution order implemented WP2 before WP1. WP1 is now
  filled in and no later package has started.
- The WP0 fixed-reference comparison against Unified English Q8 remains
  deferred. WP6A installed the target runtime and model, but no fixed WER
  corpus was added; current evidence is native smoke output and live-path
  diagnostics.
- The existing server already accepts PCM while `voiceRuntime.resolve()` is
  cold and the batch adapters already wait until Stop before inference. The
  WP1 follow-up adds explicit runtime-ready and waiting-for-transcription
  events, archives received PCM before transcription settlement, and updates
  the sidecar after success or failure. It does not keep the microphone open
  by default and does not change the five-minute model idle timer.
- The proposed 250–500 ms socket pre-roll was too small to protect a slow
  handshake. The pending client queue now uses the full five-minute audio cap;
  the package-size review remains deferred.
- The fresh local default remains Whisper Tiny English Q8 on embedded
  Transformers, not Unified English Q8 on `transcribe.cpp`. WP6A and WP6B do
  not change the saved default, and the legacy model options remain
  selectable.
- The original one-way convergence toward Unified English Q8 and later removal
  of `achetronic/parakeet` is superseded. Retain every useful runtime. The user
  can change the default when the relevant profile is available; default
  selection and runtime removal are not work packages.
- `transcribe-rs` is promoted from a candidate to an explicit WP10 integration
  package. It is not installed, selected, or described as live-capable until
  its model support, artifact packaging, hardware reporting, and streaming or
  batch contract are implemented and verified.
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
- WP4A kept the VAD implementation and model verification separate from the
  transcription adapter. WP4B now supplies the selected Silero ranges to the
  batch adapters at Stop. The pinned artifact is reused from the reviewed
  managed voice package and is also added to new Whisper manifests; existing
  installations can use any verified copy under the voice model root. No new
  settings control or lockfile dependency was added.
- The exported adapters retain an RMS split only when called without an explicit
  session segmentation object. The authenticated dictation path always passes
  the server-side Silero selection. This keeps direct adapter compatibility
  tests stable while removing `splitSilence` from the live path. WP11A can add
  a new explicit Conduit heuristic after measurement; it does not restore this
  compatibility split or make RMS a silent fallback.
- WP6B adds the verified `transcribe_cpp_stream_v1` runtime identifier and
  keeps `transcribe_cpp_batch_fallback_v1` private to stream-start fallback.
  The selected Node binding accepts `parakeet_buffered` for Unified English;
  the plain `parakeet` family is not accepted by this model. The 480 ms
  profile was the initial choice from smoke comparisons of the four practical
  profiles, not from a new WER corpus. WP7 changed the current CPU Live choice
  to the existing 1,120 ms profile after the bounded-backlog measurements
  below. Silero remains outside the native stream session.
- WP5 uses progressive batch only for a resolved local `batch` runtime whose
  adapter exposes a bounded range-transcription operation. Remote providers
  remain Stop-time batch, and no speculative stateful-streaming capability was
  added. The existing `final` wire event carries cumulative text plus optional
  sequence/sample metadata, so the existing composer contract remains stable.
- WP5 uses one incrementally processed Silero session per VAD execution owner
  and serialises VAD work across sessions. Capture does not await VAD or ASR;
  only Stop waits for the final VAD tail and unfinished fallback inference.
  The incremental path keeps the full frame audit for the final sidecar but
  avoids rescanning the complete frame history after every PCM packet.
- WP6A pins the published `transcribe-cpp@0.1.3` release instead of the
  unreleased repository head. Its Linux x64 and arm64 CPU/Vulkan packages are
  resolved as optional lockfile dependencies and their native loader verifies
  the ABI contract. The current host exposes CPU only; Vulkan execution needs
  a separate production-GPU verification and CUDA is not included.
- WP6A downloads the GGUF from the immutable
  `handy-computer/parakeet-unified-en-0.6b-gguf` revision
  `7e948f21b7bdbac698d3318db9d350f1096f3b6c`, while retaining the upstream
  source model revision `d4ac9928f3bf238223ff0779c06b8149bf8ac4e1` in the
  manifest. The exact artifact is 731,357,568 bytes with SHA-256
  `4b50b6dd862bf6e346929aaf4f5eaacec003bfa3f56462d6c874b41ef2f38795`.
- WP6A used Silero as an audit-only component for complete-session batch.
  WP6B keeps the complete PCM archive and Silero observation separate from the
  native stream. Only a verified stream-start failure changes to the WP5
  progressive batch adapter; normal Unified streaming does not submit the
  same PCM to progressive batch.
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
  build is 183,529 bytes gzip, with 24,412 bytes initial CSS gzip and 185,187
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
in section 6. Do not begin the next unit in the same agent turn. At the end of
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
synthetic ten-second pause. The user then accepted WP4A after mobile tests;
the complete short-word and pause-separated behaviors were retained for WP4B.

WP4B implementation verification record (2026-08-15): the live batch path now
waits for the server-side Silero result before final inference. Focused tests
cover silence-only no-submit behavior, padded multi-region submission, valid
speech shorter than 500 ms, and bounded tail merging above the segment cap.
The full Node suite passed 477 tests. Typecheck passed. The production build
passed with 183,484 B initial JS gzip, 24,412 B initial CSS gzip, and 185,186 B
largest lazy JS gzip. The browser set-piece suite passed 13 tests and skipped
11 project-matrix cases; the voice-focused browser suite passed 5 tests and
skipped 1. The user accepted WP4B after mobile testing. The accepted follow-up
is the sidecar
`2026-08-15T14-18-07-767Z-739d2241-3737-4005-aced-e24764c69dea.json`: a
low-level ambient event reached Silero with maximum probability about 0.894
and Parakeet returned `Mm-hmm.` while the user was silent. This is recorded as
a false-positive/noise rejection issue for later quality work.

WP5 implementation verification record (2026-08-16): focused VAD and
dictation-stream tests cover incremental closed-region delivery, a stable
final before Stop, ordered tail append, successful-result retention after a
failed range, and sequence/sample diagnostics. The full Node suite passed 482
tests. Typecheck passed. The production build passed with 183,484 B initial JS
gzip, 24,412 B initial CSS gzip, and 185,186 B largest lazy JS gzip. The
browser set-piece suite passed 13 tests and skipped 11 project-matrix cases;
the voice-focused browser suite passed 11 tests and skipped 1.

WP5 manual approval record (2026-08-16): the user tested local
`whisper-tiny-en-q8` with a 49,240 ms dictation. The WAV is mono PCM16 at
16 kHz with 1,575,680 PCM bytes; the sidecar reports the same PCM size and
duration. Progressive batch was enabled, all 9 committed ranges completed,
no range failed, no VAD fallback occurred, and the first segment final arrived
at 3,878 ms. The transcript entered the composer in order and the user
accepted WP5. The sidecar is
`2026-08-15T15-32-21-828Z-ee4f2317-0d3c-4816-9e09-516a9cd758c6.json`.

WP6A implementation verification record (2026-08-16): `transcribe-cpp@0.1.3`
was installed with its locked native packages. The pinned Unified English Q8
model was installed through the managed installer and its artifact checksum
passed. The full Node suite passed 485 tests. Typecheck passed. The production
build passed with 183,529 B initial JS gzip, 24,412 B initial CSS gzip, and
185,187 B largest lazy JS gzip. A real native smoke test loaded the reusable
batch session, reported `transcribe-cpp` version `0.1.3`, ABI header hash
`86b16dd97ad1cb58`, and CPU compute, then transcribed the first 4 seconds of
the approved WP5 WAV as `First phrase is stable.`. The current host reports no
Vulkan backend; production-GPU Vulkan verification remains a handoff risk.
After the build, Conduit was restarted with the managed restart command and
`GET /healthz` returned `{"ok":true,"status":"ready","release":"development"}`.
The browser voice suite then passed 11 tests with 1 expected skip. The passed
cases included desktop and mobile dictation, unfocused-composer insertion,
silent-microphone handling, and empty-transcription error handling. The user
approved WP6A after manual testing. The native smoke test and browser suite
prove the installed CPU path; they do not prove Vulkan execution on the
production GPU host.

WP6B implementation verification record (2026-08-16): the native model
reports `supportsStreaming: true` and accepts `parakeet_buffered`; its plain
`parakeet` family is not accepted. Smoke comparison opened all four practical
profiles (160 ms, 480 ms, 1.12 s, and 2.08 s) and produced the same fixed
phrase. The 480 ms profile was selected as the default because it gives a
shorter practical commit interval without using the excluded 80 ms profile.
The stream adapter feeds one float32 packet per accepted PCM packet, including
packets retained during cold model startup, exposes stable and tentative text,
finalizes on Stop, and preserves the complete WAV. Startup fallback is covered
before any session PCM is consumed by the batch adapter. Typecheck passed; the
focused model-manager, settings, and stream suites passed 15, 8, and 26 tests.
The full Node suite passed 487 tests on the clean rerun. An earlier concurrent
run reported `dictation stores server PCM when transcription returns no text`
as the only failure; its focused rerun and the full rerun passed. The
production build passed with 183,532 B initial JS gzip, 24,412 B initial CSS
gzip, and 185,186 B largest lazy JS gzip. After the managed restart,
`GET /healthz` returned `{"ok":true,"status":"ready","release":"development"}`.
The browser set-piece suite passed 13 tests and skipped 11 project-matrix
cases; the voice-focused suite passed 11 tests and skipped 1 expected case.
WP6B manual approval record (2026-08-16): the user confirmed that Unified
English text appeared before Stop during the live dictation test. The latest
Unified sidecar used `transcribe_cpp_stream_v1`, preserved two ordered phrases,
recorded 14 revisions, used no stream fallback, and matched client, server,
and WAV PCM bytes. The previous Transformers batch model also completed with
non-empty text and a matching audio pair after the model selection was saved.
The user reported that live text sometimes fell several seconds behind and
arrived slowly. The Unified sidecars recorded maximum buffered audio of 5,420
ms and 9,272 ms in the tested sessions. WP6B is accepted for functional live
transcription; stream latency remains a follow-up risk and is not treated as a
silent audio-loss failure.

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

### Work package 5 — retain progressive batch for batch-capable runtimes

Purpose: provide bounded progressive batch for installed offline models and
stream-start fallback. For Transformers.js and the legacy Parakeet worker,
progressive batch is a supported primary mode while that runtime is selected;
for Unified English it remains a fallback only.

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







## 5. Target architecture from work package 7 onward

The remaining work must produce one Conduit-owned dictation system. Runtime
adapters execute inference. They do not own capture, accepted PCM, range
selection, transcript merging, fallback, or archive policy.

### Terms and ownership

- **Model** identifies the acoustic model, such as
  `parakeet-unified-en-0.6b`.
- **Artifact** identifies immutable model files. Format, precision, revision,
  byte size, checksum, and licence identify an artifact.
- **Runtime** identifies the executable implementation, such as
  Transformers.js, `transcribe.cpp`, `achetronic/parakeet`, or
  `transcribe-rs`. Its stable ID must not contain a version.
- **Backend path** identifies one compatible artifact and runtime pair. Port
  capability belongs to this pair.
- **Execution profile** identifies one valid backend path, execution mode,
  segmentation policy, output contract, resource policy, and fallback.
- **Behaviour** is the user-visible time at which text appears:
  **After Stop**, **During pauses**, or **Live**.

Use this ownership model:

```text
Browser                 Conduit session                     Runtime adapter
capture ── PCM ──► accepted PCM timeline
                   archive ownership
                   segmentation: none | heuristic | Silero
                   scheduler: Stop | Eager | Live
                   transcript normalizer
                                             ├── BatchPort.transcribe(pcm)
                                             └── StreamPort.open/feed/finalize
```

The browser sends ordered 16 kHz mono PCM and control messages over the
authenticated dictation WebSocket. Browser code can resample, assemble
packets, show levels, and retain bounded pre-ready audio. It must not run
model-specific VAD, select inference ranges, merge text, or know the active
native runtime.

Every supported local backend path must expose `BatchPort`. This makes
**After Stop** a Conduit guarantee. **During pauses** is the Eager scheduler
over `BatchPort`; Silero or the explicit heuristic closes each range. **Live**
requires a verified persistent `StreamPort`. Never run Live and Eager over the
same PCM.

Capability belongs to the exact backend path. Parakeet is not globally
streaming or batch-only. Unified English Q8 GGUF currently streams through
`transcribe.cpp`. Current ONNX Parakeet through `transcribe-rs` is a batch
target. A later runtime version can add a Live profile only after that exact
artifact and adapter pass the StreamPort contract.

Local and Cloud settings share an interaction grammar, not a catalogue.
Local choices use the versioned local catalogue, installation state, and
`localSelection`. Cloud choices keep the existing provider, adapter, model,
endpoint, and credential fields. Cloud choices must never enter the local
catalogue, `localSelection`, local install state, or local runtime state.

The remaining work has six packages. Each package delivers one complete
product change. There is no separate benchmark, default-selection, or
runtime-retirement package. Run focused regression evidence in the package
that changes a path. The user can choose a default when that choice becomes
available. Retain all current runtimes unless a later instruction names one
for removal.

### Work package 7 — bound the current `transcribe.cpp` live backlog

**Behavioural change:** Unified English Live consumes audio at or above capture
rate. Long dictation does not accumulate multi-second native-feed lag.

The current adapter schedules one native `feed()` for each nominal 20 ms
browser packet. One promise tail represents packet acceptance, JavaScript
submission, and native processing. WP6B sidecars recorded 5,420 ms and
9,272 ms of buffered audio. These values prove that the path streams, but not
that it stays real-time.

**Required implementation:**

1. Keep browser packets and archive PCM unchanged. Change only the
   server-to-runtime feed scheduler.
2. Preserve the current session input method name. If
   `dictation-stream.js` currently calls `write()`, make `write()` enqueue PCM.
   Do not add `acceptPcm()` as a second public input path. A private queue
   helper can use either name.
3. Give the `transcribe.cpp` stream adapter one bounded PCM queue and one feed
   worker. The input method copies or transfers each packet into the queue and
   returns without waiting for native inference.
4. Coalesce adjacent packets into a verified native feed quantum. Determine
   the quantum from the binding contract or compare fixed multiples of 20 ms.
   Record the selected value. Do not invent a binding option.
5. Allow one native `feed()` call at a time. Preserve every sample and its
   order.
6. Track these cursors:
   `acceptedThroughSample`, `submittedThroughSample`, and
   `committedThroughSample`. Track `processedThroughSample` only if the native
   binding reports an exact processed cursor. A resolved `feed()` call proves
   submission completion; it does not prove acoustic consumption unless the
   binding states that contract.
7. Report separate lag values:

   ```text
   serverQueuedAudioMs =
     acceptedThroughSample - submittedThroughSample

   runtimeBufferedAudioMs =
     value reported by the native stream

   totalInferenceLagMs =
     serverQueuedAudioMs + runtimeBufferedAudioMs
   ```

   Convert sample differences at 16 kHz. If the runtime does not report its
   buffered duration, set that field and total lag to `null`. Never label a
   feed return as `consumedThroughSample`.
8. Set a 5,000 ms server-queue limit during this package. Before stable text,
   an overflow closes the live adapter and starts the existing batch fallback
   from sample zero. Record `live_queue_overflow`. After stable text, fail
   visibly and preserve the WAV until WP9 supplies checkpoint fallback. Never
   run both paths at once.
9. Stop in this order: close input, enqueue final PCM, drain the server queue,
   call native finalise once, normalize terminal text, and dispose the stream.
10. Cancel rejects input, discards queued runtime work, calls the verified
    cancel or disposal operation, releases capacity, and preserves accepted
    PCM for the configured archive policy.
11. Record feed quantum, feed-call count, mean audio per call, maximum server
    queue, maximum native buffer, all available cursors, overflow, and Stop
    drain duration.

**Completion evidence:**

- Run continuous speech for 60 seconds. The server queue must not grow
  monotonically and must remain below 1,000 ms on the approved host.
- After speech ends, the server queue must return below 250 ms within two
  seconds.
- Run a ten-second pause, immediate Stop during speech, and a forced feed
  stall. Confirm final words, matching WAV bytes, one terminal result, and
  visible fallback or failure.
- If the host cannot keep this profile faster than real time, keep the same
  model available as **After Stop** and mark Live unavailable on that host.

**Expected scope:** `src/server/dictation-stream.js`,
`src/server/voice-runtime.js`, focused stream coverage, diagnostics, and the
runtime protocol documentation. Do not change browser capture without evidence
of a browser defect.

**Handoff:** run focused checks and the production build. Restart the managed
server, confirm `/healthz`, report both queue layers and final-word evidence,
then wait for user testing and approval.

#### WP7 checkpoint evidence — 2026-08-17

WP7 is checkpointed complete. The user tested the changed Live path and
reported that it keeps up. The user also reported high perceived WER. Accuracy
work is deferred; WP7 establishes the backlog boundary and does not add a WER
corpus.

**Cause established.** The model was not the only cause of the backlog. The
`transcribe.cpp` Parakeet Unified buffered stream re-runs the encoder over a
sliding `[left | chunk | right]` window for each native feed. Small chunks
therefore repeat the large left context at a high rate. The official
[`transcribe.cpp` Unified documentation](https://github.com/handy-computer/transcribe.cpp/blob/main/docs/models/parakeet-unified-en-0.6b.md)
lists the supported `(left, chunk, right)` choices. The 480 ms profile was too
expensive for this CPU host; the Q8 model itself can run faster than real time
when a larger supported chunk amortises the overlapping encoder work.

**First failing live evidence.** The latest user recording before the profile
change was `2026-08-16T22-16-44-148Z-6a3eb516-2ae5-43c5-8cdd-da94be52e19c.json`.
Safe sidecar values were:

- 13,340 ms accepted audio and 426,880 server PCM bytes;
- 160 ms feed quantum, 52 native feed calls, and 160 ms mean audio per call;
- `acceptedThroughSample=213440`, `submittedThroughSample=133120`, and
  `committedThroughSample=133120`;
- 5,020 ms maximum server queue and 1,760 ms maximum native buffer;
- `completionReason=failed`, `overflow.code=live_queue_overflow`, and
  `overflow.stableText=true`.

The 160 ms scheduler was therefore correct after the Stop-drain correction,
but native processing still fell behind. The post-stable overflow was visible
and the accepted WAV was preserved, as required by WP7.

**Native CPU benchmark.** The same WAV and pinned
`parakeet-unified-en-0.6b-q8` GGUF were run through `transcribe-cpp@0.1.3`,
with actual backend `cpu`, version commit `a94e021`, and header hash
`86b16dd97ad1cb58`. With the 480 ms profile, 13,340 ms of audio required
21,456.45 ms in the profile replay, with 0.631x real-time throughput, 251.59
ms mean time per 160 ms feed, 330.34 ms p95 feed time, and 1,760 ms maximum
native buffer. A direct 160 ms feed run measured 269.372 ms mean, 315.952 ms
p50, 349.812 ms p95, 379.837 ms maximum, and 0.590x real-time throughput.

The supported-profile sweep on the same input was:

| Profile | Left / chunk / right | Total native replay | Throughput | Maximum native buffer |
| --- | ---: | ---: | ---: | ---: |
| 160 ms | 5,600 / 80 / 80 ms | 40,562.99 ms | 0.331x | 1,760 ms |
| 480 ms | 5,600 / 160 / 320 ms | 21,456.45 ms | 0.631x | 1,760 ms |
| 1,120 ms | 5,600 / 560 / 560 ms | 6,593.49 ms | 2.139x | 2,080 ms |
| 2,080 ms | 5,600 / 1,040 / 1,040 ms | 4,042.21 ms | 3.666x | 3,040 ms |

The 1,120 ms profile is the current choice because it is the first measured
profile that stays faster than real time while keeping lower lookahead than
the 2,080 ms option. The 80 ms, 480 ms, and 2,080 ms profiles remain in the
supported-profile list for later profile work.

**Paced server-adapter replay.** The last WAV was replayed as 667 real-time
20 ms packets through `createTranscribeCppStreamAdapter` with the 1,120 ms
profile. The native model and binding were real; the browser and authenticated
WebSocket were not used for this programmatic replay. Evidence was:

- 13,340 ms audio, 13,320.12 ms capture pacing, and 13,680.23 ms total replay;
- 500 ms maximum server queue, 0 ms final server queue, and 2,080 ms maximum
  native buffer;
- 0.27 ms adapter Stop-drain time and approximately 360 ms from the last
  packet to total settlement;
- 84 native feed calls with 158.810 ms mean audio per call;
- `acceptedThroughSample`, `submittedThroughSample`, and
  `committedThroughSample` all equal to 213,440;
- no overflow, with `partial`, `final`, and `adapter_closed` terminal
  evidence.

The total replay wall time includes the 13,340 ms real-time capture schedule.
The queue result, final zero queue, complete sample cursors, and short
post-capture settlement are the relevant sustained-throughput evidence.

**Regression and package checks.** The focused manager and stream tests passed
46/46. The full Node suite passed 496/496. `npm run typecheck`, `npm run
build`, and `git diff --check` passed. The build transformed 2,200 modules and
reported `bundle.initial_js_gzip_bytes=184415`,
`bundle.initial_css_gzip_bytes=24994`, and
`bundle.largest_lazy_js_gzip_bytes=185186`. The existing Vite warning about
chunks over 500 kB remains. The managed server was restarted through
`.devcontainer/start-conduit.sh restart` and `GET /healthz` returned
`{"ok":true,"status":"ready","release":"development"}`.

**Remaining evidence and risks.** The 60-second continuous-speech scenario,
ten-second pause scenario, and immediate-Stop microphone scenario were not
rerun after the profile change. The focused tests cover the forced feed stall,
queue overflow, Stop drain, fallback, and terminal-result contracts. The user
manual run confirms pace but reports poor accuracy. No fixed WER corpus was run
for WP7. WSL overhead is a plausible contributor because all CPU measurements
ran inside WSL, but no native Windows or Vulkan comparison was made. The
1,120 ms profile adds visible lookahead compared with the former 480 ms choice.
Future accuracy tuning, WSL/native comparison, and further profile optimisation
remain deferred.

### Work package 8 — add the canonical local execution contract

**Behavioural change:** every existing local choice resolves to one validated
execution profile and runs through explicit runtime ports. Existing users keep
their selected model and behaviour. A missing install remains selected and can
be installed later.

This package combines catalogue, persistence, migration, backend ports, and
lifecycle. These parts form one contract and must not exist as independent
sources of truth.

#### Static catalogue

Create `src/server/voice-execution-catalog.js` as the only static source of
local model, artifact, runtime, backend-path, profile, and migration
definitions.

```ts
type VoiceRuntimeDefinition = {
  id: string;
  adapterKind:
    | "transformers_js"
    | "transcribe_cpp"
    | "parakeet_loopback"
    | "transcribe_rs";
  version: string;
  compiledComputeBackends: string[];
};

type VoiceBackendPathDefinition = {
  id: string;
  artifactId: string;
  runtimeId: string;
  ports: { batch: boolean; stream: boolean };
};

type VoiceExecutionProfile = {
  schemaVersion: 1;
  id: string;
  modelId: string;
  artifactId: string;
  runtimeId: string;
  backendPathId: string;
  execution: "stop" | "eager" | "live";
  segmentation: "none" | "silero" | "heuristic";
  output: {
    tentative: boolean;
    stableSegments: boolean;
    sampleTimestamps: boolean;
  };
  resourcePolicy: {
    preload: "supported" | "required" | "unsupported";
    serialInference: boolean;
    maximumSessionMs: number;
    maximumQueuedAudioMs: number | null;
  };
  fallback: null | {
    profileId: string;
    allowed:
      | "before_output"
      | "after_tentative"
      | "after_stable_checkpoint";
    replay: "from_zero" | "from_committed_sample";
  };
};
```

Stable IDs describe semantics. Use `runtimeId: "transcribe-cpp"`, not
`"transcribe-cpp-0.1.3"`. Store `version: "0.1.3"` in the runtime definition
and report the loaded build version in dynamic status and sidecars. A routine
runtime update must not invalidate saved settings.

Validate the catalogue at startup. Reject duplicate or missing references,
artifact/model mismatch, artifact/runtime mismatch, cyclic fallback,
unsupported enum values, local paths without BatchPort, Live without
StreamPort, Stop or Eager without BatchPort, Eager with `none`, Stop or Live
with segmentation, and Live without a bounded queue.

Generate an After Stop profile for every BatchPort path. Add Eager only for a
path that can preserve short-range accuracy and capture responsiveness. Add
Live only for a persistent StreamPort. Represent current Transformers.js,
legacy Parakeet loopback, and `transcribe.cpp` paths. WP10 adds
`transcribe-rs`.

Keep dynamic state separate:

```ts
type VoiceBackendPathStatus = {
  backendPathId: string;
  installable: boolean;
  operational: boolean;
  blockedReason: string | null;
  artifactState: "absent" | "installing" | "installed" | "failed";
  runtimeState: "cold" | "loading" | "warm" | "busy" | "failed";
  requestedComputeBackend: string | null;
  actualComputeBackend: string | null;
  loadedRuntimeVersion: string | null;
  lastErrorCode: string | null;
};
```

Use these distinct states:

- **structurally valid:** the tuple resolves to one catalogue profile;
- **installable:** required files can be installed on this host;
- **operational now:** files and runtime are ready enough to open a session;
- **permanently blocked:** this host cannot install or run the path.

The settings API can save a structurally valid, installable profile while its
artifact is absent. Capture then returns a specific unavailable error until
installation completes. Reject invalid, incompatible, or permanently blocked
profiles. Do not use “unavailable” to mean all four states.

#### Saved local selection

Persist one complete tuple:

```json
{
  "voiceConfigVersion": 2,
  "mode": "local",
  "localSelectionOrigin": "explicit",
  "localSelection": {
    "modelId": "parakeet-unified-en-0.6b",
    "artifactId": "parakeet-unified-en-0.6b-q8-gguf",
    "runtimeId": "transcribe-cpp",
    "execution": "live",
    "segmentation": "none"
  }
}
```

Allowed origins are `default`, `explicit`, and `migrated_explicit`. Any user
Save sets `explicit`. Treat a legacy saved selection as
`migrated_explicit` unless the stored data proves that it was an untouched
default. This prevents a future default change from overwriting a user choice.

Inject the catalogue into `VoiceSettingsStore`. Do not copy validation rules
into the store or client. Define an explicit legacy `localModelId` migration
map. Migrate atomically, preserve remote credentials and unrelated settings,
and return `voice_profile_recovery_required` for an unknown choice. A
catalogue replacement uses an explicit `supersededByProfileId`; never match
labels.

`PUT /v0/voice/settings` accepts `localSelection`, resolves exactly one
profile, and returns the normalized tuple and `resolvedProfileId`. Keep
`localModelId` input for one old client version only when the mapping is
unambiguous. An absent artifact does not erase or replace the saved tuple.

#### Runtime ports and lifecycle

Create `src/server/voice-runtime-adapters.js`. Resolve ports from
`profile.backendPathId`, not `profile.runtimeId`. The backend path owns the
artifact/runtime compatibility and its ports.

```ts
type BatchPort = {
  transcribe(input: {
    pcm16: Buffer;
    operationId: string;
    sequence: number;
    startSample: number;
    endSample: number;
    signal: AbortSignal;
  }): Promise<BatchResult>;
};

type StreamPort = {
  open(input: StreamOpenInput): Promise<void>;
  feed(input: {
    pcm16: Buffer;
    startSample: number;
    endSample: number;
  }): Promise<StreamFeedReceipt>;
  finalize(input: { endSample: number }): Promise<StreamFinalResult>;
  cancel(reason: string): Promise<void>;
};
```

Adapters contain runtime-specific calls only. They cannot select a scheduler,
segment PCM, merge text, choose fallback, or archive audio.

Freeze the resolved profile when a dictation opens. A settings change affects
the next session. Use one `AbortController` per session and one runtime lease.
Release the lease once after completion, failure, cancellation, socket close,
timeout, or shutdown. Ignore late responses by session ID and operation ID.

Preserve separate artifact, runtime, and session state machines. Continue to
accept bounded PCM while a cold runtime loads. Record frozen profile,
catalogue version, artifact, stable runtime ID, loaded runtime version,
backend path, execution, segmentation, and actual compute backend.

Extend `GET /v0/voice/settings` with the local catalogue and statuses. Keep
remote provider definitions outside it. Existing user-visible dictation
behaviour must remain unchanged in this package.

**Completion evidence:**

- Invalid catalogue fixtures fail with exact errors.
- Each legacy setting migrates to the same runtime and behaviour.
- A valid absent artifact can be saved and installed later.
- Invalid, incompatible, and permanently blocked tuples cannot reach capture.
- Each current local path runs through the port declared by its backend path.
- Stop, cancellation, socket close, runtime failure, and settings changes
  release one lease and produce one terminal state.

**Expected scope:** `src/server/voice-execution-catalog.js`,
`src/server/voice-runtime-adapters.js`, `src/server/voice-runtime.js`,
`src/server/voice-model-manager.js`, `src/server/voice-model-manifests.js`,
`src/server/dictation-stream.js`, `src/server/routes/voice.js`,
`src/voice-settings.js`, client API types, focused coverage, and README
contracts.

**Handoff:** run each current local path before and after migration, plus the
invalid and absent-artifact cases. Run focused checks and the production
build. Restart, confirm `/healthz`, provide one redacted settings response and
sidecar, then wait for user approval.

#### WP8 implementation checkpoint — 2026-08-17

WP8 is complete. The implementation adds one validated static catalogue, the
explicit BatchPort and StreamPort adapter boundary, v2 local-selection
persistence, legacy migration, separate backend-path status, frozen session
metadata, one idempotent session lease, one session abort signal, and
operation IDs for local BatchPort calls. Existing legacy model IDs remain
valid. No runtime was removed and no default-selection decision was made.

The catalogue contains 7 semantic models, 12 artifacts, 3 runtimes, 12
backend paths, and 20 profiles. The current Unified selection resolves to
`parakeet-unified-en-0.6b` / `parakeet-unified-en-0.6b-q8-gguf` /
`transcribe-cpp` / `live` / `none`. Non-Live profiles use a null queue limit;
Live uses a bounded 30,000 ms queue.

**Migration and runtime-path evidence.** Each legacy setting was loaded from
v1 storage, atomically migrated to v2 with origin `migrated_explicit`, run
through its declared port, then saved as the same explicit v2 tuple and run
again. These are cold-start wall times for a 100 ms silent PCM input, not WER
measurements:

| legacy setting | resolved profile | port | migrated / explicit ms | actual backend | loaded version |
| --- | --- | --- | ---: | --- | --- |
| `whisper-tiny-en-q8` | `whisper-tiny-en-q8.eager` | BatchPort | 1,674 / 1,124 | `wasm-cpu` | `transformers.js-3.8.1` |
| `parakeet-unified-en-0.6b-q8` | `parakeet-unified-en-0.6b-q8-gguf.live` | StreamPort | 1,440 / 1,211 | `cpu` | `0.1.3` |
| `parakeet-tdt-0.6b-v3-int8` | `parakeet-tdt-0.6b-v3-int8.stop` | BatchPort | 4,397 / 2,988 | `cpu` | `parakeet-1.25.1` |

The absent-artifact case saved the valid Unified tuple and returned this
specific capture error: `voice_model_not_installed`, HTTP `409`, `Install
Parakeet Unified English Q8 from Voice settings first`. Invalid catalogue
fixtures failed with the expected codes for duplicate IDs, missing references,
model/artifact mismatch, artifact/runtime mismatch, fallback cycles, missing
ports, invalid segmentation, and unbounded Live queues.

The redacted settings response was:

```json
{"status":200,"voiceConfigVersion":2,"mode":"off","localSelectionOrigin":"default","localSelection":{"modelId":"whisper-tiny-en","artifactId":"whisper-tiny-en-q8","runtimeId":"transformers-js","execution":"eager","segmentation":"silero"},"resolvedProfileId":"whisper-tiny-en-q8.eager","catalogue":{"version":"1","models":7,"artifacts":12,"runtimes":3,"backendPaths":12,"profiles":20}}
```

An actual diagnostic sidecar contained the frozen fields:

```json
{"transcriptionStatus":"completed","mode":"local","adapter":"managed_transformers_v1","modelId":"whisper-tiny-en","artifactId":"whisper-tiny-en-q8","runtimeId":"transformers-js","backendPathId":"whisper-tiny-en-q8.transformers-js","resolvedProfileId":"whisper-tiny-en-q8.eager","execution":"eager","segmentation":"silero","requestedComputeBackend":"wasm-cpu","actualComputeBackend":"wasm-cpu","loadedRuntimeVersion":"transformers.js-3.8.1"}
```

The managed production data migrated from the previous v1 selection to
`voiceConfigVersion: 2`, preserved the Unified selection as
`migrated_explicit`, and retained the existing credential without exposing
its value. After the required restart, `GET /healthz` returned
`{"ok":true,"status":"ready","release":"development"}`.

**WP8 checks.** The focused catalogue, adapter, settings, manager, API, and
runtime checks passed 32/32. `node --test test/voice-stream-api.test.js`
passed 30/30. `npm test` passed 503/503. `npm run typecheck`, `npm run build`,
and `git diff --check` passed. The production build transformed 2,200 modules
and reported 184,415 B initial JavaScript gzip, 24,994 B initial CSS gzip,
and 185,186 B largest lazy JavaScript gzip. The existing Vite warning about
chunks over 500 kB remains.

The user dictation run remains the accuracy reference: sustained pace now
keeps up, but the user reports poor WER. WSL CPU overhead, native Windows or
Vulkan comparison, and accuracy tuning remain open. WP9 scheduling and
transcript-truth work has not started.

**Status:** WP8 is ready for user testing and explicit handoff approval.

### Work package 9 — make Conduit own scheduling and transcript truth

**Behavioural change:** After Stop, During pauses, and Live use one session
engine. All modes preserve the complete accepted PCM and produce one ordered
transcript. Safe fallback starts only at a proven sample checkpoint.

#### Schedulers

- **Stop:** retain all PCM. At Stop, pass one immutable whole-session buffer
  to BatchPort. Map a non-empty result to one stable segment with
  `sequence: 0`, `fromSample: 0`, and
  `throughSample: acceptedThroughSample`, then derive session final. An empty
  result emits the existing empty-transcription error and no stable segment.
- **Eager:** pass each completed segmentation range to BatchPort with absolute
  sample positions and increasing sequence. Stop flushes the open tail. The
  port does not know which provider closed a range.
- **Live:** feed every accepted sample once and in order to StreamPort. Stop
  drains queued PCM and finalizes the same stream. Live uses
  `segmentation: "none"` for scheduling.

#### Shared segmentation

Move Silero readiness into one Conduit-owned shared component. ASR install or
uninstall cannot install, remove, or reset Silero. Give each Eager session its
own state while sharing the immutable model instance where supported.

Expose `silero` and `heuristic` through one `SegmentationProvider` contract.
The heuristic operates on an analysis copy. It cannot change inference or
archive PCM. Use frame RMS in dBFS, a noise floor updated only outside speech,
separate entry and exit margins, onset confirmation, 200–300 ms pre-roll,
600–1,000 ms exit and trailing policy, hangover, and a maximum open range.
Never use exact zero as speech evidence.

As part of this package, create a small versioned segmentation calibration
manifest from fixed quiet, boomy, fan, keyboard, short-word, and pause
recordings. Use it to select exact heuristic margins and retain it for later
regressions. This is implementation input, not a separate evaluation package.
Do not copy thresholds from the removed `splitSilence` path.

Never discard a short detected range only because of duration. Submit it or
merge uncertain activity into an adjacent range. Apply range-count and
session guards to both providers. On exhaustion, merge the remaining timeline
into a bounded tail or use declared fallback. Never omit the tail.

#### Transcript events and watermarks

Normalize runtime output to:

```ts
type TentativeRegionEvent = {
  type: "tentative_region";
  sessionId: string;
  regionId: string;
  revision: number;
  text: string;
  fromSample: number;
  throughSample: number;
};

type StableSegmentEvent = {
  type: "stable_segment";
  sessionId: string;
  segmentId: string;
  sequence: number;
  text: string;
  fromSample: number;
  throughSample: number;
};

type SessionFinalEvent = {
  type: "session_final";
  sessionId: string;
  text: string;
  committedThroughSample: number;
};
```

A tentative region accepts only a higher revision for the same region. A
stable segment is append-only and idempotent by segment ID. Stable sequence
and sample coverage increase. A reused ID with different content is an error.
When stable output covers tentative output, remove the covered tentative text.
A runtime final cannot replace the transcript with an unrelated string.

Keep the accepted partial/final WebSocket wire and composer behaviour. Add
optional IDs, revisions, sequence, and sample positions only where the client
needs idempotence. The server derives the session final and inserts it once.

Track:

- `acceptedThroughSample`: Conduit retained the PCM;
- `submittedThroughSample`: Conduit handed PCM to the runtime;
- `processedThroughSample`: optional exact runtime report;
- `committedThroughSample`: stable text represents the PCM;
- `archiveOwnedThroughSample`: the archive queue owns the immutable PCM.

All watermarks increase and cannot exceed accepted PCM. Do not use one
“consumed” watermark for submission and native processing.

#### Fallback

Before output, a failed path can replay from zero. After tentative output, it
can discard that tentative region and replay from zero. After stable output,
fallback is valid only when the stable event has an exact
`throughSample`. Start from that checkpoint, with bounded acoustic overlap if
needed. Never change stable text. If no exact checkpoint exists, fail visibly
and preserve the archive. Never run primary and fallback over the same PCM at
the same time.

Record source and fallback profiles, trigger, replay sample, discarded
tentative revisions, stable checkpoint, overlap, duplicate-boundary handling,
and completing profile.

#### Regression evidence

For text comparisons, lowercase and collapse whitespace. Ignore punctuation
except in named punctuation cases. Report per-utterance and aggregate WER.
For a changed audio or segmentation path, aggregate WER can be no more than
one absolute percentage point worse than the common `af4f55e` corpus unless
the user accepts a stated trade-off. Missing post-silence speech, missing tail
speech, stable-text regression, duplicate stable text, or unowned PCM is
always a failure, regardless of aggregate WER.

Run quiet and boomy speech, short boundary words, silence-only input,
ten-second and 30-second pauses, more than 16 ranges, immediate Stop, repeated
event IDs, cancellation, and failures before tentative, after tentative, and
after a stable checkpoint. Confirm final text, sample ownership, original WAV
bytes, and one terminal result.

**Expected scope:** `src/server/dictation-stream.js`,
`src/server/voice-segmentation.js`, `src/server/voice-vad.js`,
`src/server/voice-runtime-adapters.js`, catalogue profiles, WebSocket schema,
sidecars, focused coverage, a small calibration manifest, and README
diagnostics.

**Handoff:** run focused checks and the production build. Restart, confirm
`/healthz`, report the pause and fallback cases, then wait for user approval.

### Work package 10 — add `transcribe-rs` as an ONNX backend

**Behavioural change:** supported Parakeet ONNX artifacts can run through a
managed `transcribe-rs` backend. The initial profile provides **During pauses**
and **After Stop**. Add **Live** only if the integrated version supplies the
full StreamPort contract.

Handy currently separates the runtimes. Unified English GGUF streams through
`transcribe.cpp`. Its ONNX Parakeet path uses `transcribe-rs` batch inference.
The current reference `transcribe-rs` Parakeet implementation reports
`supports_streaming: false`. This is a fact about that implementation, not
about all Parakeet models.

Before pinning, verify the current Handy manifest, manager, catalogue, and
`transcribe-rs` Parakeet source. Record the exact crate version, licence,
registry checksum, Rust toolchain, ONNX Runtime linkage, target architecture,
artifact revision, file sizes, SHA-256 values, and licence. Dependency and
lockfile changes require the package's explicit start instruction.

Run a long-lived unprivileged Rust worker over private child-process pipes.
Use a versioned length-prefixed protocol. Each frame starts with two
little-endian `uint32` values: JSON-header bytes and binary-payload bytes.
Reject oversized declarations before allocation. Standard output carries
frames only; standard error carries bounded logs.

Implement `hello`, `load`, `transcribe_range`, `cancel`, `unload`, `health`,
and `shutdown`. Each response echoes request and session IDs. `hello` reports
worker and crate versions, compiled ORT providers, adapters, ports, sample
format, and request limits. `load` reports requested and actual providers.
`transcribe_range` accepts 16 kHz mono PCM and absolute range metadata,
converts to the crate input once inside the worker, and returns text plus only
verified timestamps.

Run one inference operation at a time until the pinned runtime proves safe
parallelism within the resource limit. Cancellation makes late output
non-authoritative even when ORT cannot interrupt its current call. A crash
fails the active operation and leaves accepted PCM eligible for the WP9
fallback.

Register stable runtime ID `transcribe-rs`, its loaded version, ONNX artifact,
backend path, dynamic status, Stop profile, and verified Eager profiles. Do
not change the saved default.

Do not publish Live because repeated range calls are not streaming. A later
version must expose persistent open, ordered feed with processing or buffer
receipts, revisionable and stable text, finalization, reset, and cancellation.
If it does, add stream worker commands, implement StreamPort, pass WP7 and WP9
contracts, and add a separate Live profile without removing batch profiles.

**Completion evidence:** install and run without root; reject wrong protocol
versions, oversized frames, unknown sessions, and duplicate request IDs; keep
capture responsive during load and inference; preserve speech across
ten-second and 30-second pauses; recover from crash and cancellation; report
compiled, requested, and actual ORT providers separately; and keep existing
runtimes selectable.

**Expected scope:** a reviewed Rust package under `conduit-web/native/`,
native packaging, manifests, catalogue, model manager, runtime adapter,
focused native and server coverage, authorized lockfiles, and operations
documentation.

**Handoff:** run During pauses and After Stop, force crash and cancellation,
and confirm Unified English still streams through `transcribe.cpp`. Run native
checks, focused server checks, and the production build. Restart, confirm
`/healthz`, then wait for user approval.

### Work package 11 — replace the Voice settings experience

**Behavioural change:** the Voice page presents one clear path from input to
source, model, artifact, backend, and timing. It shows enough machine identity
to explain what runs without exposing scheduler internals.

Use one column:

1. **Input:** microphone, signal test, shortcut, and activation.
2. **Transcription source:** Off, This machine, or Cloud.
3. The selected source's guided choices.
4. Closed **Advanced:** capture profile, auto-send, warm microphone, and pause
   detection when relevant.
5. One Save action and one dirty state for all voice drafts.

#### This machine

Show one row per semantic model family. Do not list one model again for each
artifact, runtime, or behaviour. Expand only the selected family.

Within the row, show in order:

1. **Precision / artifact:** precision, format, approximate size, language,
   licence, and install state.
2. **Runs with:** compatible runtime rows for that exact artifact. Show
   runtime label, artifact format, compiled compute backends, and install
   state. After load, show a quiet line with loaded runtime version and actual
   compute backend.
3. **When to transcribe:** only profiles for the exact backend path:
   - **Live:** “Text appears while you speak and may revise.”
   - **During pauses:** “Each pause commits a phrase.”
   - **After Stop:** “Nothing appears until you stop.”

Every BatchPort row shows After Stop. Show During pauses only for an Eager
profile. Show Live only for StreamPort. A precision change lists only
compatible backends. A backend change retains timing if valid; otherwise use
that row's declared recommended choice and mark the draft unsaved. This is a
UI draft choice, not a global default migration.

Keep Install, Cancel, and Uninstall inside the selected family. One artifact
install can enable more than one profile. A structurally valid absent artifact
can remain selected. State why capture is unavailable and offer Install.
Never silently replace it.

Put **Pause detection: Silero / Heuristic** in Advanced only when During
pauses is selected. Each choice selects a valid profile; the client cannot
mutate profile fields.

Do not show feed quantum, queue limits, transcript overlap, stable-prefix
count, or native latency profiles in the normal form. Do not infer capability
from `model.engine` or `voiceModelPresentation()`. Render catalogue and status
facts. Distinguish compiled, requested, and actual compute.

#### Cloud

Cloud uses the same interaction grammar but its existing persistence:
provider, model, adapter, endpoint, and credential.

Choose Provider, then its model, then one backend row with transport and
credential state, then When to transcribe. Existing HTTPS upload cells show
After Stop. The existing OpenAI Realtime cell shows Live. Do not offer During
pauses to a remote upload or Live to a path without the verified stream
adapter. Keep Custom endpoint as an advanced Cloud backend.

Cloud models do not appear under local families. Local artifacts do not show
Cloud credentials. Do not write Cloud choices into `localSelection`.

Put credential entry, Test, and Remove beside the selected provider. One
provider credential can enable its models. Polling install, runtime, or test
status must not erase an unsaved draft.

#### General UI rules

Remove both current duplicate model presentations and replace them with this
single flow. Correct privacy copy: microphone-test playback remains in the
browser; server dictation can retain configured diagnostic WAV/JSON pairs.
Maintain visible focus, readable selected-state contrast, full labels, and
existing minimum target sizes.

On mobile and installed PWA, keep all content within the viewport. Do not add
horizontal scrolling. Keep the Save action reachable without rendering every
model as an expanded card.

Any user Save sets `localSelectionOrigin: "explicit"` for local mode. A
missing saved profile remains visible with Install, Retry, or Choose another.
The profile ID in the final sidecar must match the choice shown in settings.

The user can choose the fresh-install default during this package. Apply that
choice only to new settings and records with
`localSelectionOrigin: "default"`. Preserve `explicit` and
`migrated_explicit` choices. Do not block the package on a comparison
committee, and do not silently install a large artifact.

**Completion evidence:** inspect desktop and installed-PWA mobile; change
source, family, artifact, backend, timing, pause detection, input, and
credential; Save and reload; test one absent artifact and one failed runtime;
confirm one model list, truthful state, no invalid tuple, no horizontal
overflow, and no serious contrast failure. Dictate once through each
available timing mode and compare the saved choice with its sidecar.

**Expected scope:** `src/client/settings/settings.tsx`,
`src/client/styles.css`, voice API types, settings defaults if the user chooses
one, focused settings coverage, and README settings and privacy text.

**Handoff:** run focused checks and the production build. Restart, confirm
`/healthz`, present the page on desktop and installed-PWA mobile, then wait for
user approval.

### Work package 12 — decouple archive settlement

**Behavioural change:** successful transcript completion no longer waits for
diagnostic WAV/JSON writes.

After inference and transcript finalization, freeze PCM and sidecar metadata
and transfer them to a bounded server archive queue. Set
`archiveOwnedThroughSample` only after the queue owns the immutable buffer.
Emit session final without waiting for disk.

Keep atomic pair writes, current retention count, byte limits, permissions,
and rotation. Record queue delay, write duration, path, rotation, and failure
separately. Archive failure cannot change transcript text or repeat auto-send.
Drain accepted work during orderly shutdown with a bounded deadline. Never
expose an incomplete WAV/JSON pair as valid.

**Completion evidence:** run normal dictation, a delayed write, a failed
write, and shutdown with queued work. Confirm prompt composer insertion,
immutable PCM ownership, matching healthy pairs, non-fatal visible failure,
and bounded shutdown.

**Expected scope:** `src/server/voice-recording-store.js`,
`src/server/dictation-stream.js`, shutdown wiring, focused archive coverage,
and retention documentation.

**Handoff:** run focused checks and the production build. Restart, confirm
`/healthz`, report transcript settlement separately from archive settlement,
then wait for user approval.

## 6. Execution order and handoff contract

Run the remaining packages in this order:

1. WP8 — canonical local execution contract.
2. WP9 — Conduit-owned scheduling and transcript truth.
3. WP10 — `transcribe-rs` ONNX backend.
4. WP11 — final Voice settings experience.
5. WP12 — asynchronous archive settlement.

Each package must leave the product functional. Do not start the next package
until the user approves the current handoff.

At the end of each package:

1. Review the package diff and preserve unrelated work.
2. Run focused checks for the changed contract, typecheck, and production
   build. Report skipped checks.
3. Run the package's manual scenarios and retain their diagnostics.
4. Restart through `.devcontainer/start-conduit.sh restart`.
5. Confirm `GET /healthz` reports ready.
6. Report changed behaviour, files, exact results, measured values, and risk.
7. Notify the user for testing and wait for approval.

Do not change a test harness to hide behaviour. A package can add focused
coverage beside the changed module.

## 7. File ownership

- `src/client/chat/voice-dictation-client.ts`: capture lifecycle, bounded
  pre-ready PCM, packets, backpressure, and client diagnostics.
- `public/voice-capture-worklet.js`: resampling, packet assembly, levels, and
  final drain.
- `src/server/dictation-stream.js`: session state, accepted PCM, schedulers,
  watermarks, transcript truth, fallback, Stop, and diagnostics.
- `src/server/voice-vad.js`: Silero model loading and probabilities.
- `src/server/voice-segmentation.js`: session segmentation state, heuristic,
  range events, guards, and flush.
- `src/server/voice-execution-catalog.js`: models, artifacts, runtimes,
  backend paths, profiles, migration, fallback graph, and validation.
- `src/server/voice-runtime-adapters.js`: BatchPort and StreamPort
  implementations.
- `src/server/voice-runtime.js`: frozen profile resolution, leases, health,
  compute reporting, and cancellation.
- `src/server/voice-model-manager.js`: artifacts, runtime and worker state,
  activation, and preload.
- `src/server/voice-model-manifests.js`: immutable sources, checksums, limits,
  and licences.
- `src/server/voice-recording-store.js`: archive queue, atomic pairs,
  retention, and shutdown drain.
- `src/voice-settings.js`: versioned local tuple, selection origin, Cloud
  fields, migration, and validation.
- `src/server/routes/voice.js`: catalogue, status, settings, credentials, and
  managed artifact operations.
- `src/client/settings/settings.tsx`: guided selection, installation,
  credentials, dynamic state, dirty state, and capture controls.
- `conduit-web/native/`: reviewed `transcribe-rs` worker and build metadata
  after WP10 only.
- `conduit-web/README.md`: protocol, settings, privacy, limits, diagnostics,
  and operations.

Confirm the exact files at the start of each package. Follow existing module
patterns. Do not perform unrelated cleanup.

## 8. Acceptance matrix

Every changed path must retain:

- shortcut startup, rapid Start/Stop, saved microphone recovery, and bounded
  capture during cold runtime load;
- byte-identical client, server, and valid WAV sample counts;
- quiet, boomy, fan, keyboard, short-word, silence-only, clipping, and low
  input diagnostics;
- ten-second and 30-second pauses, more than 16 speech ranges, and trailing
  speech at Stop;
- one terminal event under socket close, cancellation, timeout, worker crash,
  runtime failure, and shutdown;
- stable text under repeated IDs, out-of-order revisions, acoustic overlap,
  and each permitted fallback point;
- static catalogue capability separate from install and runtime status;
- compiled, requested, and actual compute backend as distinct facts;
- one valid settings selection on desktop and installed-PWA mobile, with
  visible recovery and no horizontal overflow.

Use the common `af4f55e` English recordings only for paths that change audio,
segmentation, or inference. Normalize case and whitespace, report
per-utterance and aggregate WER, and apply the WP9 regression rule. Do not
create a separate evaluation milestone or compare paid providers.

## 9. Risks and decisions

- Browser capture cannot precede microphone permission and device activation.
- Audio constraints are requests. Effective track settings are evidence.
- VAD can clip speech. Keep pre-roll, trailing padding, original PCM, and
  boundary diagnostics.
- A model name, file format, packet transport, or SSE response does not prove
  streaming. Only a verified StreamPort can advertise Live.
- Compiled, requested, and actual compute backends can differ. Silent CPU
  fallback is a defect.
- The native workers add supply-chain and IPC boundaries. Pin versions,
  checksums, frame limits, logs, cancellation, and crash recovery.
- Do not remove checksums, unprivileged extraction, authentication, bounded
  queues, byte limits, or archive permissions.
- Do not redesign the composer, shortcut, microphone playback test, or
  retention count in these packages.

Starting WP10 authorizes only the dependency, lockfile, worker, packaging, and
artifact changes named in that package. Default selection is a user decision
during WP11, not a gate on building the architecture. Retain all runtimes and
profiles unless the user later gives an explicit removal instruction.
