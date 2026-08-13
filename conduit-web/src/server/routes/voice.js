function noStore(response) {
  response.set("Cache-Control", "no-store");
}

export function registerVoiceRoutes(app, { voiceSettings, voiceRuntime, voiceModel }) {
  const settingsView = async () => voiceSettings.publicView({ local: await voiceModel.publicView() });

  app.get("/v0/voice/settings", async (_request, response, next) => {
    try { noStore(response); response.json(await settingsView()); }
    catch (error) { next(error); }
  });

  app.put("/v0/voice/settings", async (request, response, next) => {
    try {
      await voiceSettings.update(request.body);
      noStore(response);
      response.json(await settingsView());
    } catch (error) { next(error); }
  });

  app.delete("/v0/voice/credential", async (_request, response, next) => {
    try {
      const removed = await voiceSettings.removeCredential();
      noStore(response);
      response.json({ removed, settings: await settingsView() });
    } catch (error) { next(error); }
  });

  app.post("/v0/voice/test", async (_request, response, next) => {
    try { noStore(response); response.json(await voiceRuntime.test()); }
    catch (error) { next(error); }
  });

  app.post("/v0/voice/model/install", async (request, response, next) => {
    try {
      const modelId = String(request.body?.modelId || "");
      voiceModel.assertInstall({ modelId, licenseAccepted: request.body?.licenseAccepted === true });
      await voiceSettings.selectLocalModel(modelId);
      voiceModel.startInstall({ modelId, licenseAccepted: request.body?.licenseAccepted === true });
      noStore(response);
      response.status(202).json(await settingsView());
    } catch (error) { next(error); }
  });

  app.post("/v0/voice/model/cancel", async (_request, response, next) => {
    try {
      const cancelled = voiceModel.cancelInstall();
      noStore(response);
      response.json({ cancelled, settings: await settingsView() });
    } catch (error) { next(error); }
  });

  app.delete("/v0/voice/model", async (request, response, next) => {
    try {
      const removed = await voiceModel.uninstall(String(request.body?.modelId || ""));
      noStore(response);
      response.json({ removed, settings: await settingsView() });
    } catch (error) { next(error); }
  });
}
