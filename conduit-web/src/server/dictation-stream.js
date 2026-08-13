import { WebSocket } from "ws";

const DEFAULT_LIMITS = Object.freeze({
  maxSessions: 2,
  maxDurationMs: 30_000,
  maxAudioBytes: 16_000 * 2 * 30,
  maxFrameBytes: 64 * 1024,
  maxEventBytes: 64 * 1024,
  maxBufferedBytes: 1024 * 1024,
  finalDeadlineMs: 1_000,
  finalTimeoutMs: 15_000,
  connectTimeoutMs: 5_000,
});

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

export function createParakeetNormalizer() {
  let settled = "";
  let provisional = "";
  let hasFinal = false;
  const normalize = (raw) => {
    let event;
    try { event = JSON.parse(Buffer.isBuffer(raw) ? raw.toString("utf8") : String(raw)); }
    catch { throw dictationError("asr_event_invalid", "The Parakeet endpoint returned a non-JSON event", 502); }
    const type = String(event.type || event.event || "").toLowerCase();
    if (type === "error" || event.error) {
      return [{ type: "error", code: String(event.code || "asr_error"), message: String(event.message || event.error?.message || event.error || "Transcription failed") }];
    }
    const events = [];
    if (["partial", "transcript.partial", "transcript.text.delta"].includes(type)) {
      provisional = type === "transcript.text.delta" ? `${provisional}${String(event.delta || "")}` : transcriptText(event);
      events.push({ type: "partial", text: joinTranscript(settled, provisional) });
    } else if (["final", "transcript.final", "transcript.text.done"].includes(type)) {
      settled = joinTranscript(settled, transcriptText(event) || provisional);
      provisional = "";
      hasFinal = true;
      events.push({ type: "final", text: settled });
    } else if (!["end_of_speech", "utterance_end", "speech_end"].includes(type)) {
      throw dictationError("asr_event_unknown", `The Parakeet endpoint returned an unsupported ${type || "untyped"} event`, 502);
    }
    if (event.speech_final === true || event.end_of_speech === true || ["end_of_speech", "utterance_end", "speech_end"].includes(type)) {
      events.push({ type: "end_of_speech" });
    }
    return events;
  };
  return { normalize, text: () => joinTranscript(settled, provisional), hasFinal: () => hasFinal };
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
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    pending += decoder.decode(value, { stream: true });
    if (Buffer.byteLength(pending) > limits.maxEventBytes) throw dictationError("asr_event_too_large", "Voice endpoint event is too large", 502);
    const frames = pending.split(/\r?\n\r?\n/);
    pending = frames.pop() || "";
    for (const frame of frames) {
      const data = frame.split(/\r?\n/).filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim()).join("\n");
      if (!data || data === "[DONE]") continue;
      const event = JSON.parse(data);
      const type = String(event.type || "");
      if (type === "transcript.text.delta") {
        cumulative += String(event.delta || "");
        emit({ type: "partial", text: cumulative });
      } else if (type === "transcript.text.done") {
        cumulative = transcriptText(event) || cumulative;
        emit({ type: "final", text: cumulative });
      } else if (type === "error" || event.error) {
        emit({ type: "error", code: String(event.code || "asr_error"), message: String(event.message || event.error?.message || "Transcription failed") });
      }
    }
  }
}

function createWebSocketAdapter(config, emit, limits, WebSocketImpl) {
  const normalizer = createParakeetNormalizer();
  let socket;
  let connectTimer;
  const opened = new Promise((resolve, reject) => {
    socket = new WebSocketImpl(config.endpoint, { headers: config.headers, lookup: config.lookup, handshakeTimeout: limits.connectTimeoutMs });
    connectTimer = setTimeout(() => reject(dictationError("dictation_connection_timeout", "Voice endpoint connection timed out", 504)), limits.connectTimeoutMs);
    socket.once("open", () => { clearTimeout(connectTimer); emit({ type: "ready", sampleRate: 16_000, encoding: "pcm_s16le" }); resolve(); });
    socket.on("message", (data) => {
      try {
        if (data.length > limits.maxEventBytes) throw dictationError("asr_event_too_large", "Voice endpoint event is too large", 502);
        for (const event of normalizer.normalize(data)) emit(event);
      } catch (error) { emit({ type: "error", code: error.code || "asr_event_invalid", message: error.message }); }
    });
    socket.once("error", reject);
    socket.once("close", () => emit({ type: "adapter_closed", text: normalizer.text(), final: normalizer.hasFinal() }));
  });
  return {
    opened,
    write(data) {
      if (socket?.readyState !== WebSocketImpl.OPEN) throw dictationError("dictation_not_ready", "Voice endpoint is not ready", 409);
      if (socket.bufferedAmount > limits.maxBufferedBytes) throw dictationError("dictation_backpressure", "Voice endpoint is not accepting audio quickly enough", 429);
      socket.send(data, { binary: true });
    },
    stop() {
      if (socket?.readyState === WebSocketImpl.OPEN) socket.send(config.stopMessage || JSON.stringify({ type: "stop" }));
    },
    close() { clearTimeout(connectTimer); if (socket?.readyState < WebSocketImpl.CLOSING) socket.close(1000, "Dictation complete"); },
  };
}

