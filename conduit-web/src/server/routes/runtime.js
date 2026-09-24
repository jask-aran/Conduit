import { normalizeKnownServers, validKnownServers, validSidebarPins, validTerminalShortcuts, validUiPreferencePatch } from "../../preferences-store.js";
import { manifestForImplementation } from "../../harnesses/index.js";

const PROOF_WINDOW_MS = 10_000;
const PROOF_LIMIT = 20;

const drainsOnRestart = (process) => manifestForImplementation(process.backend?.implementation)?.restartDrain !== false;

export function registerRuntimeRoutes(app, {
  attachments,
  config,
  currentMagicDnsOrigin,
  formatWorkspacePath,
  isPathInside,
  isShuttingDown,
  listDirectorySuggestions,
  preferences,
  resolveTemplate,
  runtimeHub,
  templatePublicView,
  projects,
  promptStore,
  serverIdentity,
}) {
  /*
   * Who this server is, and where else it answers.
   *
   * Authenticated on purpose. An unauthenticated version of this would let
   * anything on the network say "I am the server you already hold a token
   * for", which is the whole reason two addresses were kept apart until now.
   *
   * The reply is a claim, not an instruction: a client probes a path and
   * checks the id it gets back before addressing the server by it.
   */
  app.get("/v0/server", (request, response) => {
    serverIdentity.observe(request);
    response.json(serverIdentity.describe());
  });

  /*
   * Prove this is the server somebody already paired with.
   *
   * Unauthenticated, and that is the point: a client asks this *before* it
   * sends a token, so that moving to a new address cannot be the thing that
   * hands a credential to whatever happened to answer there. The caller picks
   * the nonce, so an answer recorded off the wire is no use for the next
   * question, and a client that holds no public half for this server learns
   * nothing it can act on.
   */
  // Cheap to answer but free to ask, so each address gets a small budget.
  // Real clients probe a handful of paths now and then; nothing needs more.
  const proofWindows = new Map();
  app.post("/v0/server/prove", (request, response) => {
    const now = Date.now();
    let window = proofWindows.get(request.ip);
    if (!window || now - window.start >= PROOF_WINDOW_MS) {
      if (proofWindows.size >= 1024) proofWindows.clear();
      window = { start: now, count: 0 };
      proofWindows.set(request.ip, window);
    }
    if (++window.count > PROOF_LIMIT) return response.status(429).json({ error: "rate_limited" });
    const proof = serverIdentity.prove(request.body?.nonce);
    if (!proof) return response.status(400).json({ error: "invalid_nonce" });
    response.json(proof);
  });

  app.get("/healthz", (request, response) => {
    // The launcher must not signal an older server that has no SIGUSR2 handler.
    response.setHeader("X-Conduit-Pwa-Prepare", "1");
    const activeGenerations = runtimeHub.snapshot().processes.filter((process) => drainsOnRestart(process)
      && (process.active || process.stopping || process.compacting || process.retrying
        || process.generation && !process.generation.settled)).length;
    response.status(isShuttingDown() ? 503 : 200).json({
      ok: !isShuttingDown(),
      status: isShuttingDown() ? "stopping" : "ready",
      release: config.release,
      activeGenerations,
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
    piRuntimes: ["conduit_profile"],
    maxAttachmentBytes: attachments.maxBytes,
  }));

  app.get("/v0/share-origin", async (_request, response, next) => {
    try {
      response.json({ origin: await currentMagicDnsOrigin() });
    } catch (error) {
      next(Object.assign(new Error("Unable to determine this host's Tailscale address"), { cause: error }));
    }
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

  app.get("/v0/prompts", async (_request, response, next) => {
    try { response.json({ prompts: await promptStore.list() }); }
    catch (error) { next(error); }
  });

  app.put("/v0/prompts/:id", async (request, response, next) => {
    try { response.json(await promptStore.save(request.params.id, request.body?.content)); }
    catch (error) { next(error); }
  });

  app.delete("/v0/prompts/:id", async (request, response, next) => {
    try { response.json(await promptStore.reset(request.params.id)); }
    catch (error) { next(error); }
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
      const sidebarPins = request.body?.sidebarPins;
      if (sidebarPins != null && !validSidebarPins(sidebarPins)) {
        return response.status(400).json({ error: "invalid_sidebar_pins" });
      }
      const knownServers = request.body?.knownServers;
      if (knownServers != null && !validKnownServers(knownServers)) {
        return response.status(400).json({ error: "invalid_known_servers" });
      }
      if (!validUiPreferencePatch(request.body)) {
        return response.status(400).json({ error: "invalid_ui_preferences" });
      }
      const uiKeys = [
        "sidebarChatLimit", "collapsedProjectIds", "sidebarCollapsed", "markdownRenderer",
        "rendererControlsVisible", "composerSurface", "contextMetrics",
        "meteorField", "incremarkPacing", "transcriptWidth", "transcriptWideBlocks",
        "codeBlockCollapse", "codeBlockCollapseLines", "codeBlockWidth",
        "userMessageCollapse", "chatSort",
        "shortcutOverrides", "voicePreferences",
      ];
      const uiPatch = Object.fromEntries(uiKeys
        .filter((key) => Object.hasOwn(request.body || {}, key))
        .map((key) => [key, request.body[key]]));
      const saved = await preferences.save({
        defaultTemplateId: requested ?? preferences.get().defaultTemplateId,
        ...(model != null ? { sessionNameModel: model } : {}),
        ...(thinkingLevel != null ? { sessionNameThinkingLevel: thinkingLevel } : {}),
        ...(terminalShortcuts != null ? { terminalShortcuts } : {}),
        ...(sidebarPins != null ? { sidebarPins } : {}),
        ...(knownServers != null ? { knownServers: normalizeKnownServers(knownServers) } : {}),
        ...uiPatch,
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
    // A real frame, not an SSE comment: the client watches for silence to tell
    // a live stream from one that died without ever firing an error.
    const heartbeat = setInterval(() => {
      try { response.write(`data: ${JSON.stringify({ type: "ping", at: new Date().toISOString() })}\n\n`); }
      catch { clearInterval(heartbeat); detach(); }
    }, 15000);
    heartbeat.unref?.();
    request.on("close", () => {
      clearInterval(heartbeat);
      detach();
    });
  });
}
