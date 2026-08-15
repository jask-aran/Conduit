# Voice dictation WP0–WP4A technical review

Baseline comparison: commit `af4f55e`.

Implementation scope:

- WP0: capture, transport, runtime, signal, inference, and archive evidence;
- WP1: immediate capture, lifecycle states, queued PCM, resource reuse, and
  failure archives;
- WP2: removal of Conduit gain, raw and processed capture profiles, and
  resampling;
- WP3: 20 ms packets, transferred-buffer reuse, final partial-packet flush,
  and one server PCM accumulator;
- WP4A: observation-only Silero VAD, auditable probabilities and regions, and
  digital-silence diagnostics.

The current architecture has a sound central data path:

1. Browser capture starts in parallel with WebSocket and runtime preparation.
2. The client bounds PCM held before the server reports readiness.
3. The worklet emits ordered 16 kHz PCM16 packets and flushes the final partial
   packet before Stop.
4. The server appends accepted packets to one bounded accumulator.
5. The active ASR adapter consumes the accepted PCM sequence.
6. WP4A copies the complete accepted PCM at Stop and gives only that copy to
   Silero.
7. Silero does not change the PCM sent to ASR or the WAV archive.

Preserve these properties while applying the remediations below.

## Priority summary

| ID | Finding | Severity | Package area |
|---|---|---:|---|
| V01 | Quiet valid transcripts can be discarded by the browser | High | WP0/WP2 |
| V02 | Spectral diagnostics do excessive work on the audio render thread | High | WP0/WP2 |
| V03 | The raw capture profile still enables browser processing | High | WP2 |
| V04 | Archive and metadata I/O delay inference and completion | High | WP1 |
| V05 | Observation-only Silero can block completion indefinitely | High | WP4A |
| V06 | Silero boundary policy has no entry/exit hysteresis | High | WP4A |
| V07 | Padded Silero ranges can overlap | High before authoritative use | WP4A |
| V08 | The resampler is expensive and lacks a validated contract | Medium–high | WP2/WP3 |
| V09 | Server clipping diagnostics miss positive full scale | Medium | WP0 |
| V10 | Timing fields omit work and misname queue delay | Medium | WP0 |
| V11 | Optional diagnostics can prevent dictation from starting | Medium | WP0 |
| V12 | A retained microphone track can fail an already captured session | Medium | WP1 |
| V13 | Sub-second sessions consume normal archive rotation slots | Medium | WP1 |
| V14 | Silero boundary fields do not describe actual state transitions | Medium | WP4A |
| V15 | Some archived failures and disconnects receive no VAD observation | Medium | WP4A |
| V16 | Whole-recording VAD execution has no queue, timeout, or cancellation | Medium | WP4A |
| V17 | Silero installation is coupled to ASR model installations | Medium | WP4A |
| V18 | A VAD region can remain open for the full session | Medium | WP4A |
| V19 | VAD policy parsing rejects valid explicit zero values | Low | WP4A |

## V01 — Quiet valid transcripts can be discarded by the browser

### Code evidence

`conduit-web/src/client/chat/voice-audio.ts` defines fixed signal thresholds:

```ts
export const MIN_AUDIO_SIGNAL_RMS = 0.003;
export const MIN_AUDIO_SIGNAL_PEAK = 0.01;

export function hasAudioSignal(level: AudioSignalLevel) {
  return (
    level.rms >= MIN_AUDIO_SIGNAL_RMS ||
    level.peak >= MIN_AUDIO_SIGNAL_PEAK
  );
}
```

`conduit-web/src/client/chat/voice-dictation-client.ts` promotes this meter
decision into session state:

```ts
inputSignalDetected ||= hasAudioSignal(level);
```

`conduit-web/src/client/chat/composer.tsx` rejects completion when the flag
remains false:

```ts
if (!completion.inputSignalDetected) {
  setDictatedRange(null);
  setDictationSelectionOwned(false);
  if (shouldReportNoSignal(completion)) {
    setDictationError(
      `No microphone signal detected after ${
        Math.max(1, Math.round(completion.captureDurationMs / 1000))
      }s (peak ${completion.maxInputPeak.toFixed(3)}).`
    );
  } else {
    setDictationError("");
  }
  return;
}
```

Partial and final text are also routed through callbacks that use this
client-side session decision.

### Failure mechanism

RMS and peak values are useful for a level meter. They are not a reliable
speech classifier. A quiet microphone, a distant speaker, a low-output USB
interface, or a browser that successfully disables automatic gain can produce
valid speech below these fixed values.

The server or ASR model can return correct text from the accepted PCM. The
composer can still discard that text because the browser meter never crossed
the threshold. Short quiet utterances are especially confusing because the
session can return without a visible low-signal warning.

Removing Conduit's adaptive gain makes this gate more dangerous. The old
threshold was calibrated against a signal path that changed sample amplitude.
It now controls text after that amplitude-changing stage has been removed.

### Required behavior

- Browser RMS and peak values drive only the waveform, level meter, and a
  non-blocking low-level warning.
- A browser amplitude threshold must not suppress partial text, final text, or
  a non-empty completed transcript.
- Digital-zero or device-stall input must remain distinct from low-amplitude
  input.
- The server must own the speech/no-speech decision because it sees the exact
  PCM supplied to inference.

### Proposed fix shape

Always forward server transcript events:

```ts
if (message.type === "partial") {
  callbacks.onPartial?.(message.text);
}

if (message.type === "final") {
  callbacks.onFinal?.(message.text);
}
```

Retain the meter result only as diagnostic metadata:

```ts
inputLevelObserved ||= hasAudioSignal(level);
```

Use a proposed server-owned completion classification:

```ts
interface VoiceSpeechDecision {
  detector: "digital_zero" | "silero" | "unclassified";
  detected: boolean;
}
```

Apply completion in this order:

```ts
const text = completion.text.trim();

if (completion.speech.detector === "digital_zero") {
  reportDeviceStall();
  return;
}

if (!completion.speech.detected) {
  reportNoSpeech();
  return;
}

if (!text) {
  reportNoTranscript();
  return;
}

applyTranscript(text);
```

Before a server VAD result is authoritative, suppress only confirmed
digital-zero input. Do not suppress a non-empty model result because its
browser RMS was low.

### Acceptance conditions

- A quiet phrase below the old browser threshold still enters the composer
  when the server returns valid text.
- Sustained digital zero produces a device-stall message.
- Natural room silence is not called a device stall.
- The waveform and low-level warning continue to work.

## V02 — Spectral diagnostics do excessive work on the audio render thread

