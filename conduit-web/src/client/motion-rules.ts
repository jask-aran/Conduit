/*
 * A :has() under a descendant combinator makes Chromium re-check ancestors on every DOM change beneath the panes,
 * whether or not the root attribute gating the rule is set (~12ms of style a keystroke). So these rules exist only
 * while `data-arrival` or `data-route-motion` is on the root, added in the same task the attribute is set.
 */
const MOTION_RULES = `
:root[data-arrival="waiting"] :is(
  [data-region="sidebar"],
  [data-region="workspace-panel"],
  [data-region="workspace-rail"],
  :is(.chat-main, .main-split, :is(.chat-main, .main-split) :has(:is(.ui-composer-slot, .ui-phone-composer))) > :not(:is(.ui-composer-slot, .ui-phone-composer), :has(:is(.ui-composer-slot, .ui-phone-composer)))
) { opacity: 0; }
:root[data-arrival="arriving"] :is(
  [data-region="sidebar"],
  [data-region="workspace-panel"],
  [data-region="workspace-rail"],
  :is(.chat-main, .main-split, :is(.chat-main, .main-split) :has(:is(.ui-composer-slot, .ui-phone-composer))) > :not(:is(.ui-composer-slot, .ui-phone-composer), :has(:is(.ui-composer-slot, .ui-phone-composer)))
) { animation: ui-arrive var(--duration-gentle) var(--ease-arrive) both; }

:root[data-route-motion="leaving"] :is(.chat-main, .chat-main :has(:is(.ui-composer-slot, .ui-phone-composer))) > :not(:is(.ui-composer-slot, .ui-phone-composer), :has(:is(.ui-composer-slot, .ui-phone-composer))) {
  animation: ui-leave var(--duration-quick) var(--ease-leave) both;
}
:root[data-route-motion="arriving"] :is(.chat-main, .chat-main :has(:is(.ui-composer-slot, .ui-phone-composer))) > :not(:is(.ui-composer-slot, .ui-phone-composer), :has(:is(.ui-composer-slot, .ui-phone-composer))) {
  animation: ui-arrive var(--duration-gentle) var(--ease-arrive) both;
}
@media (prefers-reduced-motion: reduce) {
  :root[data-arrival="arriving"] :is(
    [data-region="sidebar"],
    [data-region="workspace-panel"],
    :is(.chat-main, .main-split, :is(.chat-main, .main-split) :has(:is(.ui-composer-slot, .ui-phone-composer))) > :not(:is(.ui-composer-slot, .ui-phone-composer), :has(:is(.ui-composer-slot, .ui-phone-composer)))
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
