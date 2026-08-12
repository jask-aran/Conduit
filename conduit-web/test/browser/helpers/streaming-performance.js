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
  const rendererByStage = {};
  const rendererTimingMs = {};
  const rendererCounters = {};
  const rendererParserModes = {};
  const rendererIncrementalModes = {};
  const typewriterSamples = [];
  const typewriterTerminalSamples = [];
  const typewriterSteadyStateSamples = [];
  const transcriptScrollSamples = [];
  const changedBlocks = new Set();
  const changedBlockLengths = new Set();
  const projectionModes = {};
  let changedBlockEventCount = 0;
  const boundaryTypes = {};
  let katexCallCount = 0;
  const katexSourceLengths = [];
  const katexHtmlLengths = [];
  const katexTimes = [];
  const katexTimingBlockers = new Set();
  const changedRowKeys = metrics.flatMap((metric) => Array.isArray(metric.changedRowKeys) ? metric.changedRowKeys : []);
  const changedRowKeySet = new Set(changedRowKeys);
  const incrementalResetEvidence = [];
  const tableAstTransitions = [];
  let lastTableAstSignature = null;
  for (const metric of metrics) {
    byStage[metric.stage] = (byStage[metric.stage] || 0) + 1;
    const renderer = typeof metric.renderer === "string" ? metric.renderer : null;
    if (renderer) {
      rendererByStage[renderer] ||= {};
      rendererByStage[renderer][metric.stage] = (rendererByStage[renderer][metric.stage] || 0) + 1;
      for (const key of ["pendingBlockCount", "completedBlockCount", "updatedBlockCount", "katexCallCount"]) {
        if (typeof metric[key] !== "number") continue;
        rendererCounters[`${renderer}.${key}`] ||= [];
        rendererCounters[`${renderer}.${key}`].push(metric[key]);
      }
      if (typeof metric.parserMode === "string") {
        rendererParserModes[renderer] ||= {};
        rendererParserModes[renderer][metric.parserMode] = (rendererParserModes[renderer][metric.parserMode] || 0) + 1;
      }
      if (typeof metric.incrementalMode === "string") {
        rendererIncrementalModes[renderer] ||= {};
        rendererIncrementalModes[renderer][metric.incrementalMode] = (rendererIncrementalModes[renderer][metric.incrementalMode] || 0) + 1;
        if (metric.incrementalMode.startsWith("full-reset") && incrementalResetEvidence.length < 64) {
          incrementalResetEvidence.push({
            renderer,
            mode: metric.incrementalMode,
            sourceCharacters: metric.sourceCharacters,
            markdownSourceCharacters: metric.markdownSourceCharacters,
            previousRenderedMarkdownSourceCharacters: metric.previousRenderedMarkdownSourceCharacters,
            renderedMarkdownSourceCharacters: metric.renderedMarkdownSourceCharacters,
            stableTokenCount: metric.stableTokenCount,
            previousStableTokenCount: metric.previousStableTokenCount,
            tailTokenCount: metric.tailTokenCount,
            previousTailTokenCount: metric.previousTailTokenCount,
            sourceAppended: metric.sourceAppended,
            firstSourceMismatchIndex: metric.firstSourceMismatchIndex,
            stablePrefixUnchanged: metric.stablePrefixUnchanged,
          });
        }
      }
    }
    if (metric.stage === "markdown-typewriter") {
      typewriterSamples.push(metric);
      if (metric.terminal === true) typewriterTerminalSamples.push(metric);
      if (metric.sourceVisibleCharacters >= 500 && metric.displayedVisibleCharacters > 0) {
        typewriterSteadyStateSamples.push(metric);
      }
    }
    if (metric.stage === "transcript-scroll" && metric.owner === "typewriter-tail-inertial") {
      transcriptScrollSamples.push(metric);
    }
    if (metric.renderer?.startsWith("incremark") && metric.tableAst) {
      const signature = JSON.stringify(metric.tableAst);
      if (signature !== lastTableAstSignature) {
        if (tableAstTransitions.length < 128) {
          tableAstTransitions.push({
            at: metric.at,
            sourceCharacters: metric.sourceCharacters,
            tableAst: metric.tableAst,
          });
        }
        lastTableAstSignature = signature;
      }
    }
    if (metric.stage === "timeline-projection" && typeof metric.projectionMode === "string") {
      projectionModes[metric.projectionMode] = (projectionModes[metric.projectionMode] || 0) + 1;
    }
    for (const [key, value] of Object.entries(metric)) {
      if (!key.endsWith("Ms") || typeof value !== "number") continue;
      timingMs[`${metric.stage}.${key}`] ||= [];
      timingMs[`${metric.stage}.${key}`].push(value);
      if (renderer) {
        rendererTimingMs[`${renderer}.${metric.stage}.${key}`] ||= [];
        rendererTimingMs[`${renderer}.${metric.stage}.${key}`].push(value);
      }
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
    if (typeof metric.katexSourceCharacters === "number") katexSourceLengths.push(metric.katexSourceCharacters);
    if (typeof metric.katexHtmlCharacters === "number") katexHtmlLengths.push(metric.katexHtmlCharacters);
    if (metric.stage === "markdown-katex" && typeof metric.at === "number") katexTimes.push(metric.at);
    if (typeof metric.katexTimingBlocker === "string") katexTimingBlockers.add(metric.katexTimingBlocker);
  }
  return {
    count: metrics.length,
    byStage,
    rendererByStage,
    rendererCounters: Object.fromEntries(Object.entries(rendererCounters).map(([key, values]) => [key, summary(values)])),
    rendererParserModes,
    rendererIncrementalModes,
    incrementalResetEvidence,
    projectionModeCounts: projectionModes,
    timingMs: Object.fromEntries(Object.entries(timingMs).map(([key, values]) => [key, summary(values)])),
    rendererTimingMs: Object.fromEntries(Object.entries(rendererTimingMs).map(([key, values]) => [key, summary(values)])),
    changedBlockEventCount,
    uniqueChangedBlockCount: changedBlocks.size,
    changedBlockLengthEvidence: [...changedBlockLengths].sort((left, right) => left - right),
    structuralBoundaryTypes: boundaryTypes,
    katexCallCount,
    katexSourceCharacters: summary(katexSourceLengths),
    katexHtmlCharacters: summary(katexHtmlLengths),
    katexRenderWindowMs: katexTimes.length ? Math.max(...katexTimes) - Math.min(...katexTimes) : null,
    katexTimingBlockers: [...katexTimingBlockers],
    changedRowKeyEventCount: changedRowKeys.length,
    uniqueChangedRowKeyCount: changedRowKeySet.size,
    changedRowKeyLengthEvidence: redactChangedKeys(changedRowKeys),
    tableAstTransitions,
    typewriter: {
      sampleCount: typewriterSamples.length,
      sourceVisibleCharacters: summarizeNumbers(typewriterSamples.map((metric) => metric.sourceVisibleCharacters).filter((value) => typeof value === "number")),
      displayedVisibleCharacters: summarizeNumbers(typewriterSamples.map((metric) => metric.displayedVisibleCharacters).filter((value) => typeof value === "number")),
      backlogCharacters: summarizeNumbers(typewriterSamples.map((metric) => metric.backlogCharacters).filter((value) => typeof value === "number")),
      backlogAgeMs: summarizeNumbers(typewriterSamples.map((metric) => metric.backlogAgeMs).filter((value) => typeof value === "number")),
      observedRate: summarizeNumbers(typewriterSamples.map((metric) => metric.observedRate).filter((value) => typeof value === "number")),
      targetRate: summarizeNumbers(typewriterSamples.map((metric) => metric.targetRate).filter((value) => typeof value === "number")),
      controlRate: summarizeNumbers(typewriterSamples.map((metric) => metric.controlRate).filter((value) => typeof value === "number")),
      displayRate: summarizeNumbers(typewriterSamples.map((metric) => metric.displayRate).filter((value) => typeof value === "number")),
      relativeLag: summarizeNumbers(typewriterSamples.map((metric) => metric.relativeLag).filter((value) => typeof value === "number")),
      charsPerTick: summarizeNumbers(typewriterSamples.map((metric) => metric.charsPerTick).filter((value) => typeof value === "number")),
      frameIntervalMs: summarizeNumbers(typewriterSamples.map((metric) => metric.frameIntervalMs).filter((value) => typeof value === "number")),
      tickInterval: summarizeNumbers(typewriterSamples.map((metric) => metric.tickInterval).filter((value) => typeof value === "number")),
      frameWorkMs: summarizeNumbers(typewriterSamples.map((metric) => metric.frameWorkMs).filter((value) => typeof value === "number")),
      frameWorkEmaMs: summarizeNumbers(typewriterSamples.map((metric) => metric.frameWorkEmaMs).filter((value) => typeof value === "number")),
      frameGapMs: summarizeNumbers(typewriterSamples.map((metric) => metric.frameGapMs).filter((value) => typeof value === "number")),
      commitToNextFrameMs: summarizeNumbers(typewriterSamples.map((metric) => metric.commitToNextFrameMs).filter((value) => typeof value === "number")),
      saturationMs: summarizeNumbers(typewriterSamples.map((metric) => metric.saturationMs).filter((value) => typeof value === "number")),
      frameHealthyFalseCount: typewriterSamples.filter((metric) => metric.frameHealthy === false).length,
      stepChangedCount: typewriterSamples.filter((metric) => metric.stepChanged === true).length,
      stepIncreaseMax: Math.max(0, ...typewriterSamples.map((metric) => {
        if (typeof metric.previousCharsPerTick !== "number" || typeof metric.charsPerTick !== "number") return 0;
        return Math.max(0, metric.charsPerTick - metric.previousCharsPerTick);
      })),
      fallbackModes: Object.fromEntries(typewriterSamples.reduce((counts, metric) => {
        if (typeof metric.fallbackMode === "string") counts.set(metric.fallbackMode, (counts.get(metric.fallbackMode) || 0) + 1);
        return counts;
      }, new Map())),
      lagTargetMisses: typewriterSamples.filter((metric) => metric.lagTargetMet === false).length,
      warmupSourceCharacterThreshold: 500,
      steadyStateSampleCount: typewriterSteadyStateSamples.length,
      steadyStateRelativeLag: summarizeNumbers(typewriterSteadyStateSamples.map((metric) => metric.relativeLag).filter((value) => typeof value === "number")),
      steadyStateBacklogAgeMs: summarizeNumbers(typewriterSteadyStateSamples.map((metric) => metric.backlogAgeMs).filter((value) => typeof value === "number")),
      steadyStateLagTargetMisses: typewriterSteadyStateSamples.filter((metric) => metric.lagTargetMet === false).length,
      last: typewriterSamples.at(-1) || null,
      terminalSampleCount: typewriterTerminalSamples.length,
      terminal: typewriterTerminalSamples.at(-1) || null,
    },
    transcriptScroll: {
      sampleCount: transcriptScrollSamples.length,
      scrollHeightReadCount: transcriptScrollSamples.reduce((total, metric) => total + (Number(metric.scrollHeightReadCount) || 0), 0),
      scrollTopWriteCount: transcriptScrollSamples.reduce((total, metric) => total + (Number(metric.scrollTopWriteCount) || 0), 0),
      maxWritesPerFrame: Math.max(0, ...Object.values(transcriptScrollSamples.reduce((counts, metric) => {
        const frame = String(metric.frameToken ?? metric.frameIndex ?? "unknown");
        counts[frame] = (counts[frame] || 0) + (Number(metric.scrollTopWriteCount) || 0);
        return counts;
      }, {}))),
      maxReadsPerFrame: Math.max(0, ...Object.values(transcriptScrollSamples.reduce((counts, metric) => {
        const frame = String(metric.frameToken ?? metric.frameIndex ?? "unknown");
        counts[frame] = (counts[frame] || 0) + (Number(metric.scrollHeightReadCount) || 0);
        return counts;
      }, {}))),
      trackingSampleCount: transcriptScrollSamples.filter((metric) => metric.mode === "tracking").length,
      settledSampleCount: transcriptScrollSamples.filter((metric) => metric.mode === "settled").length,
      rebaseSampleCount: transcriptScrollSamples.filter((metric) => metric.mode === "rebase").length,
      snapSampleCount: transcriptScrollSamples.filter((metric) => ["catch-up", "correct", "damped"].includes(metric.mode)).length,
      userSampleCount: transcriptScrollSamples.filter((metric) => metric.ownership === "user").length,
      appSampleCount: transcriptScrollSamples.filter((metric) => metric.ownership === "app").length,
      userOwnedScrollTopWriteCount: transcriptScrollSamples
        .filter((metric) => metric.ownership === "user")
        .reduce((total, metric) => total + (Number(metric.scrollTopWriteCount) || 0), 0),
      ownershipTransitions: transcriptScrollSamples.reduce((count, metric, index) => {
        return index > 0 && metric.ownership !== transcriptScrollSamples[index - 1].ownership ? count + 1 : count;
      }, 0),
      movementPx: summarizeNumbers(transcriptScrollSamples.map((metric) => metric.movementPx).filter((value) => typeof value === "number")),
      velocityPxPerSecond: summarizeNumbers(transcriptScrollSamples.map((metric) => metric.velocityPxPerSecond).filter((value) => typeof value === "number")),
      frameIntervalMs: summarizeNumbers(transcriptScrollSamples.map((metric) => metric.frameIntervalMs).filter((value) => typeof value === "number")),
      scrollHeightDelta: summarizeNumbers(transcriptScrollSamples.map((metric) => metric.scrollHeightDelta).filter((value) => typeof value === "number")),
      targetDeltaPx: summarizeNumbers(transcriptScrollSamples.map((metric) => metric.targetDeltaPx).filter((value) => typeof value === "number")),
      browserCompensationPx: summarizeNumbers(transcriptScrollSamples.map((metric) => metric.browserCompensationPx).filter((value) => typeof value === "number")),
      uncompensatedTargetDeltaPx: summarizeNumbers(transcriptScrollSamples.map((metric) => metric.uncompensatedTargetDeltaPx).filter((value) => typeof value === "number")),
      feedForwardTargetDeltaPx: summarizeNumbers(transcriptScrollSamples.map((metric) => metric.feedForwardTargetDeltaPx).filter((value) => typeof value === "number")),
      targetDeltaEmaPx: summarizeNumbers(transcriptScrollSamples.map((metric) => metric.targetDeltaEmaPx).filter((value) => typeof value === "number")),
      feedForwardVelocityPxPerSecond: summarizeNumbers(transcriptScrollSamples.map((metric) => metric.feedForwardVelocityPxPerSecond).filter((value) => typeof value === "number")),
      directionReversalCount: countTailDirectionReversals(transcriptScrollSamples),
      distanceFromBottom: summarizeNumbers(transcriptScrollSamples.map((metric) => metric.distanceBeforeBottom).filter((value) => typeof value === "number")),
      distanceAfterBottom: summarizeNumbers(transcriptScrollSamples.map((metric) => metric.distanceAfterBottom).filter((value) => typeof value === "number")),
      distanceToTarget: summarizeNumbers(transcriptScrollSamples.map((metric) => metric.distanceToTarget).filter((value) => typeof value === "number")),
      reasons: [...new Set(transcriptScrollSamples.flatMap((metric) => Array.isArray(metric.reasons) ? metric.reasons : []))],
    },
  };
}

