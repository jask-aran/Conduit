function piAuthOwner(request) {
  const owner = request.conduitAuth?.session?.tokenHash;
  if (!owner) {
    throw Object.assign(new Error("Pi credential management requires an authenticated Conduit session. Set a Conduit password first."), {
      code: "pi_auth_login_required",
      status: 403,
    });
  }
  return owner;
}

function noStore(response) {
  response.set("Cache-Control", "no-store");
}

export function registerPiAuthRoutes(app, { piAuth, installationViews, clearHostPiDefaults, detectHost }) {
  app.get("/v0/pi-installations", async (_request, response, next) => {
    try { response.json({ installations: await installationViews() }); }
    catch (error) { next(error); }
  });

  app.post("/v0/pi-installations/host/detect", async (_request, response, next) => {
    try {
      const detected = await detectHost();
      if (!detected.available) await clearHostPiDefaults();
      response.json((await installationViews()).find((item) => item.id === "host-pi"));
    } catch (error) { next(error); }
  });

  app.get("/v0/pi-auth", (request, response, next) => {
    try {
      piAuthOwner(request);
      noStore(response);
      response.json({ installationId: "conduit-pinned", providers: piAuth.providers() });
    } catch (error) { next(error); }
  });

  app.get("/v0/pi-auth/attempt", (request, response, next) => {
    try {
      noStore(response);
      response.json({ attempt: piAuth.activeFor(piAuthOwner(request)) });
    } catch (error) { next(error); }
  });

  app.post("/v0/pi-auth/oauth", (request, response, next) => {
    try {
      const attempt = piAuth.start(piAuthOwner(request), String(request.body?.providerId || ""));
      noStore(response);
      response.status(202).json({ attempt });
    } catch (error) { next(error); }
  });

  app.post("/v0/pi-auth/attempt/respond", (request, response, next) => {
    try {
      const attempt = piAuth.respond(piAuthOwner(request), request.body?.value);
      noStore(response);
      response.json({ attempt });
    } catch (error) { next(error); }
  });

  app.post("/v0/pi-auth/attempt/cancel", (request, response, next) => {
    try {
      noStore(response);
      response.json({ cancelled: piAuth.cancel(piAuthOwner(request)) });
    } catch (error) { next(error); }
  });

  app.put("/v0/pi-auth/api-key", async (request, response, next) => {
    try {
      piAuthOwner(request);
      await piAuth.setApiKey(String(request.body?.providerId || ""), request.body?.key);
      noStore(response);
      response.status(204).end();
    } catch (error) { next(error); }
  });

  app.delete("/v0/pi-auth/:providerId", async (request, response, next) => {
    try {
      piAuthOwner(request);
      const removed = await piAuth.remove(String(request.params.providerId || ""));
      noStore(response);
      response.json({ removed });
    } catch (error) { next(error); }
  });
}
