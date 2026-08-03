#!/usr/bin/env node

import { createHash } from "node:crypto";
import { execFile as execFileCallback, spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { chromium } from "@playwright/test";
import { getBrowserFixture } from "../test/browser/helpers/streaming-fixtures.js";

const execFile = promisify(execFileCallback);
const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(webRoot, "..");
const viteCli = path.join(webRoot, "node_modules", "vite", "bin", "vite.js");
const candidateVersion = "1.0.2";
const solidVersion = "1.9.14";
const fixtureIds = [
  "rich-markdown",
  "incomplete-syntax",
  "incomplete-reference",
  "katex",
  "security",
  "code-copy",
  "external-confirmation",
  "scroll",
];
const packageSpecs = {
  "@incremark/core": candidateVersion,
  "@incremark/solid": candidateVersion,
  "solid-js": solidVersion,
  marked: "18.0.6",
  "marked-katex-extension": "5.1.10",
  dompurify: "3.4.12",
  katex: "0.16.27",
};

function chunks(text, size = 3) {
  const values = [];
  for (let index = 0; index < text.length; index += size) values.push(text.slice(index, index + size));
  return values;
}

function fixtureData() {
  return fixtureIds.map((id) => {
    const fixture = getBrowserFixture(id);
    return {
      id,
      source: fixture.text,
      expectedSemanticFingerprint: fixture.expectedSemanticFingerprint,
      expectedSemanticText: fixture.expectedSemanticText,
      expectedAssertions: fixture.expectedAssertions,
      expectedInteractions: fixture.expectedInteractions,
      chunks: chunks(fixture.text),
    };
  });
}

function reconnectFixture() {
  const fixture = getBrowserFixture("reconnect");
  const source = `${fixture.initialText}${fixture.recoveredDelta}`;
  return {
    id: "reconnect",
    source,
    expectedSemanticFingerprint: fixture.expectedSemanticFingerprint,
    expectedSemanticText: source,
    expectedAssertions: fixture.expectedAssertions,
    expectedInteractions: fixture.expectedInteractions,
    chunks: chunks(source),
  };
}

function evidenceText(value) {
  const text = String(value ?? "").replace(/\u00a0/g, " ").replace(/\r\n?/g, "\n").trimEnd();
  return {
    length: text.length,
    digest: createHash("sha256").update(text).digest("hex").slice(0, 16),
  };
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function readJson(file) {
  return JSON.parse(await readFile(file, "utf8"));
}

async function directoryBytes(directory, skipNestedNodeModules = false) {
  let total = 0;
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (skipNestedNodeModules && entry.isDirectory() && entry.name === "node_modules") continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) total += await directoryBytes(absolute, skipNestedNodeModules);
    else if (entry.isFile()) total += (await stat(absolute)).size;
  }
  return total;
}

function collectDependencyNodes(dependencies, nodes = new Map()) {
  for (const dependency of Object.values(dependencies || {})) {
    if (dependency?.path) nodes.set(dependency.path, dependency);
    collectDependencyNodes(dependency?.dependencies, nodes);
  }
  return nodes;
}

async function npmJson(tempDir, args) {
  const result = await execFile("npm", args, {
    cwd: tempDir,
    maxBuffer: 32 * 1024 * 1024,
  });
  return JSON.parse(result.stdout);
}

async function installCandidate(tempDir) {
  await writeFile(path.join(tempDir, "package.json"), `${JSON.stringify({
    name: "conduit-incremark-spike",
    private: true,
    type: "module",
    dependencies: packageSpecs,
  }, null, 2)}\n`);
  await execFile("npm", [
    "install",
    "--no-package-lock",
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
  ], {
    cwd: tempDir,
    maxBuffer: 32 * 1024 * 1024,
  });
}

