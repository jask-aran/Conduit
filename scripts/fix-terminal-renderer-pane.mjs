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
  const path = "conduit-web/src/client/remotes/terminal-renderer.ts";
  let content = await read(path);
  content = replaceOnce(
    content,
    '  return value === "ghostty" ? "ghostty" : "xterm";',
    '  return value === "xterm" ? "xterm" : "ghostty";',
    "preserve Ghostty default",
  );
  content = replaceOnce(
    content,
    '  if (id === "ghostty") return createGhosttyRenderer(host);\n  return createXtermRenderer(host);',
    '  if (id === "xterm") return createXtermRenderer(host);\n  return createGhosttyRenderer(host);',
    "preserve renderer default path",
  );
  content = replaceOnce(
    content,
    `function applyFit(fit: TerminalFit, terminal?: ResizableTerminal & RefreshableTerminal) {
  // FitAddon owns renderer-specific cell metrics and the render invalidation
  // needed after a resize. A refresh after fit also repairs a renderer that was
  // hidden while its Workspace tab was inactive.
  fit.fit();
  terminal?.refresh?.(0, Math.max(0, terminal.rows - 1));
}`,
    `function repaintTerminal(terminal?: ResizableTerminal & RefreshableTerminal) {
  terminal?.refresh?.(0, Math.max(0, terminal.rows - 1));
}

function applyFit(fit: TerminalFit, terminal?: ResizableTerminal & RefreshableTerminal) {
  // Geometry fitting and visual repainting are deliberately separate. A caller
  // that only needs to repaint must never silently change the terminal grid.
  fit.fit();
  repaintTerminal(terminal);
}`,
    "separate fit and repaint",
  );
  content = replaceOnce(
    content,
    '    repaint: () => applyFit(fit, refreshable),',
    '    repaint: () => repaintTerminal(refreshable),',
    "Ghostty repaint",
  );
  content = replaceOnce(
    content,
    '  const [{ Terminal }, { FitAddon }, { ClipboardAddon }] = await Promise.all([',
    '  const [{ Terminal }, { FitAddon }, { ClipboardAddon, Base64 }] = await Promise.all([',
    "clipboard Base64 import",
  );
  content = replaceOnce(
    content,
    '  const clipboard = new ClipboardAddon();',
    `  const clipboard = new ClipboardAddon(new Base64(), {
    // OSC 52 output may offer text to the system clipboard, but a terminal
    // process cannot read the user's clipboard. Clipboard reads remain an
    // explicit user gesture through the paste shortcut below.
    readText: async () => "",
    writeText: async (selection: string, text: string) => {
      if (selection !== "c") return;
      await navigator.clipboard.writeText(text).catch(() => {});
    },
  });`,
    "Conduit clipboard provider",
  );
  content = replaceOnce(
    content,
    '    repaint: () => applyFit(fit, terminal),',
    '    repaint: () => repaintTerminal(terminal),',
    "xterm repaint",
  );
  await write(path, content);
}

{
  const path = "conduit-web/src/client/remotes/terminal-pane.tsx";
  let content = await read(path);
  content = replaceOnce(content, '    created.repaint();', '    created.fit();', "initial terminal fit");
  content = replaceOnce(
    content,
    `      activeTerminal.repaint();
      connection.send(JSON.stringify({ type: "resize", cols: activeTerminal.cols(), rows: activeTerminal.rows() }));`,
    `      activeTerminal.fit();
      connection.send(JSON.stringify({ type: "resize", cols: activeTerminal.cols(), rows: activeTerminal.rows() }));`,
    "resize uses fit",
  );
  content = replaceOnce(
    content,
    `          if (message.type === "replay_end") {`,
    `          if (message.type === "remote_resize") {
            const cols = Math.trunc(Number(message.cols));
            const rows = Math.trunc(Number(message.rows));
            if (cols >= 1 && cols <= 500 && rows >= 1 && rows <= 500) activeTerminal.resize(cols, rows);
            return;
          }
          if (message.type === "replay_end") {`,
    "remote terminal resize",
  );
  content = replaceOnce(
    content,
    `      const activeTerminal = await ensureRenderer(rendererId());
      activeTerminal.repaint();`,
    `      const activeTerminal = await ensureRenderer(rendererId());
      activeTerminal.fit();`,
    "spawn geometry fit",
  );
  await write(path, content);
}
