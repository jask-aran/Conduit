import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const stylesPath = path.resolve(import.meta.dirname, "../../conduit-web/src/client/styles.css");

function rule(styles, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return styles.match(new RegExp(`${escaped}\\s*\\{([^}]+)\\}`))?.[1] ?? "";
}

test("desktop panels remain docked and resize the center chat surface", async () => {
  const styles = await fs.readFile(stylesPath, "utf8");
  const sidebar = rule(styles, ".conduit-sidebar");
  const collapsedSidebar = rule(styles, ".conduit-sidebar[data-state=\"collapsed\"]");
  const workspace = rule(styles, ".workspace-panel");
  const openWorkspace = rule(styles, ".workspace-panel.workspace-panel-open");

  assert.match(sidebar, /width:\s*244px/);
  assert.match(sidebar, /transition:\s*width/);
  assert.match(collapsedSidebar, /width:\s*52px/);
  assert.match(workspace, /position:\s*relative/);
  assert.match(workspace, /width:\s*0/);
  assert.match(workspace, /transition:[^;]*width/);
  assert.match(openWorkspace, /width:\s*var\(--workspace-panel-width\)/);
});

test("reduced motion preserves the explicitly requested meteor timeline", async () => {
  const styles = await fs.readFile(stylesPath, "utf8");
  const reducedMotion = styles.match(
    /@media \(prefers-reduced-motion: reduce\) \{([\s\S]+)\}\s*$/,
  )?.[1] ?? "";

  assert.match(
    reducedMotion,
    /\.chat-meteors \.solid-meteor\s*\{\s*animation-duration:\s*var\(--meteor-duration\)\s*!important/,
  );
});