async function packageReport(tempDir) {
  const packageNames = ["@incremark/core", "@incremark/solid"];
  const metadata = {};
  for (const name of packageNames) {
    const packageJson = await readJson(path.join(tempDir, "node_modules", ...name.split("/"), "package.json"));
    const view = await npmJson(tempDir, [
      "view",
      `${name}@${candidateVersion}`,
      "version",
      "license",
      "repository.url",
      "homepage",
      "time",
      "dist.tarball",
      "dist.integrity",
      "dist.shasum",
      "--json",
    ]);
    metadata[name] = {
      version: packageJson.version,
      license: packageJson.license,
      repository: packageJson.repository?.url || null,
      homepage: packageJson.homepage || null,
      releaseDate: view.time?.[candidateVersion] || null,
      provenance: view["dist.tarball"] || null,
      integrity: view["dist.integrity"] || null,
      shasum: view["dist.shasum"] || null,
      directDependencyCount: Object.keys(packageJson.dependencies || {}).length,
      peerDependencyCount: Object.keys(packageJson.peerDependencies || {}).length,
      dependencyNames: Object.keys(packageJson.dependencies || {}).sort(),
    };
  }

  const packageDir = path.join(tempDir, "package-metadata");
  await writeFile(path.join(tempDir, "pack-target.json"), "{}\n");
  await execFile("mkdir", ["-p", packageDir], { cwd: tempDir });
  const packed = {};
  for (const name of packageNames) {
    const result = await execFile("npm", [
      "pack",
      "--json",
      "--ignore-scripts",
      "--pack-destination",
      packageDir,
      `${name}@${candidateVersion}`,
    ], {
      cwd: tempDir,
      maxBuffer: 32 * 1024 * 1024,
    });
    packed[name] = JSON.parse(result.stdout)[0];
  }

  const dependencyTree = await npmJson(tempDir, ["ls", "--all", "--json", "--long"]);
  const nodes = collectDependencyNodes(dependencyTree.dependencies);
  const installedPackages = [];
  for (const [directory, dependency] of nodes) {
    installedPackages.push({
      name: dependency.name || path.basename(directory),
      version: dependency.version || null,
      bytes: await directoryBytes(directory, true),
    });
  }
  installedPackages.sort((left, right) => right.bytes - left.bytes);

  return {
    packages: Object.fromEntries(packageNames.map((name) => [name, {
      ...metadata[name],
      tarball: {
        filename: packed[name].filename,
        packageSize: packed[name].size,
        unpackedSize: packed[name].unpackedSize,
        fileCount: packed[name].entryCount,
        shasum: packed[name].shasum,
        integrity: packed[name].integrity,
      },
    }])),
    dependencyTree: {
      packageCount: installedPackages.length,
      installedBytes: await directoryBytes(path.join(tempDir, "node_modules")),
      packagePayloadBytes: installedPackages.reduce((total, item) => total + item.bytes, 0),
      largestPackages: installedPackages.slice(0, 12),
    },
  };
}

function htmlFixtureSource(data) {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}