### Code evidence

`conduit-web/public/voice-capture-worklet.js` calculates nine individual
frequency probes with nested trigonometric loops:

```js
for (let bandIndex = 0; bandIndex < BAND_FREQUENCIES.length; bandIndex += 1) {
  for (const frequency of BAND_FREQUENCIES[bandIndex]) {
    const step = 2 * Math.PI * frequency / inputRate;
    for (let index = 0; index < input.length; index += 1) {
      const angle = step * index;
      const value = (input[index] || 0) * valueScale;
      real += value * Math.cos(angle);
      imaginary -= value * Math.sin(angle);
    }
  }
}
```

The worklet calls this calculation for each raw render quantum:

```js
const raw = this.signalStats(input, sampleRate);
```

It runs the probes again for each processed output packet:

```js
const processedBands = bandEnergy(
  this.packetBuffer.subarray(0, sampleCount),
  TARGET_SAMPLE_RATE,
  1 / 32768,
);
```

The server repeats similar frequency-probe work for every received packet in
`conduit-web/src/server/dictation-stream.js`:

```js
const bands = pcmBandEnergy(data, 16_000);
```

At a 48 kHz input rate with 128-frame render quanta:

- raw analysis runs about 375 times each second;
- raw analysis inspects 9 × 128 samples per call;
- processed analysis runs about 50 times each second over 320 samples;
- the FIR resampler adds 17 taps for each 16 kHz output sample.

This is approximately 850,000 inner-loop iterations each second before
ordinary packetization work. Many iterations call `sin()` or `cos()`.

### Measurement defect

The values are named low-, mid-, and high-band energy, but each value is the
average of only three individual frequency probes:

```js
const BAND_FREQUENCIES = [
  [100, 200, 300],
  [500, 1_000, 2_000],
  [3_500, 5_000, 7_000],
];
```

They are not integrated frequency bands.

A 128-frame raw window at 48 kHz covers about 2.67 ms. It contains only 0.267
cycles of a 100 Hz signal. That window cannot produce a stable estimate of
100 Hz energy.

The raw and processed values also use different sample rates and different
window durations. The raw calculation averages separately normalized render
quanta. Averaging those results loses phase and cross-window information. The
two values are not a reliable before/after spectral comparison.

### Required behavior

The audio worklet must perform bounded, constant-cost capture work:

- sample accumulation;
- RMS;
- peak;
- exact clipping count;
- digital-zero run detection;
- resampling;
- packetization and transfer.

Normal capture must not run discretionary spectral analysis on every render
quantum.

### Proposed fix shape

Keep cheap accumulators:

```js
function addSignalSamples(samples, stats) {
  for (let index = 0; index < samples.length; index += 1) {
    const value = samples[index];
    stats.sumSquares += value * value;
    stats.sampleCount += 1;
    stats.peak = Math.max(stats.peak, Math.abs(value));
    if (value >= 1 || value <= -1) stats.clippedSamples += 1;
  }
}
```

Calculate RMS only when a meter or packet event is emitted:

```js
const rms = stats.sampleCount
  ? Math.sqrt(stats.sumSquares / stats.sampleCount)
  : 0;
```

Move frequency analysis to one of these bounded paths:

1. Analyze the archived 16 kHz PCM after user completion.
2. Run an explicit diagnostic operation outside normal capture.
3. Use incremental filters whose coefficients are calculated once during
   initialization.

If before-resampler spectral evidence remains necessary, use equal-duration
windows and a defined filter-bank or windowed FFT. Do not compare a 2.67 ms
48 kHz probe window with a 20 ms 16 kHz probe window as equivalent bands.

### Acceptance conditions

- Normal worklet processing contains no per-sample trigonometric calls.
- RMS, peak, clipping, and digital-zero diagnostics remain available.
- Spectral values have documented frequency ranges and equal-duration input
  windows.
- Removing the probes does not change emitted PCM bytes.

## V03 — The raw capture profile still enables browser processing

### Code evidence

`conduit-web/src/client/chat/voice-audio.ts` currently changes only automatic
gain between the profiles:

```ts
return {
  channelCount: { ideal: 1 },
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: profile !== "raw",
};
```

The raw profile therefore requests:

- echo cancellation on;
- noise suppression on;
- automatic gain off.

### Failure mechanism

The implementation labels the profile raw even though the browser can still
modify the waveform before Conduit receives it. Echo cancellation and noise
suppression can remove quiet consonants, change noise after a pause, and
produce pumping or spectral coloration. Conduit's pre-resampler diagnostics
cannot see the microphone signal before those browser stages.

This also weakens WP4A evidence. Silero observes the browser-processed signal,
not minimally processed microphone PCM.

### Required behavior

The raw profile must request all optional browser speech processing off. The
processed profile must remain available for microphones and speaker-echo
conditions where it helps.

### Proposed fix shape

```ts
const processed = profile === "processed";

return {
  channelCount: { ideal: 1 },
  echoCancellation: { ideal: processed },
  noiseSuppression: { ideal: processed },
  autoGainControl: { ideal: processed },
};
```

Record the effective values from the selected track:

```ts
const settings = track.getSettings();

const effectiveProcessing = {
  echoCancellation: settings.echoCancellation,
  noiseSuppression: settings.noiseSuppression,
  autoGainControl: settings.autoGainControl,
  sampleRate: settings.sampleRate,
  channelCount: settings.channelCount,
};
```

Do not label a session as effectively raw when the returned track settings
show active processing. Preserve both requested and effective values in the
sidecar.

### Acceptance conditions

- Raw requests all three processing constraints off.
- Processed requests all three processing constraints on.
- Diagnostics show requested and effective settings separately.
- A raw versus processed comparison uses the same microphone, phrase, model,
  and physical position.
- No equalizer or bass cut is added without evidence from the corrected raw
  path.

## V04 — Archive and metadata I/O delay inference and completion

### Code evidence

`conduit-web/src/server/dictation-stream.js` writes the recording before it
stops the ASR adapter:

```js
await archiveRecording(reason);
const current = adapter || await adapterAvailable;
await current.stop();
```

Completion then waits for the archive and metadata update before sending the
completed event:

```js
await archiveRecording(reason);
const finalDiagnostics = diagnosticsPayload();
await updateSavedRecording({
  transcript,
  transcriptionStatus: "completed",
  diagnostics: finalDiagnostics,
});
send({
  type: "completed",
  text: upstream.text || finalText,
});
```

`conduit-web/src/server/voice-recording-store.js` performs:

