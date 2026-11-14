const STATUS = { credentials: 400, unsupported: 400, refused: 400, limit: 429, network: 502 };

const found = (value, what) => {
  if (!value) throw Object.assign(new Error(`No such ${what}.`), { status: 404, code: "not_found" });
  return value;
};
const account = (value) => {
  if (!value) throw Object.assign(new Error("Say which account."), { status: 400, code: "bad_request" });
  return String(value);
};

export function registerMailRoutes(app, { mail }) {
  app.get("/v0/mail/accounts", (_request, response) => response.json({ accounts: mail.accounts() }));

  app.post("/v0/mail/accounts", async (request, response) => {
    const { kind, address, secret, name } = request.body || {};
    response.status(201).json({ account: await mail.addAccount({ kind, address, secret, name }) });
  });

  app.delete("/v0/mail/accounts/:account", async (request, response) => {
    await mail.removeAccount(request.params.account);
    response.status(204).end();
  });

  app.get("/v0/mail/accounts/:account/labels", (request, response) => response.json({ labels: mail.labels(request.params.account) }));

  app.get("/v0/mail/threads", (request, response) => {
    const { label, unread, before, limit } = request.query;
    response.json(mail.threads({ account: account(request.query.account), label: label ? String(label) : undefined,
      unread: unread === "1", before: before ? String(before) : null, limit: Number(limit) || undefined }));
  });

  app.get("/v0/mail/threads/:thread", (request, response) => response.json(found(mail.thread(request.params.thread), "thread")));

  app.get("/v0/mail/messages/:message/body", async (request, response) => response.json(await mail.body(request.params.message)));

  app.get("/v0/mail/messages/:message/attachments/:index", async (request, response) => {
    const file = found(await mail.attachment(request.params.message, Number(request.params.index)), "attachment");
    response.attachment(file.filename).type(file.mimeType).send(file.content);
  });

  app.post("/v0/mail/change", async (request, response) => response.json({ threads: await mail.change(request.body || {}) }));

  app.get("/v0/mail/search", async (request, response) => {
    const { q, remote, limit } = request.query;
    response.json({ threads: await mail.search({ account: account(request.query.account), q: String(q || ""), remote: remote === "1", limit: Number(limit) || undefined }) });
  });

  app.get("/v0/mail/drafts", (request, response) => response.json({ drafts: mail.drafts(account(request.query.account)) }));

  app.post("/v0/mail/drafts", async (request, response) => {
    const body = request.body || {};
    response.status(201).json({ draft: await mail.newDraft({ ...body, account: account(body.account) }) });
  });

  app.put("/v0/mail/drafts/:draft", async (request, response) => response.json({ draft: await mail.saveDraft(request.params.draft, request.body || {}) }));

  app.delete("/v0/mail/drafts/:draft", async (request, response) => {
    await mail.removeDraft(request.params.draft);
    response.status(204).end();
  });

  app.post("/v0/mail/drafts/:draft/send", async (request, response) => {
    await mail.sendDraft(request.params.draft);
    response.json({ sent: true });
  });

  // A source's refusal (a MailError) is the person's to read; anything else goes on to the app's own handler.
  app.use("/v0/mail", (error, _request, response, next) => {
    if (error.reason in STATUS) return response.status(STATUS[error.reason]).json({ error: error.reason, message: error.message });
    if (error.code === "not_found" || error.code === "bad_request") return response.status(error.status).json({ error: error.code, message: error.message });
    next(error);
  });
}
