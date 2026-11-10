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

export function registerPiAuthRoutes(app, { piAuth }) {
  app.get("/v0/pi-auth", async (request, response) => {
    piAuthOwner(request);
    noStore(response);
    const kinds = await piAuth.storedKinds();
    const providers = piAuth.providers().map((provider) => provider.auth.source === "stored" ? { ...provider, auth: { ...provider.auth, kind: kinds[provider.id] || null } } : provider);
    response.json({ installationId: "conduit-pinned", providers });
  });

  app.get("/v0/pi-auth/attempt", (request, response, next) => {
    noStore(response);
    response.json({ attempt: piAuth.activeFor(piAuthOwner(request)) });
  });

  app.post("/v0/pi-auth/oauth", (request, response, next) => {
    const attempt = piAuth.start(piAuthOwner(request), String(request.body?.providerId || ""));
    noStore(response);
    response.status(202).json({ attempt });
  });

  app.post("/v0/pi-auth/attempt/respond", (request, response, next) => {
    const attempt = piAuth.respond(piAuthOwner(request), request.body?.value);
    noStore(response);
    response.json({ attempt });
  });

  app.post("/v0/pi-auth/attempt/cancel", (request, response, next) => {
    noStore(response);
    response.json({ cancelled: piAuth.cancel(piAuthOwner(request)) });
  });

  app.put("/v0/pi-auth/api-key", async (request, response) => {
    piAuthOwner(request);
    await piAuth.setApiKey(String(request.body?.providerId || ""), request.body?.key, request.body?.env);
    noStore(response);
    response.status(204).end();
  });

  app.delete("/v0/pi-auth/:providerId", async (request, response) => {
    piAuthOwner(request);
    const removed = await piAuth.remove(String(request.params.providerId || ""));
    noStore(response);
    response.json({ removed });
  });
}