1. WAV materialization with `Buffer.concat`;
2. temporary WAV write;
3. formatted JSON serialization;
4. temporary JSON write;
5. two renames;
6. directory rotation;
7. later metadata read, parse, rewrite, and rename.

### Failure mechanism

Filesystem latency is now on two user-critical paths:

- Stop to inference start;
- ASR completion to composer completion.

The first provisional archive also requires a later metadata rewrite because
the transcript and final diagnostics are not yet known.

### Required behavior

- Freeze the accepted PCM once when capture ends.
- Start ASR finalization without waiting for disk.
- Send the completed event when the transcript is final.
- Settle the final WAV and sidecar asynchronously.
- Bound pending archive count and retained PCM bytes.
- Keep archive failure non-fatal to dictation.

### Proposed fix shape

Create one exact-length immutable snapshot:

```js
let finalPcm = null;

function freezeAcceptedPcm() {
  finalPcm ??= Buffer.from(pcmAccumulator.view());
  return finalPcm;
}
```

Use the same snapshot for batch inference, VAD observation, and the final
archive:

```js
const pcm = freezeAcceptedPcm();
const result = await adapter.stop(pcm);

sendCompleted(result);

void archiveQueue.enqueue({
  pcm,
  transcript: result.text,
  diagnostics: diagnosticsPayload(),
}).catch(reportArchiveFailure);
```

The queue must enforce:

```js
{
  maxPendingRecords,
  maxPendingBytes,
}
```

When full, it must report an archive-capacity failure without delaying the
completed transcript.

Write one final metadata record instead of a provisional pending result plus a
second critical-path rewrite. If crash-time durability before transcription
is required, implement a separate spool with an explicit durability contract.
Do not obtain accidental durability by blocking inference on the final
diagnostic store.

### Acceptance conditions

- Artificially slow recording storage does not delay inference start.
- Artificially slow metadata storage does not delay the completed event.
- The archived WAV still contains the exact accepted PCM.
- Archive errors do not fail a valid transcript.
- Pending archive memory remains bounded.

## V05 — Observation-only Silero can block completion indefinitely

### Code evidence

WP4A starts a whole-recording observation at Stop:

```js
startVadObservation();
```

When ASR finishes, `complete()` marks the session final and clears the
finalization timers:

```js
completed = true;
diagnostics.sessionFinalAt = performance.now();
cleanup();
```

It then waits for Silero before sending completion:

```js
await vadObservationPromise;
await archiveRecording(reason);
await updateSavedRecording(...);
send({ type: "completed", ... });
```

### Failure mechanism

Silero is observation-only, but it changes user-visible latency. If an ONNX
`session.run()` call does not settle, completion has no remaining timeout
because `cleanup()` already cleared it.

The timing fields hide the added wait:

```js
const completedAt = Date.now();
diagnostics.sessionFinalAt = performance.now();
```

Both timestamps are captured before awaiting Silero. The completed event is
sent later, but the reported settlement interval ends earlier.

### Required behavior

Observation-only work cannot:

- delay completion;
- change transcript text;
- change submitted PCM;
- fail the session;
- consume the ASR finalization deadline.

### Proposed fix shape

Send the completed event first:

```js
const complete = (reason, upstream = {}) => {
  if (completed) return;
  completed = true;
  cleanup();

  const completionSentAt = performance.now();
  send({
    type: "completed",
    text: upstream.text || finalText,
    reason,
    audioBytes,
    ...runtimeMetadata,
  });
  diagnostics.completionSentAt = completionSentAt;

  void settleObservationAndArchive({
    vadObservationPromise,
    transcript: upstream.text || finalText,
  }).catch(reportDiagnosticSettlementFailure);
};
```

Use the asynchronous archive settlement to persist the VAD result. A handoff
or diagnostic tool can wait until sidecar settlement without making the user
wait.

### Acceptance conditions

- A delayed VAD promise does not change Stop-to-completion time.
- A rejected VAD promise produces an unavailable sidecar observation.
- A never-settling VAD promise cannot leave the browser session in
  Transcribing.
- Diagnostics record the actual completion-send time.

## V06 — Silero boundary policy has no entry/exit hysteresis

### Code evidence

`conduit-web/src/server/voice-vad.js` uses one threshold for all states:

```js
const speech = frames[index].probability >= policy.threshold;

if (speech) {
  if (startFrame < 0) startFrame = index;
  lastSpeechFrame = index;
  silentFrameCount = 0;
  continue;
}
```

The policy contains one threshold:

```js
threshold: 0.5,
```

### Failure mechanism

A single threshold makes entry and exit symmetric. After speech has started,
a probability of `0.49` immediately counts as silence. Repeated values near
`0.5` can alternate between active and silent classifications.

The 320 ms hangover prevents an immediate close, but it does not correct the
classification. Ten consecutive quiet speech frames between a suitable exit
threshold and `0.5` can close the region even when the detector should remain
active.

### Required behavior

Use:

- a higher speech-entry threshold;
- a lower speech-exit threshold;
- a minimum below-exit-threshold duration before closure.

### Proposed fix shape

```js
export const SILERO_VAD_POLICY = Object.freeze({
  sampleRate: 16_000,
  frameSamples: 512,
  contextSamples: 64,
  entryThreshold: 0.5,
  exitThreshold: 0.35,
  minSilenceMs: 320,
  preRollMs: 240,
  trailingPaddingMs: 240,
});
```

```js
if (!active) {
  if (probability >= policy.entryThreshold) {
    active = true;
    onsetFrame = index;
    lastActiveFrame = index;
  }
  continue;
}

if (probability >= policy.exitThreshold) {
  lastActiveFrame = index;
  silenceStartFrame = null;
  continue;
}

silenceStartFrame ??= index;

if (index - silenceStartFrame + 1 >= minSilenceFrames) {
  closeRegion({
    exitDecisionFrame: index,
    closureReason: "silence",
  });
}
```

Keep the entry and exit thresholds in every sidecar. Do not infer the exit
threshold later from an undocumented constant.

### Acceptance conditions

- Probabilities between the exit and entry thresholds do not close an active
  region.
- The same probabilities do not open an inactive region.
- Quiet word endings remain inside the speech core.
- Long genuine silence still closes the region.

## V07 — Padded Silero ranges can overlap

### Code evidence

The policy combines:

```js
preRollMs: 240,
hangoverMs: 320,
trailingPaddingMs: 240,
```

Each region is padded independently:

