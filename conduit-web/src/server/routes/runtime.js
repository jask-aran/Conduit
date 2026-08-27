import { validTerminalShortcuts } from "../../preferences-store.js";

export function registerRuntimeRoutes(app, {
  attachments,
  config,
  currentMagicDnsOrigin,
  formatWorkspacePath,
  isPathInside,
  isShuttingDown,
  listDirectorySuggestions,
  nativePreflight,
  preferences,
  resolveTemplate,
  runtimeHub,
  templatePublicView,
  projects,
}) {
  app.get("/healthz", (request, response) => {
    response.status(isShuttingDown() ? 503 : 200).json({
      ok: !isShuttingDown(),
      status: isShuttingDown() ? "stopping" : "ready",
      release: config.release,
    });
  });

  app.get("/v0/capabilities", (_request, response) => response.json({
    runtime: "pi-rpc", create: true, resume: true, projects: true,
    sessionManagement: true, chatIdentity: "conduit", attachments: "raw-http",
    partialContinue: config.enablePartialContinue,
    stream: "websocket", processOwner: "conduit-server", sessionAuthority: "pi-jsonl",
    globalRuntime: "sse",
    templates: true,
    workspaces: true,
    workspaceModes: ["managed", "linked", "created", "cloned"],
    piRuntimes: ["conduit_profile", "native_pi"],
    maxAttachmentBytes: attachments.maxBytes,
  }));

  app.get("/v0/share-origin", async (_request, response, next) => {
    try {
      response.json({ origin: await currentMagicDnsOrigin() });
    } catch (error) {
      next(Object.assign(new Error("Unable to determine this host's Tailscale address"), { cause: error }));
    }
  });

  app.get("/v0/workspaces/:id/native-preflight", async (request, response, next) => {
    try {
      const project = await projects.get(request.params.id);
      if (!project || project.kind !== "workspace") return response.status(404).json({ error: "workspace_not_found" });
      await projects.validate(project);
      response.json(await nativePreflight(project));
    } catch (error) { next(error); }
  });

  const workspacePolicy = () => {
    const defaultRootAllowed = config.workspaceAllowlist.some((root) => isPathInside(config.workspaceDefaultRoot, root));
    return {
      allowlist: config.workspaceAllowlist,
      defaultRoot: defaultRootAllowed ? config.workspaceDefaultRoot : null,
      defaultInputPath: defaultRootAllowed ? formatWorkspacePath(config.workspaceDefaultRoot) : null,
      suggestionRoot: config.workspaceSuggestionRoot,
      modes: ["managed", "linked", "created", "cloned"],
    };
  };

  app.get("/v0/workspaces/policy", (_request, response) => {
    response.json({
      ...workspacePolicy(),
      filesRoot: config.filesRoot,
      templatesRoot: config.templatesRoot,
    });
  });

  app.get("/v0/workspaces/suggestions", async (_request, response, next) => {
    try {
      const suggestionRoot = config.workspaceSuggestionRoot;
      if (!config.workspaceAllowlist.some((root) => isPathInside(suggestionRoot, root))) {
        return response.json({ root: suggestionRoot, ...workspacePolicy(), folders: [] });
      }
      const folders = await listDirectorySuggestions(suggestionRoot);
      response.json({
        root: suggestionRoot,
        ...workspacePolicy(),
        folders: folders.map((folder) => ({
          name: folder.name,
          path: folder.path,
          displayPath: formatWorkspacePath(folder.path),
        })),
      });
    } catch (error) { next(error); }
  });

  app.get("/v0/templates", (_request, response) => {
    const prefs = preferences.get();
    response.json({
      defaultTemplateId: prefs.defaultTemplateId,
      templates: config.piTemplates.map((template) => templatePublicView(template)),
    });
  });

  app.get("/v0/preferences", (_request, response) => {
    response.json(preferences.get());
  });

  app.patch("/v0/preferences", async (request, response, next) => {
    try {
      const requested = request.body?.defaultTemplateId;
      const template = requested == null ? null : resolveTemplate(config, requested);
      if (requested != null && !template) return response.status(400).json({ error: "unknown_template", templateId: requested });
      if (template?.defaultable === false) return response.status(400).json({ error: "special_template", templateId: requested });
      const model = request.body?.sessionNameModel;
      const thinkingLevel = request.body?.sessionNameThinkingLevel;
      if (model != null && (typeof model !== "string" || !/^[^/\s]+\/\S+$/.test(model.trim()))) {
        return response.status(400).json({ error: "invalid_session_name_model" });
      }
      if (thinkingLevel != null && !new Set(["off", "minimal", "low", "medium", "high", "max", "xhigh"]).has(thinkingLevel)) {
        return response.status(400).json({ error: "invalid_session_name_thinking_level" });
      }
      const terminalShortcuts = request.body?.terminalShortcuts;
      if (terminalShortcuts != null && !validTerminalShortcuts(terminalShortcuts)) {
        return response.status(400).json({ error: "invalid_terminal_shortcuts" });
      }
      const saved = await preferences.save({
        defaultTemplateId: requested ?? preferences.get().defaultTemplateId,
        ...(model != null ? { sessionNameModel: model } : {}),
        ...(thinkingLevel != null ? { sessionNameThinkingLevel: thinkingLevel } : {}),
        ...(terminalShortcuts != null ? { terminalShortcuts } : {}),
      });
      response.json(saved);
    } catch (error) { next(error); }
  });

  app.get("/v0/runtime", (_request, response) => {
    response.json(runtimeHub.snapshot());
  });

  app.get("/v0/runtime/stream", (request, response) => {
    response.setHeader("Content-Type", "text/event-stream");
    response.setHeader("Cache-Control", "no-cache, no-transform");
    response.setHeader("Connection", "keep-alive");
    response.flushHeaders?.();
    const client = { kind: "sse", response };
    const detach = runtimeHub.attach(client);
    const heartbeat = setInterval(() => {
      try { response.write(": ping\n\n"); }
      catch { clearInterval(heartbeat); detach(); }
    }, 25000);
    heartbeat.unref?.();
    request.on("close", () => {
      clearInterval(heartbeat);
      detach();
    });
  });
}
