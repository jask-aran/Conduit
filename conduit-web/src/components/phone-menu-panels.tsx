import { Portal } from "solid-js/web";
import { createSignal, onCleanup, onMount, type ParentProps } from "solid-js";
import { createFullscreenPortalMount } from "./primitives";

/*
 * A phone menu's child panels: the parent stays open and dims, the child
 * opens beside it, and tapping the parent (or Back) returns to it.
 *
 * Kobalte's submenu places itself beside its trigger, which on a phone is off
 * the screen's edge, and opens on pointerup under a finger whose compatibility
 * mouse events follow. These panels are ordinary state instead, and the rules
 * below are what made that safe in the composer's options.
 */
export function createPhoneMenuPanels<Panel extends string>(root: Panel, open: () => boolean) {
  const [panel, setPanel] = createSignal<Panel>(root);
  /* A tap that changes the panel lands on pointerup, and the panel changes
     under the finger -- but the same tap's compatibility mouse events follow,
     onto whatever is now beneath it: the effort slider took them as a second
     choice, a submenu row as a highlight that read as a second pick. The
     whole menu stays inert until that tap is over.
     A timer alone lost the race on a slow re-render, so the tap's mouse events
     are dropped outright until the next finger comes down; the timer only
     keeps the new panel from being hit-tested in the meantime. */
  const [settling, setSettling] = createSignal(false);
  let settleTimer: number | undefined;
  let ghostTimer: number | undefined;
  let dropGhosts = false;
  const settle = () => {
    setSettling(true);
    dropGhosts = true;
    window.clearTimeout(settleTimer);
    window.clearTimeout(ghostTimer);
    settleTimer = window.setTimeout(() => setSettling(false), 400);
    ghostTimer = window.setTimeout(() => { dropGhosts = false; }, 1500);
  };
  const go = (next: Panel) => { setPanel(() => next); settle(); };
  const dropGhost = (event: Event) => {
    if (!dropGhosts) return;
    event.preventDefault();
    event.stopPropagation();
  };
  const nextTap = () => { dropGhosts = false; };
  const ghostEvents = ["mousedown", "mouseup", "click"] as const;
  window.addEventListener("pointerdown", nextTap, true);
  for (const type of ghostEvents) window.addEventListener(type, dropGhost, true);
  // Escape, and Android Back through phone-overlays, go up one level first.
  const back = (event: KeyboardEvent) => {
    if (!open() || panel() === root || event.key !== "Escape") return;
    event.preventDefault();
    event.stopImmediatePropagation();
    go(root);
  };
  document.addEventListener("keydown", back, true);
  onCleanup(() => {
    window.clearTimeout(settleTimer);
    window.clearTimeout(ghostTimer);
    window.removeEventListener("pointerdown", nextTap, true);
    for (const type of ghostEvents) window.removeEventListener(type, dropGhost, true);
    document.removeEventListener("keydown", back, true);
  });
  /** On the parent's wrapper: a touch on the dimmed parent returns to it and does nothing else. */
  const returnToRoot = (event: PointerEvent) => {
    if (panel() === root) return;
    event.preventDefault();
    event.stopPropagation();
    go(root);
  };
  /** For the menu's onPointerDownOutside: the child is portaled, so a touch in it is not "outside". */
  const keepForChild = (event: Event) => {
    if (event.target instanceof Element && event.target.closest(".phone-menu-submenu")) event.preventDefault();
  };
  return { panel, go, settling, returnToRoot, keepForChild, reset: () => setPanel(() => root) };
}

/** Portal the child beside its parent: nested backdrop filters cannot sample
 * the page through the parent's backdrop root on Android Chromium. `parent` is
 * a selector for the parent menu's content; `--phone-submenu-offset` on the
 * child says how far in from the parent's left edge it starts. */
export function PhoneMenuSubmenu(props: ParentProps<{ parent: string; class: string; settling: boolean }>) {
  const mount = createFullscreenPortalMount();
  const [position, setPosition] = createSignal({ left: "0px", bottom: "0px" });
  let panel: HTMLDivElement | undefined;
  onMount(() => {
    const parent = document.querySelector<HTMLElement>(props.parent);
    if (!parent) return;
    const place = () => {
      const box = parent.getBoundingClientRect();
      const width = panel?.getBoundingClientRect().width ?? 258;
      const inset = panel ? parseFloat(getComputedStyle(panel).getPropertyValue("--phone-submenu-offset")) || 64 : 64;
      setPosition({ left: `${Math.max(8, Math.min(box.left + inset, innerWidth - width - 8))}px`, bottom: `${innerHeight - box.bottom}px` });
    };
    const observer = new ResizeObserver(place);
    observer.observe(parent);
    place();
    window.addEventListener("resize", place);
    window.visualViewport?.addEventListener("resize", place);
    onCleanup(() => {
      observer.disconnect();
      window.removeEventListener("resize", place);
      window.visualViewport?.removeEventListener("resize", place);
    });
  });
  return <Portal mount={mount()}><div ref={panel} data-settling={props.settling} data-slot="menu-sub-content" class={`phone-menu-submenu ${props.class}`} style={{ position: "fixed", ...position() }}>{props.children}</div></Portal>;
}