```js
const startSample = Math.max(
  0,
  speechStartSample -
    Math.round(policy.preRollMs * policy.sampleRate / 1_000),
);

const endSample = Math.min(
  sampleCount,
  speechEndSample +
    Math.round(policy.trailingPaddingMs * policy.sampleRate / 1_000),
);
```

### Failure mechanism

A 320 ms pause can close the first region and permit a second region. The
first region extends 240 ms forward. The second extends 240 ms backward. The
resulting proposed ranges overlap by up to 160 ms.

Observation-only sidecars can record overlap safely. Independent
transcriptions of those ranges can decode the same acoustic content twice and
produce duplicate words.

### Required behavior

Record speech core, diagnostic padding, and final submitted range as separate
concepts. Final independent submission ranges must not overlap unless a
defined reconciliation algorithm owns that overlap.

### Proposed fix shape

Initial region:

```js
{
  coreStartSample,
  coreEndSample,
  paddedStartSample,
  paddedEndSample,
  submittedStartSample: paddedStartSample,
  submittedEndSample: paddedEndSample,
}
```

Normalize adjacent submission ranges:

```js
for (let index = 0; index + 1 < regions.length; index += 1) {
  const current = regions[index];
  const next = regions[index + 1];

  if (current.submittedEndSample <= next.submittedStartSample) continue;

  const boundary = Math.round(
    (current.coreEndSample + next.coreStartSample) / 2,
  );

  current.submittedEndSample = Math.max(
    current.coreEndSample,
    boundary,
  );

  next.submittedStartSample = Math.min(
    next.coreStartSample,
    boundary,
  );
}
```

If an inference adapter needs overlapping acoustic context, record a separate
context range and specify how its text is excluded or reconciled.

### Acceptance conditions

- Every core speech sample remains inside its submitted region.
- Independent submitted regions do not overlap.
- Sidecars retain the original padded proposal for audit.
- Closely spaced words do not duplicate in assembled text.

## V08 — The resampler is expensive and lacks a validated contract

### Code evidence

The worklet calculates a 17-tap windowed-sinc kernel for every output sample:

```js
for (
  let offset = -RESAMPLER_RADIUS;
  offset <= RESAMPLER_RADIUS;
  offset += 1
) {
  const distance = this.position - index;
  const normalized = 2 * this.cutoff * distance;
  const sinc = Math.abs(normalized) < 1e-8
    ? 1
    : Math.sin(Math.PI * normalized) / (Math.PI * normalized);
  const window =
    0.5 +
    0.5 * Math.cos(
      Math.PI * distance / (RESAMPLER_RADIUS + 1)
    );
  const weight = 2 * this.cutoff * sinc * window;
}
```

Each render quantum also allocates and copies:

```js
const combined = new Float32Array(
  this.source.length + input.length
);
combined.set(this.source);
combined.set(input, this.source.length);
```

The retained tail is another allocation:

```js
this.source = combined.slice(consumed);
```

`conduit-web/src/client/chat/voice-dictation-client.ts` also contains a separate
`Pcm16Resampler` implementation that has no current call site. This creates
two resampler definitions with one active owner.

### Failure mechanism

The filter is a significant part of the real-time worklet cost. Coefficients
depend only on sample-rate ratio and fractional phase, but the current code
recalculates them for every sample.

There is no recorded frequency-response contract. A better algorithm than the
old box average is not sufficient evidence that:

- pass-band speech remains stable;
- frequencies above 8 kHz are rejected before downsampling;
- 44.1 kHz and 48 kHz inputs produce correct long-run sample counts;
- output is independent of render-quantum boundaries;
- the final flush preserves the expected tail;
- long silence does not cause a discontinuity.

### Required behavior

- One active resampler implementation.
- A direct identity path for verified 16 kHz input.
- Coefficients calculated once, not per output sample.
- Fixed bounded history without per-quantum combined-array allocation.
- Defined pass-band, stop-band, latency, and output-length behavior.

### Proposed fix shape

Build a phase table during initialization:

```js
const PHASE_COUNT = 256;
const TAP_COUNT = 32;

this.phaseKernels = buildPhaseKernels({
  inputRate: sampleRate,
  outputRate: TARGET_SAMPLE_RATE,
  phaseCount: PHASE_COUNT,
  tapCount: TAP_COUNT,
});
```

Select a precomputed kernel:

```js
const fraction =
  sourcePosition - Math.floor(sourcePosition);
const phase = Math.min(
  PHASE_COUNT - 1,
  Math.round(fraction * (PHASE_COUNT - 1)),
);
const kernel = this.phaseKernels[phase];

let output = 0;
for (let tap = 0; tap < TAP_COUNT; tap += 1) {
  output += history[historyStart + tap] * kernel[tap];
}
```

Use a fixed history or ring buffer. Remove the unused client resampler after
confirming that no dynamic reference exists.

### Validation contract

Validate:

- 16 kHz identity;
- 44.1 kHz to 16 kHz;
- 48 kHz to 16 kHz;
- DC input;
- impulse response;
- 100 Hz, 1 kHz, and 7 kHz pass-band tones;
- signals above 8 kHz for alias rejection;
- equivalent output under different input chunk boundaries;
- exact long-run output length;
- final partial-frame flush;
- silence followed by speech.

The validation can be a focused numerical check. It does not require provider
comparison or a general browser harness rewrite.

## V09 — Server clipping diagnostics miss positive full scale

### Code evidence

`conduit-web/src/server/dictation-stream.js` normalizes first and tests the
float:

```js
const value = data.readInt16LE(offset) / 32768;

if (Math.abs(value) >= 1) {
  accumulator.clippedSamples += 1;
}
```

PCM16 has the integer range `-32768` to `32767`.

- `-32768 / 32768` equals `-1`.
- `32767 / 32768` is about `0.999969`.

The code counts negative full scale but not positive full scale.

### Required fix

Test the integer:

```js
const sample = data.readInt16LE(offset);
const value = sample / 32768;

accumulator.sumSquares += value * value;
accumulator.sampleCount += 1;
accumulator.peak = Math.max(
  accumulator.peak,
  Math.abs(value),
);

if (sample === -32768 || sample === 32767) {
  accumulator.clippedSamples += 1;
}
```

If near-rail samples need a separate diagnostic, give it a separate name and
threshold. Do not call near clipping exact clipping.

### Acceptance conditions

- Positive and negative full-scale samples increment exact clipping.
- `32766` and `-32767` do not increment exact clipping.
- Peak and RMS retain the current PCM normalization.

## V10 — Timing fields omit work and misname queue delay

### Code evidence

Current server events include:

