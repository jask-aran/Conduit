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

function normalizeSemanticText(value) {
  return String(value ?? "").replace(/\u00a0/g, " ").replace(/\r\n?/g, "\n").trimEnd();
}

export function hashRedactedText(value) {
  // Keep this compatibility helper non-content-bearing. The browser report
  // carries a per-run salted digest; callers that only need parity compare
  // length and the structural contract.
  return { length: normalizeSemanticText(value).length };
}

function redactChangedKeys(keys = []) {
  return keys.map((key) => ({ length: String(key).length }));
}

function summarizeHarnessMetrics(metrics = []) {
  const byStage = {};
  const timingMs = {};
  const changedBlocks = new Set();
  const changedBlockLengths = new Set();
  let changedBlockEventCount = 0;
  const boundaryTypes = {};
  let katexCallCount = 0;
  const katexTimingBlockers = new Set();
  const changedRowKeys = metrics.flatMap((metric) => Array.isArray(metric.changedRowKeys) ? metric.changedRowKeys : []);
  const changedRowKeySet = new Set(changedRowKeys);
  for (const metric of metrics) {
    byStage[metric.stage] = (byStage[metric.stage] || 0) + 1;
    for (const [key, value] of Object.entries(metric)) {
      if (!key.endsWith("Ms") || typeof value !== "number") continue;
      timingMs[`${metric.stage}.${key}`] ||= [];
      timingMs[`${metric.stage}.${key}`].push(value);
    }
    if (typeof metric.changedBlock === "string") {
      changedBlockEventCount += 1;
      changedBlocks.add(metric.changedBlock);
      changedBlockLengths.add(metric.changedBlock.length);
    }
    if (metric.changeScope === "structural-boundary" && typeof metric.boundaryType === "string") {
      boundaryTypes[metric.boundaryType] = (boundaryTypes[metric.boundaryType] || 0) + 1;
    }
    if (typeof metric.katexCallCount === "number") katexCallCount += metric.katexCallCount;
    if (typeof metric.katexTimingBlocker === "string") katexTimingBlockers.add(metric.katexTimingBlocker);
  }
  return {
    count: metrics.length,
    byStage,
    timingMs: Object.fromEntries(Object.entries(timingMs).map(([key, values]) => [key, summary(values)])),
    changedBlockEventCount,
    uniqueChangedBlockCount: changedBlocks.size,
    changedBlockLengthEvidence: [...changedBlockLengths].sort((left, right) => left - right),
    structuralBoundaryTypes: boundaryTypes,
    katexCallCount,
    katexTimingBlockers: [...katexTimingBlockers],
    changedRowKeyEventCount: changedRowKeys.length,
    uniqueChangedRowKeyCount: changedRowKeySet.size,
    changedRowKeyLengthEvidence: redactChangedKeys(changedRowKeys),
  };
}