async function writeBrowserFixture(tempDir, data) {
  const serialized = htmlFixtureSource(data);
  const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>Incremark compatibility spike</title></head>
<body><main id="app"></main><script type="module" src="/main.js"></script></body></html>
`;
  const source = `import { createComponent } from "solid-js";
import { render } from "solid-js/web";
import { IncremarkContent } from "@incremark/solid";
import DOMPurify from "dompurify";
import { marked } from "marked";
import markedKatex from "marked-katex-extension";

const fixtures = ${serialized};
const params = new URLSearchParams(location.search);
const fixture = fixtures.find((item) => item.id === params.get("fixture")) || fixtures[0];
const mode = params.get("mode") === "content" ? "content" : "stream";
const metrics = {
  fixture: fixture.id,
  mode,
  sourceLength: fixture.source.length,
  chunkCount: fixture.chunks.length,
  runtimeErrors: [],
  baseline: { mutations: 0, categories: {}, first: null, last: null, frames: [] },
  candidate: { mutations: 0, categories: {}, first: null, last: null, frames: [] },
};
window.__incremarkSpike = { done: false, streamYielded: false, metrics };
window.addEventListener("error", (event) => metrics.runtimeErrors.push(String(event.message || "window error")));
window.addEventListener("unhandledrejection", (event) => metrics.runtimeErrors.push(String(event.reason?.message || event.reason || "unhandled rejection")));

const app = document.querySelector("#app");
app.innerHTML = "<section id=\\"baseline\\"><h2>Current renderer baseline</h2><div class=\\"chat-markdown\\"></div></section><section id=\\"candidate\\"><h2>Incremark candidate</h2><div class=\\"candidate-mount\\"></div></section>";
const baselineRoot = document.querySelector("#baseline .chat-markdown");
const candidateMount = document.querySelector("#candidate .candidate-mount");
const identityIds = new WeakMap();
let nextIdentity = 1;
function identityOf(node) {
  if (!node) return null;
  if (!identityIds.has(node)) identityIds.set(node, nextIdentity++);
  return identityIds.get(node);
}
function observeIdentity(name) {
  const root = name === "baseline"
    ? document.querySelector("#baseline .chat-markdown")
    : document.querySelector("#candidate .incremark");
  if (!root) return;
  const state = metrics[name];
  const selectors = ["h1,h2,h3", "ul,ol", "table", "pre", ".katex", "a,button"];
  const snapshot = {
    root: identityOf(root),
    semantic: selectors.map((selector) => [...root.querySelectorAll(selector)].map(identityOf)),
  };
  if (!state.first) state.first = snapshot;
  state.last = snapshot;
}
function observeRoot(name, root) {
  new MutationObserver((records) => {
    const state = metrics[name];
    state.mutations += records.length;
    for (const record of records) state.categories[record.type] = (state.categories[record.type] || 0) + 1;
    observeIdentity(name);
  }).observe(root, { subtree: true, childList: true, attributes: true, characterData: true });
}
observeRoot("baseline", baselineRoot);
observeRoot("candidate", candidateMount);
function frameLoop(name, previous = null) {
  requestAnimationFrame((now) => {
    if (previous != null) metrics[name].frames.push(now - previous);
    if (!window.__incremarkSpike.done) frameLoop(name, now);
  });
}
frameLoop("baseline");
frameLoop("candidate");

const allowedProtocols = new Set(["http:", "https:", "mailto:"]);
const escapeHtml = (value) => String(value)
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;");
marked.use(markedKatex({ nonStandard: true, throwOnError: false }));
marked.use({
  gfm: true,
  breaks: false,
  renderer: {
    strong({ tokens }) { return "<strong data-markdown=\\"strong\\">" + this.parser.parseInline(tokens) + "</strong>"; },
    image() { return ""; },
    link({ href, title, tokens }) {
      const label = this.parser.parseInline(tokens);
      try {
        const target = new URL(href, location.href);
        if (!allowedProtocols.has(target.protocol)) return label;
        if (target.origin === location.origin || target.protocol === "mailto:") {
          return "<a href=\\"" + escapeHtml(href) + "\\"" + (title ? " title=\\"" + escapeHtml(title) + "\\"" : "") + ">" + label + "</a>";
        }
        return "<button type=\\"button\\" class=\\"external-markdown-link\\" data-external-url=\\"" + escapeHtml(target.href) + "\\" aria-label=\\"" + escapeHtml(String(tokens.map((token) => "text" in token ? token.text : "").join("") || target.href)) + "\\">" + label + "</button>";
      } catch { return label; }
    },
    code({ text, lang }) {
      const language = String(lang || "text").split(/\\s+/)[0].toLowerCase();
      return "<div class=\\"artifact\\" data-language=\\"" + escapeHtml(language) + "\\"><div class=\\"artifact-header\\"><span>" + escapeHtml(language) + "</span><button type=\\"button\\" aria-label=\\"Copy code\\" data-copy-code>Copy</button></div><pre><code>" + escapeHtml(text) + "</code></pre></div>";
    },
  },
});
function renderBaseline(source) {
  const html = marked.parse(source, { async: false });
  const fragment = DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    ADD_ATTR: ["aria-label", "data-copy-code", "data-external-url", "data-language", "data-markdown", "class"],
    FORBID_TAGS: ["img", "script", "style", "iframe", "object", "embed"],
    RETURN_DOM_FRAGMENT: true,
  });
  baselineRoot.replaceChildren(fragment);
  observeIdentity("baseline");
}

function delay(milliseconds) {
  return milliseconds > 0 ? new Promise((resolve) => setTimeout(resolve, milliseconds)) : Promise.resolve();
}
async function* sourceStream() {
  for (const chunk of fixture.chunks) {
    await delay(2);
    yield chunk;
  }
  window.__incremarkSpike.streamYielded = true;
}
const candidateProps = mode === "stream"
  ? { stream: () => sourceStream(), showBlockStatus: true }
  : { content: fixture.source, isFinished: true, showBlockStatus: true };