```js
{
  startedAt,
  runtimeReadyAt,
  stopAt,
  firstPartialAt,
  firstSegmentFinalAt,
  firstUsableTextAt,
  sessionFinalAt,
  archiveStartedAt,
  inferenceStartedAt,
}
```

They do not include:

- inference accepted or queued;
- inference completed;
- completion sent;
- archive completed as an event;
- VAD queued, started, or completed.

The serializer calculates:

```js
queueDelayMs: elapsed(
  diagnostics.stopAt,
  diagnostics.inferenceStartedAt,
),
```

This interval can include:

- archive writing;
- waiting for runtime preparation;
- waiting for an adapter;
- actual queueing.

It is not a queue-only delay.

`sessionFinalAt` is set before WP4A VAD and archive settlement, while the
completed event is sent after both. The recorded settlement does not represent
user-observed settlement.

### Required event model

```js
const timing = {
  sessionStartedMs: undefined,
  firstServerPcmMs: undefined,
  runtimeReadyMs: undefined,
  stopAcceptedMs: undefined,
  inferenceQueuedMs: undefined,
  inferenceStartedMs: undefined,
  firstUsableTextMs: undefined,
  inferenceCompletedMs: undefined,
  completionSentMs: undefined,
  vadQueuedMs: undefined,
  vadStartedMs: undefined,
  vadCompletedMs: undefined,
  archiveStartedMs: undefined,
  archiveCompletedMs: undefined,
};
```

Derived values:

```js
const durations = {
  runtimeWaitAfterStopMs:
    timing.runtimeReadyMs - timing.stopAcceptedMs,

  queueDelayMs:
    timing.inferenceStartedMs - timing.inferenceQueuedMs,

  firstTextInferenceMs:
    timing.firstUsableTextMs - timing.inferenceStartedMs,

  inferenceTotalMs:
    timing.inferenceCompletedMs - timing.inferenceStartedMs,

  userSettlementMs:
    timing.completionSentMs - timing.stopAcceptedMs,

  vadQueueMs:
    timing.vadStartedMs - timing.vadQueuedMs,

  vadExecutionMs:
    timing.vadCompletedMs - timing.vadStartedMs,

  archiveExecutionMs:
    timing.archiveCompletedMs - timing.archiveStartedMs,
};
```

Use one monotonic server clock for duration calculations. Use wall-clock time
only for record names and human timestamps.

If a real inference-queue timestamp is not available, rename the current field
to `stopToInferenceStartMs`. Do not label it queue delay.

### Acceptance conditions

- User settlement ends when the completed event is sent.
- Inference duration ends when inference finishes.
- Archive and VAD work appear separately.
- Queue delay contains only time after work enters a queue.
- Missing endpoints produce `null`, not a misleading zero.

## V11 — Optional diagnostics can prevent dictation from starting

### Code evidence

`conduit-web/src/client/chat/voice-dictation-client.ts` loads diagnostics
through a dynamic import:

```ts
const diagnosticsModulePromise =
  import("./voice-dictation-diagnostics");
```

Capture start later depends on obtaining the diagnostic factory. A failed
lazy-chunk request can therefore enter the core dictation failure path.

### Failure mechanism

Diagnostics improve evidence but are not required to:

- obtain the microphone;
- packetize audio;
- send PCM;
- receive a transcript.

A stale PWA chunk, transient asset failure, or bundle mismatch must not make
dictation unavailable.

### Required behavior

Diagnostics fail open. Capture continues with a no-op diagnostic sink.

### Proposed fix shape

```ts
function createNoopVoiceDiagnostics(): VoiceDiagnostics {
  return {
    onCaptureStart() {},
    onAudioPacket() {},
    onLevel() {},
    onStop() {},
    complete() {
      return undefined;
    },
  };
}
```

```ts
let diagnostics = createNoopVoiceDiagnostics();

try {
  const module = await diagnosticsModulePromise;
  diagnostics = module.createVoiceDiagnostics(acceptedAt);
} catch (error) {
  reportNonFatalDiagnosticsFailure(error);
}
```

A static import is also valid if its bundle cost is acceptable. The required
property is that telemetry availability cannot control capture availability.

### Acceptance conditions

- Failure to load the diagnostic module does not prevent recording.
- The failure appears in a non-fatal log or metric.
- Successful diagnostic loading retains current sidecar data.

## V12 — A retained microphone track can fail an already captured session

### Code evidence

`conduit-web/src/client/chat/voice-dictation-client.ts` retains healthy capture
resources when warm-microphone retention is enabled. The microphone track also
has an `ended` handler that can call the session failure path while state is
finishing, waiting, or transcribing.

### Failure mechanism

After final PCM flush, the server owns all audio needed for transcription. A
retained microphone track can later end because of:

- device removal;
- permission revocation;
- operating-system device change;
- browser source failure.

At that point, the track is only a warm resource for the next session. Its
failure must not invalidate the transcript already in progress.

One state machine currently represents two different lifecycles:

- active session dependence on live audio;
- reusable microphone-resource health.

### Required behavior

Track those lifecycles separately.

### Proposed fix shape

```ts
let captureAcceptingAudio = false;
```

Set it only after the graph is connected:

```ts
captureAcceptingAudio = true;
```

Clear it before final flush and resource retention:

```ts
captureAcceptingAudio = false;
await flushPendingAudio();
```

Handle track end by ownership:

```ts
const handleTrackEnded = () => {
  if (streamTrack !== track) return;

  if (captureAcceptingAudio) {
    failCapture(
      "The microphone stopped while recording."
    );
    return;
  }

  releaseRetainedStream();
  updateMicrophoneIndicator();
};
```

### Acceptance conditions

- Track loss during active capture fails clearly.
- Track loss after final flush releases only the warm resource.
- A transcript already running on the server still completes.
- The next session requests a new healthy track.

## V13 — Sub-second sessions consume normal archive rotation slots

### Code evidence

`conduit-web/src/server/voice-recording-store.js` defines a normal one-second
minimum:

```js
export const MIN_VOICE_DIAGNOSTIC_AUDIO_BYTES =
  16_000 * 2;
```

The stream bypasses it:

```js
allowEmptyTranscript: true,
allowShortAudio: true,
```

The store retains only 20 records by default.

### Failure mechanism

Accidental taps, immediate cancellations, and very short failed sessions can
evict useful full recordings. The current boolean does not distinguish:

- useful short failure evidence;
- empty accidental sessions;
- successful short dictations;
- device-stall captures.

### Required behavior

Define retention from terminal outcome and diagnostic value.

### Proposed fix shape