export function createHttpAdapter(config, emit, limits, fetchImpl) {
  const chunks = [];
  let byteLength = 0;
  let transcribedBytes = 0;
  let inFlight = null;
  let stopped = false;
  const controller = new AbortController();
  const transcribe = async (final) => {
    if (!byteLength || (!final && byteLength === transcribedBytes) || controller.signal.aborted) return;
    const snapshot = chunks.map((chunk) => Buffer.from(chunk));
    const snapshotBytes = byteLength;
    const form = new FormData();
    form.append("file", wavBlob(snapshot, snapshotBytes), "dictation.wav");
    form.append("response_format", "json");
    if (config.model) form.append("model", config.model);
    if (config.provider !== "groq") form.append("stream", "true");
    const response = await fetchImpl(config.endpoint, { method: "POST", headers: config.headers, body: form, signal: controller.signal, redirect: "error" });
    await readSse(response, (event) => {
      if (!final && event.type === "final") emit({ type: "partial", text: event.text });
      else emit(event);
    }, limits);
    transcribedBytes = snapshotBytes;
  };
  const interval = setInterval(() => {
    if (stopped || inFlight || byteLength < 3_200) return;
    inFlight = transcribe(false)
      .catch((error) => { if (error.name !== "AbortError") emit({ type: "error", code: error.code || "asr_request_failed", message: error.message }); })
      .finally(() => { inFlight = null; });
  }, 750);
  interval.unref?.();
  queueMicrotask(() => emit({ type: "ready", sampleRate: 16_000, encoding: "pcm_s16le" }));
  return {
    opened: Promise.resolve(),
    write(data) {
      byteLength += data.length;
      if (byteLength > limits.maxAudioBytes) throw dictationError("dictation_too_long", "Voice dictation reached the server audio limit", 413);
      chunks.push(Buffer.from(data));
    },
    async stop() {
      stopped = true;
      clearInterval(interval);
      try {
        await inFlight;
        await transcribe(true);
        emit({ type: "adapter_closed", final: true });
      } catch (error) {
        if (error.name !== "AbortError") emit({ type: "error", code: error.code || "asr_request_failed", message: error.message });
      }
    },
    close() { clearInterval(interval); controller.abort(); chunks.length = 0; },
  };
}

function createSnapshotAdapter(config, emit, limits, transcribe) {
  const chunks = [];
  let byteLength = 0;
  let transcribedBytes = 0;
  let inFlight = null;
  let stopped = false;
  const run = async (final) => {
    if (!byteLength || (!final && byteLength === transcribedBytes)) return;
    const snapshot = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), byteLength);
    const text = String(await transcribe(snapshot) || "").trim();
    transcribedBytes = snapshot.length;
    if (text) emit({ type: final ? "final" : "partial", text });
  };
  const interval = setInterval(() => {
    if (stopped || inFlight || byteLength < 3_200) return;
    inFlight = run(false)
      .catch((error) => emit({ type: "error", code: error.code || "asr_request_failed", message: error.message }))
      .finally(() => { inFlight = null; });
  }, 750);
  interval.unref?.();
  queueMicrotask(() => emit({ type: "ready", sampleRate: 16_000, encoding: "pcm_s16le" }));
  return {
    opened: Promise.resolve(),
    write(data) {
      byteLength += data.length;
      if (byteLength > limits.maxAudioBytes) throw dictationError("dictation_too_long", "Voice dictation reached the server audio limit", 413);
      chunks.push(Buffer.from(data));
    },
    async stop() {
      stopped = true;
      clearInterval(interval);
      try {
        await inFlight;
        await run(true);
        emit({ type: "adapter_closed", final: true });
      } catch (error) { emit({ type: "error", code: error.code || "asr_request_failed", message: error.message }); }
    },
    close() { clearInterval(interval); chunks.length = 0; },
  };
}

