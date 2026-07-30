function percentile(sorted, fraction) {
  if (!sorted.length) return null;
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)];
}

function summary(values) {
  const sorted = [...values].sort((left, right) => left - right);
  return {
    count: values.length,
    p50: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
    p99: percentile(sorted, 0.99),
    max: sorted.at(-1) ?? null,
  };
}

const chatId = "550e8400-e29b-41d4-a716-446655440099";
const model = {
  provider: "example",
  id: "reasoner",
  spec: "example/reasoner",
  label: "Reasoner",
  thinkingLevels: ["off", "medium", "high"],
};
const project = {
  id: "project_chat",
  slug: "chat",
  name: "Chats",
  sessions: [],
};

async function installBrowserProtocol(page, scenario) {
  await page.addInitScript(({ cadence }) => {
    const telemetry = {
      promptAt: null,
      completedAt: null,
      webSocketDeltas: [],
      visibleIncrements: [],
      mutationCount: 0,
      frames: [],
      longTasks: [],
      finalText: "",
    };
    Object.defineProperty(window, "__conduitHarness", { configurable: true, value: telemetry });

    let observing = true;
    const frame = (now) => {
      if (telemetry.promptAt && observing) telemetry.frames.push(now);
      if (observing) requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);

    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) telemetry.longTasks.push({ startTime: entry.startTime, duration: entry.duration });
      }).observe({ type: "longtask", buffered: true });
    } catch {
      // Long Task API is optional; an empty collection remains valid evidence.
    }

    addEventListener("DOMContentLoaded", () => {
      let visibleText = "";
      const observer = new MutationObserver((records) => {
        const relevant = records.filter((record) => {
          const target = record.target.nodeType === Node.ELEMENT_NODE ? record.target : record.target.parentElement;
          return target?.closest?.(".transcript") || target?.querySelector?.(".transcript");
        });
        if (!relevant.length || !telemetry.promptAt) return;
        telemetry.mutationCount += relevant.length;
        const markdown = [...document.querySelectorAll(".chat-markdown")].at(-1);
        const nextText = (markdown?.textContent || "").trimEnd();
        if (nextText === visibleText) return;
        telemetry.visibleIncrements.push({
          at: performance.now(),
          characters: Math.max(0, nextText.length - visibleText.length),
          totalCharacters: nextText.length,
        });
        visibleText = nextText;
        telemetry.finalText = nextText;
      });
      observer.observe(document.body, { subtree: true, childList: true, characterData: true });
    }, { once: true });

    class HarnessWebSocket extends EventTarget {
      static OPEN = 1;

      constructor() {
        super();
        this.readyState = 0;
        queueMicrotask(() => {
          this.readyState = HarnessWebSocket.OPEN;
          this.dispatchEvent(new Event("open"));
        });
      }

      close() {
        this.readyState = 3;
      }

      send(raw) {
        const command = JSON.parse(String(raw));
        if (command.type !== "prompt") return;
        telemetry.promptAt = performance.now();
        let sequence = 0;
        const emit = (event) => this.onmessage?.({
          data: JSON.stringify({ ...event, generationId: "g1", seq: ++sequence }),
        });
        const emitDelta = (delta) => {
          telemetry.webSocketDeltas.push({ at: performance.now(), characters: delta.length });
          emit({
            type: "content_block_delta",
            messageId: "m1",
            blockType: "text",
            contentIndex: 0,
            delta,
          });
        };
        setTimeout(async () => {
          emit({ type: "generation_started", continuation: false, continuationBase: "" });
          emit({ type: "generation_running" });
          emit({ type: "assistant_message_started", messageId: "m1" });
          emit({ type: "content_block_started", messageId: "m1", block: { type: "text", contentIndex: 0 } });
          let finalText = "";
          for (let index = 0; index < cadence.deltas.length; index += 1) {
            const delay = cadence.delaysMs[index];
            if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
            const delta = String(cadence.deltas[index]);
            finalText += delta;
            emitDelta(delta);
          }
          emit({
            type: "content_block_completed",
            messageId: "m1",
            block: { type: "text", contentIndex: 0, text: finalText },
          });
          emit({
            type: "assistant_message_completed",
            messageId: "m1",
            blocks: [{ type: "text", contentIndex: 0, text: finalText }],
            stopReason: "stop",
            errorMessage: null,
            usage: null,
          });
          emit({ type: "generation_settled" });
          telemetry.completedAt = performance.now();
          requestAnimationFrame(() => requestAnimationFrame(() => { observing = false; }));
        }, 0);
      }
    }
    Object.defineProperty(window, "WebSocket", { configurable: true, value: HarnessWebSocket });

    class HarnessEventSource extends EventTarget {
      static CONNECTING = 0;
      static OPEN = 1;
      static CLOSED = 2;

      constructor() {
        super();
        this.readyState = HarnessEventSource.CONNECTING;
        queueMicrotask(() => {
          this.readyState = HarnessEventSource.OPEN;
          this.dispatchEvent(new Event("open"));
          this.onmessage?.({
            data: JSON.stringify({ type: "runtime_global_snapshot", processes: [], at: new Date().toISOString() }),
          });
        });
      }

      close() {
        this.readyState = HarnessEventSource.CLOSED;
      }
    }
    Object.defineProperty(window, "EventSource", { configurable: true, value: HarnessEventSource });
  }, { cadence: scenario.cadence });

  await page.route("**/v0/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const pathname = url.pathname;
    const method = request.method();
    if (pathname === "/v0/capabilities") return route.fulfill({ json: { partialContinue: true, globalRuntime: "sse" } });
    if (pathname === "/v0/templates") return route.fulfill({ json: {
      templates: [{ id: "chat", label: "General", version: 1, defaultable: true, tools: [] }],
      defaultTemplateId: "chat",
    } });
    if (pathname === "/v0/preferences") return route.fulfill({ json: { defaultTemplateId: "chat" } });
    if (pathname === "/v0/runtime/settings") return route.fulfill({ json: {
      maxLiveProcesses: 12,
      maxGeneratingProcesses: 2,
      idleProcessTtlMs: 120_000,
      liveCount: 0,
      generatingCount: 0,
    } });
    if (pathname === "/v0/runtime") return route.fulfill({ json: { type: "runtime_global_snapshot", processes: [] } });
    if (pathname === "/v0/share-origin") return route.fulfill({ json: { origin: null } });
    if (pathname === "/v0/pi-installations") return route.fulfill({ json: {
      installations: [{ id: "conduit-pinned", label: "Isolated Pi", version: "0.80.6", available: true }],
    } });
    if (pathname === "/v0/ptys") return route.fulfill({ json: { ptys: [] } });
    if (pathname === "/v0/projects") return route.fulfill({ json: { projects: [project] } });
    if (pathname === "/v0/chats" && method === "POST") return route.fulfill({ status: 201, json: {
      id: chatId,
      projectId: project.id,
      status: "draft",
      title: "New chat",
      templateId: "chat",
    } });
    if (pathname === `/v0/chats/${chatId}`) return route.fulfill({ json: {
      id: chatId,
      projectId: project.id,
      status: "draft",
      title: "New chat",
      templateId: "chat",
    } });
    if (pathname === `/v0/sessions/${chatId}`) return route.fulfill({ json: {
      id: chatId,
      projectId: project.id,
      status: "draft",
      title: "New chat",
      templateId: "chat",
      messages: [],
      tools: [],
      page: { before: null },
    } });
    if (pathname === `/v0/chats/${chatId}/attachments`) return route.fulfill({ json: { attachments: [] } });
    if (pathname === `/v0/chats/${chatId}/models`) return route.fulfill({ json: {
      installationId: "conduit-pinned",
      runtimeKind: "conduit_profile",
      models: [model],
      model: model.spec,
      thinkingLevel: "medium",
      defaultModel: model.spec,
      defaultThinkingLevel: "medium",
      requiresAuthentication: false,
      warnings: [],
      source: "jsonl",
    } });
    if (pathname === "/v0/models") return route.fulfill({ json: {
      models: [model],
      defaultModel: model.spec,
      defaultThinkingLevel: "medium",
      requiresAuthentication: false,
    } });
    if (pathname === "/v0/settings") return route.fulfill({ json: {
      models: [model],
      enabledModels: [model.spec],
      defaultModel: model.spec,
    } });
    if (pathname === "/v0/live-sessions" && method === "POST") return route.fulfill({ status: 201, json: {
      id: "live_browser_harness",
      chatId,
      streamUrl: "/v0/live-sessions/live_browser_harness/stream",
    } });
    if (pathname.endsWith("/tree")) return route.fulfill({ json: { path: "", entries: [] } });
    return route.fulfill({ status: 501, json: { error: "unhandled_browser_harness_api", method, pathname } });
  });
}