```js
const retainShortAudio =
  outcome === "failed" &&
  acceptedAudioBytes > 0 &&
  failureNeedsAudioEvidence;
```

Options for very short sessions:

- retain metadata without a WAV;
- retain a WAV only for a named failure class;
- reserve a separate bounded failure quota;
- apply a lower but non-zero failure-audio threshold.

Do not pass `allowShortAudio: true` for every recording.

### Acceptance conditions

- Accidental zero-use sessions do not evict normal recordings.
- Useful failed audio remains available.
- The effective policy matches the README and privacy description.
- Rotation remains bounded.

## V14 — Silero boundary fields do not describe actual state transitions

### Code evidence

`conduit-web/src/server/voice-vad.js` records:

```js
{
  entryFrame: startFrame,
  exitFrame: lastSpeechFrame,
  hangoverEndFrame,
  speechFrameCount: probabilities.length,
  meanProbability: roundedMean(probabilities),
}
```

`exitFrame` is the last frame classified as speech, not the frame where the
policy decided to close.

`speechFrameCount` is the number of frames in the complete span from first to
last speech. It includes below-threshold frames that occurred during the open
region. `meanProbability` includes those frames too.

A retained real sidecar showed:

- summary `speechFrameCount`: 141;
- region `speechFrameCount`: 143.

The two fields use different definitions under the same name.

### Required behavior

Record model evidence, state transitions, padding, and submission boundaries
as separate values.

### Proposed fix shape

```js
{
  onsetFrame,
  lastActiveFrame,
  silenceStartFrame,
  exitDecisionFrame,
  closureReason:
    "silence" |
    "end_of_stream" |
    "maximum_duration",

  spanFrameCount,
  activeFrameCount,
  meanSpanProbability,
  meanActiveProbability,
  maxProbability,

  coreStartSample,
  coreEndSample,
  paddedStartSample,
  paddedEndSample,
}
```

Pass the actual closure event into region creation:

```js
closeRegion({
  exitDecisionFrame: index,
  closureReason: "silence",
});
```

At end-of-stream:

```js
closeRegion({
  exitDecisionFrame: null,
  closureReason: "end_of_stream",
});
```

### Acceptance conditions

- Each field has one stable definition.
- Active-frame count includes only frames that meet the active-state rule.
- Exit-decision frame identifies the policy transition.
- End-of-stream closure is distinguishable from detected silence.

## V15 — Some archived failures and disconnects receive no VAD observation

### Code evidence

VAD starts only from `stop()`:

```js
diagnostics.stopAt = performance.now();
startVadObservation();
```

The failure path archives without ensuring VAD has started:

```js
void Promise.all([
  archiveRecording("failed", failure),
  vadObservationPromise,
]).then(...);
```

When failure occurs before Stop, `vadObservationPromise` is `null`.

The disconnect path also archives directly:

```js
void archiveRecording("client_disconnected");
```

### Failure mechanism

Failed runtime and disconnected sessions often contain the most useful audio
evidence. They can produce a WAV and sidecar without WP4A's principal
diagnostic.

### Required behavior

All terminal paths with accepted PCM must request one non-fatal observation.

### Proposed fix shape

```js
const ensureVadObservation = () => {
  if (vadObservationPromise || audioBytes <= 0) {
    return vadObservationPromise;
  }

  const pcm = freezeAcceptedPcm();
  vadObservationPromise = observeVadSafely(pcm);
  return vadObservationPromise;
};
```

Call it for:

- explicit Stop;
- duration-limit Stop;
- runtime or ASR failure after PCM exists;
- client disconnect after PCM exists;
- orderly server settlement of an active archived session.

### Acceptance conditions

- Failed ASR recordings contain either a completed observation or a precise
  unavailable status.
- Disconnect recordings receive the same treatment.
- VAD failure never replaces the original terminal reason.

## V16 — Whole-recording VAD execution has no queue, timeout, or cancellation

### Code evidence

`SileroVad.observe()` runs one awaited inference for every 512-sample frame:

```js
for (
  let startSample = 0;
  startSample < sampleCount;
  startSample += this.policy.frameSamples
) {
  const result = await session.run(...);
}
```

A five-minute 16 kHz recording has about 9,375 frames. The server permits two
active dictation sessions. Both can use the same ONNX session while ASR also
uses machine resources.

There is no:

- application-level observation queue;
- pending-job limit;
- execution timeout;
- cancellation signal;
- queue-depth diagnostic;
- VAD execution-duration diagnostic.

### Required behavior

Observation load must be bounded and must not contend without visibility.

### Proposed fix shape

Use one bounded queue for whole-recording shadow jobs:

```js
class VadObservationQueue {
  constructor({
    concurrency = 1,
    maxPending = 2,
    maxPendingBytes,
  }) {
    // Queue state.
  }

  enqueue({ pcm, signal }) {
    // Return observed, cancelled, timed_out,
    // or capacity_skipped.
  }
}
```

Record:

```js
{
  queuedAt,
  startedAt,
  completedAt,
  queueDelayMs,
  executionMs,
  status,
}
```

When the queue is full, record:

```js
{
  available: false,
  status: "capacity_skipped",
}
```

Do not delay ASR or retain unbounded PCM waiting for diagnostic capacity.

### Acceptance conditions

- Maximum pending PCM bytes are explicit.
- Two long sessions cannot create unbounded VAD work.
- Cancellation and timeout have sidecar statuses.
- Capacity loss affects diagnostics only.

## V17 — Silero installation is coupled to ASR model installations

### Code evidence

`conduit-web/src/server/voice-model-manifests.js` appends the same Silero
artifact to each Whisper and Parakeet manifest:

```js
{
  ...SILERO_VAD_ARTIFACT,
  relative: "models/silero_vad.onnx",
}
```

`conduit-web/src/server/voice-vad.js` scans model directories and accepts any
verified copy:

```js
for (const entry of entries) {
  candidates.push(
    path.join(root, entry.name, "models", MODEL_FILE)
  );
}
```

### Failure mechanism

VAD is a Conduit pipeline component, but its installation ownership belongs to
whichever ASR model happens to contain a copy.

Consequences:

- installing several ASR models duplicates the artifact;
- removing a model can remove the accepted VAD copy;
- a remote-ASR configuration has no direct VAD package;
- model-directory scanning becomes permanent dependency resolution;
- VAD readiness cannot be reported independently from ASR readiness.

Checksum verification prevents accepting the wrong bytes. It does not fix
artifact ownership.

### Required behavior

Manage one independently versioned shared VAD artifact.

### Proposed layout