function summarizeNumbers(values) {
  const sorted = [...values].sort((left, right) => left - right);
  return {
    count: sorted.length,
    p50: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
    p99: percentile(sorted, 0.99),
    max: sorted.at(-1) ?? null,
    last: values.at(-1) ?? null,
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
  await page.addInitScript(({ cadence, reconnect, instrumentation }) => {
    const fixtureText = (cadence?.deltas || []).join("");
    const inputFeatures = {
      unsafeElement: /<(?:script|style|iframe|object|embed)\b/i.test(fixtureText),
      unsafeProtocol: /(?:javascript|vbscript|data|file|irc):/i.test(fixtureText),
      image: /!\[[^\]]*\]\([^)]*\)/.test(fixtureText),
      externalLink: /\[[^\]]+\]\(https?:\/\/[^)]+\)/i.test(fixtureText),
      fencedCode: /```/.test(fixtureText),
      katex: /\$(?:\$?)[^\n]+\$(?:\$?)/.test(fixtureText),
    };
    const runSalt = (() => {
      const bytes = new Uint32Array(2);
      crypto.getRandomValues(bytes);
      return `${bytes[0].toString(16)}:${bytes[1].toString(16)}`;
    })();
    const telemetry = {
      instrumentationEnabled: instrumentation !== false,
      enabled: instrumentation !== false,
      promptAt: null,
      completedAt: null,
      webSocketDeltas: [],
      visibleIncrements: [],
      mutationCount: 0,
      mutationCategories: {},
      frames: [],
      longTasks: [],
      metrics: [],
      scrollSamples: [],
      scrollEvents: 0,
      scrollWrites: 0,
      identity: { first: null, last: null },
      finalFingerprint: null,
      finalSemanticShape: null,
      finalSecurity: null,
      sourceDigest: null,
      finalSemanticTextDigest: null,
      clipboardWrites: [],
      inputFeatures,
      finalText: "",
      finalSemanticText: "",
      socketCount: 0,
      resumeCount: 0,
      disconnectedAt: null,
      resumedAt: null,
      record(metric) {
        this.metrics.push(metric);
      },
    };
    Object.defineProperty(window, "__conduitHarness", { configurable: true, value: telemetry });
    try {
      const clipboard = navigator.clipboard;
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
          ...(clipboard || {}),
          writeText(value) {
            telemetry.clipboardWrites.push(String(value));
            return Promise.resolve();
          },
        },
      });
    } catch {
      // Clipboard is optional in the browser harness; the interaction check
      // reports the unavailable control rather than exposing code text.
    }

    const digestText = (value) => {
      const text = String(value ?? "").replace(/\u00a0/g, " ").replace(/\r\n?/g, "\n");
      let hash = 2166136261;
      const salted = `${runSalt}:${text}`;
      for (let index = 0; index < salted.length; index += 1) {
        hash ^= salted.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
      }
      return `salted:${(hash >>> 0).toString(16).padStart(8, "0")}`;
    };
    const textFingerprint = (value) => ({ digest: digestText(value), length: String(value ?? "").length });
    telemetry.sourceDigest = digestText(fixtureText);
    const behaviorAttributes = new Set([
      "aria-label", "class", "data-copy-code", "data-external-url", "data-language",
      "data-markdown", "href", "role", "target", "rel", "type",
    ]);
    const safeAttribute = (attribute) => {
      const value = attribute.value;
      if (attribute.name === "href" || attribute.name === "data-external-url") {
        try {
          const target = new URL(value, location.href);
          return { protocol: target.protocol, origin: target.origin === location.origin ? "same-origin" : "external" };
        } catch {
          return { protocol: "invalid", origin: "invalid" };
        }
      }
      if (attribute.name === "aria-label") return textFingerprint(value);
      if (attribute.name === "class") return value.split(/\s+/).filter(Boolean).sort();
      if (attribute.name === "data-copy-code") return true;
      return value;
    };
    const fingerprint = (node, state = { count: 0 }) => {
      if (state.count >= 1000) return { type: "…", truncated: true };
      state.count += 1;
      if (node.nodeType === Node.TEXT_NODE) return { type: "#text", text: textFingerprint(node.nodeValue || "") };
      if (node.nodeType !== Node.ELEMENT_NODE) return { type: `#${node.nodeType}` };
      const element = node;
      const attributes = {};
      for (const attribute of [...element.attributes].filter((entry) => behaviorAttributes.has(entry.name)).sort((left, right) => left.name.localeCompare(right.name))) {
        attributes[attribute.name] = safeAttribute(attribute);
      }
      return {
        type: element.tagName.toLowerCase(),
        attributes,
        children: [...element.childNodes].map((child) => fingerprint(child, state)),
      };
    };
    const nodeIds = new WeakMap();
    let nextNodeId = 1;
    const identityOf = (node) => {
      if (!node) return null;
      let id = nodeIds.get(node);
      if (!id) {
        id = nextNodeId;
        nextNodeId += 1;
        nodeIds.set(node, id);
      }
      return id;
    };
    const semanticSelectors = {
      heading: "h1, h2, h3",
      list: "ul, ol",
      table: "table",
      code: ".artifact",
      math: ".katex",
      link: "a, .external-markdown-link",
    };
    const markdownRoot = () => [...document.querySelectorAll(".chat-markdown")].at(-1) || null;
    const semanticShape = (root) => ({
      rootType: root?.tagName?.toLowerCase() || null,
      semanticCounts: Object.fromEntries(Object.entries(semanticSelectors).map(([category, selector]) => [category, root?.querySelectorAll(selector).length || 0])),
    });
    const securityAssertions = (root) => {
      if (!root) return null;
      const unsafeElements = root.querySelectorAll("script, style, iframe, object, embed, img").length;
      let unsafeProtocols = 0;
      for (const element of root.querySelectorAll("a[href], [data-external-url]")) {
        const value = element.getAttribute("href") || element.getAttribute("data-external-url") || "";
        try {
          if (!["http:", "https:", "mailto:"].includes(new URL(value, location.href).protocol)) unsafeProtocols += 1;
        } catch {
          unsafeProtocols += 1;
        }
      }
      const externalButtons = [...root.querySelectorAll(".external-markdown-link")];
      const anchors = [...root.querySelectorAll("a[href]")];
      const artifacts = [...root.querySelectorAll(".artifact")];
      const codeCopyButtons = artifacts.filter((artifact) => artifact.querySelector("button[data-copy-code]"));
      return {
        unsafeElementsAbsent: unsafeElements === 0,
        unsafeElementCount: unsafeElements,
        unsafeElementInputPresent: telemetry.inputFeatures.unsafeElement,
        unsafeProtocolsAbsent: unsafeProtocols === 0,
        unsafeProtocolCount: unsafeProtocols,
        unsafeProtocolInputPresent: telemetry.inputFeatures.unsafeProtocol,
        imagesRemoved: !telemetry.inputFeatures.image || root.querySelectorAll("img").length === 0,
        imageInputPresent: telemetry.inputFeatures.image,
        externalLinkConfirmation: externalButtons.length > 0 && externalButtons.every((button) => button.tagName === "BUTTON" && button.hasAttribute("data-external-url") && !button.hasAttribute("href")),
        externalLinkButtonCount: externalButtons.length,
        externalLinkInputPresent: telemetry.inputFeatures.externalLink,
        internalLinkCount: anchors.length,
        katexNodeCount: root.querySelectorAll(".katex").length,
        katexRendered: root.querySelectorAll(".katex").length > 0,
        katexInputPresent: telemetry.inputFeatures.katex,
        fencedCodeCount: artifacts.length,
        fencedCodeInputPresent: telemetry.inputFeatures.fencedCode,
        fencedCodeCopyControls: artifacts.length > 0 && codeCopyButtons.length === artifacts.length,
        artifactControlsPresent: artifacts.length > 0 && artifacts.every((artifact) => artifact.querySelector(".artifact-header")),
      };
    };
    const captureDomState = () => {
      const root = markdownRoot();
      if (!root) return;
      const semantic = {};
      for (const [category, selector] of Object.entries(semanticSelectors)) {
        semantic[category] = [...root.querySelectorAll(selector)].map((element) => identityOf(element));
      }
      const snapshot = { outerId: identityOf(root), outerConnected: root.isConnected, semantic };
      if (!telemetry.identity.first) telemetry.identity.first = snapshot;
      telemetry.identity.last = snapshot;
      telemetry.finalFingerprint = fingerprint(root);
      telemetry.finalSemanticShape = semanticShape(root);
      telemetry.finalSecurity = securityAssertions(root);
    };
    telemetry.captureDomState = captureDomState;
    telemetry.readCorrectness = () => {
      const root = markdownRoot();
      const value = String(root?.textContent || "").replace(/\u00a0/g, " ").replace(/\r\n?/g, "\n").trimEnd();
      telemetry.finalText = value;
      telemetry.finalSemanticText = value;
      telemetry.finalSemanticTextDigest = digestText(value);
      captureDomState();
    };
    const targetCategory = (target) => {
      const element = target.nodeType === Node.ELEMENT_NODE ? target : target.parentElement;
      if (element?.closest?.(".chat-markdown")) return "markdown";
      if (element?.closest?.('[data-slot="message-scroller-viewport"]')) return "scroll";
      if (element?.closest?.(".transcript")) return "transcript";
      return "other";
    };
    const inPromptWindow = (at = performance.now()) => telemetry.promptAt != null
      && (telemetry.completedAt == null || at <= telemetry.completedAt);
    const isTranscriptViewport = (node) => node instanceof Element
      && node.matches('[data-slot="message-scroller-viewport"]');
    const sampleScroll = (at = performance.now()) => {
      if (!inPromptWindow(at)) return;
      const viewport = document.querySelector('[data-slot="message-scroller-viewport"]');
      if (!viewport) return;
      telemetry.scrollSamples.push({
        at,
        distanceFromBottom: Math.max(0, viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight),
        scrollTop: viewport.scrollTop,
        scrollHeight: viewport.scrollHeight,
        clientHeight: viewport.clientHeight,
      });
    };
    telemetry.startScrollProbe = () => {
      const attempt = () => {
        const viewport = document.querySelector('[data-slot="message-scroller-viewport"]');
        if (!inPromptWindow()) return;
        if (!viewport) {
          setTimeout(attempt, 10);
          return;
        }
        viewport.scrollTop = Math.max(0, viewport.scrollHeight - viewport.clientHeight - 24);
        setTimeout(() => {
          if (inPromptWindow()) viewport.scrollTop = viewport.scrollHeight;
        }, 10);
      };
      attempt();
      return true;
    };
    if (telemetry.instrumentationEnabled) {
      const scrollPrototype = [Element.prototype, HTMLElement.prototype].find((prototype) => Object.getOwnPropertyDescriptor(prototype, "scrollTop"));
      const scrollDescriptor = scrollPrototype && Object.getOwnPropertyDescriptor(scrollPrototype, "scrollTop");
      if (scrollPrototype && scrollDescriptor?.set) {
        try {
          Object.defineProperty(scrollPrototype, "scrollTop", {
            configurable: scrollDescriptor.configurable,
            enumerable: scrollDescriptor.enumerable,
            get: scrollDescriptor.get,
            set(value) {
              if (inPromptWindow() && isTranscriptViewport(this)) telemetry.scrollWrites += 1;
              scrollDescriptor.set.call(this, value);
            },
          });
        } catch {
          telemetry.scrollWriteInstrumentation = "unavailable";
        }
      }
    }

    let observing = true;
    let observerRetry = null;
    const finishObservation = () => {
      observing = false;
      if (observerRetry != null) clearTimeout(observerRetry);
      observerRetry = null;
    };
    const frame = (now) => {
      if (telemetry.promptAt != null && observing) {
        telemetry.frames.push(now);
        sampleScroll();
      }
      if (observing && telemetry.instrumentationEnabled) requestAnimationFrame(frame);
    };
    if (telemetry.instrumentationEnabled) requestAnimationFrame(frame);

    try {
      if (!telemetry.instrumentationEnabled) throw new Error("measurement_disabled");
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) telemetry.longTasks.push({ startTime: entry.startTime, duration: entry.duration });
      }).observe({ type: "longtask", buffered: true });
    } catch {
      // Long Task API is optional; an empty collection remains valid evidence.
    }

    addEventListener("DOMContentLoaded", () => {
      let visibleText = "";
      const normalizeSemanticText = (value) => String(value ?? "")
        .replace(/\u00a0/g, " ")
        .replace(/\r\n?/g, "\n")
        .trimEnd();
      const updateVisibleText = () => {
        if (telemetry.promptAt == null) return;
        const markdown = markdownRoot();
        const nextText = normalizeSemanticText(markdown?.textContent || "");
        if (nextText === visibleText) return;
        telemetry.visibleIncrements.push({
          at: performance.now(),
          characters: Math.max(0, nextText.length - visibleText.length),
          totalCharacters: nextText.length,
        });
        visibleText = nextText;
        telemetry.finalText = nextText;
        telemetry.finalSemanticText = nextText;
      };
      if (telemetry.instrumentationEnabled) {
        const observer = new MutationObserver((records) => {
          if (!records.length || telemetry.promptAt == null) return;
          for (const record of records) {
            const category = `${record.type}:${targetCategory(record.target)}`;
            telemetry.mutationCategories[category] = (telemetry.mutationCategories[category] || 0) + 1;
            telemetry.mutationCount += 1;
            telemetry.mutationCategories[`${category}:added`] = (telemetry.mutationCategories[`${category}:added`] || 0) + record.addedNodes.length;
            telemetry.mutationCategories[`${category}:removed`] = (telemetry.mutationCategories[`${category}:removed`] || 0) + record.removedNodes.length;
          }
          captureDomState();
          updateVisibleText();
        });
        const attachObserver = () => {
          if (!observing) return;
          const transcript = document.querySelector(".transcript");
          if (transcript) observer.observe(transcript, { subtree: true, childList: true, characterData: true, attributes: true });
          else observerRetry = setTimeout(attachObserver, 10);
        };
        attachObserver();
        const attachScrollListener = () => {
          const viewport = document.querySelector('[data-slot="message-scroller-viewport"]');
          if (!viewport) {
            observerRetry = setTimeout(attachScrollListener, 10);
            return;
          }
          viewport.addEventListener("scroll", () => {
            const at = performance.now();
            if (!inPromptWindow(at)) return;
            telemetry.scrollEvents += 1;
            sampleScroll(at);
          }, { passive: true });
        };
        attachScrollListener();
      }
      captureDomState();
    }, { once: true });

    class HarnessWebSocket extends EventTarget {
      static OPEN = 1;

      constructor() {
        super();
        this.readyState = 0;
        telemetry.socketCount += 1;
        this.instanceNumber = telemetry.socketCount;
        queueMicrotask(() => {
          this.readyState = HarnessWebSocket.OPEN;
          this.dispatchEvent(new Event("open"));
          if (reconnect && telemetry.socketCount === 2) {
            const generation = {
              id: "g1",
              status: "running",
              assistantMessages: [{
                id: "m1",
                status: "streaming",
                stopReason: null,
                errorMessage: null,
                blocks: [{
                  type: "text",
                  contentIndex: 0,
                  identity: "g1:m1:0",
                  status: "streaming",
                  text: reconnect.initialText,
                }],
              }],
              toolExecutions: {},
              retry: null,
              error: null,
              lastSeq: 4,
            };
            telemetry.resumeCount += 1;
            telemetry.resumedAt = performance.now();
            this.emit({ type: "generation_resume", generationId: "g1", seq: 4, generation });
            setTimeout(() => {
              this.emit({
                type: "content_block_delta",
                generationId: "g1",
                seq: 5,
                messageId: "m1",
                blockType: "text",
                contentIndex: 0,
                delta: reconnect.recoveredDelta,
              });
              const finalText = reconnect.initialText + reconnect.recoveredDelta;
              this.emit({
                type: "content_block_completed",
                generationId: "g1",
                seq: 6,
                messageId: "m1",
                block: { type: "text", contentIndex: 0, text: finalText },
              });
              this.emit({
                type: "assistant_message_completed",
                generationId: "g1",
                seq: 7,
                messageId: "m1",
                blocks: [{ type: "text", contentIndex: 0, text: finalText }],
                stopReason: "stop",
                errorMessage: null,
                usage: null,
              });
              this.emit({ type: "generation_settled", generationId: "g1", seq: 8 });
              telemetry.completedAt = performance.now();
              if (telemetry.instrumentationEnabled) requestAnimationFrame(() => requestAnimationFrame(finishObservation));
              else setTimeout(finishObservation, 50);
            }, reconnect.recoveredDelayMs);
          }
        });
      }

      emit(event) {
        this.onmessage?.({ data: JSON.stringify(event) });
      }

      close() {
        if (this.readyState === 3) return;
        this.readyState = 3;
        this.dispatchEvent(new Event("close"));
      }

      send(raw) {
        const command = JSON.parse(String(raw));
        if (command.type !== "prompt") return;
        telemetry.promptAt = performance.now();
        if (reconnect && this.instanceNumber === 1) {
          queueMicrotask(() => {
            this.emit({ type: "generation_started", generationId: "g1", seq: 1 });
            this.emit({ type: "assistant_message_started", generationId: "g1", seq: 2, messageId: "m1" });
            this.emit({
              type: "content_block_started",
              generationId: "g1",
              seq: 3,
              messageId: "m1",
              block: { type: "text", contentIndex: 0 },
            });
            this.emit({
              type: "content_block_delta",
              generationId: "g1",
              seq: 4,
              messageId: "m1",
              blockType: "text",
              contentIndex: 0,
              delta: reconnect.initialText,
            });
            telemetry.disconnectedAt = performance.now();
            this.close();
          });
          return;
        }
        if (reconnect) return;
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
          if (telemetry.instrumentationEnabled) requestAnimationFrame(() => requestAnimationFrame(finishObservation));
          else setTimeout(finishObservation, 50);
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
  }, {
    cadence: scenario.cadence || { delaysMs: [], deltas: [] },
    reconnect: scenario.reconnect || null,
    instrumentation: scenario.instrumentation !== false,
  });

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