function rendererPath(renderer, typewriter = false) {
  const selectedRenderer = typewriter && renderer === "incremark" ? "incremark-typewriter" : renderer;
  const params = new URLSearchParams({
    markdownRenderer: selectedRenderer,
  });
  return `/?${params.toString()}`;
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

function countTailDirectionReversals(samples) {
  let reversals = 0;
  let previousMovement = 0;
  for (const sample of samples) {
    const movement = Number(sample.movementPx) || 0;
    if (Math.abs(movement) > 0.01 && previousMovement !== 0 && Math.sign(movement) !== Math.sign(previousMovement)) {
      reversals += 1;
    }
    if (Math.abs(movement) > 0.01) previousMovement = movement;
  }
  return reversals;
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
      katex: /\$\$|(?:^|[^\\$])\$(?!\$)|\\\([\s\S]*?\\\)|\\\[[\s\S]*?\\\]/.test(fixtureText),
      tableMath: /\|[^\n]*\$(?!\$)[^\n]*\$(?!\$)[^\n]*\|/.test(fixtureText),
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
      mutationTargetCounts: {},
      rootMutationEvidence: {
        records: 0,
        addedNodeCount: 0,
        removedNodeCount: 0,
        addedMathNodeCount: 0,
        removedMathNodeCount: 0,
        removedMathEvents: [],
      },
      frames: [],
      longTasks: [],
      layoutShifts: [],
      layoutShiftSupported: false,
      metrics: [],
      scrollSamples: [],
      scrollEvents: 0,
      scrollWrites: 0,
      scrollProbeWrites: 0,
      scrollWriteEvidence: [],
      domUpdateEvidence: [],
      identity: { first: null, last: null },
      finalFingerprint: null,
      finalSemanticShape: null,
      finalSecurity: null,
      tableGeometry: [],
      tableLayoutTransitions: [],
      lastTableLayoutSignature: null,
      tableStructure: [],
      tableStructureTransitions: [],
      lastTableStructureSignature: null,
      mathGeometryTransitions: 0,
      mathGeometryEvidence: [],
      lastMathGeometry: null,
      blockGeometryTransitions: 0,
      blockHeightDirectionReversals: 0,
      blockTopDirectionReversals: 0,
      blockGeometryEvidence: [],
      sourceDigest: null,
      finalSemanticTextDigest: null,
      clipboardWrites: [],
      inputFeatures,
      finalText: "",
      finalSemanticText: "",
      streamedText: "",
      streamingSnapshots: [],
      socketCount: 0,
      resumeCount: 0,
      disconnectedAt: null,
      resumedAt: null,
      record(metric) {
        this.metrics.push({ ...metric, frameIndex: this.frames.length, frameToken: this.currentFrameToken });
      },
    };
    telemetry.currentFrameToken = 0;
    if (telemetry.instrumentationEnabled) {
      const nativeRequestAnimationFrame = window.requestAnimationFrame.bind(window);
      let frameToken = 0;
      window.requestAnimationFrame = (callback) => nativeRequestAnimationFrame((timestamp) => {
        frameToken += 1;
        telemetry.currentFrameToken = frameToken;
        callback(timestamp);
      });
    }
    const blockGeometryState = new Map();
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
    const tableMathOverflowCount = (root) => [...root.querySelectorAll("td, th")].reduce((count, cell) => {
      const cellRect = cell.getBoundingClientRect();
      const overflow = [...cell.querySelectorAll(".katex")].some((math) => {
        const mathRect = math.getBoundingClientRect();
        return mathRect.left < cellRect.left - 1 || mathRect.right > cellRect.right + 1;
      });
      return count + (overflow ? 1 : 0);
    }, 0);
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
      const visibleText = String(root.textContent || "");
      const rawDollarDelimiterCount = (visibleText.match(/\$/g) || []).length;
      const rawTexDelimiterCount = (visibleText.match(/\\[()[\]]/g) || []).length;
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
        syntheticMathPreviewCount: root.querySelectorAll('[data-synthetic-math-preview="true"] .katex').length,
        syntheticMathRendered: root.querySelectorAll('[data-synthetic-math-preview="true"] .katex').length > 0,
        syntheticMathErrorsAbsent: root.querySelectorAll('[data-synthetic-math-preview="true"] .katex-error').length === 0,
        tableMathCellCount: [...root.querySelectorAll("td, th")].filter((cell) => cell.querySelector(".katex")).length,
        mathCellOverflowCount: tableMathOverflowCount(root),
        rawDollarDelimiterCount,
        rawTexDelimiterCount,
        rawMathDelimiterCount: rawDollarDelimiterCount + rawTexDelimiterCount,
        tableMathRendered: !telemetry.inputFeatures.tableMath
          || [...root.querySelectorAll("td, th")].some((cell) => cell.querySelector(".katex")),
        katexInputPresent: telemetry.inputFeatures.katex,
        fencedCodeCount: artifacts.length,
        fencedCodeInputPresent: telemetry.inputFeatures.fencedCode,
        fencedCodeCopyControls: artifacts.length > 0 && codeCopyButtons.length === artifacts.length,
        artifactControlsPresent: artifacts.length > 0 && artifacts.every((artifact) => artifact.querySelector(".artifact-header")),
      };
    };
    const captureStreamingSnapshot = () => {
      const root = markdownRoot();
      if (!root || telemetry.promptAt == null) return;
      const visibleText = String(root.textContent || "");
      const pendingMathNodes = [...root.querySelectorAll('[data-streaming-pending="math-block"], [data-streaming-pending="math-inline"], .streaming-pending-math-block, .streaming-pending-math-inline')];
      const pendingMathHeights = pendingMathNodes.map((element) => element.getBoundingClientRect().height);
      telemetry.streamingSnapshots.push({
        sourceCharacters: telemetry.streamedText.length,
        visibleTextLength: visibleText.length,
        rawDollarCount: (visibleText.match(/\$/g) || []).length,
        rawTexDelimiterCount: (visibleText.match(/\\[()[\]]/g) || []).length,
        rawBacktickCount: (visibleText.match(/`/g) || []).length,
        pendingMathBlockCount: root.querySelectorAll('[data-streaming-pending="math-block"], .streaming-pending-math-block').length,
        pendingMathInlineCount: root.querySelectorAll('[data-streaming-pending="math-inline"], .streaming-pending-math-inline').length,
        pendingFenceCount: root.querySelectorAll('[data-streaming-pending="fence"]').length,
        pendingFenceTextLength: [...root.querySelectorAll('[data-streaming-pending="fence"]')]
          .reduce((length, element) => Math.max(length, String(element.textContent || "").length), 0),
        pendingMathVisibleCount: pendingMathNodes.filter((element) => {
          const style = getComputedStyle(element);
          return style.visibility !== "hidden" && style.display !== "none" && style.opacity !== "0";
        }).length,
        syntheticMathPreviewCount: root.querySelectorAll('[data-synthetic-math-preview="true"] .katex').length,
        syntheticMathErrorCount: root.querySelectorAll('[data-synthetic-math-preview="true"] .katex-error').length,
        tableMathOverflowCount: tableMathOverflowCount(root),
        pendingMathTextLength: pendingMathNodes.reduce((length, element) => length + String(element.textContent || "").length, 0),
        pendingMathHeights,
      });
    };
    telemetry.captureStreamingSnapshot = captureStreamingSnapshot;
    const captureDomState = () => {
      const root = markdownRoot();
      if (!root) return;
      const rect = (element) => {
        const value = element.getBoundingClientRect();
        return {
          x: Number(value.x.toFixed(2)),
          y: Number(value.y.toFixed(2)),
          width: Number(value.width.toFixed(2)),
          height: Number(value.height.toFixed(2)),
        };
      };
      const tableGeometry = [...root.querySelectorAll("table")].map((table) => ({
        layout: getComputedStyle(table).tableLayout,
        rect: rect(table),
        columns: [...(table.rows[0]?.cells || [])].map((cell) => rect(cell)),
      }));
      const tableStructure = [...root.querySelectorAll("table")].map((table) => ({
        tableId: identityOf(table),
        rows: [...table.rows].map((row) => ({
          rowId: identityOf(row),
          rect: rect(row),
          cells: [...row.cells].map((cell) => ({ cellId: identityOf(cell), rect: rect(cell) })),
        })),
      }));
      const tableStructureSignature = JSON.stringify(tableStructure.map((table) => ({
        tableId: table.tableId,
        rows: table.rows.map((row) => ({ rowId: row.rowId, cells: row.cells.map((cell) => cell.cellId) })),
      })));
      if (telemetry.promptAt != null && tableStructureSignature !== telemetry.lastTableStructureSignature) {
        if (telemetry.tableStructureTransitions.length < 128) {
          telemetry.tableStructureTransitions.push({
            at: performance.now(),
            sourceCharacters: telemetry.streamedText.length,
            tableStructure,
          });
        }
        telemetry.lastTableStructureSignature = tableStructureSignature;
      }
      telemetry.tableStructure = tableStructure;
      const tableLayout = tableGeometry.map((table) => ({
        layout: table.layout,
        x: table.rect.x,
        width: table.rect.width,
        columns: table.columns.map((column) => ({ x: column.x, width: column.width })),
      }));
      const tableLayoutSignature = JSON.stringify(tableLayout);
      if (telemetry.promptAt != null && tableLayoutSignature !== telemetry.lastTableLayoutSignature) {
        if (telemetry.tableLayoutTransitions.length < 128) {
          telemetry.tableLayoutTransitions.push({
            at: performance.now(),
            sourceCharacters: telemetry.streamedText.length,
            tableLayout,
          });
        }
        telemetry.lastTableLayoutSignature = tableLayoutSignature;
      }
      telemetry.tableGeometry = tableGeometry;
      const mathGeometry = [...root.querySelectorAll(".incremark-math-inline")].map((wrapper) => {
        const katex = wrapper.querySelector(".katex");
        const wrapperRect = wrapper.getBoundingClientRect();
        const katexRect = katex?.getBoundingClientRect();
        return {
          wrapper: {
            width: Number(wrapperRect.width.toFixed(2)),
            height: Number(wrapperRect.height.toFixed(2)),
          },
          katex: katexRect ? {
            width: Number(katexRect.width.toFixed(2)),
            height: Number(katexRect.height.toFixed(2)),
          } : null,
          tableCell: (() => {
            const cell = wrapper.closest("td,th");
            const row = cell?.closest("tr");
            const table = row?.closest("table");
            return table && row && cell
              ? { row: [...table.rows].indexOf(row), cell: [...row.cells].indexOf(cell) }
              : null;
          })(),
        };
      });
      if (telemetry.promptAt != null && telemetry.lastMathGeometry) {
        const commonCount = Math.min(telemetry.lastMathGeometry.length, mathGeometry.length);
        let changedMathNode = false;
        for (let index = 0; index < commonCount; index += 1) {
          const previous = telemetry.lastMathGeometry[index];
          const current = mathGeometry[index];
          const changed = Math.abs(previous.wrapper.width - current.wrapper.width) > 0.5
            || Math.abs(previous.wrapper.height - current.wrapper.height) > 0.5
            || Math.abs((previous.katex?.width || 0) - (current.katex?.width || 0)) > 0.5
            || Math.abs((previous.katex?.height || 0) - (current.katex?.height || 0)) > 0.5;
          if (changed) {
            changedMathNode = true;
            if (telemetry.mathGeometryEvidence.length < 64) {
              telemetry.mathGeometryEvidence.push({
                at: performance.now(),
                sourceCharacters: telemetry.streamedText.length,
                index,
                previous,
                current,
              });
            }
          }
        }
        if (changedMathNode) telemetry.mathGeometryTransitions += 1;
      }
      telemetry.lastMathGeometry = mathGeometry;
      telemetry.mathGeometry = mathGeometry;
      const incremarkRoot = root.querySelector(".incremark");
      const scrollViewport = root.closest(".message-scroller-viewport");
      const scrollTop = scrollViewport instanceof HTMLElement ? scrollViewport.scrollTop : 0;
      if (incremarkRoot) {
        for (const [index, block] of [...incremarkRoot.children].entries()) {
          const value = block.getBoundingClientRect();
          const current = {
            x: Number(value.x.toFixed(2)),
            // Compare document-relative positions. Viewport y changes during
            // normal follow-scroll are not layout movement of the block.
            y: Number((value.y + scrollTop).toFixed(2)),
            width: Number(value.width.toFixed(2)),
            height: Number(value.height.toFixed(2)),
          };
          const previous = blockGeometryState.get(block);
          if (previous) {
            const heightDelta = current.height - previous.rect.height;
            const topDelta = current.y - previous.rect.y;
            if (Math.abs(heightDelta) > 0.5 || Math.abs(topDelta) > 0.5) {
              telemetry.blockGeometryTransitions += 1;
              if (Math.abs(heightDelta) > 0.5) {
                const direction = Math.sign(heightDelta);
                if (previous.heightDirection && direction !== previous.heightDirection) {
                  telemetry.blockHeightDirectionReversals += 1;
                }
                previous.heightDirection = direction;
              }
              if (Math.abs(topDelta) > 0.5) {
                const direction = Math.sign(topDelta);
                if (previous.topDirection && direction !== previous.topDirection) {
                  telemetry.blockTopDirectionReversals += 1;
                }
                previous.topDirection = direction;
              }
              if (telemetry.blockGeometryEvidence.length < 64) {
                telemetry.blockGeometryEvidence.push({
                  at: performance.now(),
                  sourceCharacters: telemetry.streamedText.length,
                  index,
                  tag: block.tagName,
                  textLength: String(block.textContent || "").length,
                  textSample: String(block.textContent || "").slice(0, 96),
                  previous: previous.rect,
                  current,
                });
              }
            }
          }
          blockGeometryState.set(block, {
            rect: current,
            heightDirection: previous?.heightDirection || 0,
            topDirection: previous?.topDirection || 0,
          });
        }
      }
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
      captureStreamingSnapshot();
    };
    const targetCategory = (target) => {
      const element = target.nodeType === Node.ELEMENT_NODE ? target : target.parentElement;
      if (element?.closest?.(".chat-markdown")) return "markdown";
      if (element?.closest?.('[data-slot="message-scroller-viewport"]')) return "scroll";
      if (element?.closest?.(".transcript")) return "transcript";
      return "other";
    };
    const mutationTarget = (target) => {
      if (!(target instanceof Element)) return String(target?.nodeName || "node").toLowerCase();
      const classes = [...target.classList].slice(0, 3).join(".");
      return `${target.tagName.toLowerCase()}${classes ? `.${classes}` : ""}`;
    };
    const mathNodeCount = (node) => {
      if (!(node instanceof Element)) return 0;
      return (node.matches(".katex") ? 1 : 0) + node.querySelectorAll(".katex").length;
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
        telemetry.scrollProbeWrites += 1;
        viewport.scrollTop = Math.max(0, viewport.scrollHeight - viewport.clientHeight - 24);
        setTimeout(() => {
          if (inPromptWindow()) {
            telemetry.scrollProbeWrites += 1;
            viewport.scrollTop = viewport.scrollHeight;
          }
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
              if (inPromptWindow() && isTranscriptViewport(this)) {
                telemetry.scrollWrites += 1;
                if (telemetry.scrollWriteEvidence.length < 128) {
                  telemetry.scrollWriteEvidence.push({ at: performance.now(), value: Number(value) });
                }
              }
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
    try {
      if (!telemetry.instrumentationEnabled) throw new Error("measurement_disabled");
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (!entry.hadRecentInput && inPromptWindow(entry.startTime)) {
            telemetry.layoutShifts.push({
              at: entry.startTime,
              value: entry.value,
              sources: (entry.sources || []).slice(0, 8).map((source) => {
                const node = source.node;
                const describe = (rect) => rect ? {
                  x: Number(rect.x.toFixed(2)),
                  y: Number(rect.y.toFixed(2)),
                  width: Number(rect.width.toFixed(2)),
                  height: Number(rect.height.toFixed(2)),
                } : null;
                return {
                  element: node instanceof Element
                    ? `${node.tagName.toLowerCase()}${node.className && typeof node.className === "string" ? `.${node.className.trim().replace(/\s+/g, ".")}` : ""}`
                    : null,
                  ancestors: node instanceof Element
                    ? [...Array.from({ length: 5 }, (_, index) => {
                      let current = node;
                      for (let step = 0; step < index; step += 1) current = current?.parentElement;
                      return current;
                    }).filter(Boolean)].map((current) => `${current.tagName.toLowerCase()}${current.className && typeof current.className === "string" ? `.${current.className.trim().replace(/\s+/g, ".")}` : ""}`)
                    : [],
                  previousRect: describe(source.previousRect),
                  currentRect: describe(source.currentRect),
                };
              }),
            });
          }
        }
      }).observe({ type: "layout-shift", buffered: true });
      telemetry.layoutShiftSupported = true;
    } catch {
      // Layout Shift API is optional; the geometry snapshots remain valid evidence.
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
          frameIndex: telemetry.frames.length,
          sourceCharacters: telemetry.streamedText.length,
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
            const targetKey = `${category}:${mutationTarget(record.target)}`;
            telemetry.mutationTargetCounts[targetKey] = (telemetry.mutationTargetCounts[targetKey] || 0) + 1;
            telemetry.mutationCount += 1;
            telemetry.mutationCategories[`${category}:added`] = (telemetry.mutationCategories[`${category}:added`] || 0) + record.addedNodes.length;
            telemetry.mutationCategories[`${category}:removed`] = (telemetry.mutationCategories[`${category}:removed`] || 0) + record.removedNodes.length;
            const rendererRoot = record.type === "childList"
              && record.target instanceof Element
              && (record.target.matches(".chat-markdown") || record.target.matches(".incremark"));
            if (rendererRoot) {
              const addedMathNodeCount = [...record.addedNodes].reduce((total, node) => total + mathNodeCount(node), 0);
              const removedMathNodeCount = [...record.removedNodes].reduce((total, node) => total + mathNodeCount(node), 0);
              telemetry.rootMutationEvidence.records += 1;
              telemetry.rootMutationEvidence.addedNodeCount += record.addedNodes.length;
              telemetry.rootMutationEvidence.removedNodeCount += record.removedNodes.length;
              telemetry.rootMutationEvidence.addedMathNodeCount += addedMathNodeCount;
              telemetry.rootMutationEvidence.removedMathNodeCount += removedMathNodeCount;
              if (removedMathNodeCount > 0 && telemetry.rootMutationEvidence.removedMathEvents.length < 64) {
                telemetry.rootMutationEvidence.removedMathEvents.push({
                  sourceCharacters: telemetry.streamedText.length,
                  count: removedMathNodeCount,
                });
              }
            }
          }
          if (telemetry.domUpdateEvidence.length < 256) {
            telemetry.domUpdateEvidence.push({
              at: performance.now(),
              frameIndex: telemetry.frames.length,
              mutationCount: records.length,
              sourceCharacters: telemetry.streamedText.length,
            });
          }
          captureDomState();
          updateVisibleText();
          captureStreamingSnapshot();
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
          const text = String(delta);
          telemetry.streamedText += text;
          telemetry.webSocketDeltas.push({ at: performance.now(), characters: text.length });
          emit({
            type: "content_block_delta",
            messageId: "m1",
            blockType: "text",
            contentIndex: 0,
            delta: text,
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
      templates: [{ id: "chat", label: "Assistant", version: 5, defaultable: true, tools: ["read", "bash", "edit", "write", "web_search", "fetch_content", "get_search_content", "source_check"] }],
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
      installations: [{ id: "conduit-pinned", label: "Isolated Pi", version: "0.84.1", available: true }],
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
    tableMathRendered: "tableMath",
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
    if (value === true && ["externalLinkConfirmation", "katexNodeCount", "katexRendered", "syntheticMathRendered", "tableMathRendered", "fencedCodeCopyControls", "artifactControlsPresent"].includes(key)) {
      const count = key.startsWith("katex") ? security?.katexNodeCount
        : key === "syntheticMathRendered" ? security?.syntheticMathPreviewCount
          : key === "tableMathRendered" ? security?.tableMathCellCount
            : key === "externalLinkConfirmation" ? security?.externalLinkButtonCount
              : security?.fencedCodeCount;
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

function prefixHasOpenConstruct(prefix, kind) {
  if (kind === "fence") {
    const opener = prefix.indexOf("```");
    return opener >= 0 && prefix.indexOf("```", opener + 3) < 0;
  }
  if (kind === "math-block") {
    const dollarOpener = prefix.indexOf("$$");
    const bracketOpener = prefix.indexOf("\\[");
    const opener = dollarOpener < 0 ? bracketOpener : bracketOpener < 0 ? dollarOpener : Math.min(dollarOpener, bracketOpener);
    if (opener < 0) return false;
    const close = opener === bracketOpener && (dollarOpener < 0 || bracketOpener <= dollarOpener) ? "\\]" : "$$";
    return prefix.indexOf(close, opener + close.length) < 0;
  }
  const dollarOpener = prefix.search(/\$(?!\$)(?=\S)/);
  const texOpener = prefix.indexOf("\\(");
  const opener = dollarOpener < 0 ? texOpener : texOpener < 0 ? dollarOpener : Math.min(dollarOpener, texOpener);
  if (opener < 0) return false;
  const close = opener === texOpener && (dollarOpener < 0 || texOpener <= dollarOpener) ? "\\)" : "$";
  return prefix.indexOf(close, opener + close.length) < 0;
}

function streamingPresentationEvidence(assertion, snapshots, sourceText) {
  if (!assertion) return { errors: [], report: null };
  if (!assertion.kind) {
    const candidates = snapshots.filter((snapshot) => snapshot.sourceCharacters > 0 && snapshot.sourceCharacters < sourceText.length);
    const errors = [];
    if (!candidates.length) errors.push("No mid-stream snapshots captured for the table/math contract");
    const delimiterClean = candidates.filter((snapshot) => snapshot.rawDollarCount === 0 && snapshot.rawTexDelimiterCount === 0);
    if (assertion.requireNoRawMathDelimiters && delimiterClean.length !== candidates.length) {
      errors.push("Math appeared with raw delimiters in visible text during streaming");
    }
    if (assertion.requireNoMathCellOverflow && candidates.some((snapshot) => snapshot.tableMathOverflowCount > 0)) {
      errors.push("Table math overflowed its cell during streaming");
    }
    return {
      errors,
      report: {
        kind: "all-math",
        snapshotCount: snapshots.length,
        finalSourceCharacters: snapshots.at(-1)?.sourceCharacters ?? null,
        sourceCharacterSamples: snapshots.map((snapshot) => snapshot.sourceCharacters),
        candidateSnapshotCount: candidates.length,
        delimiterCleanSnapshotCount: delimiterClean.length,
        rawDelimiterSamples: candidates
          .filter((snapshot) => snapshot.rawDollarCount > 0 || snapshot.rawTexDelimiterCount > 0)
          .map((snapshot) => ({
            sourceCharacters: snapshot.sourceCharacters,
            rawDollarCount: snapshot.rawDollarCount,
            rawTexDelimiterCount: snapshot.rawTexDelimiterCount,
          })),
      },
    };
  }
  const candidates = snapshots.filter((snapshot) => snapshot.sourceCharacters < sourceText.length
    && prefixHasOpenConstruct(sourceText.slice(0, snapshot.sourceCharacters), assertion.kind));
  const errors = [];
  if (!candidates.length) {
    errors.push(`No mid-stream snapshot captured for open ${assertion.kind}`);
  }
  const delimiterClean = candidates.filter((snapshot) => snapshot.rawDollarCount === 0 && snapshot.rawTexDelimiterCount === 0 && snapshot.rawBacktickCount === 0);
  if (assertion.requireNoRawDelimiters && delimiterClean.length !== candidates.length) {
    errors.push(`Open ${assertion.kind} appeared with raw delimiters in visible text`);
  }
  const pendingCount = candidates.map((snapshot) => assertion.kind === "math-block"
    ? snapshot.pendingMathBlockCount
    : assertion.kind === "math-inline" ? snapshot.pendingMathInlineCount : snapshot.pendingFenceCount);
  if (assertion.requirePendingNode && !pendingCount.some((count) => count > 0)) {
    errors.push(`Open ${assertion.kind} did not produce a pending presentation node`);
  }
  if (assertion.requirePendingGrowth && assertion.kind === "fence") {
    const fenceLengths = candidates
      .filter((snapshot) => snapshot.pendingFenceCount > 0)
      .map((snapshot) => snapshot.pendingFenceTextLength);
    if (fenceLengths.length < 2 || Math.max(...fenceLengths) <= Math.min(...fenceLengths)) {
      errors.push("Open fence presentation did not grow with later source deltas");
    }
  }
  if (assertion.requireHiddenPending && candidates.some((snapshot) => snapshot.pendingMathVisibleCount !== 0 || snapshot.pendingMathTextLength !== 0)) {
    errors.push(`Open ${assertion.kind} exposed visible or textual pending math`);
  }
  const pendingMathHeights = candidates.flatMap((snapshot) => snapshot.pendingMathHeights || []);
  const pendingMathHeightDelta = pendingMathHeights.length
    ? Math.max(...pendingMathHeights) - Math.min(...pendingMathHeights)
    : 0;
  if (assertion.requireStablePendingLayout && pendingMathHeightDelta > 0.5) {
    errors.push(`Open ${assertion.kind} changed pending math height by ${pendingMathHeightDelta.toFixed(2)}px`);
  }
  if (assertion.requireSyntheticPreview && !candidates.some((snapshot) => snapshot.syntheticMathPreviewCount > 0)) {
    errors.push(`Open ${assertion.kind} did not produce an eager synthetic math preview`);
  }
  if (assertion.requireNoSyntheticErrors && candidates.some((snapshot) => snapshot.syntheticMathErrorCount > 0)) {
    errors.push(`Open ${assertion.kind} produced a KaTeX error during synthetic preview`);
  }
  const finalSnapshot = snapshots.at(-1);
  const finalPendingCount = finalSnapshot
    ? assertion.kind === "math-block"
      ? finalSnapshot.pendingMathBlockCount
      : assertion.kind === "math-inline" ? finalSnapshot.pendingMathInlineCount : finalSnapshot.pendingFenceCount
    : 0;
  if (finalPendingCount > 0) errors.push(`Pending ${assertion.kind} presentation remained after stream end`);
  return {
    errors,
    report: {
      kind: assertion.kind,
      snapshotCount: snapshots.length,
      finalSourceCharacters: finalSnapshot?.sourceCharacters ?? null,
      sourceCharacterSamples: snapshots.map((snapshot) => snapshot.sourceCharacters),
      candidateSnapshotCount: candidates.length,
      delimiterCleanSnapshotCount: delimiterClean.length,
      rawDelimiterSamples: candidates
        .filter((snapshot) => snapshot.rawDollarCount > 0 || snapshot.rawTexDelimiterCount > 0)
        .map((snapshot) => ({
          sourceCharacters: snapshot.sourceCharacters,
          rawDollarCount: snapshot.rawDollarCount,
          rawTexDelimiterCount: snapshot.rawTexDelimiterCount,
        })),
      pendingNodeCount: {
        min: pendingCount.length ? Math.min(...pendingCount) : 0,
        max: pendingCount.length ? Math.max(...pendingCount) : 0,
      },
      pendingMathVisibleCount: candidates.length ? Math.max(...candidates.map((snapshot) => snapshot.pendingMathVisibleCount ?? 0)) : 0,
    pendingMathTextLength: candidates.length ? Math.max(...candidates.map((snapshot) => snapshot.pendingMathTextLength ?? 0)) : 0,
    pendingMathHeightDelta,
      syntheticMathPreviewCount: candidates.length ? Math.max(...candidates.map((snapshot) => snapshot.syntheticMathPreviewCount ?? 0)) : 0,
      syntheticMathErrorCount: candidates.length ? Math.max(...candidates.map((snapshot) => snapshot.syntheticMathErrorCount ?? 0)) : 0,
      finalPendingNodeCount: finalPendingCount,
    },
  };
}

export async function runBrowserStreamingScenario(page, scenario) {
  const startedAt = new Date().toISOString();
  const renderer = scenario.renderer || "marked";
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
  await page.goto(rendererPath(renderer, Boolean(scenario.typewriter)));
  await page.getByRole("textbox", { name: "Message Pi" }).fill(scenario.prompt || `Run ${scenario.name}`);
  await page.getByRole("button", { name: "Send message" }).click();
  const sourceText = scenario.cadence.deltas.join("");
  const expectedSemanticText = scenario.expectedSemanticText == null
    ? null
    : normalizeSemanticText(scenario.expectedSemanticText);
  if (scenario.scrollProbe) await page.evaluate(() => window.__conduitHarness?.startScrollProbe?.());
  if (scenario.wheelProbe && renderer === "incremark-typewriter") {
    await page.waitForFunction(() => {
      const viewport = document.querySelector('[data-slot="message-scroller-viewport"]');
      return (window.__conduitHarness?.webSocketDeltas?.length || 0) >= 24
        && viewport instanceof HTMLElement
        && viewport.scrollHeight - viewport.clientHeight > 240;
    }, { timeout: 15_000 });
    const viewportBox = await page.locator('[data-slot="message-scroller-viewport"]').boundingBox();
    if (!viewportBox) throw new Error("Wheel probe could not locate the transcript viewport");
    await page.mouse.move(viewportBox.x + viewportBox.width / 2, viewportBox.y + viewportBox.height / 2);
    for (let index = 0; index < 3; index += 1) await page.mouse.wheel(0, -600);
    await page.waitForFunction(() => window.__conduitHarness?.metrics?.some((metric) =>
      metric.stage === "transcript-scroll" && metric.owner === "typewriter-tail-inertial" && metric.ownership === "user"), { timeout: 5_000 });
    await page.mouse.wheel(0, 10_000);
    await page.waitForFunction(() => {
      const metrics = window.__conduitHarness?.metrics || [];
      const userIndex = metrics.findIndex((metric) => metric.stage === "transcript-scroll"
        && metric.owner === "typewriter-tail-inertial" && metric.ownership === "user");
      return userIndex >= 0 && metrics.slice(userIndex + 1).some((metric) => metric.stage === "transcript-scroll"
        && metric.owner === "typewriter-tail-inertial" && metric.ownership === "app");
    }, { timeout: 5_000 });
  }
  await page.waitForFunction(() => Boolean(window.__conduitHarness?.completedAt));
  let displayCompletedAt = null;
  if (scenario.typewriter) {
    const typewriterRenderer = renderer === "incremark" ? "incremark-typewriter" : renderer;
    const typewriterSelector = `.chat-markdown[data-renderer="${typewriterRenderer}"]`;
    await page.waitForSelector(typewriterSelector, { state: "attached", timeout: 15_000 });
    try {
      await page.waitForFunction((selector) => {
        const roots = [...document.querySelectorAll(selector)];
        return roots.length > 0 && roots.every((root) => root.getAttribute("data-display-busy") !== "true");
      }, typewriterSelector, { timeout: 15_000 });
    } catch (error) {
      const state = await page.evaluate((selector) => [...document.querySelectorAll(selector)].map((root) => ({
        renderer: root.getAttribute("data-renderer"),
        busy: root.getAttribute("data-display-busy"),
        animationBusy: root.getAttribute("data-display-animation-busy"),
        pendingMathRenders: root.getAttribute("data-pending-math-renders"),
        streaming: root.getAttribute("data-streaming"),
        textLength: String(root.textContent || "").length,
        pendingMath: root.querySelectorAll('[data-streaming-pending^="math-"]').length,
        pendingFence: root.querySelectorAll('[data-streaming-pending="fence"]').length,
        recentTypewriterMetrics: (window.__conduitHarness?.metrics || [])
          .filter((metric) => metric.stage === "markdown-typewriter")
          .slice(-8)
          .map((metric) => ({
            source: metric.sourceVisibleCharacters,
            displayed: metric.displayedVisibleCharacters,
            backlog: metric.backlogCharacters,
            terminal: metric.terminal,
            native: metric.nativeTransformer,
            at: metric.at,
          })),
      })), typewriterSelector);
      throw new Error(`${error.message}; typewriter roots=${JSON.stringify(state)}`);
    }
  }
  // onAllComplete clears data-display-busy before Solid commits the final
  // display nodes. Measure and read correctness after two paint boundaries.
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  if (scenario.typewriter) displayCompletedAt = await page.evaluate(() => performance.now());
  await page.evaluate(() => window.__conduitHarness?.readCorrectness?.());
  if (expectedSemanticText != null) {
    await page.waitForFunction((text) => window.__conduitHarness?.finalSemanticText === text, expectedSemanticText, { timeout: 5_000 });
  }
  await page.evaluate(() => window.__conduitHarness?.captureDomState?.());
  await page.evaluate(() => window.__conduitHarness?.captureStreamingSnapshot?.());
  const interactionAssertions = await runInteractionAssertions(page, scenario.expectedInteractions);
  const runtime = await page.evaluate(() => ({ userAgent: navigator.userAgent, platform: navigator.platform }));

  const raw = await page.evaluate(() => window.__conduitHarness);
  const webSocketGaps = raw.webSocketDeltas.slice(1)
    .map((frame, index) => frame.at - raw.webSocketDeltas[index].at);
  const visibleGaps = raw.visibleIncrements.slice(1)
    .map((frame, index) => frame.at - raw.visibleIncrements[index].at);
  const frameGaps = raw.frames.slice(1).map((frame, index) => frame - raw.frames[index]);
  const domUpdateToNextFrame = raw.domUpdateEvidence.flatMap((entry) => {
    const nextFrame = raw.frames.find((frame) => frame >= entry.at);
    return nextFrame == null ? [] : [nextFrame - entry.at];
  });
  const measurementCompletedAt = displayCompletedAt ?? raw.completedAt;
  const scopedLongTasks = raw.longTasks.filter((entry) =>
    entry.startTime <= measurementCompletedAt && entry.startTime + entry.duration >= raw.promptAt);
  const scopedMetrics = raw.metrics.filter((entry) =>
    typeof entry.at === "number" && entry.at >= raw.promptAt && entry.at <= measurementCompletedAt);
  const firstVisibleAt = raw.visibleIncrements[0]?.at;
  const expectedFingerprint = scenario.expectedSemanticFingerprint || null;
  const errors = [...browserErrors];
  if (scenario.fixture && scenario.requiresStructuralContract && !expectedFingerprint) errors.push("Named fixture is missing a structural fingerprint contract");
  if (scenario.fixture && scenario.requiresStructuralContract && scenario.expectedAssertions == null) errors.push("Named fixture is missing explicit security assertions");
  if (expectedSemanticText != null && raw.finalSemanticText !== expectedSemanticText) errors.push("Visible semantic text did not match the expected fixture text");
  const structuralFingerprint = redactFingerprint(raw.finalFingerprint);
  if (!scenario.skipStructuralFingerprint && fingerprintTruncated(structuralFingerprint)) errors.push("Structural fingerprint exceeded the redaction node budget");
  const structuralMatch = expectedFingerprint == null
    ? null
    : fingerprintMatches(structuralFingerprint, expectedFingerprint, raw.finalSemanticShape);
  if (structuralMatch === false) errors.push("Rendered structural fingerprint did not match the expected fixture");
  const securityAssertions = raw.finalSecurity || {};
  errors.push(...expectedAssertionErrors(scenario.expectedAssertions, securityAssertions, interactionAssertions, raw.inputFeatures));
  errors.push(...expectedInteractionErrors(scenario.expectedInteractions, interactionAssertions, raw.inputFeatures));
  if (scenario.expectedTableMathCellCount != null && securityAssertions.tableMathCellCount !== scenario.expectedTableMathCellCount) {
    errors.push(`Table math cell count ${securityAssertions.tableMathCellCount} did not equal ${scenario.expectedTableMathCellCount}`);
  }
  if (scenario.requireNoRawMathDelimiters && securityAssertions.rawMathDelimiterCount !== 0) {
    errors.push(`Final visible text contained ${securityAssertions.rawMathDelimiterCount} raw math delimiters`);
  }
  if (scenario.maxMathCellOverflowCount != null && securityAssertions.mathCellOverflowCount > scenario.maxMathCellOverflowCount) {
    errors.push(`Table math cell overflow count ${securityAssertions.mathCellOverflowCount} exceeded ${scenario.maxMathCellOverflowCount}`);
  }
  const streamingPresentation = streamingPresentationEvidence(scenario.streamingAssertion, raw.streamingSnapshots, sourceText);
  errors.push(...streamingPresentation.errors);
  const clientWork = summarizeHarnessMetrics(scopedMetrics);
  if (scenario.maxKaTeXCalls != null && clientWork.katexCallCount > scenario.maxKaTeXCalls) {
    errors.push(`KaTeX actual render count ${clientWork.katexCallCount} exceeded ${scenario.maxKaTeXCalls}`);
  }
  if (scenario.maxLayoutShiftCount != null && raw.layoutShifts.length > scenario.maxLayoutShiftCount) {
    errors.push(`Layout Shift entry count ${raw.layoutShifts.length} exceeded ${scenario.maxLayoutShiftCount}`);
  }
  if (scenario.maxLayoutShiftValue != null && raw.layoutShifts.reduce((total, entry) => total + entry.value, 0) > scenario.maxLayoutShiftValue) {
    const value = raw.layoutShifts.reduce((total, entry) => total + entry.value, 0);
    errors.push(`Cumulative Layout Shift ${value.toFixed(6)} exceeded ${scenario.maxLayoutShiftValue}`);
  }
  const longestTaskMs = Math.max(0, ...scopedLongTasks.map((entry) => entry.duration));
  if (scenario.maxLongestTaskMs != null && longestTaskMs > scenario.maxLongestTaskMs) {
    errors.push(`Longest task ${longestTaskMs.toFixed(1)} ms exceeded ${scenario.maxLongestTaskMs} ms`);
  }
  if (scenario.maxRemovedMathNodes != null && raw.rootMutationEvidence.removedMathNodeCount > scenario.maxRemovedMathNodes) {
    errors.push(`Completed KaTeX nodes removed during streaming ${raw.rootMutationEvidence.removedMathNodeCount} exceeded ${scenario.maxRemovedMathNodes}`);
  }
  if (scenario.maxIncrementalResets != null && clientWork.incrementalResetEvidence.length > scenario.maxIncrementalResets) {
    errors.push(`Incremental renderer resets ${clientWork.incrementalResetEvidence.length} exceeded ${scenario.maxIncrementalResets}`);
  }
  if (scenario.expectedTableLayout != null) {
    const finalTableLayouts = raw.tableGeometry.map((table) => table.layout);
    const observedTableLayouts = raw.tableLayoutTransitions
      .flatMap((entry) => entry.tableLayout.map((table) => table.layout));
    if (finalTableLayouts.some((layout) => layout !== scenario.expectedTableLayout)
      || observedTableLayouts.some((layout) => layout !== scenario.expectedTableLayout)) {
      errors.push(`Table layout was not consistently ${scenario.expectedTableLayout}`);
    }
  }
  if (scenario.maxTableLayoutTransitions != null && raw.tableLayoutTransitions.length > scenario.maxTableLayoutTransitions) {
    errors.push(`Table layout transitions ${raw.tableLayoutTransitions.length} exceeded ${scenario.maxTableLayoutTransitions}`);
  }
  if (scenario.maxMathGeometryTransitions != null && raw.mathGeometryTransitions > scenario.maxMathGeometryTransitions) {
    errors.push(`Math geometry transitions ${raw.mathGeometryTransitions} exceeded ${scenario.maxMathGeometryTransitions}`);
  }
  if (scenario.maxBlockGeometryTransitions != null && raw.blockGeometryTransitions > scenario.maxBlockGeometryTransitions) {
    errors.push(`Rendered block geometry transitions ${raw.blockGeometryTransitions} exceeded ${scenario.maxBlockGeometryTransitions}`);
  }
  if (scenario.maxBlockHeightDirectionReversals != null && raw.blockHeightDirectionReversals > scenario.maxBlockHeightDirectionReversals) {
    errors.push(`Rendered block height direction reversals ${raw.blockHeightDirectionReversals} exceeded ${scenario.maxBlockHeightDirectionReversals}`);
  }
  if (scenario.maxBlockTopDirectionReversals != null && raw.blockTopDirectionReversals > scenario.maxBlockTopDirectionReversals) {
    errors.push(`Rendered block top direction reversals ${raw.blockTopDirectionReversals} exceeded ${scenario.maxBlockTopDirectionReversals}`);
  }

  return {
    schemaVersion: 1,
    scenario: scenario.name,
    mode: "deterministic-browser",
    target: "playwright-production-client",
    startedAt,
    metadata: {
      commit: process.env.CONDUIT_RELEASE || "working-tree",
      profile: scenario.profile || "fixed",
      renderer,
      typewriter: Boolean(scenario.typewriter),
      runtime,
      command: "npm run test:harness:browser",
    },
    seed: scenario.seed ?? null,
    outcome: errors.length ? "failed" : "passed",
    browser: {
      renderer,
      typewriter: Boolean(scenario.typewriter),
      sourceCharacters: sourceText.length,
      sourceDeltaCount: scenario.cadence.deltas.length,
      sourceEvidence: { length: sourceText.length, digest: raw.sourceDigest || null },
      firstVisibleMs: firstVisibleAt == null ? null : firstVisibleAt - raw.promptAt,
      completionMs: raw.completedAt - raw.promptAt,
      displayCompletionDelayMs: displayCompletedAt == null ? null : displayCompletedAt - raw.completedAt,
      webSocketDeltaCount: raw.webSocketDeltas.length,
      webSocketGapMs: summary(webSocketGaps),
      visibleIncrementCount: raw.visibleIncrements.length,
      visibleIncrementCharacters: summary(raw.visibleIncrements.map((entry) => entry.characters)),
      visibleGapMs: summary(visibleGaps),
      domMutationCount: raw.mutationCount,
      domUpdateToNextFrameMs: summary(domUpdateToNextFrame),
      frameGapMs: summary(frameGaps),
      frameGapsOver32Ms: frameGaps.filter((gap) => gap > 32).length,
      frameGapsOver50Ms: frameGaps.filter((gap) => gap > 50).length,
      frameGapsOver100Ms: frameGaps.filter((gap) => gap > 100).length,
      longTaskCount: scopedLongTasks.length,
      longTaskEvidence: scopedLongTasks.map((entry) => ({
        startMs: entry.startTime - raw.promptAt,
        durationMs: entry.duration,
        endMs: entry.startTime + entry.duration - raw.promptAt,
      })),
      longestTaskMs: Math.max(0, ...scopedLongTasks.map((entry) => entry.duration)),
      layoutShift: {
        supported: Boolean(raw.layoutShiftSupported),
        count: raw.layoutShifts.length,
        value: raw.layoutShifts.reduce((total, entry) => total + entry.value, 0),
        max: Math.max(0, ...raw.layoutShifts.map((entry) => entry.value)),
      },
      layoutShiftEvidence: raw.layoutShifts,
      tableGeometry: raw.tableGeometry,
      tableLayoutTransitions: raw.tableLayoutTransitions,
      tableStructure: raw.tableStructure,
      tableStructureTransitions: raw.tableStructureTransitions,
      scrollWriteEvidence: raw.scrollWriteEvidence,
      tableAstTransitions: clientWork.tableAstTransitions,
      mathGeometryTransitions: raw.mathGeometryTransitions,
      mathGeometryEvidence: raw.mathGeometryEvidence,
      tableMathCellCount: securityAssertions.tableMathCellCount ?? null,
      mathCellOverflowCount: securityAssertions.mathCellOverflowCount ?? null,
      rawMathDelimiterCount: securityAssertions.rawMathDelimiterCount ?? null,
      blockGeometryTransitions: raw.blockGeometryTransitions,
      blockHeightDirectionReversals: raw.blockHeightDirectionReversals,
      blockTopDirectionReversals: raw.blockTopDirectionReversals,
      blockGeometryEvidence: raw.blockGeometryEvidence,
      finalSemanticTextEvidence: { length: normalizeSemanticText(raw.finalSemanticText).length, digest: raw.finalSemanticTextDigest || null },
      finalSemanticTextLength: normalizeSemanticText(raw.finalSemanticText).length,
      structuralFingerprint,
      semanticShape: raw.finalSemanticShape,
      structuralMatch,
      inputFeatures: raw.inputFeatures,
      securityAssertions,
      interactionAssertions,
      streamingPresentation: streamingPresentation.report,
      mutationCategories: raw.mutationCategories,
      mutationTargetCounts: raw.mutationTargetCounts,
      rootMutationEvidence: raw.rootMutationEvidence,
      identity: identityReport(raw.identity),
      scroll: {
        distanceFromBottom: summarizeNumbers(raw.scrollSamples.map((sample) => sample.distanceFromBottom)),
        finalDistanceFromBottom: raw.scrollSamples.at(-1)?.distanceFromBottom ?? null,
        scrollEventCount: raw.scrollEvents,
        programmaticWriteCount: raw.scrollWrites,
        applicationProgrammaticWriteCount: Math.max(0, raw.scrollWrites - raw.scrollProbeWrites),
        scrollProbeWriteCount: raw.scrollProbeWrites,
        programmaticWriteEvidence: raw.scrollWriteEvidence,
        typewriterTail: clientWork.transcriptScroll,
      },
      instrumentation: {
        enabled: Boolean(raw.instrumentationEnabled),
        metricCount: scopedMetrics.length,
        correctnessRead: raw.instrumentationEnabled ? null : "one final DOM text read after completion; read cost excluded from timing",
      },
      limitations: {
        katexTiming: "Marked timing wraps marked-katex-extension's katex.renderToString; Incremark timing records adapter MathNode calls. clientWork reports renderer-specific KaTeX timing. A zero call count means the fixture did not invoke math rendering.",
      },
      clientWork,
    },
    errors,
    artifacts: [],
  };
}

export async function runBrowserReconnectScenario(page, scenario) {
  const startedAt = new Date().toISOString();
  const renderer = scenario.renderer || "marked";
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
  await page.goto(rendererPath(renderer, Boolean(scenario.typewriter)));
  await page.getByRole("textbox", { name: "Message Pi" }).fill(scenario.prompt || `Run ${scenario.name}`);
  await page.getByRole("button", { name: "Send message" }).click();
  const expectedText = scenario.initialText + scenario.recoveredDelta;
  await page.waitForFunction(() => window.__conduitHarness?.socketCount === 2);
  await page.waitForFunction(() => Boolean(window.__conduitHarness?.completedAt), { timeout: 5_000 });
  let displayCompletedAt = null;
  if (scenario.typewriter) {
    const typewriterRenderer = renderer === "incremark" ? "incremark-typewriter" : renderer;
    await page.waitForSelector(`.chat-markdown[data-renderer="${typewriterRenderer}"]`, { state: "attached", timeout: 15_000 });
    await page.waitForFunction((rendererId) => {
      const roots = [...document.querySelectorAll(`.chat-markdown[data-renderer="${rendererId}"]`)];
      return roots.length > 0 && roots.every((root) => root.getAttribute("data-display-busy") !== "true");
    }, typewriterRenderer, { timeout: 15_000 });
  }
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  if (scenario.typewriter) displayCompletedAt = await page.evaluate(() => performance.now());
  await page.evaluate(() => window.__conduitHarness?.readCorrectness?.());
  await page.evaluate(() => window.__conduitHarness?.captureDomState?.());
  const interactionAssertions = await runInteractionAssertions(page, scenario.expectedInteractions);
  const runtime = await page.evaluate(() => ({ userAgent: navigator.userAgent, platform: navigator.platform }));

  const raw = await page.evaluate(() => window.__conduitHarness);
  const renderedCharacters = raw.visibleIncrements
    .reduce((total, increment) => total + increment.characters, 0);
  const measurementCompletedAt = displayCompletedAt ?? raw.completedAt;
  const scopedMetrics = raw.metrics.filter((entry) => entry.at >= raw.promptAt && entry.at <= measurementCompletedAt);
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
        renderer,
        typewriter: Boolean(scenario.typewriter),
      runtime,
      command: "npm run test:harness:browser",
    },
    outcome: errors.length ? "failed" : "passed",
    browser: {
      renderer,
      sourceCharacters: expectedText.length,
      sourceDeltaCount: 2,
      sourceEvidence: { length: expectedText.length, digest: raw.sourceDigest || null },
      socketCount: raw.socketCount,
      resumeCount: raw.resumeCount,
      recoveryMs: raw.resumedAt - raw.disconnectedAt,
      displayCompletionDelayMs: displayCompletedAt == null ? null : displayCompletedAt - raw.completedAt,
      typewriter: Boolean(scenario.typewriter),
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