```text
data/voice/models/
├── shared/
│   └── silero-vad/
│       ├── manifest.json
│       └── silero_vad.onnx
├── parakeet-...
└── whisper-...
```

Expose separate lifecycle operations:

```js
await modelManager.ensureVoiceModel(modelId);
await modelManager.ensureVadRuntime();
```

Existing verified copies can be used as migration sources. The final loader
must resolve one canonical shared location instead of scanning all ASR model
directories.

### Acceptance conditions

- VAD readiness is visible independently from ASR readiness.
- One artifact copy serves all ASR choices.
- Removing an ASR model does not remove VAD.
- Remote ASR can use local VAD without installing an unrelated local ASR
  model.

## V18 — A VAD region can remain open for the full session

### Code evidence

The current region closes only after enough non-speech frames or
end-of-stream:

```js
if (speech) {
  lastSpeechFrame = index;
  silentFrameCount = 0;
  continue;
}

silentFrameCount += 1;
if (silentFrameCount >= hangoverFrames) {
  closeRegion();
}
```

There is no maximum active-region duration.

### Failure mechanism

Persistent background speech, music, fan noise, or another false positive can
keep a region open until the five-minute session limit. Memory remains bounded
by the session limit, but the region policy cannot produce a timely boundary.

### Required behavior

Use a finite maximum region duration. Prefer a recent low-probability boundary
over an arbitrary hard cut.

### Proposed fix shape

Track low-probability split candidates:

```js
if (
  active &&
  probability < bestSplitCandidate.probability
) {
  bestSplitCandidate = {
    frame: index,
    probability,
  };
}
```

At the maximum:

```js
if (activeDurationFrames >= maxRegionFrames) {
  const splitFrame =
    validRecentCandidate(bestSplitCandidate)
      ? bestSplitCandidate.frame
      : index;

  closeRegion({
    exitDecisionFrame: splitFrame,
    closureReason: "maximum_duration",
  });
}
```

Record any acoustic context overlap separately from the non-overlapping core
range.

### Acceptance conditions

- Constant false-positive input cannot create one five-minute region.
- Long continuous speech remains ordered and complete.
- Maximum-duration closure is visible in the sidecar.
- A hard split retains context without duplicating submitted core samples.

## V19 — VAD policy parsing rejects valid explicit zero values

### Code evidence

`conduit-web/src/server/voice-vad.js` uses `||` while parsing numeric policy
values:

```js
policy.threshold = Math.min(
  1,
  Math.max(
    0,
    Number(policy.threshold) ||
      SILERO_VAD_POLICY.threshold,
  ),
);

policy.preRollMs = Math.max(
  0,
  Math.round(
    Number(policy.preRollMs) ||
      SILERO_VAD_POLICY.preRollMs,
  ),
);
```

Numeric zero is falsy. An explicit zero threshold, pre-roll, hangover, or
padding value silently becomes the default.

### Required fix

Parse finite numbers explicitly:

```js
function finiteOr(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}
```

```js
policy.entryThreshold = Math.min(
  1,
  Math.max(
    0,
    finiteOr(
      policy.entryThreshold,
      SILERO_VAD_POLICY.entryThreshold,
    ),
  ),
);

policy.preRollMs = Math.max(
  0,
  Math.round(
    finiteOr(
      policy.preRollMs,
      SILERO_VAD_POLICY.preRollMs,
    ),
  ),
);
```

### Acceptance conditions

- Explicit zero remains zero for fields where zero is valid.
- `undefined`, `NaN`, and infinite values use defaults.
- Sidecars contain the effective normalized policy.

## Sound implementation elements to preserve

### Immediate capture and bounded pre-ready PCM

Microphone acquisition and worklet setup begin independently from runtime
readiness. PCM captured before WebSocket readiness is bounded by the session
audio cap and later flushed in order. This prevents the previous startup gap
where speech could begin before capture.

Preserve:

- shortcut acceptance timestamp;
- microphone-request timing;
- first non-empty PCM transition;
- no socket transmission before server readiness;
- ordered flush after readiness;
- one hard audio-byte cap.

### Lifecycle state detail

The UI distinguishes microphone preparation, recording, capture finalization,
runtime waiting, and transcription. The waveform begins only after non-empty
PCM.

Preserve the state distinctions. Fix resource ownership without collapsing
the states into one generic loading state.

### Twenty-millisecond packet contract

The worklet emits 320 PCM16 samples, or 640 bytes, for a normal packet:

```js
const PACKET_SAMPLES = 320;
const PACKET_BYTES = PACKET_SAMPLES * 2;
```

This gives about 50 packets each second. The final partial packet is flushed
before `flush_complete`.

Preserve:

- packet order;
- final partial packet;
- final PCM before Stop;
- client and server byte reconciliation;
- bounded returned-buffer pool.

### One authoritative server accumulator

The server appends each accepted packet to one bounded `PcmAccumulator`.
Adapters receive views of the accepted sequence, and final consumers can make
an exact-length snapshot.

Preserve one sequence owner. Do not reintroduce independent adapter, archive,
and VAD packet lists.

### Silero input isolation

WP4A takes:

```js
const pcm = Buffer.from(pcmAccumulator.view());
```

Silero receives this copy. The active ASR path continues to receive the
original accepted sequence. This correctly prevents observation code from
mutating or replacing transcript input.

Preserve:

- one exact snapshot;
- no Silero write access to the accumulator;
- complete WAV archive;
- non-fatal unavailable observations;
- pinned artifact size and checksum;
- recurrent state local to each observation.

### Digital-zero classification

The worklet reports sustained exact zero as:

```js
{
  type: "digital_silence",
  diagnostic: "device_stall",
}
```

This is more accurate than calling exact zero natural silence or VAD. Preserve
this distinction while removing browser amplitude control over transcript
acceptance.

## Remediation sequence

Each item leaves the current product behavior coherent and testable.

### R1 — Remove client amplitude control over text

Implement V01. Preserve meter and warning behavior. Confirm quiet valid text
enters the composer and digital zero remains a device diagnostic.

### R2 — Make diagnostic settlement non-blocking

Implement V04 and V05. Freeze accepted PCM once, send completed text before
archive and VAD settlement, and use bounded asynchronous work.

### R3 — Correct the raw capture contract

Implement V03. Request all browser speech processing off for raw capture and
record effective settings.

### R4 — Remove real-time spectral work

Implement V02. Keep RMS, peak, clipping, packet, and zero-run evidence. Move
frequency analysis off the render thread.

### R5 — Establish one validated resampler

