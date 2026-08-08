import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const stylesPath = path.resolve(import.meta.dirname, "../../conduit-web/src/client/styles.css");

function rule(styles, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return styles.match(new RegExp(`${escaped}\\s*\\{([^}]+)\\}`))?.[1] ?? "";
}

test("desktop panel shells commit atomically while bounded surfaces animate", async () => {
  const styles = await fs.readFile(stylesPath, "utf8");
  const sidebar = rule(styles, ".conduit-sidebar");
  const collapsedSidebar = rule(styles, ".conduit-sidebar[data-state=\"collapsed\"]");
  const workspace = rule(styles, ".workspace-panel");
  const openWorkspace = rule(styles, ".workspace-panel.workspace-panel-open");
  const workspaceSurface = rule(styles, ".workspace-panel-surface");

  assert.match(sidebar, /width:\s*244px/);
  assert.match(sidebar, /overflow:\s*visible/);
  assert.doesNotMatch(sidebar, /transition:[^;]*width/);
  assert.match(collapsedSidebar, /width:\s*52px/);
  assert.match(workspace, /position:\s*relative/);
  assert.match(workspace, /width:\s*0/);
  assert.doesNotMatch(workspace, /transition:[^;]*width/);
  assert.match(openWorkspace, /pointer-events:\s*auto/);
  // Open shell paints panel chrome so the committed slot is not the app frame.
  assert.match(openWorkspace, /background:\s*var\(--background\)/);
  assert.match(workspaceSurface, /width:\s*var\(--workspace-panel-width\)/);
  assert.match(workspaceSurface, /position:\s*absolute/);
  assert.match(workspaceSurface, /right:\s*0/);
  assert.match(workspaceSurface, /contain:\s*layout paint/);
  assert.doesNotMatch(styles, /\.workspace-resizing \.chat-meteors/);
  const transcriptMotionShell = rule(styles, ".transcript-motion-shell");
  assert.match(transcriptMotionShell, /width:\s*100%/);
  assert.match(transcriptMotionShell, /position:\s*relative/);
  assert.match(transcriptMotionShell, /contain:\s*layout paint/);
  assert.match(transcriptMotionShell, /container-name:\s*chat-main/);
  assert.match(transcriptMotionShell, /container-type:\s*inline-size/);
  const hiddenTranscriptContent = rule(styles, "[data-transcript-visibility=\"hidden\"]");
  assert.match(hiddenTranscriptContent, /content-visibility:\s*hidden/);
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