async function runInteractionAssertions(page, expected = {}) {
  const result = await page.evaluate(() => {
    const root = [...document.querySelectorAll(".chat-markdown")].at(-1);
    if (!root) return { copyCode: false, externalLinkConfirmation: false, externalLinkButtonCount: 0, codeBlockCount: 0, scrollViewportPresent: false };
    const artifacts = [...root.querySelectorAll(".artifact")];
    const externalLinks = [...root.querySelectorAll(".external-markdown-link")];
    return {
      copyCode: false,
      codeBlockCount: artifacts.length,
      externalLinkButtonCount: externalLinks.length,
      externalLinkConfirmation: externalLinks.length > 0 && externalLinks
        .every((button) => button.tagName === "BUTTON" && button.getAttribute("type") === "button" && button.hasAttribute("data-external-url")),
      scrollViewportPresent: Boolean(document.querySelector('[data-slot="message-scroller-viewport"]')),
    };
  });
  if (expected.copyCode) {
    const artifact = page.locator(".chat-markdown .artifact").first();
    const button = artifact.locator("button[data-copy-code]");
    if (await button.count() > 0) {
      const code = await artifact.locator("code").textContent() || "";
      await button.click();
      const clipboard = await page.evaluate(() => window.__conduitHarness?.clipboardWrites || []);
      result.copyCode = clipboard.includes(code);
      result.clipboardWriteCount = clipboard.length;
      result.clipboardOutputLength = code.length;
    } else {
      result.clipboardWriteCount = 0;
      result.clipboardOutputLength = 0;
    }
  }
  if (expected.externalLinkConfirmation) {
    const external = page.locator(".external-markdown-link").first();
    if (await external.count() === 0) {
      result.externalLinkConfirmation = false;
    } else {
      await external.click();
      const dialog = page.getByRole("alertdialog", { name: "Open external link?" });
      result.externalLinkConfirmation = await dialog.isVisible().catch(() => false);
      if (await dialog.count()) await dialog.getByRole("button", { name: "Cancel" }).click().catch(() => {});
    }
  }
  result.scrollViewport = result.scrollViewportPresent;
  return result;
}

