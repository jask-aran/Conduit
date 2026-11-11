import { isMobileLayout } from "../client/navigation/mobile-layout";
import { installedClientKind } from "../client/platform/installed-client";
import { stepBack } from "./ui/back";

// Every menu, submenu and popover is drawn by the library (its slots are ui-*).
const menus = '[data-slot^="ui-"]';
// A menu playing its leave (data-closed) is already gone: the next touch is for what is under it.
const gone = (element: HTMLElement) => !element.isConnected || element.hasAttribute("data-closed") || !element.checkVisibility();
const visibleMenus = () => [...document.querySelectorAll<HTMLElement>(menus)].filter((element) => !gone(element));
export const phoneLayerOpen = () => visibleMenus().length > 0;
const escape = () => {
  const child = visibleMenus().findLast((element) => element.matches('[data-slot="ui-menu-sub-content"], [data-slot="ui-context-menu-sub-content"]') && element.getAttribute("role") === "menu");
  if (child) {
    child.dispatchEvent(new KeyboardEvent("keydown", { key: getComputedStyle(child).direction === "rtl" ? "ArrowRight" : "ArrowLeft", bubbles: true, cancelable: true }));
    if (gone(child)) return true;
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
    // One step: a menu shuts first; then whatever holds a step back (back.ts); then a dialog that holds none, by
    // Escape; and only then the app's own history.
    if (visibleMenus().length && (escape() || !visibleMenus().length)) return;
    if (stepBack()) return;
    const dialogs = () => [...document.querySelectorAll<HTMLElement>('[role="dialog"], [role="alertdialog"]')].filter((element) => !gone(element) && element.dataset.state !== "closed").length;
    const open = dialogs();
    if (open && (escape() || dialogs() < open)) return;
    if (canGoBack) history.back();
  }));
}
