import { DropdownMenu as KMenu } from "@kobalte/core/dropdown-menu";
import { Popover as KPopover } from "@kobalte/core/popover";
import { ContextMenu as KContextMenu } from "@kobalte/core/context-menu";
import type { FocusOutsideEvent } from "@kobalte/core";
import { createContext, createEffect, Index, Show, type ValidComponent, createMemo, createSignal, createUniqueId, For, on, onCleanup, onMount, splitProps, useContext, type ComponentProps, type JSX, type ParentProps } from "solid-js";
import { haptic } from "./ui/haptics";
import { createFullscreenPortalMount } from "./portal";

/*
 * Row menus wait for the first open to have been shown. Every chat, folder and project row carries a context menu, and
 * building the menu machinery for each one was a tenth of a second of a phone's first open. Until `attachRowMenus()` the
 * rows draw as the elements they wrap and their menus are absent; then each row is redrawn with its menu, well before
 * anyone could right-click or long-press it.
 */
const [rowMenusAttached, setRowMenusAttached] = createSignal(false);
export const attachRowMenus = () => setRowMenusAttached(true);
import { Dynamic } from "solid-js/web";
import { Menu as Surface, type Measure, MenuAction, Item, RowAction, RowGroup, Section, MenuPanel, MenuParent, MenuNote, SearchSection } from "./ui/popover";
import { Button, SelectTrigger, SliderValue } from "./ui/controls";
import { PillButton } from "./ui/pill";
// Both are measured once and kept until the window or the Interface size changes: Kobalte reads them on every position
// update, and a probe each time laid the page out again before floating-ui measured.
let edges: unknown, gapPx: number | undefined;
if (typeof window !== "undefined") for (const change of ["resize", "conduit:ui-scale"]) addEventListener(change, () => { edges = gapPx = undefined; });
/** The room a popover keeps from the window's edges: a gutter, and the system bars an edge-to-edge window draws
 *  under (the safe area), so a menu never runs under a phone's navigation bar. */
export function edgePadding() { return (edges ??= measureEdges()) as number; }
function measureEdges() {
  const probe = document.createElement("div");
  probe.style.cssText = "position:fixed;visibility:hidden;pointer-events:none;padding:var(--safe-area-inset-top, env(safe-area-inset-top, 0px)) var(--safe-area-inset-right, env(safe-area-inset-right, 0px)) var(--safe-area-inset-bottom, env(safe-area-inset-bottom, 0px)) var(--safe-area-inset-left, env(safe-area-inset-left, 0px))";
  document.body.append(probe);
  const style = getComputedStyle(probe);
  const side = (inset: string) => 8 + (parseFloat(inset) || 0);
  const padding = { top: side(style.paddingTop), right: side(style.paddingRight), bottom: side(style.paddingBottom), left: side(style.paddingLeft) };
  probe.remove();
  // Each edge its own: one number for all four pushed a menu off a phone's left edge by its status bar's height.
  // Kobalte passes it to floating-ui, which takes a side each, though Kobalte's type says a number.
  return padding as unknown as number;
}
/** The room between a control and the popover it opens (--popover-gap): touching it, the menu read as part of the
 *  control. A Kobalte gutter is a number, so the step is measured. */
export function popoverGap() { return gapPx ??= measureGap(); }
function measureGap() {
  const probe = document.createElement("div");
  probe.style.cssText = "position:fixed;visibility:hidden;pointer-events:none;width:var(--popover-gap)";
  document.body.append(probe);
  const gap = probe.getBoundingClientRect().width;
  probe.remove();
  return gap;
}
export const DropdownMenu = Object.assign((props: ComponentProps<typeof KMenu>) => {
  // Measured once, as the menu is made: inside the JSX each is a getter Kobalte reads on every position update.
  const padding = edgePadding(), gap = popoverGap();
  return <KMenu overflowPadding={padding} gutter={gap} {...props} onOpenChange={(open) => { if (!open) haptic("dismiss"); props.onOpenChange?.(open); }} />;
}, KMenu);
/** A row's right-click (or long-press, Menu, Shift+F10) menu. Its rows, sections, choices and submenus are the
 *  Menu's own (MenuRow, MenuSection, MenuRadioItem, MenuSub), which work in either. */
export const ContextMenu = (props: ParentProps<{ placement?: "right-start" | "bottom-start"; onOpenChange?: (open: boolean) => void }>) =>
  <Show when={rowMenusAttached()} fallback={<RowMenuDeferred.Provider value={true}>{props.children}</RowMenuDeferred.Provider>}>
    <KContextMenu modal={false} fitViewport overflowPadding={edgePadding()} placement={props.placement ?? "right-start"} onOpenChange={(open) => { haptic(open ? "hold" : "dismiss"); props.onOpenChange?.(open); }}>{props.children}</KContextMenu>
  </Show>;
