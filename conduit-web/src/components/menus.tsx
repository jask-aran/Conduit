import { DropdownMenu as KMenu } from "@kobalte/core/dropdown-menu";
import { ContextMenu as KContextMenu } from "@kobalte/core/context-menu";
import { createFocusScope } from "@kobalte/core/primitives/create-focus-scope";
import { Portal } from "solid-js/web";
import type { FocusOutsideEvent } from "@kobalte/core";
import { createSignal, onCleanup, onMount, type ComponentProps, type ParentProps } from "solid-js";
import { createFullscreenPortalMount } from "./primitives";
import { Menu as Surface, MenuAction, Item, Section, MenuPanel } from "./ui/popover";
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
  return <KMenu.Portal mount={mount()}><KMenu.Content as={Surface} data-slot="ui-menu-content" {...props}>{props.children}</KMenu.Content></KMenu.Portal>;
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
export const MenuSub = KMenu.Sub;
export const MenuRadioItem = (props: ChoiceProps) => <KMenu.RadioItem as={Item} {...props} closeOnSelect={props.closeOnSelect ?? true} />;
export const MenuSubTrigger = (props: RowProps) => <KMenu.SubTrigger as={Item} {...props} opens />;
export function MenuSubContent(props: ParentProps) {
  const mount = createFullscreenPortalMount();
  return <KMenu.Portal mount={mount()}><KMenu.SubContent as={Surface} data-slot="ui-menu-sub-content">{props.children}</KMenu.SubContent></KMenu.Portal>;
}
export const MenuSection = (props: ParentProps<{ title?: string }>) => <KMenu.Group as={Section} title={props.title}>{props.children}</KMenu.Group>;
export const MenuRow = (props: RowProps) => <KMenu.Item as={Item} {...props} />;

/** Same phone-panel behavior as other menus; v2 owns its geometry and material. */
export function PhoneMenuPanel(props: ParentProps<{ parent: string; settling: boolean }>) {
  const mount = createFullscreenPortalMount();
  const [position, setPosition] = createSignal({ left: "0px", bottom: "0px" });
  let panel!: HTMLDivElement;
  const [panelRef, setPanelRef] = createSignal<HTMLDivElement>();
  const previousFocus = document.activeElement;
  // A portaled child needs its own Kobalte scope to pause the parent's trap.
  createFocusScope({
    trapFocus: true,
    onMountAutoFocus: (event) => { event.preventDefault(); panel.querySelector<HTMLElement>('[role^="menuitem"]:not([data-disabled])')?.focus(); },
    onUnmountAutoFocus: (event) => { event.preventDefault(); queueMicrotask(() => { if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus(); }); },
  }, panelRef);
  const navigate = (event: KeyboardEvent) => {
    if (!["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
    const rows = [...panel.querySelectorAll<HTMLElement>('[role^="menuitem"]:not([data-disabled])')];
    if (!rows.length) return;
    event.preventDefault();
    event.stopPropagation();
    const current = rows.findIndex((row) => row === document.activeElement);
    const next = event.key === "Home" ? 0 : event.key === "End" ? rows.length - 1 : (current + (event.key === "ArrowUp" ? -1 : 1) + rows.length) % rows.length;
    rows[next]?.focus();
  };
  onMount(() => {
    const parent = document.querySelector<HTMLElement>(props.parent);
    if (!parent) return;
    const place = () => {
      const box = parent.getBoundingClientRect();
      const style = getComputedStyle(panel);
      const inset = parseFloat(style.paddingLeft);
      const offset = panel.querySelector<HTMLElement>(".ui-row")?.getBoundingClientRect().height ?? 0;
      const width = panel.getBoundingClientRect().width;
      setPosition({ left: `${Math.max(inset, Math.min(box.left + offset, innerWidth - width - inset))}px`, bottom: `${innerHeight - box.bottom}px` });
    };
    const observer = new ResizeObserver(place);
    observer.observe(parent);
    observer.observe(panel);
    place();
    window.addEventListener("resize", place);
    window.visualViewport?.addEventListener("resize", place);
    onCleanup(() => { observer.disconnect(); window.removeEventListener("resize", place); window.visualViewport?.removeEventListener("resize", place); });
  });
  return <Portal mount={mount()}><MenuPanel ref={(element) => { panel = element; setPanelRef(element); }} data-slot="ui-menu-sub-content" data-settling={props.settling} style={position()} onKeyDown={navigate}>{props.children}</MenuPanel></Portal>;
}
