import { DropdownMenu as KMenu } from "@kobalte/core/dropdown-menu";
import { ContextMenu as KContextMenu } from "@kobalte/core/context-menu";
import { type ParentProps } from "solid-js";
import { createFullscreenPortalMount } from "./primitives";
import { Menu as Surface, MenuAction } from "./ui/popover";
import { Button } from "./ui/controls";
export const Menu = KMenu;
export const ContextMenu = (props: ParentProps) => <KContextMenu modal={false} fitViewport overflowPadding={8} placement="right-start">{props.children}</KContextMenu>;
export const ContextMenuTrigger = KContextMenu.Trigger;
export const MenuGroup = KMenu.Group;
export const ContextMenuGroup = KContextMenu.Group;
export function MenuTrigger(props: ParentProps<{ disabled?: boolean; "aria-label"?: string }>) { return <KMenu.Trigger as={Button} variant="ghost" {...props} />; }
export function MenuContent(props: ParentProps) {
  const mount = createFullscreenPortalMount();
  return <KMenu.Portal mount={mount()}><KMenu.Content as={Surface} data-slot="menu-content">{props.children}</KMenu.Content></KMenu.Portal>;
}
export function ContextMenuContent(props: ParentProps) {
  const mount = createFullscreenPortalMount();
  return <KContextMenu.Portal mount={mount()}><KContextMenu.Content as={Surface} data-slot="context-menu-content">{props.children}</KContextMenu.Content></KContextMenu.Portal>;
}
type ItemProps = ParentProps<{ disabled?: boolean; variant?: "destructive"; onSelect?: () => void }>;
export const MenuItem = (props: ItemProps) => <KMenu.Item as={MenuAction} disabled={props.disabled} onSelect={props.onSelect} data-destructive={props.variant === "destructive" ? "" : undefined}>{props.children}</KMenu.Item>;
export const ContextMenuItem = (props: ItemProps) => <KContextMenu.Item as={MenuAction} disabled={props.disabled} onSelect={props.onSelect} data-destructive={props.variant === "destructive" ? "" : undefined}>{props.children}</KContextMenu.Item>;
