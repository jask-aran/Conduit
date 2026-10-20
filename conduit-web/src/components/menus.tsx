import { DropdownMenu as KMenu } from "@kobalte/core/dropdown-menu";
import { Popover as KPopover } from "@kobalte/core/popover";
import { ContextMenu as KContextMenu } from "@kobalte/core/context-menu";
import type { FocusOutsideEvent } from "@kobalte/core";
import { createContext, createEffect, createMemo, createSignal, createUniqueId, For, on, onCleanup, splitProps, useContext, type ComponentProps, type JSX, type ParentProps } from "solid-js";
import { createFullscreenPortalMount } from "./primitives";
import { Menu as Surface, MenuAction, Item, Section, MenuPanel, MenuParent, MenuNote, SearchSection } from "./ui/popover";
import { Button, SliderValue } from "./ui/controls";
import { PillButton } from "./ui/pill";
export const Menu = KMenu;
/** A row's right-click (or long-press, Menu, Shift+F10) menu. Its rows, sections, choices and submenus are the
 *  Menu's own (MenuRow, MenuSection, MenuRadioItem, MenuSub), which work in either. */
export const ContextMenu = (props: ParentProps<{ placement?: "right-start" | "bottom-start"; onOpenChange?: (open: boolean) => void }>) =>
  <KContextMenu modal={false} fitViewport overflowPadding={8} placement={props.placement ?? "right-start"} onOpenChange={props.onOpenChange}>{props.children}</KContextMenu>;
export const ContextMenuTrigger = KContextMenu.Trigger;
export const MenuGroup = KMenu.Group;
export const ContextMenuGroup = KContextMenu.Group;
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
type ContentProps = ParentProps<{ "data-settling"?: boolean; keep?: () => boolean; onOpenAutoFocus?: (event: Event) => void; onPointerDownOutside?: (event: Event) => void; onFocusOutside?: (event: FocusOutsideEvent) => void; onCloseAutoFocus?: (event: Event) => void }>;
type RowProps = Omit<ComponentProps<typeof Item>, "onSelect"> & { onSelect?: () => void; closeOnSelect?: boolean };
type ChoiceProps = RowProps & { value: string };
/** keep: while true, opening leaves focus where it is (MenuPillTrigger's typing). */
export function MenuContent(props: ContentProps) {
  const mount = createFullscreenPortalMount();
  const [local, rest] = splitProps(props, ["keep"]);
  return <KMenu.Portal mount={mount()}><KMenu.Content as={Surface} data-slot="ui-menu-content" fit style={{ "--menu-room": "var(--kb-popper-content-available-height)" }}
    ref={(element: HTMLElement) => { if (local.keep) holdFocus(element, local.keep); }} {...rest}><MenuBody>{props.children}</MenuBody></KMenu.Content></KMenu.Portal>;
}
export function ContextMenuContent(props: ParentProps) {
  const mount = createFullscreenPortalMount();
  return <KContextMenu.Portal mount={mount()}><KContextMenu.Content as={Surface} data-slot="ui-context-menu-content" fit style={{ "--menu-room": "var(--kb-popper-content-available-height)" }}><MenuBody>{props.children}</MenuBody></KContextMenu.Content></KContextMenu.Portal>;
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
export function MenuSubContent(props: ParentProps) {
  const mount = createFullscreenPortalMount();
  const submenu = useContext(SubmenuContext);
  return <KMenu.Portal mount={mount()}><KMenu.SubContent as={submenu?.phone() ? MenuPanel : Surface} ref={submenu?.setContent} data-slot="ui-menu-sub-content"><MenuBody>{props.children}</MenuBody></KMenu.SubContent></KMenu.Portal>;
}
export const MenuSection = (props: ParentProps<{ title?: string; note?: JSX.Element }>) => <KMenu.Group as={Section} title={props.title} note={props.note}>{props.children}</KMenu.Group>;
export const MenuRow = (props: RowProps) => <KMenu.Item as={Item} {...props} />;

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
    return { x: Math.max(inset, Math.min(box.left + offset, innerWidth - size.width - inset)), y: box.bottom - size.height, width: 0, height: 0 };
  };
  return <SubmenuContext.Provider value={{ phone: () => !!props.phone, close, setTrigger, setContent }}><KMenu.Sub open={open()} onOpenChange={setOpen} getAnchorRect={anchorRect} fitViewport>{props.children}</KMenu.Sub></SubmenuContext.Provider>;
}

/** Something edited in place over the page: the menu's surface without a menu's keys, which would take the typing. */
export function Popover(props: ParentProps<{ open?: boolean; onOpenChange?: (open: boolean) => void; anchorRef?: () => HTMLElement | undefined; placement?: "bottom-start" | "bottom-end" | "top-start" | "top-end" }>) {
  return <KPopover open={props.open} onOpenChange={props.onOpenChange} anchorRef={props.anchorRef} placement={props.placement || "bottom-end"} gutter={4} fitViewport overflowPadding={8}>{props.children}</KPopover>;
}
export const PopoverTrigger = KPopover.Trigger;
export function PopoverContent(props: ParentProps<{ "aria-label"?: string; wide?: boolean; onPointerDownOutside?: (event: Event & { target: EventTarget | null }) => void; onOpenAutoFocus?: (event: Event) => void; onCloseAutoFocus?: (event: Event) => void }>) {
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
          icon={row.icon} meta={row.meta} title={row.title} onPointerMove={() => setActive(index())} onClick={() => props.onChoose(item)}>{row.label}</Item>;
      }}</For>
    </Section>
  </>;
}