Implement V08. Remove the unused implementation, precompute kernels, use fixed
history, and record the numerical contract.

### R6 — Repair evidence semantics

Implement V09, V10, and V11. Correct clipping, measure actual lifecycle
endpoints, and make diagnostics fail open.

### R7 — Separate active capture from warm-resource health

Implement V12. A retained track ending after flush must not fail an existing
transcript.

### R8 — Restore explicit archive retention policy

Implement V13. Keep useful failure evidence without allowing every accidental
short session to consume the normal archive quota.

### R9 — Correct Silero boundary semantics

Implement V06, V07, V14, and V19. Add entry/exit hysteresis, normalize overlap,
record actual state transitions, and parse policy values correctly.

### R10 — Bound and complete VAD observation

Implement V15, V16, and V18. Cover every archived terminal path, bound
whole-recording observation work, and define maximum-region behavior.

### R11 — Defer VAD artifact ownership migration to model-state work

Do not perform a partial V17 migration in WP0–WP4A. Move the artifact owner,
readiness reporting, migration, and uninstall behavior together in the model-
state work package.

## Final acceptance matrix

### Capture correctness

- Speech begins immediately after shortcut activation.
- First non-empty PCM changes the UI to recording.
- PCM captured before runtime readiness is retained and sent in order.
- Final partial PCM precedes Stop.
- Client bytes, server bytes, and WAV bytes reconcile.

### Signal correctness

- Raw capture requests echo cancellation, noise suppression, and automatic
  gain off.
- Effective settings are recorded.
- Conduit applies no dynamic gain to ASR PCM.
- Positive and negative clipping are counted symmetrically.
- No per-sample trigonometric diagnostics run in normal worklet processing.
- The resampler has a defined and checked frequency response.

### Transcript correctness

- Quiet valid text is not suppressed by browser amplitude thresholds.
- Digital-zero input produces a device-stall result.
- Empty server text produces a no-transcript result.
- Immediate Stop preserves the last word.
- Speech after ten-second and 30-second pauses remains represented in accepted
  PCM and Silero regions.

### Lifecycle correctness

- Slow archive storage does not delay inference.
- Slow or failed Silero observation does not delay completion.
- Track loss during capture fails clearly.
- Track loss after final flush does not fail the transcript.
- Runtime failure and disconnect archives receive a VAD status.
- Diagnostic module failure does not disable dictation.

### VAD correctness

- Entry and exit use separate thresholds.
- Exit requires the configured below-threshold duration.
- Short words remain inside core and padded regions.
- Submitted independent ranges do not overlap.
- Region fields distinguish onset, last active frame, exit decision, padding,
  and closure reason.
- Persistent false positives cannot hold one region for the full session.
- Observation concurrency, pending bytes, timeout, and cancellation are
  bounded.

### Evidence correctness

- Queue delay measures a real queue.
- User settlement ends at completed-event transmission.
- Inference, VAD, archive, and runtime preparation have separate durations.
- Sidecars preserve requested and effective capture settings.
- Sidecars preserve complete PCM sample coordinates.
- Archive rotation retains useful evidence under repeated accidental starts.

## Remediation record

Reviewed and actioned on 2026-08-15. The following findings are implemented in
the current WP0–WP4A code:

- **V01:** Browser RMS/peak values no longer suppress partial, final, or
  non-empty completed text. The server classifies exact digital-zero input so
  a confirmed device stall remains distinct from a quiet valid phrase.
- **V02:** Per-quantum spectral probes were removed from the worklet and server
  packet path. Live diagnostics retain RMS, peak, clipping, and digital-zero
  evidence. Spectral energy is absent rather than presented as a misleading
  short-window estimate.
- **V03:** Raw capture requests echo cancellation, noise suppression, and
  automatic gain control off. Processed capture requests them on. Requested
  and effective track settings remain separate.
- **V04:** Accepted PCM is frozen once for observation and archive work. ASR
  finalisation and the completed event do not await archive I/O. The archive
  has a bounded asynchronous queue and reports capacity failure without
  failing a transcript.
- **V05:** Completion is sent before VAD settlement. VAD timeout, rejection,
  and unavailable status remain diagnostic-only. Completion timing records the
  actual send point.
- **V06:** Silero uses separate entry and exit thresholds with configured
  hangover duration.
- **V07:** Sidecars retain core and padded ranges, while submitted neighboring
  ranges are normalized to remove overlap.
- **V08:** The worklet has one active resampler with precomputed phase kernels,
  fixed history, an identity path at 16 kHz, and a bounded flush length.
  Numerical tests cover 16 kHz, 44.1 kHz, 48 kHz, and render-quantum changes.
- **V09:** Server clipping counts both signed PCM full-scale values.
- **V10:** Diagnostics schema 5 separates queue, inference, completion-send,
  VAD, and archive timestamps and durations. The old stop-to-inference value is
  retained under an explicit name.
- **V11:** Diagnostics loading fails open. A missing telemetry chunk cannot
  prevent capture or transcription.
- **V12:** Track loss fails only while the capture graph still accepts audio.
  A track that ends after final flush is released as a warm-resource failure.
- **V13:** Standard archive rotation has its own quota. Short failure audio has
  a separate bounded quota and cannot evict standard recordings.
- **V14:** Silero regions now record onset, last active frame, silence start,
  exit decision, closure reason, span count, active count, and separate core
  and padded coordinates.
- **V15:** Failure, disconnect, explicit Stop, duration-limit, and orderly
  completion paths request one non-fatal VAD observation or record
  `not_configured`.
- **V16:** Whole-recording VAD uses one bounded queue with explicit pending
  record/byte limits, timeout, cancellation, and queue/execution timing.
- **V18:** A maximum Silero region duration forces a visible
  `maximum_duration` boundary.
- **V19:** VAD numeric policy parsing preserves explicit zero values and falls
  back only for non-finite input.

### V17 decision — deferred; scope disagreement recorded

I agree that the current ownership model is a design concern. I disagree that
the migration should be actioned inside this WP0–WP4A remediation because WP4A
has no independent VAD install, manifest, settings, or uninstall endpoint. The
current verified-copy lookup is deliberate compatibility with the already-
installed WP4A artifact and keeps this remediation limited to capture,
completion, archive, and observation behavior. A partial migration would leave
two ownership rules and could make an existing VAD copy disappear when an ASR
model is removed.

V17 remains open for the model-state work package. That package must add one
shared `data/voice/models/shared/silero-vad` owner, independent readiness and
install reporting, migration from verified existing copies, and tests proving
that ASR model removal and remote ASR do not remove local VAD.
