import { WebSocket } from "ws";

const MAX_AUDIO_FRAME_BYTES = 256 * 1024;
const FINAL_SETTLE_MS = 1_000;

function transcriptText(event) {
  return String(event?.text ?? event?.transcript ?? event?.result?.text ?? "").trim();
}

function joinTranscript(left, right) {
  if (!left) return right;
  if (!right || right === left) return left;
  if (right.startsWith(left)) return right;
  return `${left}${/\s$/.test(left) || /^\s/.test(right) ? "" : " "}${right}`;
}

export function createAsrNormalizer() {
  let settled = "";
  let provisional = "";
  let hasFinal = false;

  const normalize = (raw) => {
    let event;
    const source = Buffer.isBuffer(raw) ? raw.toString("utf8") : String(raw);
    try { event = JSON.parse(source); }
    catch {
      const text = source.trim();
      if (!text) return [];
      settled = joinTranscript(settled, text);
      provisional = "";
      hasFinal = true;
      return [{ type: "final", text: settled }];
    }

    const type = String(event.type || event.event || "").toLowerCase();
    const text = transcriptText(event);
    if (type.includes("error") || event.error) {
      return [{ type: "error", code: event.code || "asr_error", message: String(event.message || event.error?.message || event.error || "Transcription failed") }];
    }

    const final = event.final === true || event.is_final === true || event.speech_final === true
      || type.includes("final") || type.includes("done");
    const delta = String(event.delta ?? event.text_delta ?? "");
    const partial = !final && (type.includes("partial") || type.includes("interim") || type.includes("delta") || Boolean(text));
    const events = [];
    if (final) {
      settled = joinTranscript(settled, text || provisional);
      provisional = "";
      hasFinal = true;
      events.push({ type: "final", text: settled });
    } else if (partial) {
      provisional = delta ? `${provisional}${delta}` : text;
      events.push({ type: "partial", text: joinTranscript(settled, provisional) });
    }
    if (event.speech_final === true || event.end_of_speech === true || type.includes("end_of_speech") || type.includes("utterance_end")) {
      events.push({ type: "end_of_speech" });
    }
    return events;
  };

  return {
    normalize,
    text: () => joinTranscript(settled, provisional),
    hasFinal: () => hasFinal,
  };
}

export function createDictationStream({ wss, endpoint, apiKey = "", stopMessage = "", WebSocketImpl = WebSocket }) {
  const handleUpgrade = (request, socket, head) => wss.handleUpgrade(request, socket, head, (client) => {
    if (!endpoint) {
      client.send(JSON.stringify({ type: "error", code: "dictation_not_configured", message: "Voice dictation is not configured on this Conduit server" }));
      client.close(1011, "Voice dictation is not configured");
      return;
    }

    let upstream;
    let settling = false;
    let completed = false;
    let settleTimer = null;
    const normalizer = createAsrNormalizer();
    const send = (event) => {
      if (client.readyState === client.OPEN) client.send(JSON.stringify(event));
    };
    const cleanup = () => {
      if (settleTimer) clearTimeout(settleTimer);
      settleTimer = null;
      if (upstream?.readyState < WebSocketImpl.CLOSING) upstream.close();
    };
    const complete = (reason) => {
      if (completed) return;
      completed = true;
      cleanup();
      send({ type: "completed", text: normalizer.text(), final: normalizer.hasFinal(), reason });
    };
    const fail = (error) => {
      if (completed) return;
      completed = true;
      cleanup();
      send({ type: "error", code: error.code || "dictation_connection_failed", message: error.message || "Voice dictation failed" });
    };
    const settle = (reason) => {
      if (settling || completed) return;
      settling = true;
      if (stopMessage && upstream?.readyState === WebSocketImpl.OPEN) upstream.send(stopMessage);
      settleTimer = setTimeout(() => complete(reason), FINAL_SETTLE_MS);
      settleTimer.unref?.();
    };

    try {
      const headers = apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined;
      upstream = new WebSocketImpl(endpoint, { headers });
      upstream.on("open", () => send({ type: "ready", sampleRate: 16_000, encoding: "pcm_s16le" }));
      upstream.on("message", (data) => {
        for (const event of normalizer.normalize(data)) {
          send(event);
          if (event.type === "error") fail(Object.assign(new Error(event.message), { code: event.code }));
          if (event.type === "final" && settling) complete("final");
          if (event.type === "end_of_speech") settle("end_of_speech");
        }
      });
      upstream.on("error", fail);
      upstream.on("close", () => {
        if (!completed) complete(settling ? "stopped" : "upstream_closed");
      });
    } catch (error) { fail(error); }

    client.on("message", (data, isBinary) => {
      if (completed || settling) return;
      if (isBinary) {
        if (data.length > MAX_AUDIO_FRAME_BYTES) return fail(Object.assign(new Error("Audio frame is too large"), { code: "dictation_frame_too_large" }));
        if (upstream?.readyState === WebSocketImpl.OPEN) upstream.send(data, { binary: true });
        return;
      }
      try {
        const command = JSON.parse(String(data));
        if (command.type === "stop") settle("stopped");
        else throw Object.assign(new Error("Unknown dictation control frame"), { code: "dictation_control_invalid" });
      } catch (error) { fail(error); }
    });
    client.on("close", cleanup);
  });

  return { handleUpgrade };
}
