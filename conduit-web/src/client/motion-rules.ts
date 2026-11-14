/*
 * These rules exist only while `data-arrival` or `data-route-motion` is on the root, added in the same task the
 * attribute is set, so the rest of the time no restyle matches against them. While they exist, what holds a composer
 * in a pane is marked `data-holds-composer` (kept true as the panes render), in place of a :has() (check-conventions
 * rule 11): everything else in the pane fades.
 */
const COMPOSER = ".ui-composer-slot, .ui-phone-composer";
const HOLDS = "data-holds-composer";
const FADES = `:is(.chat-main, .main-split, [${HOLDS}]) > :not(${COMPOSER}, [${HOLDS}])`;
const ROUTE_FADES = `:is(.chat-main, .chat-main [${HOLDS}]) > :not(${COMPOSER}, [${HOLDS}])`;
const MOTION_RULES = `
:root[data-arrival="waiting"] :is(
  [data-region="sidebar"],
  [data-region="workspace-panel"],
  [data-region="workspace-rail"],
  ${FADES}
) { opacity: 0; }
:root[data-arrival="arriving"] :is(
  [data-region="sidebar"],
  [data-region="workspace-panel"],
  [data-region="workspace-rail"],
  ${FADES}
) { animation: ui-arrive var(--duration-gentle) var(--ease-arrive) both; }

:root[data-route-motion="leaving"] ${ROUTE_FADES} {
  animation: ui-leave var(--duration-quick) var(--ease-leave) both;
}
:root[data-route-motion="arriving"] ${ROUTE_FADES} {
  animation: ui-arrive var(--duration-gentle) var(--ease-arrive) both;
}
@media (prefers-reduced-motion: reduce) {
  :root[data-arrival="arriving"] :is(
    [data-region="sidebar"],
    [data-region="workspace-panel"],
    ${FADES}
  ) { animation: none; }
}
`;

const root = document.documentElement;
let sheet: HTMLStyleElement | null = null;
let held = new Set<Element>();

const mark = () => {
  const next = new Set<Element>();
  for (const composer of document.querySelectorAll(COMPOSER)) {
    const pane = composer.closest(".chat-main, .main-split");
    for (let at = composer.parentElement; pane && at && at !== pane; at = at.parentElement) next.add(at);
  }
  for (const at of held) if (!next.has(at)) at.removeAttribute(HOLDS);
  for (const at of next) if (!held.has(at)) at.setAttribute(HOLDS, "");
  held = next;
};
const panes = new MutationObserver(mark);

const sync = () => {
  const running = root.hasAttribute("data-arrival") || root.hasAttribute("data-route-motion");
  if (running && !sheet) {
    mark();
    panes.observe(document.body, { childList: true, subtree: true });
    sheet = document.createElement("style");
    sheet.dataset.motionRules = "";
    sheet.textContent = MOTION_RULES;
    document.head.append(sheet);
  } else if (!running && sheet) {
    sheet.remove();
    sheet = null;
    panes.disconnect();
    for (const at of held) at.removeAttribute(HOLDS);
    held = new Set();
  }
};

new MutationObserver(sync).observe(root, { attributes: true, attributeFilter: ["data-arrival", "data-route-motion"] });
sync();
