import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const stylesPath = path.resolve(import.meta.dirname, "../../conduit-web/src/client/styles.css");
const performanceComposerStylesPath = path.resolve(import.meta.dirname, "../../conduit-web/src/client/chat/performance-composer.css");
const liquidGlassSurfacePath = path.resolve(import.meta.dirname, "../../conduit-web/src/client/chat/liquid-glass-surface.tsx");
const panelMotionPath = path.resolve(import.meta.dirname, "../../conduit-web/src/client/panel-motion.ts");
const mainPath = path.resolve(import.meta.dirname, "../../conduit-web/src/client/main.tsx");
const transcriptPath = path.resolve(import.meta.dirname, "../../conduit-web/src/client/chat/transcript.tsx");
const transcriptVisibilityPath = path.resolve(import.meta.dirname, "../../conduit-web/src/client/chat/transcript-visibility.ts");
const sidebarPath = path.resolve(import.meta.dirname, "../../conduit-web/src/client/navigation/sidebar.tsx");
const sidebarStylesPath = path.resolve(import.meta.dirname, "../../conduit-web/src/client/navigation/sidebar.css");
const workspaceStylesPath = path.resolve(import.meta.dirname, "../../conduit-web/src/client/workspace/workspace.css");

function rule(styles, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return styles.match(new RegExp(`${escaped}\\s*\\{([^}]+)\\}`))?.[1] ?? "";
}

test("desktop panel shells transition open and close while surfaces fill the shell", async () => {
  const styles = await fs.readFile(stylesPath, "utf8");
  const sidebarStyles = await fs.readFile(sidebarStylesPath, "utf8");
  const workspaceStyles = await fs.readFile(workspaceStylesPath, "utf8");
  const sidebar = rule(sidebarStyles, ".conduit-sidebar");
  const collapsedSidebar = rule(sidebarStyles, ".conduit-sidebar[data-state=\"collapsed\"]");
  const sidebarContainer = rule(sidebarStyles, ".sidebar-container");
  const workspace = rule(workspaceStyles, ".workspace-panel");
  const openWorkspace = rule(workspaceStyles, ".workspace-panel.workspace-panel-open");
  const workspaceSurface = rule(workspaceStyles, ".workspace-panel-surface");
  const resizeHandle = rule(workspaceStyles, ".workspace-resize-handle");

  assert.match(sidebar, /width:\s*244px/);
  assert.match(sidebar, /overflow:\s*hidden/);
  assert.match(sidebar, /transition:[^;]*width/);
  assert.match(collapsedSidebar, /width:\s*52px/);
  assert.match(sidebarContainer, /position:\s*absolute/);
  assert.match(sidebarContainer, /right:\s*0/);
  assert.match(sidebarContainer, /width:\s*244px/);
  assert.match(workspace, /position:\s*relative/);
  assert.match(workspace, /width:\s*0/);
  assert.match(workspace, /overflow:\s*visible/);
  assert.match(workspace, /transition:[^;]*width/);
  assert.match(openWorkspace, /pointer-events:\s*auto/);
  assert.match(openWorkspace, /background:\s*var\(--background\)/);
  assert.match(workspaceSurface, /width:\s*var\(--workspace-panel-width\)/);
  assert.match(workspaceSurface, /position:\s*absolute/);
  assert.match(workspaceSurface, /right:\s*0/);
  assert.match(workspaceSurface, /contain:\s*layout paint/);
  assert.match(resizeHandle, /left:\s*-12px/);
  assert.match(resizeHandle, /width:\s*24px/);
  assert.doesNotMatch(styles, /\.workspace-resizing \.chat-meteors/);
  const transcriptMotionShell = rule(styles, ".transcript-motion-shell");
  assert.match(transcriptMotionShell, /width:\s*100%/);
  assert.match(transcriptMotionShell, /position:\s*relative/);
  assert.match(transcriptMotionShell, /contain:\s*layout/);
  assert.doesNotMatch(transcriptMotionShell, /transform:\s*translate3d/);
  assert.doesNotMatch(transcriptMotionShell, /will-change:\s*transform/);
  assert.match(transcriptMotionShell, /container-name:\s*chat-main/);
  assert.match(transcriptMotionShell, /container-type:\s*inline-size/);
  const settingsRailNav = rule(styles, ".settings-rail nav");
  assert.match(settingsRailNav, /display:\s*flex/);
  assert.match(settingsRailNav, /flex-direction:\s*column/);
  const hiddenTranscriptContent = rule(styles, "[data-transcript-visibility=\"hidden\"]");
  assert.match(hiddenTranscriptContent, /content-visibility:\s*hidden/);
});

