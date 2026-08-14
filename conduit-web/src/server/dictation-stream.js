const DEFAULT_LIMITS = Object.freeze({
  maxSessions: 2,
  maxDurationMs: 300_000,
  maxAudioBytes: 16_000 * 2 * 300,
  maxFrameBytes: 64 * 1024,
  maxEventBytes: 64 * 1024,
  finalDeadlineMs: 1_000,
  finalizationBaseMs: 30_000,
  finalizationMaxMs: 600_000,
  finalizationDefaultMultiplier: 12,
});

// Local full-precision models need much more CPU time than a remote streaming
// adapter. Keep these policies here so a deployment can tune the defaults
// through createDictationStream({ limits }) without changing the protocol.
export const FINALIZATION_MODEL_MULTIPLIERS = Object.freeze({
  "parakeet-tdt-0.6b-v2-fp32": 18,
  "parakeet-tdt-0.6b-v2-int8": 10,
  "parakeet-tdt-0.6b-v3-fp32": 18,
  "parakeet-tdt-0.6b-v3-int8": 10,
  "whisper-large-v3-turbo-q8": 14,
  "whisper-small-fp32": 14,
  "whisper-small-q8": 10,
  "whisper-base-fp32": 12,
  "whisper-base-q8": 8,
  "whisper-tiny-en-fp32": 10,
  "whisper-tiny-en-q8": 6,
});

function finalizationMultiplier({ adapter, model }, limits) {
  const exact = FINALIZATION_MODEL_MULTIPLIERS[String(model || "")];
  if (Number.isFinite(exact)) return exact;
  return Number.isFinite(Number(limits.finalizationDefaultMultiplier))
    ? Number(limits.finalizationDefaultMultiplier)
    : DEFAULT_LIMITS.finalizationDefaultMultiplier;
}

export function calculateFinalizationTimeoutMs({ audioBytes = 0, adapter = null, model = null, limits = DEFAULT_LIMITS } = {}) {
  const fixed = Number(limits.finalTimeoutMs);
  if (Number.isFinite(fixed) && fixed >= 1_000) return Math.round(fixed);
  const baseMs = Math.max(1_000, Number(limits.finalizationBaseMs) || DEFAULT_LIMITS.finalizationBaseMs);
  const maxMs = Math.max(baseMs, Number(limits.finalizationMaxMs) || DEFAULT_LIMITS.finalizationMaxMs);
  const audioDurationMs = Math.max(0, Number(audioBytes) || 0) / 32;
  const estimate = Math.max(baseMs, audioDurationMs * finalizationMultiplier({ adapter, model }, limits));
  return Math.min(maxMs, Math.ceil(estimate));
}

function dictationError(code, message, status = 400) {
  return Object.assign(new Error(message), { code, status });
}

function transcriptText(event) {
  return String(event?.text ?? event?.transcript ?? event?.result?.text ?? "").trim();
}

function joinTranscript(left, right) {
  if (!left) return right;
  if (!right || right === left) return left;
  if (right.startsWith(left)) return right;
  return `${left}${/\s$/.test(left) || /^\s/.test(right) ? "" : " "}${right}`;
}

// Append two texts verbatim. Unlike joinTranscript this never deduplicates:
// segment transcripts are distinct utterances, so a sentence spoken twice must
// appear twice even when the model transcribes both segments identically.
function appendText(left, right) {
  if (!left) return right;
  if (!right) return left;
  return `${left}${/\s$/.test(left) || /^\s/.test(right) ? "" : " "}${right}`;
}

