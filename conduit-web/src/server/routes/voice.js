import express from "express";
import { createVoiceTranscriber } from "../voice-transcription.js";

const transcribers = new WeakMap();

// Both HTTP entry points share the runtime's admission limit and validation.
export function voiceTranscriber(voiceRuntime) {
  if (voiceRuntime && transcribers.has(voiceRuntime)) return transcribers.get(voiceRuntime);
  const transcribe = createVoiceTranscriber(voiceRuntime);
  const checked = async (audio) => {
    const text = await transcribe(audio);
    if (!text) throw Object.assign(new Error("Nothing was heard. Try again."), { status: 422, code: "nothing_heard" });
    return text;
  };
  if (voiceRuntime) transcribers.set(voiceRuntime, checked);
  return checked;
}

function noStore(response) {
  response.set("Cache-Control", "no-store");
}

export function registerVoiceRoutes(app, { voiceSettings, voiceRuntime, voiceModel }) {
  const transcribe = voiceTranscriber(voiceRuntime);
  const settingsView = async () => voiceSettings.publicView({ local: await voiceModel.publicView() });

  app.post("/v0/voice/transcribe", (request, response, next) => {
    if (!request.is("audio/wav")) return response.status(415).json({ error: "invalid_audio", message: "Send an audio/wav recording." });
    next();
  }, express.raw({ type: "audio/wav", limit: "10mb" }), async (request, response) => {
    try {
      noStore(response);
      response.json({ text: await transcribe(request.body) });
    } catch (error) {
      if (Number.isInteger(error.status) && error.status >= 400 && error.status < 600) {
        return response.status(error.code === "invalid_audio" ? 415 : error.status)
          .json({ error: error.code || "voice_failed", message: error.message });
      }
      response.status(502).json({ error: "voice_failed", message: `Transcription failed: ${String(error?.message || error).slice(0, 120)}` });
    }
  });

  app.get("/v0/voice/settings", async (_request, response, next) => {
    try { noStore(response); response.json(await settingsView()); }
    catch (error) { next(error); }
  });

  app.put("/v0/voice/settings", async (request, response) => {
    await voiceSettings.update(request.body);
    noStore(response);
    response.json(await settingsView());
  });

  app.delete("/v0/voice/credential", async (_request, response) => {
    const removed = await voiceSettings.removeCredential();
    noStore(response);
    response.json({ removed, settings: await settingsView() });
  });

  app.post("/v0/voice/test", async (_request, response, next) => {
    try { noStore(response); response.json(await voiceRuntime.test()); }
    catch (error) { next(error); }
  });

  app.post("/v0/voice/model/install", async (request, response) => {
    const modelId = String(request.body?.modelId || "");
    voiceModel.assertInstall({ modelId, licenseAccepted: request.body?.licenseAccepted === true });
    voiceModel.startInstall({ modelId, licenseAccepted: request.body?.licenseAccepted === true });
    noStore(response);
    response.status(202).json(await settingsView());
  });

  app.post("/v0/voice/model/cancel", async (_request, response) => {
    const cancelled = voiceModel.cancelInstall();
    noStore(response);
    response.json({ cancelled, settings: await settingsView() });
  });

  app.delete("/v0/voice/model", async (request, response) => {
    const removed = await voiceModel.uninstall(String(request.body?.modelId || ""));
    noStore(response);
    response.json({ removed, settings: await settingsView() });
  });
}