/* Until the first open has been shown (attachRowMenus), a row draws as the element it wraps and has no menu:
   building every row's menu machinery was a tenth of a second of a phone's first open. */
const RowMenuDeferred = createContext(false);
// Typed as Kobalte's own trigger, so each row's props are checked as before.
export const ContextMenuTrigger = ((props: Record<string, unknown>) => {
  if (!useContext(RowMenuDeferred)) return <KContextMenu.Trigger {...props} />;
  const [local, rest] = splitProps(props, ["as"]);
  return <Dynamic component={(local.as as ValidComponent | undefined) || "div"} {...rest} />;
}) as typeof KContextMenu.Trigger;
export const MenuGroup = KMenu.Group;
export const ContextMenuGroup = KContextMenu.Group;
/** A menu opened by the caller's own control (`as`: a HeaderButton). */
export const MenuControl = KMenu.Trigger;
export function MenuTrigger(props: ParentProps<{ disabled?: boolean; "aria-label"?: string }>) { return <KMenu.Trigger as={Button} variant="ghost" {...props} />; }
/** A pill that opens a menu without taking focus from what is being typed: a tap leaves focus where it
 *  is, and while `keep()` the menu's closing focus is not handed to it either (on a phone, even a
 *  moment away from the text makes Android drop and re-raise the keyboard). */
export function MenuPillTrigger(props: { label: string; icon: JSX.Element; open?: boolean; disabled?: boolean; keep: () => boolean; ref?: (element: HTMLButtonElement) => void }) {
  return <KMenu.Trigger as={(attrs: ComponentProps<typeof PillButton>["button"]) => <PillButton label={props.label} icon={props.icon} open={props.open} button={attrs} />}
    disabled={props.disabled} onPointerDown={(event: PointerEvent) => event.preventDefault()}
    ref={(element: HTMLButtonElement) => { holdFocus(element, props.keep); props.ref?.(element); }} />;
}
/** An element that declines focus while `keep()`: Kobalte's own focus calls (the trigger on close, the menu on open) leave the typing where it is. */
function holdFocus(element: HTMLElement, keep: () => boolean) {
  const focus = element.focus.bind(element);
  element.focus = (options?: FocusOptions) => { if (!keep()) focus(options); };
}
type Caps = { width?: Measure; height?: Measure; unfolds?: boolean };
type ContentProps = ParentProps<Caps & { keep?: () => boolean; onOpenAutoFocus?: (event: Event) => void; onPointerDownOutside?: (event: Event) => void; onFocusOutside?: (event: FocusOutsideEvent) => void; onCloseAutoFocus?: (event: Event) => void }>;
type RowProps = Omit<ComponentProps<typeof Item>, "onSelect"> & { onSelect?: () => void; closeOnSelect?: boolean };
type ChoiceProps = RowProps & { value: string };
/** keep: while true, opening leaves focus where it is (MenuPillTrigger's typing). */
export function MenuContent(props: ContentProps) {
  const mount = createFullscreenPortalMount();
  const [local, rest] = splitProps(props, ["keep"]);
  return <KMenu.Portal mount={mount()}><KMenu.Content as={Surface} data-slot="ui-menu-content" style={{ "--menu-room": "var(--kb-popper-content-available-height)" }}
    ref={(element: HTMLElement) => { if (local.keep) holdFocus(element, local.keep); }} {...rest}><MenuBody>{props.children}</MenuBody></KMenu.Content></KMenu.Portal>;
}
export function ContextMenuContent(props: ParentProps<Caps>) {
  if (useContext(RowMenuDeferred)) return null;
  const mount = createFullscreenPortalMount();
  return <KContextMenu.Portal mount={mount()}><KContextMenu.Content as={Surface} data-slot="ui-context-menu-content" width={props.width} height={props.height} style={{ "--menu-room": "var(--kb-popper-content-available-height)" }}><MenuBody>{props.children}</MenuBody></KContextMenu.Content></KContextMenu.Portal>;
}
type ItemProps = ParentProps<{ disabled?: boolean; variant?: "destructive"; onSelect?: () => void }>;
export const MenuItem = (props: ItemProps) => <KMenu.Item as={MenuAction} disabled={props.disabled} onSelect={props.onSelect} data-destructive={props.variant === "destructive" ? "" : undefined}>{props.children}</KMenu.Item>;
export const ContextMenuItem = (props: ItemProps) => <KContextMenu.Item as={MenuAction} disabled={props.disabled} onSelect={props.onSelect} data-destructive={props.variant === "destructive" ? "" : undefined}>{props.children}</KContextMenu.Item>;

