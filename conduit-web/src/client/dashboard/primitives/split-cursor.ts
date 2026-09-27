/**
 * A dashboard's cursor, from the keyboard, moving as the sidebar's does
 * (navigation/sidebar-cursor.ts). The cursor is the focused row and its wash;
 * no ring.
 *
 * Tab is one stop per section: the composer, then the chats list, then each
 * group of the right column, and round again -- landing where the cursor last
 * was in each. Nothing else on the dashboard is a Tab stop: the composer's
 * icons have their shortcuts, and a group's heading controls are reached from
 * its rows. Leader then C, L, P, W or T goes straight to a section.
 *
 * In a group ↑/↓ step through the rows -- across the chats list's day
 * headings -- and Home/End go to the ends; the folder shelf steps with ←/→ as
 * well. ↑ from the first row goes up into the heading's controls, where ←/→
 * step and ↓ comes back down. Enter opens, the Menu key or Shift+F10 opens the
 * row's menu, and Esc goes back to the composer.
 *
 * Pointer and keyboard move the one cursor: a pointer moving over a row takes
 * focus there while a row has it, and arrowing away from a still pointer
 * takes the rows out of hover until it moves again.
 */

const ROWS = ":is(.split-row:is(button, a), .split-group-more, .app-folder)";
const CONTROLS = ".split-group-heading :is(button, a[href])";
const INPUT = ".split-dashboard-composer :is(textarea, [contenteditable='true'])";

export type SplitSection = "composer" | "chats" | "projects" | "workspaces" | "terminals" | "changes" | "files";
export type SplitPage = "Dashboard" | "Project" | "Workspace";

const visible = (element: Element) => typeof element.checkVisibility === "function"
  ? element.checkVisibility({ visibilityProperty: true })
  : element.getClientRects().length > 0;

const installed = new Set<(section: SplitSection) => boolean>();

// The page showing, which declares what it is (data-page) and its sections
// (each group's data-section), so the leader offers only what is there.
const showing = () => [...document.querySelectorAll<HTMLElement>(".split-dashboard")].find(visible);

/** What the showing page is, for the leader's path. */
export function splitPage() {
  return showing()?.dataset.page as SplitPage | undefined;
}

/** The sections the showing page has. */
export function splitSections() {
  const root = showing();
  const sections = new Set<SplitSection>();
  if (!root) return sections;
  if (root.querySelector(INPUT)) sections.add("composer");
  for (const group of root.querySelectorAll<HTMLElement>(".split-group[data-section]")) if (visible(group)) sections.add(group.dataset.section as SplitSection);
  return sections;
}

/** Leader's go-to: move the showing dashboard's cursor to a section. */
export function focusSplitSection(section: SplitSection) {
  for (const go of installed) if (go(section)) return true;
  return false;
}