export function createDeepgramAdapter(config, emit, limits, fetchImpl) {
  return createSnapshotAdapter(config, emit, limits, async (pcm) => {
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

export function createDictationStream({ wss, voiceRuntime, WebSocketImpl = WebSocket, fetchImpl = fetch, limits: limitOverrides = {} }) {
  const limits = { ...DEFAULT_LIMITS, ...limitOverrides };
  let activeSessions = 0;
  const handleUpgrade = (request, socket, head) => wss.handleUpgrade(request, socket, head, (client) => {
    if (activeSessions >= limits.maxSessions) {
      client.send(JSON.stringify({ type: "error", code: "dictation_capacity", message: "The Conduit server is already handling the maximum number of dictation sessions" }));
      client.close(1013, "Dictation capacity reached");
      return;
    }
    activeSessions += 1;
    let adapter;
    let completed = false;
    let stopping = false;
    let stoppedAt = 0;
    let finalText = "";
    let hasFinal = false;
    let finalRevision = 0;
    let stopFinalRevision = 0;
    let durationTimer;
    let finalTimer;
    let deadlineTimer;
    let deadlinePassed = false;
    let audioBytes = 0;
    const send = (event) => {
      if (client.readyState === client.OPEN) client.send(JSON.stringify(event));
    };
    const cleanup = () => {
      clearTimeout(durationTimer);
      clearTimeout(finalTimer);
      clearTimeout(deadlineTimer);
      adapter?.close();
      adapter = null;
    };
    const complete = (reason, upstream = {}) => {
      if (completed) return;
      completed = true;
      const completedAt = Date.now();
      cleanup();
      send({
        type: "completed",
        text: upstream.text || finalText,
        final: upstream.final ?? hasFinal,
        reason,
        settlementMs: stoppedAt ? completedAt - stoppedAt : null,
        finalWithinDeadline: Boolean(hasFinal && stoppedAt && !deadlinePassed),
      });
    };
    const fail = (error) => {
      if (completed) return;
      completed = true;
      cleanup();
      send({ type: "error", code: error.code || "dictation_failed", message: error.message || "Voice dictation failed" });
    };
    const stop = (reason) => {
      if (stopping || completed) return;
      stopping = true;
      stoppedAt = Date.now();
      stopFinalRevision = finalRevision;
      finalTimer = setTimeout(() => fail(dictationError("dictation_final_timeout", "Voice dictation did not finalize in time", 504)), limits.finalTimeoutMs);
      finalTimer.unref?.();
      deadlineTimer = setTimeout(() => { deadlinePassed = true; send({ type: "settlement_deadline", deadlineMs: limits.finalDeadlineMs }); }, limits.finalDeadlineMs);
      deadlineTimer.unref?.();
      Promise.resolve(adapter?.stop()).catch(fail);
      if (reason === "end_of_speech" && hasFinal) complete(reason);
    };
    const emit = (event) => {
      if (completed) return;
      if (event.type === "partial") send({ type: "partial", text: String(event.text || "") });
      else if (event.type === "final") {
        finalText = String(event.text || "");
        hasFinal = true;
        finalRevision += 1;
        send({ type: "final", text: finalText });
        if (stopping && finalRevision > stopFinalRevision) complete("final");
      } else if (event.type === "end_of_speech") { send(event); stop("end_of_speech"); }
      else if (event.type === "adapter_closed") complete(stopping ? "stopped" : "upstream_closed", event);
      else if (event.type === "error") fail(dictationError(event.code || "asr_error", event.message || "Voice dictation failed", 502));
      else send(event);
    };
    (async () => {
      const config = await voiceRuntime.resolve();
      adapter = config.adapter === "parakeet_pcm_ws_v1"
        ? createWebSocketAdapter(config, emit, limits, WebSocketImpl)
        : config.adapter === "deepgram_audio_v1"
          ? createDeepgramAdapter(config, emit, limits, fetchImpl)
          : config.adapter === "managed_transformers_v1"
            ? createSnapshotAdapter(config, emit, limits, config.transcribe)
            : createHttpAdapter(config, emit, limits, fetchImpl);
      await adapter.opened;
      if (stopping) {
        await adapter.stop();
        return;
      }
      durationTimer = setTimeout(() => stop("duration_limit"), limits.maxDurationMs);
      durationTimer.unref?.();
    })().catch(fail);

    client.on("message", (data, isBinary) => {
      if (completed || stopping) return;
      try {
        if (isBinary) {
          if (data.length > limits.maxFrameBytes) throw dictationError("dictation_frame_too_large", "Audio frame is too large", 413);
          audioBytes += data.length;
          if (audioBytes > limits.maxAudioBytes) throw dictationError("dictation_too_long", "Voice dictation reached the server audio limit", 413);
          adapter?.write(data);
          return;
        }
        const command = JSON.parse(String(data));
        if (command.type !== "stop") throw dictationError("dictation_control_invalid", "Unknown dictation control frame");
        stop("stopped");
      } catch (error) { fail(error); }
    });
    client.once("close", () => {
      if (!completed) { completed = true; cleanup(); }
      activeSessions = Math.max(0, activeSessions - 1);
    });
  });
  return { handleUpgrade, activeSessions: () => activeSessions };
}
