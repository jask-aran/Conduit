import fs from "node:fs/promises";

const root = new URL("../", import.meta.url);

async function read(path) {
  return fs.readFile(new URL(path, root), "utf8");
}

async function write(path, content) {
  await fs.writeFile(new URL(path, root), content, "utf8");
}

function replaceOnce(content, before, after, label) {
  const first = content.indexOf(before);
  if (first < 0) throw new Error(`Missing replacement anchor: ${label}`);
  if (content.indexOf(before, first + before.length) >= 0) throw new Error(`Replacement anchor is not unique: ${label}`);
  return content.slice(0, first) + after + content.slice(first + before.length);
}

{
  const path = "conduit-web/src/pty-manager.js";
  let content = await read(path);
  content = replaceOnce(
    content,
    `    this.states = new Map();
    this.sequences = new Map();`,
    `    this.states = new Map();
    this.sequences = new Map();
    this.protocolResponders = new Map();`,
    "protocol responder registry",
  );
  content = replaceOnce(
    content,
    `    const state = this.states.get(id);
    if (!state) return this.replay(id);`,
    `    const state = this.states.get(id);
    if (!state || state.isValid?.() === false) return this.replay(id);`,
    "invalid canonical replay fallback",
  );
  content = replaceOnce(
    content,
    `    const state = this.stateFactory({ cols: width, rows: height });
    let handle;
    try {
      handle = this.pty.spawn(template.command, template.args, { name: "xterm-256color", cols: width, rows: height, cwd, env });`,
    `    let handle;
    const state = this.stateFactory({
      cols: width,
      rows: height,
      onData: (data) => {
        if (this.protocolResponders.get(id) === false) return;
        this.handles.get(id)?.write(data);
      },
      onBackpressure: (paused) => {
        const active = this.handles.get(id);
        if (!active) return;
        if (paused) active.pause?.();
        else active.resume?.();
      },
      onInvalid: (error) => this.emit("state_error", { id, error }),
    });
    try {
      handle = this.pty.spawn(template.command, template.args, { name: "xterm-256color", cols: width, rows: height, cwd, env });`,
    "headless terminal ownership",
  );
  content = replaceOnce(
    content,
    `    this.states.set(id, state);
    this.sequences.set(id, 0);
    this.scrollback.set(id, replay);`,
    `    this.states.set(id, state);
    this.sequences.set(id, 0);
    this.protocolResponders.set(id, true);
    this.scrollback.set(id, replay);`,
    "enable detached protocol responder",
  );
  content = replaceOnce(
    content,
    `      void state.write(data).catch((error) => this.emit("state_error", { id, error }));`,
    `      void state.write(data);`,
    "bounded state output",
  );
  content = replaceOnce(
    content,
    `    void this.states.get(id)?.resize(width, height).catch((error) => this.emit("state_error", { id, error }));`,
    `    void this.states.get(id)?.resize(width, height);`,
    "bounded state resize",
  );
  content = replaceOnce(
    content,
    `  resize(id, cols, rows) {`,
    `  setProtocolResponder(id, enabled) {
    if (!this.handles.has(id)) return false;
    this.protocolResponders.set(id, enabled === true);
    return true;
  }

  resize(id, cols, rows) {`,
    "protocol responder control",
  );
  content = content.replace(/^(\s*)this\.sequences\.delete\(([^)]+)\);$/gm, "$&\n$1this.protocolResponders.delete($2);");
  content = replaceOnce(
    content,
    `    this.states.clear();
    this.sequences.clear();`,
    `    this.states.clear();
    this.sequences.clear();
    this.protocolResponders.clear();`,
    "clear protocol responders",
  );
  await write(path, content);
}