export function installSplitCursor(root: HTMLElement): () => void {
  const last = new WeakMap<Element, HTMLElement>();
  let pointerFocus = false;

  const groups = () => [...root.querySelectorAll<HTMLElement>(".split-group")]
    .filter((group) => visible(group) && group.querySelector(ROWS))
    // The chats list reads first, then the right column, top to bottom.
    .sort((a, b) => Number(b.dataset.order === "list") - Number(a.dataset.order === "list"));
  const rowsIn = (group: Element) => [...group.querySelectorAll<HTMLElement>(ROWS)].filter(visible);
  const controlsIn = (group: Element) => [...group.querySelectorAll<HTMLElement>(CONTROLS)].filter(visible);
  const composer = () => root.querySelector<HTMLElement>(INPUT);
  const keyboardCursor = (on: boolean) => {
    if (on) root.setAttribute("data-keyboard-cursor", "");
    else root.removeAttribute("data-keyboard-cursor");
  };
  const move = (to: HTMLElement | null | undefined) => {
    if (!to) return false;
    keyboardCursor(true);
    to.focus({ preventScroll: true });
    to.scrollIntoView({ block: "nearest" });
    return true;
  };
  const toComposer = () => {
    const input = composer();
    if (!input) return false;
    keyboardCursor(false);
    input.focus();
    return true;
  };
  const enter = (group: Element | undefined) => {
    if (!group) return false;
    const remembered = last.get(group);
    return move(remembered?.isConnected && visible(remembered) ? remembered : rowsIn(group)[0]);
  };
  // Tab's round: the composer, then each group.
  const tab = (from: Element | null, back: boolean) => {
    const order: Array<Element | null> = [...(composer() ? [null] : []), ...groups()];
    const at = order.indexOf(from);
    const next = order[(at + (back ? -1 : 1) + order.length) % order.length];
    return next === null ? toComposer() : enter(next!);
  };

  const go = (section: SplitSection) => {
    if (!root.isConnected || !visible(root)) return false;
    if (section === "composer") return toComposer();
    const group = root.querySelector<HTMLElement>(`.split-group[data-section="${section}"]`);
    return group ? enter(group) : false;
  };
  installed.add(go);

  const keydown = (event: KeyboardEvent) => {
    if (event.defaultPrevented || event.isComposing || event.ctrlKey || event.metaKey || event.altKey) return;
    const target = event.target instanceof HTMLElement ? event.target : null;
    if (!target || !root.contains(target)) return;
    if (event.key === "Tab" && target.matches(INPUT)) {
      if (tab(null, event.shiftKey)) { event.preventDefault(); event.stopPropagation(); }
      return;
    }
    const row = target.matches(ROWS) ? target : null;
    const control = !row && target.matches(CONTROLS) ? target : null;
    const group = (row ?? control)?.closest<HTMLElement>(".split-group");
    if (!group) return;
    const rows = rowsIn(group);
    const controls = controlsIn(group);
    let handled = true;
    if (event.key === "Tab") handled = tab(group, event.shiftKey);
    else if (event.key === "Escape") handled = toComposer();
    else if (control) {
      const index = controls.indexOf(control);
      switch (event.key) {
        case "ArrowRight": move(controls[index + 1]); break;
        case "ArrowLeft": move(controls[index - 1]); break;
        case "Home": move(controls[0]); break;
        case "End": move(controls[controls.length - 1]); break;
        case "ArrowDown": move(rows[0]); break;
        case "ArrowUp": break;
        default: handled = false;
      }
    } else {
      const index = rows.indexOf(row!);
      const shelf = row!.matches(".app-folder");
      switch (event.key) {
        case "ArrowDown": move(rows[index + 1]); break;
        case "ArrowUp": if (index > 0) move(rows[index - 1]); else move(controls[0]); break;
        case "ArrowRight": if (shelf) move(rows[index + 1]); else handled = false; break;
        case "ArrowLeft": if (shelf) move(rows[index - 1]); else handled = false; break;
        case "Home": move(rows[0]); break;
        case "End": move(rows[rows.length - 1]); break;
        case "ContextMenu":
        case "F10": {
          if (event.key === "F10" && !event.shiftKey) { handled = false; break; }
          const box = row!.getBoundingClientRect();
          row!.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: box.left + 16, clientY: box.bottom }));
          break;
        }
        default: handled = false;
      }
    }
    if (!handled) return;
    event.preventDefault();
    event.stopPropagation();
  };

  const pointermove = (event: PointerEvent) => {
    if (event.pointerType !== "mouse") return;
    keyboardCursor(false);
    const row = event.target instanceof Element ? event.target.closest<HTMLElement>(ROWS) : null;
    const focused = document.activeElement;
    if (!row || !root.contains(row) || row === focused) return;
    if (!(focused instanceof HTMLElement) || !focused.matches(ROWS) || !root.contains(focused)) return;
    pointerFocus = true;
    row.focus({ preventScroll: true });
    pointerFocus = false;
  };
  const focusin = (event: FocusEvent) => {
    const row = event.target instanceof HTMLElement ? event.target : null;
    if (!row?.matches(ROWS)) return;
    const group = row.closest(".split-group");
    if (group) last.set(group, row);
    if (!pointerFocus && row.matches(":focus-visible")) keyboardCursor(true);
  };

  // Capture, so a heading's own controls -- a segmented switch that selects on
  // arrows, a menu that opens on ↓ -- give way to the cursor.
  root.addEventListener("keydown", keydown, { capture: true });
  root.addEventListener("pointermove", pointermove);
  root.addEventListener("focusin", focusin);
  return () => {
    installed.delete(go);
    root.removeEventListener("keydown", keydown, { capture: true });
    root.removeEventListener("pointermove", pointermove);
    root.removeEventListener("focusin", focusin);
    keyboardCursor(false);
  };
}