/** Choice rows and submenus: Kobalte supplies behavior, Item supplies its parts. */
export const MenuRadioGroup = KMenu.RadioGroup;
export const MenuRadioItem = (props: ChoiceProps) => <KMenu.RadioItem as={Item} {...props} closeOnSelect={props.closeOnSelect ?? true} />;
export const MenuSubTrigger = (props: RowProps) => {
  const submenu = useContext(SubmenuContext);
  return <KMenu.SubTrigger as={Item} {...props} ref={submenu?.setTrigger} onPointerMove={(event: PointerEvent) => { if (submenu?.phone()) event.preventDefault(); }} opens />;
};
/** A Slider's value as the submenu's trigger: its levels to pick from, beside the slider. */
export const MenuSubValue = (props: ParentProps<{ disabled?: boolean }>) => {
  const submenu = useContext(SubmenuContext);
  return <KMenu.SubTrigger as={SliderValue} disabled={props.disabled} ref={submenu?.setTrigger} onPointerMove={(event: PointerEvent) => { if (submenu?.phone()) event.preventDefault(); }}>{props.children}</KMenu.SubTrigger>;
};
/** Back to the parent from inside a submenu: a choice there that leaves the parent open (the next pick is often beside it). */
export const useMenuBack = () => useContext(SubmenuContext)?.close ?? (() => {});
export function MenuSubContent(props: ParentProps<Caps>) {
  const mount = createFullscreenPortalMount();
  const submenu = useContext(SubmenuContext);
  return <KMenu.Portal mount={mount()}><KMenu.SubContent as={submenu?.phone() ? MenuPanel : Surface} ref={submenu?.setContent} data-slot="ui-menu-sub-content" width={props.width} height={props.height}
    style={{ "--menu-room": "var(--kb-popper-content-available-height)" }}><MenuBody>{props.children}</MenuBody></KMenu.SubContent></KMenu.Portal>;
}
export const MenuSection = (props: ParentProps<{ title?: string; note?: JSX.Element }>) => <KMenu.Group as={Section} title={props.title} note={props.note}>{props.children}</KMenu.Group>;
/** actions: the row's own actions beside it, each a menu item (RowGroup): Down reaches them in turn after the row, and
 *  choosing one runs it and closes the menu as the row does. A getter keeps one live (disabled while busy). */
export type MenuRowAction = { label: string; icon: JSX.Element; onSelect: () => void; disabled?: boolean; destructive?: boolean };
export const MenuRow = (props: RowProps & { actions?: MenuRowAction[] }) => {
  const [local, rest] = splitProps(props, ["actions"]);
  return <Show when={local.actions?.length} fallback={<KMenu.Item as={Item} {...rest} />}>
    <RowGroup actions={<Index each={local.actions}>{(action) =>
      <KMenu.Item as={RowAction} label={action().label} icon={action().icon} textValue={action().label} disabled={action().disabled} destructive={action().destructive} onSelect={() => action().onSelect()} />}</Index>}>
      <KMenu.Item as={Item} {...rest} />
    </RowGroup>
  </Show>;
};