try {
  render(() => createComponent(IncremarkContent, candidateProps), candidateMount);
} catch (error) {
  metrics.runtimeErrors.push(String(error?.stack || error?.message || error));
}
observeIdentity("candidate");

async function driveBaseline() {
  if (mode === "stream") {
    let value = "";
    for (const chunk of fixture.chunks) {
      value += chunk;
      renderBaseline(value);
      await delay(2);
    }
  } else {
    renderBaseline(fixture.source);
  }
  renderBaseline(fixture.source);
}

function textEvidence(value) {
  const text = String(value || "").replace(/\\u00a0/g, " ").replace(/\\r\\n?/g, "\\n").trimEnd();
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return { length: text.length, digest: (hash >>> 0).toString(16).padStart(8, "0") };
}
function semanticSnapshot(root) {
  if (!root) return null;
  const links = [...root.querySelectorAll("a[href],button[data-external-url],.external-markdown-link")];
  let unsafeProtocols = 0;
  for (const element of links) {
    const value = element.getAttribute("href") || element.getAttribute("data-external-url") || "";
    try {
      if (!["http:", "https:", "mailto:"].includes(new URL(value, location.href).protocol)) unsafeProtocols += 1;
    } catch { unsafeProtocols += 1; }
  }
  const artifacts = [...root.querySelectorAll(".artifact")];
  const preformatted = [...root.querySelectorAll("pre")];
  const externalButtons = [...root.querySelectorAll(".external-markdown-link")];
  return {
    text: textEvidence(root.textContent),
    counts: {
      heading: root.querySelectorAll("h1,h2,h3").length,
      list: root.querySelectorAll("ul,ol").length,
      table: root.querySelectorAll("table").length,
      code: preformatted.length,
      math: root.querySelectorAll(".katex").length,
      link: links.length,
    },
    security: {
      unsafeElementCount: root.querySelectorAll("script,style,iframe,object,embed,img").length,
      unsafeProtocolCount: unsafeProtocols,
      imagesRemoved: root.querySelectorAll("img").length === 0,
      externalLinkConfirmation: externalButtons.length > 0 && externalButtons.every((button) => button.tagName === "BUTTON" && !button.hasAttribute("href") && button.hasAttribute("data-external-url")),
      externalLinkButtonCount: externalButtons.length,
      artifactCount: artifacts.length || preformatted.length,
      artifactControlsPresent: artifacts.length > 0 && artifacts.every((artifact) => artifact.querySelector(".artifact-header")),
      codeCopyControlCount: root.querySelectorAll("[data-copy-code]").length,
    },
  };
}
function identityReport(state) {
  const first = state.first;
  const last = state.last;
  if (!first || !last) return { rootStable: false, semanticStable: false, firstPresent: false, lastPresent: false };
  const semanticStable = first.semantic.every((nodes, index) => nodes.every((node, nodeIndex) => node === last.semantic[index]?.[nodeIndex]));
  return {
    rootStable: first.root === last.root,
    semanticStable,
    firstPresent: true,
    lastPresent: true,
  };
}

await driveBaseline();
await delay(mode === "stream" ? 700 : 350);
observeIdentity("baseline");
observeIdentity("candidate");
metrics.baseline.semantic = semanticSnapshot(baselineRoot);
metrics.candidate.semantic = semanticSnapshot(document.querySelector("#candidate .incremark"));
metrics.baseline.identity = identityReport(metrics.baseline);
metrics.candidate.identity = identityReport(metrics.candidate);
metrics.baseline.frameSummary = {
  count: metrics.baseline.frames.length,
  max: Math.max(0, ...metrics.baseline.frames),
};
metrics.candidate.frameSummary = {
  count: metrics.candidate.frames.length,
  max: Math.max(0, ...metrics.candidate.frames),
};
metrics.parity = {
  text: metrics.baseline.semantic?.text?.digest === metrics.candidate.semantic?.text?.digest,
  counts: JSON.stringify(metrics.baseline.semantic?.counts) === JSON.stringify(metrics.candidate.semantic?.counts),
  security: JSON.stringify(metrics.baseline.semantic?.security) === JSON.stringify(metrics.candidate.semantic?.security),
};
window.__incremarkSpike.done = true;
window.__incremarkSpike.report = metrics;
`;
  const jsxRuntimePath = path.join(tempDir, "node_modules", "solid-js", "h", "jsx-runtime", "dist", "jsx.js");
  const viteConfig = `import { defineConfig } from ${JSON.stringify(pathToFileURL(path.join(webRoot, "node_modules", "vite", "dist", "node", "index.js")).href)};