export async function runBrowserStreamingScenario(page, scenario) {
  const startedAt = new Date().toISOString();
  const browserErrors = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().startsWith("Failed to load resource:")) browserErrors.push(message.text());
  });
  page.on("response", (response) => {
    if (response.status() < 400) return;
    const request = response.request();
    browserErrors.push(`${response.status()} ${request.method()} ${new URL(response.url()).pathname}`);
  });
  await installBrowserProtocol(page, scenario);
  await page.goto("/");
  await page.getByRole("textbox", { name: "Message Pi" }).fill(scenario.prompt || `Run ${scenario.name}`);
  await page.getByRole("button", { name: "Send message" }).click();
  const expectedText = scenario.cadence.deltas.join("");
  await page.waitForFunction(() => Boolean(window.__conduitHarness?.completedAt));
  await page.waitForFunction((text) => window.__conduitHarness?.finalText === text, expectedText, {
    timeout: 5_000,
  });
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));

  const raw = await page.evaluate(() => window.__conduitHarness);
  const webSocketGaps = raw.webSocketDeltas.slice(1)
    .map((frame, index) => frame.at - raw.webSocketDeltas[index].at);
  const visibleGaps = raw.visibleIncrements.slice(1)
    .map((frame, index) => frame.at - raw.visibleIncrements[index].at);
  const frameGaps = raw.frames.slice(1).map((frame, index) => frame - raw.frames[index]);
  const scopedLongTasks = raw.longTasks.filter((entry) =>
    entry.startTime >= raw.promptAt && entry.startTime <= raw.completedAt);
  const firstVisibleAt = raw.visibleIncrements[0]?.at;
  const errors = [...browserErrors];
  if (raw.finalText !== expectedText) errors.push("Visible assistant text did not match the scripted source");

  return {
    schemaVersion: 1,
    scenario: scenario.name,
    mode: "deterministic-browser",
    target: "playwright-production-client",
    startedAt,
    seed: scenario.seed ?? null,
    outcome: errors.length ? "failed" : "passed",
    browser: {
      firstVisibleMs: firstVisibleAt == null ? null : firstVisibleAt - raw.promptAt,
      completionMs: raw.completedAt - raw.promptAt,
      webSocketDeltaCount: raw.webSocketDeltas.length,
      webSocketGapMs: summary(webSocketGaps),
      visibleIncrementCount: raw.visibleIncrements.length,
      visibleIncrementCharacters: summary(raw.visibleIncrements.map((entry) => entry.characters)),
      visibleGapMs: summary(visibleGaps),
      domMutationCount: raw.mutationCount,
      frameGapMs: summary(frameGaps),
      frameGapsOver32Ms: frameGaps.filter((gap) => gap > 32).length,
      frameGapsOver50Ms: frameGaps.filter((gap) => gap > 50).length,
      frameGapsOver100Ms: frameGaps.filter((gap) => gap > 100).length,
      longTaskCount: scopedLongTasks.length,
      longestTaskMs: Math.max(0, ...scopedLongTasks.map((entry) => entry.duration)),
      finalText: raw.finalText,
    },
    errors,
    artifacts: [],
  };
}