/** Kobalte owns focus, selection and navigation in both layouts. Phone only changes placement and Back. */
const MenuLayerContext = createContext<(child: (() => void) | undefined) => void>();
const SubmenuContext = createContext<{
  phone: () => boolean;
  close: () => void;
  setTrigger: (element: HTMLElement) => void;
  setContent: (element: HTMLElement) => void;
}>();
function MenuBody(props: ParentProps) {
  const [child, setChild] = createSignal<(() => void) | undefined>();
  let consumeTap = false;
  const consume = (event: Event) => {
    if (!consumeTap) return;
    event.preventDefault();
    event.stopPropagation();
  };
  return <MenuLayerContext.Provider value={(next) => setChild(() => next)}><MenuParent under={!!child()}
    on:pointerdown={{ capture: true, handleEvent: (event) => {
      consumeTap = !!child();
      if (!consumeTap) return;
      consume(event);
      child()?.();
    }}} on:pointerup={{ capture: true, handleEvent: consume }} on:click={{ capture: true, handleEvent: consume }}>{props.children}</MenuParent></MenuLayerContext.Provider>;
}
export function MenuSub(props: ParentProps<{ phone?: boolean }>) {
  const [open, setOpen] = createSignal(false);
  const [trigger, setTrigger] = createSignal<HTMLElement>();
  const [content, setContent] = createSignal<HTMLElement>();
  const setParentChild = useContext(MenuLayerContext);
  const close = () => { setOpen(false); trigger()?.focus({ preventScroll: true }); };
  createEffect(() => {
    if (!props.phone || !open()) return;
    setParentChild?.(close);
    const back = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      // A deeper submenu handles its own Back before this level.
      if (event.target instanceof Element && event.target.closest('[role="menu"]') !== content()) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      close();
    };
    document.addEventListener("keydown", back, true);
    onCleanup(() => { setParentChild?.(undefined); document.removeEventListener("keydown", back, true); });
  });
  const anchorRect = (anchor?: HTMLElement) => {
    if (!props.phone) return anchor?.getBoundingClientRect();
    const parent = anchor?.closest<HTMLElement>('[role="menu"]');
    const panel = content();
    if (!parent || !panel) return anchor?.getBoundingClientRect();
    const box = parent.getBoundingClientRect();
    const inset = parseFloat(getComputedStyle(panel).paddingLeft);
    const offset = parent.querySelector<HTMLElement>(".ui-row")?.getBoundingClientRect().height ?? 0;
    const size = panel.getBoundingClientRect();
    // It opens from the row that opened it, in the direction its menu opened: under a menu hanging from the top of
    // the screen its top is the row's, over one rising from the bottom (the composer's) its foot is. Kept to its
    // menu's foot, every submenu sat at the bottom, far from a row near a hanging menu's top.
    const row = anchor!.getBoundingClientRect();
    const edge = edgePadding() as unknown as { top: number; bottom: number };
    const hangs = box.top + box.height / 2 < innerHeight / 2;
    const y = hangs ? row.top : row.bottom - size.height;
    return { x: Math.max(inset, Math.min(box.left + offset, innerWidth - size.width - inset)), y: Math.max(edge.top, Math.min(y, innerHeight - size.height - edge.bottom)), width: 0, height: 0 };
  };
  return <SubmenuContext.Provider value={{ phone: () => !!props.phone, close, setTrigger, setContent }}><KMenu.Sub open={open()} onOpenChange={(next) => { if (!next) haptic("dismiss"); setOpen(next); }} getAnchorRect={anchorRect} fitViewport overflowPadding={edgePadding()}>{props.children}</KMenu.Sub></SubmenuContext.Provider>;
}

/** Something edited in place over the page: the menu's surface without a menu's keys, which would take the typing. */
export function Popover(props: ParentProps<{ open?: boolean; onOpenChange?: (open: boolean) => void; anchorRef?: () => HTMLElement | undefined; placement?: "bottom-start" | "bottom-end" | "top-start" | "top-end" }>) {
  const padding = edgePadding(), gap = popoverGap();
  return <KPopover open={props.open} onOpenChange={(open) => { if (!open) haptic("dismiss"); props.onOpenChange?.(open); }} anchorRef={props.anchorRef} placement={props.placement || "bottom-end"} gutter={gap} fitViewport overflowPadding={padding}>{props.children}</KPopover>;
}
export const PopoverTrigger = KPopover.Trigger;
export function PopoverContent(props: ParentProps<Caps & { "aria-label"?: string; wide?: boolean; onPointerDownOutside?: (event: Event & { target: EventTarget | null }) => void; onOpenAutoFocus?: (event: Event) => void; onCloseAutoFocus?: (event: Event) => void }>) {
  const mount = createFullscreenPortalMount();
  return <KPopover.Portal mount={mount()}><KPopover.Content as={Surface} data-slot="ui-popover-content" {...props} /></KPopover.Portal>;
}