import solid from ${JSON.stringify(pathToFileURL(path.join(webRoot, "node_modules", "vite-plugin-solid", "dist", "esm", "index.mjs")).href)};
export default defineConfig({
  plugins: [solid()],
  resolve: {
    alias: [
      { find: "solid-js/jsx-runtime", replacement: ${JSON.stringify(jsxRuntimePath)} },
      { find: "solid-js/jsx-dev-runtime", replacement: ${JSON.stringify(jsxRuntimePath)} },
    ],
    dedupe: ["solid-js"],
  },
});
`;
  await writeFile(path.join(tempDir, "index.html"), html);
  await writeFile(path.join(tempDir, "main.js"), source);
  await writeFile(path.join(tempDir, "vite.config.js"), viteConfig);
}

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function waitForServer(url, processHandle) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (processHandle.exitCode != null || processHandle.signalCode != null) {
      throw new Error(`Vite exited before serving fixture (code ${processHandle.exitCode}, signal ${processHandle.signalCode})`);
    }
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // The server is still starting.
    }
    await sleep(50);
  }
  throw new Error("Timed out waiting for the isolated Vite fixture");
}

async function waitForSpikePage(page, vite, getViteOutput) {
  const deadline = Date.now() + 15_000;
  let lastPageError = null;
  while (Date.now() < deadline) {
    if (vite.exitCode != null || vite.signalCode != null) {
      throw new Error(`Vite exited while loading fixture (code ${vite.exitCode}, signal ${vite.signalCode})\n${getViteOutput()}`);
    }
    try {
      if (await page.evaluate(() => window.__incremarkSpike?.done === true)) return;
    } catch (error) {
      lastPageError = error;
    }
    await sleep(100);
  }
  throw new Error(`Timed out waiting for browser fixture completion${lastPageError ? `: ${lastPageError.message}` : ""}`);
}

async function runBrowserFixture(tempDir, data) {
  const port = await freePort();
  const vite = spawn(process.execPath, [viteCli, "--host", "127.0.0.1", "--port", String(port), "--strictPort"], {
    cwd: tempDir,
    env: { ...process.env, BROWSER: "none" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let viteOutput = "";
  vite.stdout.on("data", (chunk) => { viteOutput += String(chunk); });
  vite.stderr.on("data", (chunk) => { viteOutput += String(chunk); });
  await waitForServer(`http://127.0.0.1:${port}/`, vite);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const reports = [];
  try {
    for (const mode of ["content", "stream"]) {
      const page = await context.newPage();
      const pageErrors = [];
      const consoleErrors = [];
      page.on("pageerror", (error) => pageErrors.push(error.message));
      page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
      await page.route("https://example.com/**", (route) => route.abort());
      try {
        await page.goto(`http://127.0.0.1:${port}/?fixture=${encodeURIComponent(data.id)}&mode=${mode}`, { waitUntil: "networkidle" });
        await waitForSpikePage(page, vite, () => viteOutput.slice(-2_000));
        const report = await page.evaluate(() => window.__incremarkSpike.report);
        reports.push({
          ...report,
          pageErrorCount: pageErrors.length,
          consoleErrorCount: consoleErrors.length,
          pageErrors,
          consoleErrors,
        });
      } finally {
        await page.close();
      }
    }
  } finally {
    await context.close();
    await browser.close();
    vite.kill("SIGTERM");
    await new Promise((resolve) => vite.once("exit", resolve));
  }
  return { reports, viteOutput: viteOutput.slice(-2_000) };
}

function astStatistics(root) {
  const counts = {};
  const visit = (node) => {
    if (!node || typeof node !== "object") return;
    if (typeof node.type === "string") counts[node.type] = (counts[node.type] || 0) + 1;
    for (const child of node.children || []) visit(child);
  };
  visit(root);
  return counts;
}

function blockIds(update) {
  return [...(update.completed || []), ...(update.updated || []), ...(update.pending || [])].map((block) => block.id);
}