// Merge an incoming finalized transcript into the accumulated text. Endpoints
// stream token deltas that differ from their final text only by whitespace
// (the local Parakeet runtime emits word-boundary tokens with a leading space
// and then a trimmed, collapsed `transcript.text.done`), so a plain append
// would print the transcript twice. When the two texts are whitespace-equal or
// one is a normalized prefix of the other, take the authoritative candidate
// instead of appending; distinct segments still merge with `joinTranscript`.
function mergeTranscript(left, right) {
  if (!left) return right;
  if (!right) return left;
  const normalize = (text) => String(text).trim().replace(/\s+/g, " ");
  const a = normalize(left);
  const b = normalize(right);
  if (a === b || b.startsWith(a)) return right;
  if (a.startsWith(b)) return left;
  return joinTranscript(left, right);
}

// Batch ASR models hallucinate over long mid-utterance silence: the local
// Parakeet TDT fills a 2s+ pause with invented text and drops the speech that
// follows. Split the buffered PCM at long silent runs before transcription so
// each segment is a self-contained utterance, then join the segment texts.
const SEGMENT_WINDOW_SAMPLES = 160; // 10ms at 16 kHz
const SEGMENT_SILENCE_RMS = 0.008; // -42 dBFS
const SEGMENT_SILENCE_MS = 2_000;
const SEGMENT_MIN_SEGMENT_MS = 500;
const SEGMENT_MAX_SEGMENTS = 16;
const SEGMENT_MERGE_ACTIVE_MS = 150;

export function splitSilence(pcm, byteLength, options = {}) {
  const sampleCount = Math.max(0, Math.floor(byteLength / 2));
  const windowSamples = Number.isFinite(options.windowSamples) ? options.windowSamples : SEGMENT_WINDOW_SAMPLES;
  const silenceRms = Number.isFinite(options.silenceRms) ? options.silenceRms : SEGMENT_SILENCE_RMS;
  const silenceSamples = Math.max(1, Math.round((Number.isFinite(options.silenceMs) ? options.silenceMs : SEGMENT_SILENCE_MS) / 1_000 * 16_000));
  const minSegmentSamples = Math.max(1, Math.round((Number.isFinite(options.minSegmentMs) ? options.minSegmentMs : SEGMENT_MIN_SEGMENT_MS) / 1_000 * 16_000));
  const maxSegments = Math.max(2, Number.isFinite(options.maxSegments) ? options.maxSegments : SEGMENT_MAX_SEGMENTS);
  const windows = Math.ceil(sampleCount / windowSamples);
  const silent = new Array(windows);
  for (let windowIndex = 0; windowIndex < windows; windowIndex += 1) {
    const start = windowIndex * windowSamples;
    const end = Math.min(sampleCount, start + windowSamples);
    let sum = 0;
    for (let index = start; index < end; index += 1) {
      const value = pcm.readInt16LE(index * 2) / 32768;
      sum += value * value;
    }
    silent[windowIndex] = Math.sqrt(sum / (end - start)) < silenceRms;
  }
  // Collect silent runs; brief active blips (e.g. a click inside the pause)
  // merge into the surrounding run.
  const mergeWindows = Math.max(1, Math.round(SEGMENT_MERGE_ACTIVE_MS / 1_000 * 16_000 / windowSamples));
  const runs = [];
  let runStartWindow = -1;
  let activeWindowCount = 0;
  for (let windowIndex = 0; windowIndex <= windows; windowIndex += 1) {
    const isSilent = windowIndex < windows && silent[windowIndex];
    if (isSilent) {
      if (runStartWindow < 0) {
        runStartWindow = windowIndex;
        activeWindowCount = 0;
      }
    } else {
      activeWindowCount += 1;
      if (runStartWindow >= 0 && activeWindowCount >= mergeWindows) {
        const runEndWindow = windowIndex - activeWindowCount + 1;
        const durationSamples = (runEndWindow - runStartWindow) * windowSamples;
        if (durationSamples >= silenceSamples) runs.push([runStartWindow * windowSamples, Math.min(sampleCount, runEndWindow * windowSamples)]);
        runStartWindow = -1;
        activeWindowCount = 0;
      }
    }
  }
  if (runStartWindow >= 0 && (windows - runStartWindow) * windowSamples >= silenceSamples) {
    runs.push([runStartWindow * windowSamples, sampleCount]);
  }
  if (!runs.length) return [[0, sampleCount]];
  if (runs.length > maxSegments - 1) {
    runs.sort((left, right) => (right[1] - right[0]) - (left[1] - left[0]));
    runs.length = maxSegments - 1;
  }
  runs.sort((left, right) => left[0] - right[0]);
  const segments = [];
  let cursor = 0;
  for (const [runStart, runEnd] of runs) {
    if (runStart - cursor >= minSegmentSamples) segments.push([cursor, runStart]);
    cursor = runEnd;
  }
  if (sampleCount - cursor >= minSegmentSamples) segments.push([cursor, sampleCount]);
  return segments;
}