function redactFingerprint(fingerprint) {
  if (!fingerprint || typeof fingerprint !== "object") return fingerprint;
  if (fingerprint.type === "#text") return { type: "#text", text: fingerprint.text };
  if (fingerprint.type === "…") return fingerprint;
  return {
    type: fingerprint.type,
    attributes: fingerprint.attributes,
    children: Array.isArray(fingerprint.children) ? fingerprint.children.map(redactFingerprint) : [],
  };
}

function fingerprintTruncated(fingerprint) {
  if (!fingerprint || typeof fingerprint !== "object") return false;
  if (fingerprint.type === "…" || fingerprint.truncated === true) return true;
  return Array.isArray(fingerprint.children) && fingerprint.children.some(fingerprintTruncated);
}

function fingerprintMatches(actual, expected, semanticShape) {
  if (!expected || typeof expected !== "object") return false;
  if (expected.type && actual?.type !== expected.type) return false;
  if (expected.attributes) {
    for (const [name, value] of Object.entries(expected.attributes)) {
      if (JSON.stringify(actual?.attributes?.[name]) !== JSON.stringify(value)) return false;
    }
  }
  if (expected.requiredNodeCounts) {
    for (const [category, count] of Object.entries(expected.requiredNodeCounts)) {
      if (semanticShape?.semanticCounts?.[category] !== count) return false;
    }
  }
  if (expected.text) {
    if (actual?.type !== "#text") return false;
    if (expected.text.length != null && actual.text?.length !== expected.text.length) return false;
    if (expected.text.digest && actual.text?.digest !== expected.text.digest) return false;
  }
  if (Array.isArray(expected.children)) {
    if (!Array.isArray(actual?.children) || actual.children.length !== expected.children.length) return false;
    return expected.children.every((child, index) => fingerprintMatches(actual.children[index], child, semanticShape));
  }
  return true;
}