test("desktop open-close uses atomic geometry, compositor surfaces, and motion-safe frost", async () => {
  const [performanceStyles, panelMotion, sidebarSource] = await Promise.all([
    fs.readFile(performanceComposerStylesPath, "utf8"),
    fs.readFile(panelMotionPath, "utf8"),
    fs.readFile(sidebarPath, "utf8"),
  ]);

  const sidebarMotion = rule(performanceStyles, '.conduit-sidebar[data-compositor-motion="true"]');
  assert.match(sidebarMotion, /overflow:\s*visible/);
  assert.match(sidebarMotion, /transition:\s*none\s*!important/);

  assert.match(sidebarSource, /targetSize:\s*targetWidth/);
  assert.match(sidebarSource, /sidebarSurface\.animate\(/);
  assert.match(sidebarSource, /setShellWidth\(targetWidth\)/);
  assert.doesNotMatch(sidebarSource, /sampleEdge|sidebarEdgeRaf|getBoundingClientRect\(\)\.width/);

  assert.match(panelMotion, /document\.querySelector<HTMLElement>\("\.composer-wrap"\)/);
  assert.match(panelMotion, /naturalShift = detail\.source === "sidebar" \? delta \/ 2 : -delta \/ 2/);
  assert.match(panelMotion, /document\.body\.dataset\.panelGeometryMotion = "true"/);

  const movingFrost = rule(performanceStyles, 'body[data-panel-geometry-motion="true"] .composer[data-composer-surface="frost"]');
  assert.match(movingFrost, /backdrop-filter:\s*none/);
  assert.match(movingFrost, /-webkit-backdrop-filter:\s*none/);
  assert.match(movingFrost, /color-mix\(in oklch, var\(--background\), transparent 18%\)/);
});

test("static composer keeps material chrome without sampling transcript pixels", async () => {
  const performanceStyles = await fs.readFile(performanceComposerStylesPath, "utf8");
  const staticSurface = rule(performanceStyles, '.composer[data-composer-surface="static"]');
  const staticRim = rule(performanceStyles, '.composer[data-composer-surface="static"]::before');
  const staticSheen = rule(performanceStyles, '.composer[data-composer-surface="static"]::after');

  assert.match(staticSurface, /background:[\s\S]*var\(--background\)/);
  assert.match(staticSurface, /backdrop-filter:\s*none/);
  assert.match(staticSurface, /-webkit-backdrop-filter:\s*none/);
  assert.match(staticRim, /content:\s*""/);
  assert.match(staticRim, /linear-gradient\(150deg/);
  assert.match(staticSheen, /content:\s*""/);
  assert.match(staticSheen, /radial-gradient\(150% 72%/);
});

test("liquid glass maps use measured user-space composer dimensions", async () => {
  const liquidSurface = await fs.readFile(liquidGlassSurfacePath, "utf8");

  assert.match(liquidSurface, /primitiveUnits="userSpaceOnUse"/);
  assert.match(liquidSurface, /setFilterWidth\(width\)/);
  assert.match(liquidSurface, /setFilterHeight\(height\)/);
  assert.match(liquidSurface, /width=\{filterWidth\(\)\}/);
  assert.match(liquidSurface, /height=\{filterHeight\(\)\}/);
  assert.doesNotMatch(liquidSurface, /<feImage[^>]+width="100%"/);
  assert.doesNotMatch(liquidSurface, /<feImage[^>]+height="100%"/);
});

test("composer remains a sibling overlay outside the transcript motion island", async () => {
  const [main, transcript, transcriptVisibility, performanceStyles] = await Promise.all([
    fs.readFile(mainPath, "utf8"),
    fs.readFile(transcriptPath, "utf8"),
    fs.readFile(transcriptVisibilityPath, "utf8"),
    fs.readFile(performanceComposerStylesPath, "utf8"),
  ]);

  const transcriptIndex = main.indexOf("<Transcript chat={chat}");
  const composerIndex = main.indexOf('<div class="composer-stack">', transcriptIndex);
  assert.ok(transcriptIndex >= 0, "main.tsx should render Transcript");
  assert.ok(composerIndex > transcriptIndex, "composer should be painted after Transcript as its sibling");
  assert.doesNotMatch(transcript, /stickyFooter|footer\?:\s*JSX\.Element|props\.(stickyFooter|footer)/);

  const motionShell = rule(performanceStyles, ".transcript-motion-shell");
  assert.equal(motionShell, "");
  assert.match(transcriptVisibility, /DISPLAY_MATH_SELECTOR/);
  assert.match(transcriptVisibility, /containsDisplayMath/);
  assert.match(transcriptVisibility, /stableIncremarkBlocks/);
  assert.match(transcriptVisibility, /hasDisplayMath/);

  const composerOverlay = rule(performanceStyles, ".chat-main:not(.chat-main-empty) .composer-stack");
  assert.match(composerOverlay, /position:\s*absolute/);
  assert.match(composerOverlay, /bottom:\s*0/);
  assert.match(composerOverlay, /z-index:\s*2/);
  assert.match(composerOverlay, /background:\s*transparent/);

  const frost = rule(performanceStyles, '.composer[data-composer-surface="frost"]');
  assert.match(frost, /backdrop-filter:\s*blur\(24px\)/);
  assert.doesNotMatch(performanceStyles, /position:\s*sticky/);
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
