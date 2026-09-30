/*
 * The first open's fade and a dashboard send's route motion (styles.css says
 * when each runs). Their selectors find each pane's outermost parts that do not
 * hold the composer with :has(), and a :has() under a descendant combinator
 * makes Chromium re-check ancestors on every DOM change beneath the panes --
 * whether or not the root attribute that gates the rule is set. Measured, that
 * was ~12ms of style a keystroke in a file editor and most of a streaming
 * turn's style cost (docs/design/performance-pass.md, 6). So the rules exist
 * only while `data-arrival` or `data-route-motion` is on the root: a style
 * element added in the same task the attribute is set (a mutation observer
 * runs before the next frame) and removed when both are gone.
 */
const MOTION_RULES = `
:root[data-arrival="waiting"] :is(
  [data-region="sidebar"],
  [data-region="workspace-panel"],
  .workspace-rail,
  :is(.chat-main, .main-split, :is(.chat-main, .main-split) :has([data-part="composer"])) > :not([data-part="composer"], :has([data-part="composer"]))
) { opacity: 0; }
:root[data-arrival="arriving"] :is(
  [data-region="sidebar"],
  [data-region="workspace-panel"],
  .workspace-rail,
  :is(.chat-main, .main-split, :is(.chat-main, .main-split) :has([data-part="composer"])) > :not([data-part="composer"], :has([data-part="composer"]))
) { animation: ui-arrive 300ms cubic-bezier(.2, .8, .2, 1) both; }

:root[data-route-motion="leaving"] :is(.chat-main, .chat-main :has([data-part="composer"])) > :not([data-part="composer"], :has([data-part="composer"])) {
  animation: ui-leave 200ms cubic-bezier(.4, 0, 1, 1) both;
}
:root[data-route-motion="arriving"] :is(.chat-main, .chat-main :has([data-part="composer"])) > :not([data-part="composer"], :has([data-part="composer"])) {
  animation: ui-arrive 300ms cubic-bezier(.2, .8, .2, 1) both;
}
@media (prefers-reduced-motion: reduce) {
  :root[data-arrival="arriving"] :is(
    [data-region="sidebar"],
    [data-region="workspace-panel"],
    :is(.chat-main, .main-split, :is(.chat-main, .main-split) :has([data-part="composer"])) > :not([data-part="composer"], :has([data-part="composer"]))
  ) { animation: none; }
}
`;

const root = document.documentElement;
let sheet: HTMLStyleElement | null = null;

const sync = () => {
  const running = root.hasAttribute("data-arrival") || root.hasAttribute("data-route-motion");
  if (running && !sheet) {
    sheet = document.createElement("style");
    sheet.dataset.motionRules = "";
    sheet.textContent = MOTION_RULES;
    document.head.append(sheet);
  } else if (!running && sheet) {
    sheet.remove();
    sheet = null;
  }
};

new MutationObserver(sync).observe(root, { attributes: true, attributeFilter: ["data-arrival", "data-route-motion"] });
sync();