function wavBlob(chunks, byteLength) {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + byteLength, 4);
  header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(16_000, 24);
  header.writeUInt32LE(32_000, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(byteLength, 40);
  return new Blob([header, ...chunks], { type: "audio/wav" });
}

async function readSse(response, emit, limits) {
  if (!response.ok || !response.body) throw dictationError("asr_request_failed", `Voice endpoint returned ${response.status}`, 502);
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("text/event-stream")) {
    const raw = await response.text();
    if (Buffer.byteLength(raw) > limits.maxEventBytes) throw dictationError("asr_event_too_large", "Voice endpoint response is too large", 502);
    const event = JSON.parse(raw);
    emit({ type: "final", text: transcriptText(event) });
    return;
  }
  const decoder = new TextDecoder();
  const reader = response.body.getReader();
  let pending = "";
  let cumulative = "";
  const processFrame = (frame) => {
    const data = frame.split(/\r?\n/).filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim()).join("\n");
    if (!data || data === "[DONE]") return;
    const event = JSON.parse(data);
    const type = String(event.type || "");
    if (type === "transcript.text.delta") {
      cumulative += String(event.delta || "");
      emit({ type: "partial", text: cumulative });
    } else if (type === "transcript.text.done") {
      cumulative = mergeTranscript(cumulative, transcriptText(event) || cumulative);
      emit({ type: "final", text: cumulative });
    } else if (type === "error" || event.error) {
      emit({ type: "error", code: String(event.code || "asr_error"), message: String(event.message || event.error?.message || "Transcription failed") });
    }
  };
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    pending += decoder.decode(value, { stream: true });
    if (Buffer.byteLength(pending) > limits.maxEventBytes) throw dictationError("asr_event_too_large", "Voice endpoint event is too large", 502);
    const frames = pending.split(/\r?\n\r?\n/);
    pending = frames.pop() || "";
    frames.forEach(processFrame);
  }
  pending += decoder.decode();
  if (pending.trim()) processFrame(pending);
}