function identityReport(identity) {
  const first = identity?.first || null;
  const last = identity?.last || null;
  const semantic = {};
  for (const category of new Set([
    ...Object.keys(first?.semantic || {}),
    ...Object.keys(last?.semantic || {}),
  ])) {
    const firstIds = first?.semantic?.[category] || [];
    const lastIds = last?.semantic?.[category] || [];
    semantic[category] = {
      firstCount: firstIds.length,
      finalCount: lastIds.length,
      persistentCount: firstIds.filter((id) => lastIds.includes(id)).length,
      firstIds,
      finalIds: lastIds,
    };
  }
  return {
    outer: {
      firstId: first?.outerId ?? null,
      finalId: last?.outerId ?? null,
      persistent: first?.outerId != null && first?.outerId === last?.outerId,
      finalConnected: Boolean(last?.outerConnected),
    },
    semantic,
  };
}

function expectedAssertionErrors(expected, security, interactions, inputFeatures) {
  const requiredInput = {
    unsafeElementsAbsent: "unsafeElement",
    unsafeProtocolsAbsent: "unsafeProtocol",
    imagesRemoved: "image",
    externalLinkConfirmation: "externalLink",
    katexNodeCount: "katex",
    katexRendered: "katex",
    fencedCodeCopyControls: "fencedCode",
    artifactControlsPresent: "fencedCode",
    copyCode: "fencedCode",
  };
  const errors = [];
  for (const [key, value] of Object.entries(expected || {})) {
    if (value !== true) continue;
    const feature = requiredInput[key];
    if (feature && !inputFeatures?.[feature]) {
      errors.push(`Expected browser assertion requires fixture input: ${key}`);
      continue;
    }
    if (security?.[key] !== true && interactions?.[key] !== true) errors.push(`Expected browser assertion failed: ${key}`);
    if (value === true && ["externalLinkConfirmation", "katexNodeCount", "katexRendered", "fencedCodeCopyControls", "artifactControlsPresent"].includes(key)) {
      const count = key.startsWith("katex") ? security?.katexNodeCount : key === "externalLinkConfirmation" ? security?.externalLinkButtonCount : security?.fencedCodeCount;
      if (!(Number(count) > 0)) errors.push(`Expected browser assertion produced no ${key} control or node`);
    }
  }
  return errors;
}

