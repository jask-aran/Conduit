import { DropdownMenu as KMenu } from "@kobalte/core/dropdown-menu";
import { ContextMenu as KContextMenu } from "@kobalte/core/context-menu";
import type { FocusOutsideEvent } from "@kobalte/core";
import { createContext, createEffect, createSignal, onCleanup, useContext, type ComponentProps, type ParentProps } from "solid-js";
import { createFullscreenPortalMount } from "./primitives";
import { Menu as Surface, MenuAction, Item, Section, MenuPanel, MenuParent } from "./ui/popover";
import { Button } from "./ui/controls";
export const Menu = KMenu;
export const ContextMenu = (props: ParentProps) => <KContextMenu modal={false} fitViewport overflowPadding={8} placement="right-start">{props.children}</KContextMenu>;
export const ContextMenuTrigger = KContextMenu.Trigger;
export const MenuGroup = KMenu.Group;
export const ContextMenuGroup = KContextMenu.Group;
export function MenuTrigger(props: ParentProps<{ disabled?: boolean; "aria-label"?: string }>) { return <KMenu.Trigger as={Button} variant="ghost" {...props} />; }
type ContentProps = ParentProps<{ "data-settling"?: boolean; onPointerDownOutside?: (event: Event) => void; onFocusOutside?: (event: FocusOutsideEvent) => void; onCloseAutoFocus?: (event: Event) => void }>;
type RowProps = Omit<ComponentProps<typeof Item>, "onSelect"> & { onSelect?: () => void; closeOnSelect?: boolean };
type ChoiceProps = RowProps & { value: string };
export function MenuContent(props: ContentProps) {
  const mount = createFullscreenPortalMount();
  return <KMenu.Portal mount={mount()}><KMenu.Content as={Surface} data-slot="ui-menu-content" {...props}><MenuBody>{props.children}</MenuBody></KMenu.Content></KMenu.Portal>;
}
export function ContextMenuContent(props: ParentProps) {
  const mount = createFullscreenPortalMount();
  return <KContextMenu.Portal mount={mount()}><KContextMenu.Content as={Surface} data-slot="ui-context-menu-content">{props.children}</KContextMenu.Content></KContextMenu.Portal>;
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
export function MenuSubContent(props: ParentProps) {
  const mount = createFullscreenPortalMount();
  const submenu = useContext(SubmenuContext);
  return <KMenu.Portal mount={mount()}><KMenu.SubContent as={submenu?.phone() ? MenuPanel : Surface} ref={submenu?.setContent} data-slot="ui-menu-sub-content"><MenuBody>{props.children}</MenuBody></KMenu.SubContent></KMenu.Portal>;
}
export const MenuSection = (props: ParentProps<{ title?: string }>) => <KMenu.Group as={Section} title={props.title}>{props.children}</KMenu.Group>;
export const MenuRow = (props: RowProps) => <KMenu.Item as={Item} {...props} />;

/** Kobalte owns focus, selection and navigation in both layouts. Phone only changes placement and Back. */
const MenuLayerContext = createContext<(child: (() => void) | undefined) => void>();
const SubmenuContext = createContext<{
  phone: () => boolean;
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
  return <SubmenuContext.Provider value={{ phone: () => !!props.phone, setTrigger, setContent }}><KMenu.Sub open={open()} onOpenChange={setOpen} getAnchorRect={anchorRect} fitViewport>{props.children}</KMenu.Sub></SubmenuContext.Provider>;
}