export function createHttpAdapter(config, emit, limits, fetchImpl) {
  const chunks = [];
  let byteLength = 0;
  const controller = new AbortController();
  const transcribe = async () => {
    if (!byteLength || controller.signal.aborted) return { final: false, text: "" };
    const pcm = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), byteLength);
    const segments = splitSilence(pcm, byteLength, limits);
    let final = false;
    let text = "";
    for (let index = 0; index < segments.length; index += 1) {
      const [startSample, endSample] = segments[index];
      const segmentBytes = (endSample - startSample) * 2;
      const segmentChunks = segments.length > 1 ? [pcm.subarray(startSample * 2, endSample * 2)] : [pcm];
      const prefix = text;
      let segmentText = "";
      const form = new FormData();
      form.append("file", wavBlob(segmentChunks, segmentBytes), `dictation-${index + 1}.wav`);
      form.append("response_format", "json");
      if (config.model) form.append("model", config.model);
      if (config.provider !== "groq") form.append("stream", "true");
      const response = await fetchImpl(config.endpoint, { method: "POST", headers: config.headers, body: form, signal: controller.signal, redirect: "error" });
      await readSse(response, (event) => {
        if (event.type === "final") {
          final = true;
          // Finals within one response are cumulative snapshots of that
          // segment, so they merge extension-aware; the completed segments
          // ahead of this one are distinct utterances and append verbatim.
          segmentText = mergeTranscript(segmentText, String(event.text || ""));
          emit({ type: "final", text: appendText(prefix, segmentText) });
        } else if (event.type === "partial") {
          // Partials stay cumulative snapshots of the whole utterance: prefix
          // the joined text of the completed segments ahead of this one.
          emit({ type: "partial", text: appendText(prefix, String(event.text || "")) });
        } else emit(event);
      }, limits);
      text = appendText(text, segmentText);
    }
    return { final, text };
  };
  queueMicrotask(() => emit({ type: "ready", sampleRate: 16_000, encoding: "pcm_s16le" }));
  return {
    opened: Promise.resolve(),
    write(data) {
      byteLength += data.length;
      if (byteLength > limits.maxAudioBytes) throw dictationError("dictation_too_long", "Voice dictation reached the server audio limit", 413);
      chunks.push(Buffer.from(data));
    },
    async stop() {
      try {
        const result = await transcribe();
        emit({ type: "adapter_closed", ...result });
      } catch (error) {
        if (error.name !== "AbortError") emit({ type: "error", code: error.code || "asr_request_failed", message: error.message });
      }
    },
    close() { controller.abort(); chunks.length = 0; },
  };
}

function createSnapshotAdapter(emit, limits, transcribe) {
  const chunks = [];
  let byteLength = 0;
  const run = async () => {
    if (!byteLength) return { final: false, text: "" };
    const snapshot = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), byteLength);
    const segments = splitSilence(snapshot, byteLength, limits);
    let text = "";
    for (const [startSample, endSample] of segments) {
      const piece = segments.length > 1 ? snapshot.subarray(startSample * 2, endSample * 2) : snapshot;
      const pieceText = String(await transcribe(piece) || "").trim();
      if (pieceText) text = appendText(text, pieceText);
    }
    if (text) emit({ type: "final", text });
    return { final: Boolean(text), text };
  };
  queueMicrotask(() => emit({ type: "ready", sampleRate: 16_000, encoding: "pcm_s16le" }));
  return {
    opened: Promise.resolve(),
    write(data) {
      byteLength += data.length;
      if (byteLength > limits.maxAudioBytes) throw dictationError("dictation_too_long", "Voice dictation reached the server audio limit", 413);
      chunks.push(Buffer.from(data));
    },
    async stop() {
      try {
        const result = await run();
        emit({ type: "adapter_closed", ...result });
      } catch (error) { emit({ type: "error", code: error.code || "asr_request_failed", message: error.message }); }
    },
    close() { chunks.length = 0; },
  };
}

export function createDeepgramAdapter(config, emit, limits, fetchImpl) {
  return createSnapshotAdapter(emit, limits, async (pcm) => {
    const endpoint = new URL(config.endpoint);
    endpoint.searchParams.set("model", config.model || "nova-3");
    endpoint.searchParams.set("smart_format", "true");
    const response = await fetchImpl(endpoint, {
      method: "POST",
      headers: { ...config.headers, "Content-Type": "audio/wav" },
      body: wavBlob([pcm], pcm.length),
      signal: AbortSignal.timeout(15_000),
      redirect: "error",
    });
    if (!response.ok) throw dictationError("asr_request_failed", `Deepgram returned ${response.status}`, 502);
    const result = await response.json();
    return result?.results?.channels?.[0]?.alternatives?.[0]?.transcript || "";
  });
}

