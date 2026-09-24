/**
 * The sidebar's cursor, from the keyboard (docs/ui-polish-sketch.md, section 8).
 *
 * The cursor is the focused row: its wash is the focus wash, so moving the
 * cursor is moving focus between the rows that are showing. ↑/↓ step, Home/End
 * go to the ends, → opens a folder and then steps into it, ← steps out to the
 * folder and then closes it, and Esc steps out a level at a time until it
 * leaves for the main pane. Shift+↑/↓ selects chats as a range -- selecting is
 * only more washed rows. The Menu key or Shift+F10 opens the row's menu.
 *
 * Pointer and keyboard move the one cursor. A pointer moving over a row takes
 * focus there while the sidebar has it, so arrowing carries on from where the
 * pointer is; arrowing away from a still pointer takes the rows out of hover
 * until it moves again, so the row under it does not keep a second wash --
 * as does any arrival from the keyboard, such as the go-to chord.
 */

// The rows the cursor stops on. A project is its link: the chevron beside it
// is what → and ← press.
const STOPS = ".sidebar-rail-action, .sidebar-row:not(.sidebar-project), .sidebar-project-link, .sidebar-view-more, .sidebar-harness-tile";

type SidebarCursorOptions = {
  root: HTMLElement;
  list: HTMLElement;
  hasSelection: () => boolean;
  select: (chatIds: string[]) => void;
  clearSelection: () => void;
  /** Esc from the top of the sidebar: back to the main pane. */
  onLeave: () => void;
};

const visible = (element: Element) => typeof element.checkVisibility === "function"
  ? element.checkVisibility({ visibilityProperty: true })
  : element.getClientRects().length > 0;

export function installSidebarCursor(options: SidebarCursorOptions): () => void {
  const { root, list } = options;
  let anchor: HTMLElement | null = null;
  let pointerFocus = false;

  const stops = () => [...list.querySelectorAll<HTMLElement>(STOPS)].filter(visible);
  const toggleOf = (link: Element) => link.closest(".sidebar-project")?.querySelector<HTMLButtonElement>(".sidebar-project-toggle") ?? null;
  const expanded = (link: Element) => toggleOf(link)?.getAttribute("aria-expanded") === "true";

  const keyboardCursor = (on: boolean) => {
    if (on) root.setAttribute("data-keyboard-cursor", "");
    else root.removeAttribute("data-keyboard-cursor");
  };
  const move = (to: HTMLElement | undefined) => {
    if (!to) return;
    keyboardCursor(true);
    to.focus({ preventScroll: true });
    to.scrollIntoView({ block: "nearest" });
  };
  const selectThrough = (from: HTMLElement, to: HTMLElement, all: HTMLElement[]) => {
    const a = all.indexOf(from), b = all.indexOf(to);
    options.select(all.slice(Math.min(a, b), Math.max(a, b) + 1).map((row) => row.dataset.chatId).filter((id): id is string => Boolean(id)));
  };

  const keydown = (event: KeyboardEvent) => {
    if (event.defaultPrevented || event.isComposing || event.ctrlKey || event.metaKey || event.altKey) return;
    const target = event.target instanceof HTMLElement ? event.target : null;
    const current = target?.matches(STOPS) && list.contains(target) ? target : null;
    if (!current) return;
    const all = stops();
    const index = all.indexOf(current);
    const step = (offset: number) => {
      const next = all[index + offset];
      if (!next) return;
      if (event.shiftKey) {
        anchor ??= current;
        selectThrough(anchor, next, all);
      } else {
        anchor = null;
        if (options.hasSelection()) options.clearSelection();
      }
      move(next);
    };
    const tile = current.matches(".sidebar-harness-tile");
    const body = current.closest(".sidebar-project-body");
    const link = current.matches(".sidebar-project-link") ? current : null;
    switch (event.key) {
      case "ArrowDown": step(1); break;
      case "ArrowUp": step(-1); break;
      case "Home": anchor = null; move(all[0]); break;
      case "End": anchor = null; move(all[all.length - 1]); break;
      case "ArrowRight":
        if (tile) move(current.nextElementSibling?.matches(STOPS) ? current.nextElementSibling as HTMLElement : undefined);
        else if (link && !expanded(link)) toggleOf(link)?.click();
        else if (link) move([...(link.closest(".sidebar-project-block")?.querySelectorAll<HTMLElement>(`.sidebar-project-body :is(${STOPS})`) ?? [])].find(visible));
        else return;
        break;
      case "ArrowLeft":
        if (tile) move(current.previousElementSibling?.matches(STOPS) ? current.previousElementSibling as HTMLElement : undefined);
        else if (body) move(body.closest(".sidebar-project-block")?.querySelector<HTMLElement>(".sidebar-project-link") ?? undefined);
        else if (link && expanded(link)) toggleOf(link)?.click();
        else return;
        break;
      case "Escape":
        // A selection is cleared first, by the sidebar's own Esc.
        if (options.hasSelection()) return;
        if (body) move(body.closest(".sidebar-project-block")?.querySelector<HTMLElement>(".sidebar-project-link") ?? undefined);
        else options.onLeave();
        break;
      case "ContextMenu":
      case "F10": {
        if (event.key === "F10" && !event.shiftKey) return;
        const box = current.getBoundingClientRect();
        current.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: box.left + 16, clientY: box.bottom }));
        break;
      }
      default: return;
    }
    event.preventDefault();
    event.stopPropagation();
  };

  const pointermove = (event: PointerEvent) => {
    if (event.pointerType !== "mouse") return;
    keyboardCursor(false);
    const row = event.target instanceof Element ? event.target.closest<HTMLElement>(STOPS) : null;
    const focused = document.activeElement;
    if (!row || !list.contains(row) || row === focused) return;
    if (!(focused instanceof HTMLElement) || !focused.matches(STOPS) || !list.contains(focused)) return;
    anchor = null;
    pointerFocus = true;
    row.focus({ preventScroll: true });
    pointerFocus = false;
  };
  const focusin = (event: FocusEvent) => {
    const row = event.target instanceof HTMLElement ? event.target : null;
    if (!pointerFocus && row?.matches(STOPS) && row.matches(":focus-visible")) keyboardCursor(true);
  };

  root.addEventListener("keydown", keydown);
  root.addEventListener("pointermove", pointermove);
  root.addEventListener("focusin", focusin);
  return () => {
    root.removeEventListener("focusin", focusin);
    root.removeEventListener("keydown", keydown);
    root.removeEventListener("pointermove", pointermove);
    keyboardCursor(false);
  };
}
