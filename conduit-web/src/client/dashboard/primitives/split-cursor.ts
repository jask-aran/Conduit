const ROWS = ":is(.ui-row[data-density=list]:is(button, a), .ui-dash-more, .ui-folder)";
const GROUP = ".ui-group[data-group=dash]";
const CONTROLS = ".ui-group-head :is(button, a[href])";
const INPUT = ":is(.ui-dash-composer, [data-dash-dock]) :is(textarea, [contenteditable='true'])";

export type SplitSection = "composer" | "chats" | "projects" | "workspaces" | "terminals" | "changes" | "files" | "folders";
export type SplitPage = "Dashboard" | "Project" | "Workspace" | "Harness" | "Agent";

const visible = (element: Element) => typeof element.checkVisibility === "function"
  ? element.checkVisibility({ visibilityProperty: true })
  : element.getClientRects().length > 0;

// By its root, so a command acts on the dashboard that has the keyboard, not another beside it.
const installed = new Map<HTMLElement, (section: SplitSection) => boolean>();
const focused = () => document.activeElement?.closest<HTMLElement>(".ui-dash") ?? null;

// The page showing, which declares what it is (data-page) and its sections
// (each group's data-section), so the leader offers only what is there.
const showing = () => { const here = focused(); return here && visible(here) ? here : [...document.querySelectorAll<HTMLElement>(".ui-dash")].find(visible); };

export function splitPage() {
  return showing()?.dataset.page as SplitPage | undefined;
}

export function splitSections() {
  const root = showing();
  const sections = new Set<SplitSection>();
  if (!root) return sections;
  if (root.querySelector(INPUT)) sections.add("composer");
  for (const group of root.querySelectorAll<HTMLElement>(".ui-group[data-group=dash][data-section]")) if (visible(group)) sections.add(group.dataset.section as SplitSection);
  return sections;
}

export function focusSplitSection(section: SplitSection) {
  const root = showing();
  const go = root ? installed.get(root) : undefined;
  return go ? go(section) : false;
}

export function installSplitCursor(root: HTMLElement): () => void {
  const last = new WeakMap<Element, HTMLElement>();
  let pointerFocus = false;

  const groups = () => [...root.querySelectorAll<HTMLElement>(GROUP)]
    .filter((group) => visible(group) && (rowsIn(group).length || controlsIn(group).length))
    .sort((a, b) => rank(a) - rank(b));
  const rank = (group: HTMLElement) => group.dataset.order === "list" ? 1 : 2;
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
    // A folded group is entered at its heading.
    return move(remembered?.isConnected && visible(remembered) ? remembered : rowsIn(group)[0] ?? controlsIn(group)[0]);
  };
  const tab = (from: Element | null, back: boolean) => {
    const order: Array<Element | null> = [...(composer() ? [null] : []), ...groups()];
    const at = order.indexOf(from);
    const next = order[(at + (back ? -1 : 1) + order.length) % order.length];
    return next === null ? toComposer() : enter(next!);
  };

  const go = (section: SplitSection) => {
    if (!root.isConnected || !visible(root)) return false;
    if (section === "composer") return toComposer();
    const group = root.querySelector<HTMLElement>(`.ui-group[data-group=dash][data-section="${section}"]`);
    return group ? enter(group) : false;
  };
  installed.set(root, go);

  const keydown = (event: KeyboardEvent) => {
    if (event.defaultPrevented || event.isComposing || event.ctrlKey || event.metaKey || event.altKey) return;
    const target = event.target instanceof HTMLElement ? event.target : null;
    if (!target || !root.contains(target)) return;
    // Tab in a composer whose slash menu is open completes the command: the composer's, not a section move.
    if (event.key === "Tab" && target.matches(INPUT) && target.getAttribute("aria-expanded") !== "true") {
      if (tab(null, event.shiftKey)) { event.preventDefault(); event.stopPropagation(); }
      return;
    }
    const row = target.matches(ROWS) ? target : null;
    const control = !row && target.matches(CONTROLS) ? target : null;
    const group = (row ?? control)?.closest<HTMLElement>(GROUP);
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
    const group = row.closest(GROUP);
    if (group) last.set(group, row);
    if (!pointerFocus && row.matches(":focus-visible")) keyboardCursor(true);
  };

  // Capture, so a heading's own controls -- a segmented switch that selects on
  // arrows, a menu that opens on ↓ -- give way to the cursor.
  // The browser drops :focus-visible while the window is away; hold the wash -- only a wash that showed: a row a click
  // focused (a message clicked) has none, and gains one on blur otherwise.
  const release = () => root.querySelector("[data-held]")?.removeAttribute("data-held");
  const away = () => {
    const focused = document.activeElement;
    if (focused instanceof HTMLElement && root.contains(focused) && focused.matches(`${ROWS}, ${CONTROLS}`) && focused.matches(":focus-visible")) focused.setAttribute("data-held", "");
  };
  window.addEventListener("blur", away);
  window.addEventListener("focus", release);
  root.addEventListener("focusout", release);

  root.addEventListener("keydown", keydown, { capture: true });
  root.addEventListener("pointermove", pointermove);
  root.addEventListener("focusin", focusin);
  return () => {
    if (installed.get(root) === go) installed.delete(root);
    window.removeEventListener("blur", away);
    window.removeEventListener("focus", release);
    root.removeEventListener("focusout", release);
    release();
    root.removeEventListener("keydown", keydown, { capture: true });
    root.removeEventListener("pointermove", pointermove);
    root.removeEventListener("focusin", focusin);
    keyboardCursor(false);
  };
}