export function createDictationStream({ wss, voiceRuntime, recordingStore = null, fetchImpl = fetch, limits: limitOverrides = {} }) {
  const limits = { ...DEFAULT_LIMITS, ...limitOverrides };
  let activeSessions = 0;
  const handleUpgrade = (request, socket, head) => wss.handleUpgrade(request, socket, head, (client) => {
    if (activeSessions >= limits.maxSessions) {
      client.send(JSON.stringify({ type: "error", code: "dictation_capacity", message: "The Conduit server is already handling the maximum number of dictation sessions" }));
      client.close(1013, "Dictation capacity reached");
      return;
    }
    activeSessions += 1;
    voiceRuntime.pin?.();
    let adapter = null;
    let adapterReady = false;
    let settleAdapter;
    const adapterAvailable = new Promise((resolve) => { settleAdapter = resolve; });
    let completed = false;
    let stopping = false;
    let stoppedAt = 0;
    let finalText = "";
    let hasFinal = false;
    let durationTimer;
    let finalTimer;
    let deadlineTimer;
    let deadlinePassed = false;
    let audioBytes = 0;
    let clientAudioBytes = null;
    const audioChunks = [];
    const pendingPcm = [];
    let transcriptObserved = false;
    let stopReason = null;
    let runtimeMetadata = { adapter: null, provider: null, model: null };
    const send = (event) => {
      if (client.readyState === client.OPEN) client.send(JSON.stringify(event));
    };
    const cleanup = () => {
      clearTimeout(durationTimer);
      clearTimeout(finalTimer);
      clearTimeout(deadlineTimer);
      pendingPcm.length = 0;
      adapter?.close();
      adapter = null;
      adapterReady = false;
    };
    const complete = async (reason, upstream = {}) => {
      if (completed) return;
      completed = true;
      const completedAt = Date.now();
      cleanup();
      const transcript = String(upstream.text || finalText || "").trim();
      if (recordingStore && transcriptObserved && transcript) {
        try {
          await recordingStore.save({
            audioChunks,
            audioBytes,
            transcript,
            metadata: {
              completionReason: reason,
              final: upstream.final ?? hasFinal,
              finalWithinDeadline: Boolean(hasFinal && stoppedAt && !deadlinePassed),
              settlementMs: stoppedAt ? completedAt - stoppedAt : null,
              clientAudioBytes,
              serverAudioBytes: audioBytes,
              serverAudioDurationMs: Math.round(audioBytes / 32),
              ...runtimeMetadata,
            },
          });
        } catch (error) {
          console.error(`Voice diagnostic recording failed: ${error.message}`);
        }
      }
      send({
        type: "completed",
        text: upstream.text || finalText,
        final: upstream.final ?? hasFinal,
        reason,
        settlementMs: stoppedAt ? completedAt - stoppedAt : null,
        finalWithinDeadline: Boolean(hasFinal && stoppedAt && !deadlinePassed),
        audioBytes,
        audioDurationMs: Math.round(audioBytes / 32),
        ...runtimeMetadata,
      });
    };
    const fail = (error) => {
      if (completed) return;
      completed = true;
      cleanup();
      send({ type: "error", code: error.code || "dictation_failed", message: error.message || "Voice dictation failed" });
    };
    const acceptAudio = (data) => {
      if (data.length > limits.maxFrameBytes) throw dictationError("dictation_frame_too_large", "Audio frame is too large", 413);
      audioBytes += data.length;
      if (audioBytes > limits.maxAudioBytes) throw dictationError("dictation_too_long", "Voice dictation reached the server audio limit", 413);
      const copy = Buffer.from(data);
      audioChunks.push(copy);
      if (adapterReady && adapter) adapter.write(copy);
      else pendingPcm.push(copy);
    };
    const stop = (reason) => {
      if (stopping || completed) return;
      stopping = true;
      stopReason = reason;
      stoppedAt = Date.now();
      void (async () => {
        try {
          const current = adapter || await adapterAvailable;
          if (!current || completed) return;
          const finalizationTimeoutMs = calculateFinalizationTimeoutMs({
            audioBytes,
            adapter: runtimeMetadata.adapter,
            model: runtimeMetadata.model,
            limits,
          });
          send({
            type: "finalizing",
            timeoutMs: finalizationTimeoutMs,
            audioDurationMs: Math.round(audioBytes / 32),
            ...runtimeMetadata,
          });
          finalTimer = setTimeout(() => fail(dictationError("dictation_final_timeout", "Voice dictation did not finalize in time", 504)), finalizationTimeoutMs);
          finalTimer.unref?.();
          deadlineTimer = setTimeout(() => { deadlinePassed = true; send({ type: "settlement_deadline", deadlineMs: limits.finalDeadlineMs }); }, limits.finalDeadlineMs);
          deadlineTimer.unref?.();
          await current.stop();
        } catch (error) { fail(error); }
      })();
    };
    const emit = (event) => {
      if (completed) return;
      // Session already advertised readiness so the browser can stream PCM while
      // the local model cold-starts; ignore the adapter's own ready event.
      if (event.type === "ready") return;
      if (event.type === "partial") {
        const text = String(event.text || "");
        if (text.trim()) transcriptObserved = true;
        send({ type: "partial", text });
      }
      else if (event.type === "final") {
        finalText = String(event.text || "");
        if (finalText.trim()) transcriptObserved = true;
        hasFinal = true;
        send({ type: "final", text: finalText });
        // Completion waits for adapter_closed: segmented transcriptions emit
        // one final per utterance, so completing on the first final would drop
        // every later segment.
      } else if (event.type === "adapter_closed") complete(stopping ? stopReason || "stopped" : "upstream_closed", event);
      else if (event.type === "error") fail(dictationError(event.code || "asr_error", event.message || "Voice dictation failed", 502));
      else send(event);
    };
    // Accept PCM immediately. Cold model load continues in the background; the
    // server retains frames until the adapter is attached, then drains them.
    send({ type: "ready", sampleRate: 16_000, encoding: "pcm_s16le" });
    durationTimer = setTimeout(() => stop("duration_limit"), limits.maxDurationMs);
    durationTimer.unref?.();
    (async () => {
      const config = await voiceRuntime.resolve();
      if (completed) {
        settleAdapter(null);
        return;
      }
      runtimeMetadata = {
        adapter: typeof config.adapter === "string" ? config.adapter : null,
        provider: typeof config.provider === "string" ? config.provider : null,
        model: typeof config.model === "string" && config.model ? config.model : typeof config.localModelId === "string" ? config.localModelId : null,
      };
      const next = config.adapter === "deepgram_audio_v1"
        ? createDeepgramAdapter(config, emit, limits, fetchImpl)
        : config.adapter === "managed_transformers_v1"
          ? createSnapshotAdapter(emit, limits, config.transcribe)
          : createHttpAdapter(config, emit, limits, fetchImpl);
      await next.opened;
      if (completed) {
        next.close();
        settleAdapter(null);
        return;
      }
      adapter = next;
      for (const chunk of pendingPcm) adapter.write(chunk);
      pendingPcm.length = 0;
      adapterReady = true;
      settleAdapter(adapter);
    })().catch((error) => {
      settleAdapter(null);
      fail(error);
    });

    client.on("message", (data, isBinary) => {
      if (completed || stopping) return;
      try {
        if (isBinary) {
          acceptAudio(data);
          return;
        }
        const command = JSON.parse(String(data));
        if (command.type !== "stop") throw dictationError("dictation_control_invalid", "Unknown dictation control frame");
        const reportedAudioBytes = Number(command.audioBytesSent);
        clientAudioBytes = Number.isFinite(reportedAudioBytes) && reportedAudioBytes >= 0
          ? Math.trunc(reportedAudioBytes)
          : null;
        stop("stopped");
      } catch (error) { fail(error); }
    });
    client.once("close", () => {
      if (!completed) { completed = true; cleanup(); }
      settleAdapter(null);
      activeSessions = Math.max(0, activeSessions - 1);
      voiceRuntime.unpin?.();
    });
  });
  return { handleUpgrade, activeSessions: () => activeSessions };
}