function expectedInteractionErrors(expected, interactions, inputFeatures) {
  const requiredInput = { copyCode: "fencedCode", externalLinkConfirmation: "externalLink" };
  const errors = [];
  for (const [key, value] of Object.entries(expected || {})) {
    if (value !== true) continue;
    const feature = requiredInput[key];
    if (feature && !inputFeatures?.[feature]) {
      errors.push(`Expected browser interaction requires fixture input: ${key}`);
      continue;
    }
    if (interactions?.[key] !== true) errors.push(`Expected browser interaction failed: ${key}`);
  }
  return errors;
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
  const sourceText = scenario.cadence.deltas.join("");
  const expectedSemanticText = scenario.expectedSemanticText == null
    ? null
    : normalizeSemanticText(scenario.expectedSemanticText);
  if (scenario.scrollProbe) await page.evaluate(() => window.__conduitHarness?.startScrollProbe?.());
  await page.waitForFunction(() => Boolean(window.__conduitHarness?.completedAt));
  await page.evaluate(() => window.__conduitHarness?.readCorrectness?.());
  if (expectedSemanticText != null) {
    await page.waitForFunction((text) => window.__conduitHarness?.finalSemanticText === text, expectedSemanticText, { timeout: 5_000 });
  }
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await page.evaluate(() => window.__conduitHarness?.captureDomState?.());
  const interactionAssertions = await runInteractionAssertions(page, scenario.expectedInteractions);
  const runtime = await page.evaluate(() => ({ userAgent: navigator.userAgent, platform: navigator.platform }));

  const raw = await page.evaluate(() => window.__conduitHarness);
  const webSocketGaps = raw.webSocketDeltas.slice(1)
    .map((frame, index) => frame.at - raw.webSocketDeltas[index].at);
  const visibleGaps = raw.visibleIncrements.slice(1)
    .map((frame, index) => frame.at - raw.visibleIncrements[index].at);
  const frameGaps = raw.frames.slice(1).map((frame, index) => frame - raw.frames[index]);
  const scopedLongTasks = raw.longTasks.filter((entry) =>
    entry.startTime <= raw.completedAt && entry.startTime + entry.duration >= raw.promptAt);
  const scopedMetrics = raw.metrics.filter((entry) =>
    typeof entry.at === "number" && entry.at >= raw.promptAt && entry.at <= raw.completedAt);
  const firstVisibleAt = raw.visibleIncrements[0]?.at;
  const expectedFingerprint = scenario.expectedSemanticFingerprint || null;
  const errors = [...browserErrors];
  if (scenario.fixture && scenario.requiresStructuralContract && !expectedFingerprint) errors.push("Named fixture is missing a structural fingerprint contract");
  if (scenario.fixture && scenario.requiresStructuralContract && scenario.expectedAssertions == null) errors.push("Named fixture is missing explicit security assertions");
  if (expectedSemanticText != null && raw.finalSemanticText !== expectedSemanticText) errors.push("Visible semantic text did not match the expected fixture text");
  const structuralFingerprint = redactFingerprint(raw.finalFingerprint);
  if (fingerprintTruncated(structuralFingerprint)) errors.push("Structural fingerprint exceeded the redaction node budget");
  const structuralMatch = expectedFingerprint == null
    ? null
    : fingerprintMatches(structuralFingerprint, expectedFingerprint, raw.finalSemanticShape);
  if (structuralMatch === false) errors.push("Rendered structural fingerprint did not match the expected fixture");
  const securityAssertions = raw.finalSecurity || {};
  errors.push(...expectedAssertionErrors(scenario.expectedAssertions, securityAssertions, interactionAssertions, raw.inputFeatures));
  errors.push(...expectedInteractionErrors(scenario.expectedInteractions, interactionAssertions, raw.inputFeatures));

  return {
    schemaVersion: 1,
    scenario: scenario.name,
    mode: "deterministic-browser",
    target: "playwright-production-client",
    startedAt,
    metadata: {
      commit: process.env.CONDUIT_RELEASE || "working-tree",
      profile: scenario.profile || "fixed",
      runtime,
      command: "npm run test:harness:browser",
    },
    seed: scenario.seed ?? null,
    outcome: errors.length ? "failed" : "passed",
    browser: {
      sourceCharacters: sourceText.length,
      sourceDeltaCount: scenario.cadence.deltas.length,
      sourceEvidence: { length: sourceText.length, digest: raw.sourceDigest || null },
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
      finalSemanticTextEvidence: { length: normalizeSemanticText(raw.finalSemanticText).length, digest: raw.finalSemanticTextDigest || null },
      finalSemanticTextLength: normalizeSemanticText(raw.finalSemanticText).length,
      structuralFingerprint,
      semanticShape: raw.finalSemanticShape,
      structuralMatch,
      inputFeatures: raw.inputFeatures,
      securityAssertions,
      interactionAssertions,
      mutationCategories: raw.mutationCategories,
      identity: identityReport(raw.identity),
      scroll: {
        distanceFromBottom: summarizeNumbers(raw.scrollSamples.map((sample) => sample.distanceFromBottom)),
        finalDistanceFromBottom: raw.scrollSamples.at(-1)?.distanceFromBottom ?? null,
        scrollEventCount: raw.scrollEvents,
        programmaticWriteCount: raw.scrollWrites,
      },
      instrumentation: {
        enabled: Boolean(raw.instrumentationEnabled),
        metricCount: scopedMetrics.length,
        correctnessRead: raw.instrumentationEnabled ? null : "one final DOM text read after completion; read cost excluded from timing",
      },
      limitations: {
        katexTiming: "Measured by wrapping marked-katex-extension's katex.renderToString; clientWork reports katexCallCount and markdown-render.katexMs. A zero call count means the fixture did not invoke the extension.",
      },
      clientWork: summarizeHarnessMetrics(scopedMetrics),
    },
    errors,
    artifacts: [],
  };
}

