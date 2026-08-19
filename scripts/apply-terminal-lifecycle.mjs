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
  const path = "conduit-web/package.json";
  const pkg = JSON.parse(await read(path));
  Object.assign(pkg.dependencies, {
    "@xterm/addon-clipboard": "0.2.0",
    "@xterm/addon-fit": "0.11.0",
    "@xterm/addon-serialize": "0.14.0",
    "@xterm/headless": "6.0.0",
    "@xterm/xterm": "6.0.0",
  });
  pkg.dependencies = Object.fromEntries(Object.entries(pkg.dependencies).sort(([a], [b]) => a.localeCompare(b)));
  await write(path, `${JSON.stringify(pkg, null, 2)}\n`);
}

{
  const path = "conduit-web/src/server/routes/ptys.js";
  let content = await read(path);
  content = replaceOnce(
    content,
    '  app.get("/v0/ptys", (_request, response) => response.json({ ptys: terminals.list() }));',
    `  app.get("/v0/ptys", (request, response) => {
    const projectId = String(request.query?.projectId || "");
    const ptys = terminals.list().filter((record) => !projectId || record.projectId === projectId);
    response.json({ ptys });
  });`,
    "project-scoped PTY list",
  );
  await write(path, content);
}

{
  const path = "conduit-web/src/client/workspace/workspace-panel.tsx";
  let content = await read(path);
  content = replaceOnce(
    content,
    '  const [artifactMode, setArtifactMode] = createSignal<ArtifactMode>("outputs");\n',
    '  const [artifactMode, setArtifactMode] = createSignal<ArtifactMode>("outputs");\n  const [terminalMounted, setTerminalMounted] = createSignal(tab() === "terminal");\n',
    "terminal mounted signal",
  );
  content = replaceOnce(
    content,
    `  const selectTab = (next: PanelTab) => {
    setDetailOpen(detailOpenFor(next) === "true");
    setDetailHeight(Math.max(160, Number(localStorage.getItem(\`conduit:workspace-panel:\${props.chatId()}:\${next}:detail-height\`)) || 360));
    setTab(next);
    localStorage.setItem(storageKey(), next);
  };`,
    `  const selectTab = (next: PanelTab) => {
    setDetailOpen(detailOpenFor(next) === "true");
    setDetailHeight(Math.max(160, Number(localStorage.getItem(\`conduit:workspace-panel:\${props.chatId()}:\${next}:detail-height\`)) || 360));
    if (next === "terminal") setTerminalMounted(true);
    setTab(next);
    localStorage.setItem(storageKey(), next);
  };`,
    "select terminal tab",
  );
  content = replaceOnce(
    content,
    `      setWidth(nextWidth);
      if (props.open()) setShellWidth(nextWidth);
      setTab(nextTab);`,
    `      setWidth(nextWidth);
      if (props.open()) setShellWidth(nextWidth);
      setTerminalMounted(nextTab === "terminal");
      setTab(nextTab);`,
    "reset terminal mount on chat change",
  );
  content = replaceOnce(
    content,
    '    <Show when={tab() === "terminal"}><TerminalPane projectId={props.projectId()} /></Show>',
    `    <Show when={terminalMounted()}>
      <div class="workspace-terminal-slot" data-active={tab() === "terminal" ? "true" : "false"} aria-hidden={tab() !== "terminal"}>
        <TerminalPane projectId={props.projectId()} active={props.open() && tab() === "terminal"} />
      </div>
    </Show>`,
    "resident terminal slot",
  );
  await write(path, content);
}

{
  const path = "conduit-web/src/client/remotes/terminal-pane.css";
  let content = await read(path);
  const marker = "/* Persistent terminal lifecycle additions. */";
  if (!content.includes(marker)) {
    content += `\n\n${marker}
.workspace-terminal-slot {
  display: none;
  min-width: 0;
  min-height: 0;
  flex: 1;
  overflow: hidden;
}
.workspace-terminal-slot[data-active="true"] { display: flex; }
.workspace-terminal-slot > .terminal-pane {
  width: 100%;
  min-width: 0;
  min-height: 0;
  flex: 1;
}

.terminal-sessions-trigger {
  display: inline-flex;
  min-height: 26px;
  height: 26px;
  align-items: center;
  gap: 5px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  padding: 0 7px;
  color: var(--muted-foreground);
  font-size: 11px;
}
.terminal-sessions-trigger:hover,
.terminal-sessions-trigger[data-expanded] {
  background: var(--accent);
  color: var(--foreground);
}
.terminal-sessions-trigger svg { width: 13px; height: 13px; }
.terminal-sessions-trigger svg:last-child { width: 11px; height: 11px; }

.terminal-sessions-menu { width: min(300px, calc(100vw - 24px)); }
.terminal-session-item { align-items: flex-start; }
.terminal-session-check {
  width: 13px;
  height: 13px;
  margin-top: 2px;
  flex: none;
}
.terminal-session-check-hidden { visibility: hidden; }
.terminal-session-copy {
  display: grid;
  min-width: 0;
  gap: 1px;
}
.terminal-session-copy strong {
  overflow: hidden;
  color: var(--foreground);
  font-size: 12px;
  font-weight: 560;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.terminal-session-copy small {
  color: var(--muted-foreground);
  font: 10px ui-monospace, SFMono-Regular, Consolas, monospace;
}
.terminal-session-destroy {
  margin-top: -1px;
  padding-left: 27px;
  font-size: 11px;
}
.terminal-session-destroy svg { width: 12px; height: 12px; }
.terminal-session-empty {
  padding: 7px 8px;
  color: var(--muted-foreground);
  font-size: 11px;
  line-height: 1.4;
}
`;
  }
  await write(path, content);
}