async function runCoreFixture(core, data) {
  const parser = core.createIncremarkParser({ gfm: true, math: true, htmlTree: true, containers: true });
  const pendingHistory = new Map();
  const updateStats = [];
  for (const chunk of data.chunks) {
    const update = parser.append(chunk);
    for (const id of update.pending || []) pendingHistory.set(id.id, (pendingHistory.get(id.id) || 0) + 1);
    updateStats.push({
      completed: update.completed.length,
      updated: update.updated.length,
      pending: update.pending.length,
      blockCount: blockIds(update).length,
      astTypes: astStatistics(update.ast),
    });
  }
  const finalUpdate = parser.finalize();
  const ast = parser.getAst();
  const stablePendingIds = [...pendingHistory.values()].filter((count) => count > 1).length;
  return {
    fixture: data.id,
    sourceLength: data.source.length,
    chunkCount: data.chunks.length,
    bufferMatchesSource: parser.getBuffer() === data.source,
    appendCount: updateStats.length,
    finalCompletedBlockCount: finalUpdate.completed.length,
    finalUpdatedBlockCount: finalUpdate.updated.length,
    finalPendingBlockCount: finalUpdate.pending.length,
    finalAstTypes: astStatistics(ast),
    finalTopLevelTypes: ast.children.map((node) => node.type),
    stablePendingIdCount: stablePendingIds,
    maxBlocksInUpdate: Math.max(0, ...updateStats.map((entry) => entry.blockCount)),
  };
}

async function runCoreFixtures(tempDir, data) {
  const corePath = path.join(tempDir, "node_modules", "@incremark", "core", "dist", "index.js");
  const core = await import(pathToFileURL(corePath).href);
  const reports = [];
  for (const fixture of data) reports.push(await runCoreFixture(core, fixture));
  return reports;
}

async function writeBundleEntry(tempDir, type) {
  const html = `<!doctype html><html><body><div id="root"></div><script type="module" src="/bundle-entry.js"></script></body></html>\n`;
  const source = type === "candidate"
    ? `import { createComponent } from "solid-js";\nimport { render } from "solid-js/web";\nimport { IncremarkContent } from "@incremark/solid";\nrender(() => createComponent(IncremarkContent, { content: "# Bundle estimate\\n\\nA **streaming** Markdown response.", isFinished: true }), document.querySelector("#root"));\n`
    : `import DOMPurify from "dompurify";\nimport { marked } from "marked";\nimport markedKatex from "marked-katex-extension";\nmarked.use(markedKatex({ nonStandard: true, throwOnError: false }));\nconst html = marked.parse("# Bundle estimate\\n\\nA **streaming** Markdown response.", { async: false });\ndocument.querySelector("#root").append(DOMPurify.sanitize(html, { RETURN_DOM_FRAGMENT: true }));\n`;
  await writeFile(path.join(tempDir, "index.html"), html);
  await writeFile(path.join(tempDir, "bundle-entry.js"), source);
}

async function bundleReport(tempDir, type) {
  const outputDir = path.join(tempDir, `dist-${type}`);
  await execFile(process.execPath, [viteCli, "build", "--outDir", outputDir, "--emptyOutDir"], {
    cwd: tempDir,
    maxBuffer: 32 * 1024 * 1024,
  });
  const files = [];
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(absolute);
      else if (entry.isFile()) {
        const content = await readFile(absolute);
        files.push({
          name: path.relative(outputDir, absolute).split(path.sep).join("/"),
          bytes: content.length,
          gzipBytes: (await import("node:zlib")).gzipSync(content, { level: 9 }).length,
        });
      }
    }
  }
  await visit(outputDir);
  return {
    fileCount: files.length,
    bytes: files.reduce((total, file) => total + file.bytes, 0),
    gzipBytes: files.reduce((total, file) => total + file.gzipBytes, 0),
    files: files.sort((left, right) => right.bytes - left.bytes).slice(0, 12),
  };
}

async function runBundleEstimates(tempDir) {
  const reports = {};
  for (const type of ["baseline", "candidate"]) {
    await writeBundleEntry(tempDir, type);
    reports[type] = await bundleReport(tempDir, type);
  }
  return reports;
}

