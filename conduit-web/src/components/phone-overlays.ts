import { isMobileLayout } from "../client/navigation/mobile-layout";
import { installedClientKind } from "../client/platform/installed-client";

const menus = '[data-slot="menu-content"], [data-slot="menu-sub-content"], [data-slot="context-menu-content"], [data-slot="context-menu-sub-content"], [data-slot="popover-content"]';
const visibleMenus = () => [...document.querySelectorAll<HTMLElement>(menus)].filter((element) => element.checkVisibility());
const escape = () => {
  const child = visibleMenus().findLast((element) => element.matches('[data-slot="menu-sub-content"], [data-slot="context-menu-sub-content"]') && element.getAttribute("role") === "menu");
  if (child) {
    child.dispatchEvent(new KeyboardEvent("keydown", { key: getComputedStyle(child).direction === "rtl" ? "ArrowRight" : "ArrowLeft", bubbles: true, cancelable: true }));
    if (!child.isConnected || !child.checkVisibility()) return true;
  }
  const event = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
  document.dispatchEvent(event);
  return event.defaultPrevented;
};

// An outside touch dismisses one layer and consumes that touch, including the
// compatibility click. The next pointerdown always starts a fresh gesture.
let consumeTouch = false;
const consume = (event: Event) => { event.preventDefault(); event.stopImmediatePropagation(); };
document.addEventListener("pointerdown", (event) => {
  consumeTouch = false;
  if (!isMobileLayout()) return;
  const open = visibleMenus();
  const target = event.target;
  if (!open.length || !(target instanceof Element) || target.closest('[role="dialog"], [role="alertdialog"]')) return;
  if (open.some((menu) => menu.contains(target))) return;
  const trigger = target.closest('[aria-expanded="true"][aria-controls]');
  if (trigger && open.some((menu) => menu.id === trigger.getAttribute("aria-controls"))) return;
  consumeTouch = true;
  consume(event);
  escape();
}, true);
for (const type of ["pointerup", "mouseup", "click", "touchend"]) {
  document.addEventListener(type, (event) => { if (consumeTouch) consume(event); }, { capture: true, passive: false });
}

if (installedClientKind === "android") {
  void import("@capacitor/app").then(({ App }) => App.addListener("backButton", ({ canGoBack }) => {
    if ((visibleMenus().length || document.querySelector('[role="dialog"], [role="alertdialog"]')) && escape()) return;
    if (canGoBack) history.back();
  }));
}
