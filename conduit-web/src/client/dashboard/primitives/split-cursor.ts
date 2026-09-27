/**
 * A dashboard's cursor, from the keyboard, moving as the sidebar's does
 * (navigation/sidebar-cursor.ts). The cursor is the focused row and its wash;
 * no ring. ↑/↓ step within a group -- across the chats list's day headings --
 * and Home/End go to its ends; the folder shelf steps with ←/→ as well. Tab
 * and Shift+Tab move between the groups, landing where the cursor last was in
 * each. Enter opens (the row is a button or link), the Menu key or Shift+F10
 * opens the row's menu, and Esc goes back to the composer.
 *
 * Pointer and keyboard move the one cursor: a pointer moving over a row takes
 * focus there while a row has it, and arrowing away from a still pointer
 * takes the rows out of hover until it moves again.
 */

const STOPS = ":is(.split-row:is(button, a), .split-group-more, .app-folder)";

const visible = (element: Element) => typeof element.checkVisibility === "function"
  ? element.checkVisibility({ visibilityProperty: true })
  : element.getClientRects().length > 0;

export function installSplitCursor(root: HTMLElement): () => void {
  const last = new WeakMap<Element, HTMLElement>();
  let pointerFocus = false;

  const groups = () => [...root.querySelectorAll<HTMLElement>(".split-group")]
    .filter((group) => visible(group) && group.querySelector(STOPS))
    // The chats list reads first, then the right column, top to bottom.
    .sort((a, b) => Number(b.dataset.order === "list") - Number(a.dataset.order === "list"));
  const stopsIn = (group: Element) => [...group.querySelectorAll<HTMLElement>(STOPS)].filter(visible);
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
  const enter = (group: Element) => {
    const remembered = last.get(group);
    move(remembered?.isConnected && visible(remembered) ? remembered : stopsIn(group)[0]);
  };
  const composer = () => root.querySelector<HTMLElement>(".split-dashboard-composer :is(textarea, [contenteditable='true'])");

  const keydown = (event: KeyboardEvent) => {
    if (event.defaultPrevented || event.isComposing || event.ctrlKey || event.metaKey || event.altKey) return;
    const target = event.target instanceof HTMLElement ? event.target : null;
    const current = target?.matches(STOPS) && root.contains(target) ? target : null;
    const group = current?.closest<HTMLElement>(".split-group");
    if (!current || !group) return;
    const all = stopsIn(group);
    const index = all.indexOf(current);
    const shelf = current.matches(".app-folder");
    switch (event.key) {
      case "ArrowDown": move(all[index + 1]); break;
      case "ArrowUp": move(all[index - 1]); break;
      case "ArrowRight": if (!shelf) return; move(all[index + 1]); break;
      case "ArrowLeft": if (!shelf) return; move(all[index - 1]); break;
      case "Home": move(all[0]); break;
      case "End": move(all[all.length - 1]); break;
      case "Tab": {
        const order = groups();
        const next = order[order.indexOf(group) + (event.shiftKey ? -1 : 1)];
        const input = composer();
        if (next) enter(next);
        else if (event.shiftKey && input) { keyboardCursor(false); input.focus(); }
        else return;
        break;
      }
      case "Escape": {
        const input = composer();
        if (!input) return;
        keyboardCursor(false);
        input.focus();
        break;
      }
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
    if (!row || !root.contains(row) || row === focused) return;
    if (!(focused instanceof HTMLElement) || !focused.matches(STOPS) || !root.contains(focused)) return;
    pointerFocus = true;
    row.focus({ preventScroll: true });
    pointerFocus = false;
  };
  const focusin = (event: FocusEvent) => {
    const row = event.target instanceof HTMLElement ? event.target : null;
    if (!row?.matches(STOPS)) return;
    const group = row.closest(".split-group");
    if (group) last.set(group, row);
    if (!pointerFocus && row.matches(":focus-visible")) keyboardCursor(true);
  };

  root.addEventListener("keydown", keydown);
  root.addEventListener("pointermove", pointermove);
  root.addEventListener("focusin", focusin);
  return () => {
    root.removeEventListener("keydown", keydown);
    root.removeEventListener("pointermove", pointermove);
    root.removeEventListener("focusin", focusin);
    keyboardCursor(false);
  };
}