/** A pick list under its search: typing filters it, arrows move the cursor, Enter picks. Each row is an Item's parts. */
export function SearchList<T>(props: {
  items: T[];
  /** Whether a row stays for the typed text (already trimmed and lower-cased). */
  matches: (item: T, needle: string) => boolean;
  onChoose: (item: T) => void;
  isCurrent?: (item: T) => boolean;
  placeholder: string;
  empty?: string;
  row: (item: T) => { icon?: JSX.Element; label: JSX.Element; meta?: JSX.Element; title?: string };
}) {
  const id = createUniqueId();
  const [query, setQuery] = createSignal("");
  // The cursor; -1 while it rests in the search.
  const [active, setActive] = createSignal(-1);
  const rows = createMemo(() => {
    const needle = query().trim().toLowerCase();
    return needle ? props.items.filter((item) => props.matches(item, needle)) : props.items;
  });
  let list: HTMLDivElement | undefined;
  createEffect(on(query, () => setActive(query().trim() ? 0 : -1), { defer: true }));
  createEffect(on(active, (index) => list?.querySelectorAll(".ui-row")[index]?.scrollIntoView({ block: "nearest" })));
  const move = (step: number) => {
    const count = rows().length;
    if (count) setActive((index) => index < 0 ? (step > 0 ? 0 : count - 1) : (index + step + count) % count);
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); move(event.key === "ArrowDown" ? 1 : -1); }
    else if (event.key === "Enter") {
      const row = rows()[active()] ?? (query().trim() ? rows()[0] : undefined);
      if (row !== undefined) { event.preventDefault(); props.onChoose(row); }
    }
  };
  return <>
    <SearchSection placeholder={props.placeholder} value={query()} onInput={setQuery}
      field={{ role: "combobox", "aria-expanded": true, "aria-controls": `${id}-list`, "aria-activedescendant": active() >= 0 ? `${id}-${active()}` : undefined, onKeyDown, autofocus: true }} />
    <Section id={`${id}-list`} role="listbox" ref={list} scroll>
      <For each={rows()} fallback={<MenuNote>{props.empty ?? "No matches."}</MenuNote>}>{(item, index) => {
        const row = props.row(item);
        return <Item role="option" id={`${id}-${index()}`} tabIndex={-1} aria-selected={active() === index()} active={active() === index()} checked={props.isCurrent?.(item) || undefined}
          icon={row.icon} meta={row.meta} title={row.title} onCursor={() => setActive(index())} onClick={() => props.onChoose(item)}>{row.label}</Item>;
      }}</For>
    </Section>
  </>;
}

/**
 * A select drawn by the library: SelectTrigger opening a Menu of its choices. The native select stays
 * the value's owner -- its options, value, ref and change event work as a form's do -- but is hidden;
 * its id, name and title go to the trigger, so a label's `for` reaches what can be pressed.
 */
export function Select(props: JSX.SelectHTMLAttributes<HTMLSelectElement> & { bare?: boolean }) {
  const [local, rest] = splitProps(props, ["ref", "id", "title", "disabled", "children", "aria-label", "bare"]);
  let select!: HTMLSelectElement;
  const [value, setValue] = createSignal("");
  const [label, setLabel] = createSignal("");
  const [options, setOptions] = createSignal<Array<{ value: string; label: string; disabled: boolean }>>([]);
  const read = () => {
    // A value given before its options existed (options drawn by a <For>) did
    // not take: the native select fell back to its first option. Put it back
    // once the option is there.
    const wanted = rest.value == null ? null : String(rest.value);
    if (wanted !== null && select.value !== wanted && Array.from(select.options).some((option) => option.value === wanted)) select.value = wanted;
    setValue(select.value);
    setLabel(select.selectedOptions[0]?.textContent || "");
    setOptions(Array.from(select.options, (option) => ({ value: option.value, label: option.textContent || "", disabled: option.disabled })));
  };
  onMount(() => {
    read();
    const observer = new MutationObserver(read);
    observer.observe(select, { childList: true, subtree: true, characterData: true, attributes: true });
    onCleanup(() => observer.disconnect());
  });
  // A value set from code (a reactive value prop) lands after the options; read it once it has.
  createEffect(on(() => rest.value, () => queueMicrotask(read), { defer: true }));
  const choose = (next: string) => {
    if (next === select.value) return;
    select.value = next;
    select.dispatchEvent(new Event("change", { bubbles: true }));
    read();
  };
  return <>
    <DropdownMenu modal={false} placement="bottom-end" onOpenChange={(open) => open && read()}>
      <KMenu.Trigger as={SelectTrigger} id={local.id} title={local.title} disabled={local.disabled} aria-label={local["aria-label"]} value={label()} bare={local.bare ?? true} />
      <MenuContent>
        <KMenu.RadioGroup value={value()} onChange={choose}>
          <For each={options()}>{(option) => <MenuRadioItem value={option.value} disabled={option.disabled}>{option.label}</MenuRadioItem>}</For>
        </KMenu.RadioGroup>
      </MenuContent>
    </DropdownMenu>
    <select {...rest} hidden disabled={local.disabled} ref={(element) => { select = element; (local.ref as ((element: HTMLSelectElement) => void) | undefined)?.(element); }}>{local.children}</select>
  </>;
}
