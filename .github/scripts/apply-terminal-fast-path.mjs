import fs from "node:fs";

function read(path) {
  return fs.readFileSync(path, "utf8");
}

function write(path, text) {
  fs.writeFileSync(path, text);
}

function replaceExact(text, before, after, label) {
  const first = text.indexOf(before);
  if (first < 0) throw new Error(`Missing replacement target: ${label}`);
  if (text.indexOf(before, first + before.length) >= 0) throw new Error(`Replacement target is not unique: ${label}`);
  return text.slice(0, first) + after + text.slice(first + before.length);
}

function replaceRegex(text, pattern, replacement, label) {
  const matches = [...text.matchAll(new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`))];
  if (matches.length !== 1) throw new Error(`Expected one ${label} match, found ${matches.length}`);
  return text.replace(pattern, replacement);
}

function edit(path, transform) {
  const before = read(path);
  const after = transform(before);
  if (after === before) throw new Error(`No changes produced for ${path}`);
  write(path, after);
}

edit("conduit-web/src/client/remotes/terminal-renderer.ts", (source) => {
  let text = source;
  text = replaceExact(text,
`  write: (bytes: Uint8Array) => Promise<void>;
  focus: () => void;`,
`  write: (bytes: Uint8Array) => void;
  drain: () => Promise<void>;
  focus: () => void;`,
  "renderer write/drain contract");

  text = replaceExact(text,
`  return value === "xterm" ? "xterm" : "ghostty";`,
`  return value === "ghostty" ? "ghostty" : "xterm";`,
  "xterm default renderer");

  text = replaceExact(text,
`type WritableTerminal = ResizableTerminal & RefreshableTerminal & {
  write: (bytes: Uint8Array, callback?: () => void) => void;
  options: { cursorBlink?: boolean };
};`,
`type WritableTerminal = ResizableTerminal & RefreshableTerminal & {
  write: (bytes: Uint8Array, callback?: () => void) => void;
};`,
  "writable terminal shape");

  text = replaceExact(text,
`function writeTerminal(terminal: WritableTerminal, bytes: Uint8Array) {
  return new Promise<void>((resolve) => {
    terminal.write(bytes, () => {
      terminal.options.cursorBlink = false;
      resolve();
    });
  });
}`,
`function writeTerminal(terminal: WritableTerminal, bytes: Uint8Array) {
  terminal.write(bytes);
}

function drainTerminal(terminal: WritableTerminal) {
  return new Promise<void>((resolve) => terminal.write(new Uint8Array(0), resolve));
}`,
  "direct terminal write");

  text = replaceExact(text,
`function applyFit(fit: TerminalFit, terminal?: ResizableTerminal & RefreshableTerminal) {
  // Geometry fitting and visual repainting are deliberately separate. A caller
  // that only needs to repaint must never silently change the terminal grid.
  fit.fit();
  repaintTerminal(terminal);
}`,
`function applyFit(fit: TerminalFit) {
  // FitAddon owns geometry. Repaint is reserved for visibility changes and must
  // not sit on the resize or live-output hot path.
  fit.fit();
}`,
  "fit without forced repaint");

  text = text.replaceAll("applyFit(fit, terminal);", "applyFit(fit);");
  text = text.replaceAll("applyFit(fit, refreshable)", "applyFit(fit)");
  text = text.replaceAll("applyFit(fit, terminal)", "applyFit(fit)");

  text = replaceExact(text,
`    write: (bytes) => writeTerminal(terminal as unknown as WritableTerminal, bytes),
    focus: () => terminal.focus(),`,
`    write: (bytes) => writeTerminal(terminal as unknown as WritableTerminal, bytes),
    drain: () => drainTerminal(terminal as unknown as WritableTerminal),
    focus: () => terminal.focus(),`,
  "ghostty drain");

  text = replaceExact(text,
`    write: (bytes) => writeTerminal(terminal, bytes),
    focus: () => terminal.focus(),`,
`    write: (bytes) => writeTerminal(terminal, bytes),
    drain: () => drainTerminal(terminal),
    focus: () => terminal.focus(),`,
  "xterm drain");

  return text;
});

edit("conduit-web/src/client/remotes/terminal-pane.tsx", (source) => {
  let text = source;
  text = replaceRegex(text,
/type ReplayEvent = \{ type: "resize"; cols: number; rows: number \} \| \{ type: "data"; bytes: Uint8Array \};\n\nconst PTY_REPLAY_PREFIX = "CONDUIT-PTY-REPLAY\/1\\n";\nconst replayDecoder = new TextDecoder\(\);\n\n/,
"",
"legacy replay declarations");

  text = replaceRegex(text,
/function base64Bytes\(value: string\) \{[\s\S]*?\n\}\n\nfunction decodeReplayFrame\(bytes: Uint8Array\): ReplayEvent\[\] \| null \{[\s\S]*?\n\}\n\n(?=function sessionTimestamp)/,
"",
"legacy replay decoder");

  text = replaceExact(text,
`    host.dataset.terminalRendererReadyMs = String(Math.round(performance.now() - startedAt));
    created.fit();
    return created;`,
`    host.dataset.terminalRendererReadyMs = String(Math.round(performance.now() - startedAt));
    return created;`,
  "duplicate initial fit");

  text = replaceExact(text,
`    let replaying = true;
    let replayWork = Promise.resolve();
    let firstOutput = true;
    let intentionallyClosed = false;

    const sendResize = () => {
      if (generation !== connectionGeneration || replaying || !writable() || connection.readyState !== WebSocket.OPEN) return;
      activeTerminal.fit();
      connection.send(JSON.stringify({ type: "resize", cols: activeTerminal.cols(), rows: activeTerminal.rows() }));
    };
    syncGeometry = sendResize;

    const finishReplay = () => {
      if (generation !== connectionGeneration || connection.readyState !== WebSocket.OPEN) return;
      // Keep browser-generated terminal replies suppressed until the server has
      // drained every output mutation that the headless emulator already saw.
      activeTerminal.repaint();
      connection.send(JSON.stringify({ type: "restore_ready" }));
    };`,
`    let replaying = true;
    let replayWork: Promise<void> = Promise.resolve();
    let firstOutput = true;
    let intentionallyClosed = false;
    let lastSentCols = 0;
    let lastSentRows = 0;

    const sendResize = () => {
      if (generation !== connectionGeneration || replaying || !writable() || connection.readyState !== WebSocket.OPEN) return;
      const cols = activeTerminal.cols();
      const rows = activeTerminal.rows();
      if (cols === lastSentCols && rows === lastSentRows) return;
      lastSentCols = cols;
      lastSentRows = rows;
      connection.send(JSON.stringify({ type: "resize", cols, rows }));
    };
    syncGeometry = sendResize;

    const finishReplay = () => {
      if (generation !== connectionGeneration || connection.readyState !== WebSocket.OPEN) return;
      connection.send(JSON.stringify({ type: "restore_ready" }));
    };`,
  "live geometry and replay barrier");

  text = replaceExact(text,
`          if (message.type === "replay_resize") {
            if (replaying) replayWork = replayWork.then(() => { activeTerminal.resize(message.cols, message.rows); });
            return;
          }`,
`          if (message.type === "replay_resize") {
            const cols = Math.trunc(Number(message.cols));
            const rows = Math.trunc(Number(message.rows));
            if (replaying && cols >= 1 && cols <= 500 && rows >= 1 && rows <= 500) {
              replayWork = replayWork.then(async () => {
                await activeTerminal.drain();
                if (generation === connectionGeneration) activeTerminal.resize(cols, rows);
              });
            }
            return;
          }`,
  "ordered replay resize");

  text = replaceExact(text,
`          if (message.type === "replay_end") {
            void replayWork.then(finishReplay).catch((cause) => {
              setError((cause as Error).message || "Terminal state restoration failed");
              finishReplay();
            });
            return;
          }`,
`          if (message.type === "replay_end") {
            void replayWork.then(() => activeTerminal.drain()).then(finishReplay).catch((cause) => {
              setError((cause as Error).message || "Terminal state restoration failed");
              finishReplay();
            });
            return;
          }`,
  "replay drain boundary");

  text = replaceExact(text,
`            if (message.writable === true) {
              sendResize();
              focusActiveTerminal();
            }`,
`            if (message.writable === true) {
              // Replay restores server geometry; now fit once to the actual host.
              // The onResize callback sends the changed dimensions, with the
              // explicit send below serving only as a no-op-safe fallback.
              activeTerminal.fit();
              sendResize();
              focusActiveTerminal();
            }`,
  "post-replay host fit");

  text = replaceRegex(text,
/      if \(replaying\) \{\n        let replayEvents: ReplayEvent\[\] \| null = null;[\s\S]*?\n        return;\n      \}\n      void activeTerminal\.write\(bytes\);/,
`      if (replaying) {
        // WebSocket ordering plus the explicit drain barriers around replay
        // resizes/end are sufficient; raw terminal bytes need no JSON/Base64
        // decoding or Promise allocation of their own.
        replayWork = replayWork.then(() => {
          if (generation === connectionGeneration) activeTerminal.write(bytes);
        });
        return;
      }
      activeTerminal.write(bytes);`,
  "raw replay and direct live write");

  text = replaceExact(text,
`    queueMicrotask(() => {
      terminal?.repaint();
      syncGeometry?.();
      if (!pty() && !starting()) void attachExisting(activeProjectId);
    });`,
`    queueMicrotask(() => {
      // A resident terminal may have spent time inside display:none. Fit only
      // when it becomes visible again, then repaint and publish any real grid
      // change. Normal live output never enters this path.
      terminal?.fit();
      terminal?.repaint();
      syncGeometry?.();
      if (!pty() && !starting()) void attachExisting(activeProjectId);
    });`,
  "reactivation fit");

  return text;
});

edit("conduit-web/src/pty-manager.js", (source) => {
  let text = source;
  text = replaceExact(text,
`export const PTY_MAX_REPLAY_EVENTS = 4096;
export const PTY_REPLAY_PREFIX = "CONDUIT-PTY-REPLAY/1\\n";`,
`export const PTY_MAX_REPLAY_EVENTS = 4096;`,
  "replay prefix export");

  text = replaceRegex(text,
/function encodeReplay\(events\) \{[\s\S]*?\n\}\n\n(?=class ReplayBuffer)/,
"",
"base64 replay encoder");

  text = replaceExact(text,
`    return {
      complete: this.complete,
      events,
      bytes: this.complete ? encodeReplay(events) : Buffer.alloc(0),
    };`,
`    return { complete: this.complete, events };`,
  "journal replay result");

  text = replaceExact(text,
`    if (!buffer) return { complete: false, events: [], bytes: Buffer.alloc(0), sequence };`,
`    if (!buffer) return { complete: false, events: [], sequence };`,
  "empty replay result");

  text = replaceExact(text,
`    return { complete: true, source: "state", sequence, events, bytes: encodeReplay(events) };`,
`    return { complete: true, source: "state", sequence, events };`,
  "canonical replay result");

  return text;
});

edit("conduit-web/src/server/terminal-stream.js", (source) => {
  let text = source;
  text = replaceExact(text,
`  terminals.on("resize", ({ id, cols, rows, sequence }) => {
    for (const ws of terminalClients.get(id) || []) {`,
`  terminals.on("resize", ({ id, cols, rows, sequence }) => {
    // Preserve PTY mutation order: any output accumulated earlier in this turn
    // must reach live clients before the resize that followed it.
    terminalOutput.flush(id);
    for (const ws of terminalClients.get(id) || []) {`,
  "flush output before live resize");

  text = replaceExact(text,
`      ws.send(JSON.stringify({ type: "replay_start", complete: replay.complete, source: replay.source || "journal" }));
      if (replay.bytes.length) ws.send(replay.bytes, { binary: true });
      for (const event of pending) sendRestoreEvent(ws, event);`,
`      ws.send(JSON.stringify({ type: "replay_start", complete: replay.complete, source: replay.source || "journal" }));
      // Replay uses the same wire representation as live traffic: tiny text
      // control frames for geometry and raw binary terminal bytes for output.
      // No Base64/JSON envelope sits on the browser's restore path.
      for (const event of replay.events || []) sendRestoreEvent(ws, event);
      for (const event of pending) sendRestoreEvent(ws, event);`,
  "raw replay transport");

  return text;
});

edit("conduit-web/src/pty-output-batcher.js", (source) => {
  const expected = `export class PtyOutputBatcher {
  constructor(send, { schedule = setImmediate, cancel = clearImmediate } = {}) {
    this.send = send;
    this.schedule = schedule;
    this.cancel = cancel;
    this.pending = new Map();
    this.scheduled = new Map();
  }

  append(id, bytes) {
    const chunks = this.pending.get(id) || [];
    chunks.push(bytes);
    this.pending.set(id, chunks);
    if (this.scheduled.has(id)) return;
    this.scheduled.set(id, this.schedule(() => this.flush(id)));
  }

  flush(id) {
    if (this.scheduled.has(id)) this.cancel(this.scheduled.get(id));
    this.scheduled.delete(id);
    const chunks = this.pending.get(id);
    this.pending.delete(id);
    if (!chunks?.length) return;
    this.send(id, chunks.length === 1 ? chunks[0] : Buffer.concat(chunks));
  }

  flushAll() {
    for (const id of [...this.pending.keys()]) this.flush(id);
  }
}
`;
  if (source !== expected) throw new Error("Unexpected pty-output-batcher.js contents");
  return `export const PTY_OUTPUT_BATCH_BYTES = 128 * 1024;

export class PtyOutputBatcher {
  constructor(send, { schedule = setImmediate, cancel = clearImmediate, maxBatchBytes = PTY_OUTPUT_BATCH_BYTES } = {}) {
    this.send = send;
    this.schedule = schedule;
    this.cancel = cancel;
    this.maxBatchBytes = Math.max(1, Math.trunc(Number(maxBatchBytes)) || PTY_OUTPUT_BATCH_BYTES);
    this.pending = new Map();
    this.pendingBytes = new Map();
    this.scheduled = new Map();
  }

  append(id, value) {
    const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value);
    let offset = 0;
    while (offset < bytes.length) {
      const size = this.pendingBytes.get(id) || 0;
      const room = this.maxBatchBytes - size;
      if (room <= 0) {
        this.flush(id);
        continue;
      }
      const length = Math.min(room, bytes.length - offset);
      const chunks = this.pending.get(id) || [];
      chunks.push(bytes.subarray(offset, offset + length));
      this.pending.set(id, chunks);
      this.pendingBytes.set(id, size + length);
      offset += length;
      if (size + length >= this.maxBatchBytes) this.flush(id);
    }
    if (this.pendingBytes.get(id) && !this.scheduled.has(id)) {
      this.scheduled.set(id, this.schedule(() => this.flush(id)));
    }
  }

  flush(id) {
    if (this.scheduled.has(id)) this.cancel(this.scheduled.get(id));
    this.scheduled.delete(id);
    const chunks = this.pending.get(id);
    const length = this.pendingBytes.get(id) || 0;
    this.pending.delete(id);
    this.pendingBytes.delete(id);
    if (!chunks?.length || !length) return;
    this.send(id, chunks.length === 1 ? chunks[0] : Buffer.concat(chunks, length));
  }

  flushAll() {
    for (const id of [...this.pending.keys()]) this.flush(id);
  }
}
`;
});

edit("conduit-web/test/pty-output-batcher.test.js", (source) => {
  let text = source;
  text += `\ntest("PTY output batcher bounds bulk output without reordering bytes", () => {
  const scheduler = controlledScheduler();
  const sent = [];
  const batcher = new PtyOutputBatcher(
    (id, bytes) => sent.push({ id, bytes }),
    { ...scheduler, maxBatchBytes: 5 },
  );

  batcher.append("pty-1", Buffer.from("1234567890x"));
  scheduler.run();

  assert.deepEqual(sent.map(({ id, bytes }) => [id, bytes.toString()]), [
    ["pty-1", "12345"],
    ["pty-1", "67890"],
    ["pty-1", "x"],
  ]);
});\n`;
  return text;
});

edit("conduit-web/test/pty-manager.test.js", (source) => {
  let text = source;
  text = replaceExact(text,
`import { PTY_REPLAY_PREFIX, PtyManager } from "../src/pty-manager.js";`,
`import { PtyManager } from "../src/pty-manager.js";`,
  "manager test replay import");
  text = text.replace(`  assert.equal(manager.replay(record.id).bytes.toString().startsWith(PTY_REPLAY_PREFIX), true);\n`, "");
  text = text.replaceAll(`  assert.equal(manager.replay(record.id).bytes.length, 0);\n`, "");
  text = replaceExact(text,
`  assert.deepEqual(manager.replay(record.id), { complete: false, events: [], bytes: Buffer.alloc(0), sequence: 5000 });`,
`  assert.deepEqual(manager.replay(record.id), { complete: false, events: [], sequence: 5000 });`,
  "bounded replay shape");
  return text;
});

edit("conduit-web/test/pty-transport.test.js", (source) => {
  let text = source;
  text = replaceExact(text,
`import { PTY_REPLAY_PREFIX } from "../src/pty-manager.js";\n`,
"",
  "transport replay import");
  text = replaceRegex(text,
/function replayPayload\(frame\) \{[\s\S]*?\n\}\n\n(?=test\("PTY API streams)/,
"",
"transport replay payload helper");
  text = replaceExact(text,
`    const replay = await stream.next((frame) => frame.isBinary && frame.data.toString().startsWith(PTY_REPLAY_PREFIX));
    assert.deepEqual(replayPayload(replay)[0], { type: "resize", cols: 100, rows: 30 });`,
`    const replayResize = await stream.next((frame) => !frame.isBinary && jsonFrame(frame).type === "replay_resize");
    assert.deepEqual(jsonFrame(replayResize), { type: "replay_resize", cols: 100, rows: 30 });`,
  "raw replay transport assertion");
  return text;
});

console.log("Applied terminal fast-path simplification.");