export async function runBrowserReconnectScenario(page, scenario) {
  const startedAt = new Date().toISOString();
  const browserErrors = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().startsWith("Failed to load resource:")) browserErrors.push(message.text());
  });
  await installBrowserProtocol(page, {
    cadence: { deltas: [scenario.initialText, scenario.recoveredDelta], delaysMs: [] },
    reconnect: {
      initialText: scenario.initialText,
      recoveredDelta: scenario.recoveredDelta,
      recoveredDelayMs: scenario.recoveredDelayMs ?? 20,
    },
    instrumentation: scenario.instrumentation !== false,
  });
  await page.goto("/");
  await page.getByRole("textbox", { name: "Message Pi" }).fill(scenario.prompt || `Run ${scenario.name}`);
  await page.getByRole("button", { name: "Send message" }).click();
  const expectedText = scenario.initialText + scenario.recoveredDelta;
  await page.waitForFunction(() => window.__conduitHarness?.socketCount === 2);
  await page.waitForFunction(() => Boolean(window.__conduitHarness?.completedAt), { timeout: 5_000 });
  await page.evaluate(() => window.__conduitHarness?.readCorrectness?.());
  await page.evaluate(() => window.__conduitHarness?.captureDomState?.());
  const interactionAssertions = await runInteractionAssertions(page, scenario.expectedInteractions);
  const runtime = await page.evaluate(() => ({ userAgent: navigator.userAgent, platform: navigator.platform }));

  const raw = await page.evaluate(() => window.__conduitHarness);
  const renderedCharacters = raw.visibleIncrements
    .reduce((total, increment) => total + increment.characters, 0);
  const scopedMetrics = raw.metrics.filter((entry) => entry.at >= raw.promptAt && entry.at <= raw.completedAt);
  const errors = [...browserErrors];
  if (scenario.fixture && scenario.requiresStructuralContract && !scenario.expectedSemanticFingerprint) errors.push("Named fixture is missing a structural fingerprint contract");
  if (scenario.fixture && scenario.requiresStructuralContract && scenario.expectedAssertions == null) errors.push("Named fixture is missing explicit security assertions");
  if (raw.finalSemanticText !== normalizeSemanticText(expectedText)) errors.push("Visible semantic text did not converge after reconnect");
  if (raw.socketCount !== 2) errors.push(`Expected two sockets, observed ${raw.socketCount}`);
  if (raw.resumeCount !== 1) errors.push(`Expected one generation resume, observed ${raw.resumeCount}`);
  const structuralFingerprint = redactFingerprint(raw.finalFingerprint);
  if (fingerprintTruncated(structuralFingerprint)) errors.push("Structural fingerprint exceeded the redaction node budget");
  const structuralMatch = scenario.expectedSemanticFingerprint == null
    ? null
    : fingerprintMatches(structuralFingerprint, scenario.expectedSemanticFingerprint, raw.finalSemanticShape);
  if (structuralMatch === false) errors.push("Rendered structural fingerprint did not match the expected fixture");
  const securityAssertions = raw.finalSecurity || {};
  errors.push(...expectedAssertionErrors(scenario.expectedAssertions, securityAssertions, interactionAssertions, raw.inputFeatures));
  errors.push(...expectedInteractionErrors(scenario.expectedInteractions, interactionAssertions, raw.inputFeatures));

  return {
    schemaVersion: 1,
    scenario: scenario.name,
    mode: "deterministic-browser-reconnect",
    target: "playwright-production-client",
    startedAt,
    metadata: {
      commit: process.env.CONDUIT_RELEASE || "working-tree",
      profile: "reconnect",
      runtime,
      command: "npm run test:harness:browser",
    },
    outcome: errors.length ? "failed" : "passed",
    browser: {
      sourceCharacters: expectedText.length,
      sourceDeltaCount: 2,
      sourceEvidence: { length: expectedText.length, digest: raw.sourceDigest || null },
      socketCount: raw.socketCount,
      resumeCount: raw.resumeCount,
      recoveryMs: raw.resumedAt - raw.disconnectedAt,
      finalSemanticTextEvidence: { length: normalizeSemanticText(raw.finalSemanticText).length, digest: raw.finalSemanticTextDigest || null },
      finalSemanticTextLength: normalizeSemanticText(raw.finalSemanticText).length,
      structuralFingerprint,
      semanticShape: raw.finalSemanticShape,
      structuralMatch,
      inputFeatures: raw.inputFeatures,
      securityAssertions,
      interactionAssertions,
      mutationCategories: raw.mutationCategories,
      identity: identityReport(raw.identity),
      scroll: {
        distanceFromBottom: summarizeNumbers(raw.scrollSamples.map((sample) => sample.distanceFromBottom)),
        finalDistanceFromBottom: raw.scrollSamples.at(-1)?.distanceFromBottom ?? null,
        scrollEventCount: raw.scrollEvents,
        programmaticWriteCount: raw.scrollWrites,
      },
      instrumentation: {
        enabled: Boolean(raw.instrumentationEnabled),
        metricCount: scopedMetrics.length,
        correctnessRead: raw.instrumentationEnabled ? null : "one final DOM text read after completion; read cost excluded from timing",
      },
      clientWork: summarizeHarnessMetrics(scopedMetrics),
      duplicateCharacters: Math.max(0, renderedCharacters - expectedText.length),
    },
    errors,
    artifacts: [],
  };
}