function compareBrowserReport(report, data) {
  const expectedCounts = data.expectedSemanticFingerprint?.requiredNodeCounts || {};
  const baseline = report.baseline.semantic;
  const candidate = report.candidate.semantic;
  const expected = Object.fromEntries(Object.keys(expectedCounts).map((key) => [key, expectedCounts[key]]));
  const baselineContract = baseline
    ? Object.entries(expected).every(([key, value]) => baseline.counts[key] === value)
    : false;
  const candidateContract = candidate
    ? Object.entries(expected).every(([key, value]) => candidate.counts[key] === value)
    : false;
  return {
    fixture: data.id,
    mode: report.mode,
    sourceLength: data.source.length,
    chunkCount: data.chunks.length,
    baselineContract,
    candidateContract,
    textParity: report.parity.text,
    semanticParity: report.parity.counts,
    securityParity: report.parity.security,
    baseline: {
      semantic: baseline,
      mutations: report.baseline.mutations,
      frameSummary: report.baseline.frameSummary,
      identity: report.baseline.identity,
    },
    candidate: {
      semantic: candidate,
      mutations: report.candidate.mutations,
      frameSummary: report.candidate.frameSummary,
      identity: report.candidate.identity,
    },
    errors: [
      ...report.runtimeErrors,
      ...report.pageErrors,
      ...report.consoleErrors,
    ],
  };
}

function gateSummary(coreReports, browserReports, bundles) {
  const coreBufferParity = coreReports.every((report) => report.bufferMatchesSource);
  const browserParity = browserReports.filter((report) => report.mode === "stream").filter((report) => report.textParity && report.semanticParity && report.securityParity).length;
  const browserTotal = browserReports.filter((report) => report.mode === "stream").length;
  const candidateContractCount = browserReports.filter((report) => report.candidateContract).length;
  const candidateContractTotal = browserReports.length;
  const noRuntimeErrors = browserReports.every((report) => report.errors.length === 0);
  const candidateGzip = bundles.candidate?.gzipBytes ?? null;
  const baselineGzip = bundles.baseline?.gzipBytes ?? null;
  return {
    coreBufferParity,
    browserStreamParityCount: browserParity,
    browserStreamParityTotal: browserTotal,
    candidateContractCount,
    candidateContractTotal,
    noRuntimeErrors,
    candidateGzipBytes: candidateGzip,
    baselineGzipBytes: baselineGzip,
    candidateGzipDeltaBytes: candidateGzip == null || baselineGzip == null ? null : candidateGzip - baselineGzip,
    promising: coreBufferParity && browserParity === browserTotal && candidateContractCount === candidateContractTotal && noRuntimeErrors,
  };
}

async function main() {
  const startedAt = new Date().toISOString();
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "conduit-incremark-spike."));
  try {
    await installCandidate(tempDir);
    const data = [...fixtureData(), reconnectFixture()];
    const packages = await packageReport(tempDir);
    const core = await runCoreFixtures(tempDir, data);
    await writeBrowserFixture(tempDir, data);
    const browser = [];
    for (const fixture of data) {
      const result = await runBrowserFixture(tempDir, fixture);
      for (const report of result.reports) browser.push(compareBrowserReport(report, fixture));
    }
    const bundles = await runBundleEstimates(tempDir);
    const gate = gateSummary(core, browser, bundles);
    const report = {
      schemaVersion: 1,
      scenario: "slice6-incremark-compatibility",
      status: "completed",
      startedAt,
      candidate: {
        package: "@incremark/solid",
        version: candidateVersion,
        corePackage: "@incremark/core",
        coreVersion: candidateVersion,
      },
      fixture: {
        ids: data.map((item) => item.id),
        chunkSize: 3,
        sourceLengths: Object.fromEntries(data.map((item) => [item.id, item.source.length])),
      },
      packages,
      lowLevel: core,
      browser,
      bundles,
      gate,
      limitations: [
        "The candidate was measured in an isolated browser fixture, not in Conduit's production renderer.",
        "The current-renderer baseline mirrors markdown.tsx contracts but does not import production code.",
        "Incremark tool rows, thinking rows, reconnect protocol, checkpoint reconciliation, and Conduit scroll ownership are outside a Markdown renderer spike.",
        "Browser timing is a single deterministic run per fixture and is evidence for compatibility, not a provider or production latency claim.",
      ],
    };
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