{
  const path = "conduit-web/test/pty-manager.test.js";
  let content = await read(path);
  content = replaceOnce(
    content,
    `  const record = await manager.create({ project: { id: "workspace" }, cwd: workspace });
  const duplicate = await manager.create({ project: { id: "workspace" }, cwd: workspace });
  assert.equal(duplicate.id, record.id);
  assert.equal(pty.handles.length, 1);`,
    `  const record = await manager.create({ project: { id: "workspace" }, cwd: workspace });
  const sibling = await manager.create({ project: { id: "workspace" }, cwd: workspace });
  assert.notEqual(sibling.id, record.id);
  assert.equal(sibling.title, "Shell 2");
  assert.equal(pty.handles.length, 2);
  assert.equal(await manager.remove(sibling.id), true);`,
    "multiple PTY manager sessions",
  );
  content = replaceOnce(
    content,
    `  pty.handles[0].emit("e");
  assert.deepEqual(replayView(manager, record.id), { complete: false, events: [] });
  assert.equal(manager.replay(record.id).bytes.length, 0);
  assert.equal(manager.output(record.id).length, 0);`,
    `  pty.handles[0].emit("e");
  assert.deepEqual(replayView(manager, record.id), { complete: false, events: [] });
  assert.equal(manager.replay(record.id).bytes.length, 0);
  assert.equal(manager.output(record.id).length, 0);
  const canonical = await manager.stateReplay(record.id);
  assert.equal(canonical.source, "state");
  assert.equal(canonical.complete, true);
  assert.deepEqual(canonical.events[0], { type: "resize", cols: 120, rows: 40 });
  assert.match(canonical.events.find((event) => event.type === "data")?.bytes.toString() || "", /abcde/);`,
    "canonical state after replay overflow",
  );
  await write(path, content);
}

{
  const path = "conduit-web/test/pty-transport.test.js";
  let content = await read(path);
  content = replaceOnce(
    content,
    `    const replayStart = await stream.next((frame) => !frame.isBinary && jsonFrame(frame).type === "replay_start");
    assert.equal(jsonFrame(replayStart).complete, true);`,
    `    const replayStart = await stream.next((frame) => !frame.isBinary && jsonFrame(frame).type === "replay_start");
    assert.equal(jsonFrame(replayStart).complete, true);
    assert.equal(jsonFrame(replayStart).source, "state");`,
    "canonical replay source",
  );
  const anchor = `test("PTY API uses a linked Workspace root or the server home directory, never a browser path", async () => {`;
  const multiTest = `test("PTY API supports multiple active Project terminals and scoped session discovery", async () => {
  const harness = await startConduitHarness({ env: { SHELL: "sh" } });
  try {
    const project = await harness.createProject("Multi-terminal project");
    const other = await harness.createProject("Other terminal project");
    const first = await (await harness.request("/v0/ptys", { method: "POST", body: JSON.stringify({ projectId: project.id }) })).json();
    const second = await (await harness.request("/v0/ptys", { method: "POST", body: JSON.stringify({ projectId: project.id }) })).json();
    await harness.request("/v0/ptys", { method: "POST", body: JSON.stringify({ projectId: other.id }) });
    assert.notEqual(first.id, second.id);
    const scoped = await (await harness.request(\`/v0/ptys?projectId=\${encodeURIComponent(project.id)}\`)).json();
    assert.deepEqual(scoped.ptys.map((item) => item.id).sort(), [first.id, second.id].sort());
    assert.equal(scoped.ptys.every((item) => item.projectId === project.id && item.status === "running"), true);
  } finally {
    await harness.stop();
  }
});

`;
  content = replaceOnce(content, anchor, multiTest + anchor, "multi-terminal transport test");
  await write(path, content);
}
