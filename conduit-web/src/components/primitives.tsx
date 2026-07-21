import type { JSX, ParentProps } from "solid-js";
import { Show, splitProps } from "solid-js";
import * as KDialog from "@kobalte/core/dialog";
import { DropdownMenu as KMenu } from "@kobalte/core/dropdown-menu";
import { ContextMenu as KContextMenu } from "@kobalte/core/context-menu";
import { LoaderCircleIcon, XIcon } from "lucide-solid";
import { cn } from "@/lib/utils";

type ButtonProps = JSX.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "default" | "outline" | "ghost" | "destructive";
  size?: "default" | "sm" | "icon" | "icon-sm";
};

export function Button(props: ButtonProps) {
  const [local, rest] = splitProps(props, ["class", "variant", "size"]);
  return <button
    {...rest}
    data-slot="button"
    data-variant={local.variant || "default"}
    data-size={local.size || "default"}
    class={cn(
      "inline-flex shrink-0 items-center justify-center gap-2 rounded-md text-sm font-medium transition-colors outline-none disabled:pointer-events-none disabled:opacity-50",
      "focus-visible:ring-ring/50 focus-visible:ring-[3px]",
      local.variant === "outline" && "border bg-background shadow-xs hover:bg-accent hover:text-accent-foreground",
      local.variant === "ghost" && "hover:bg-accent hover:text-accent-foreground",
      local.variant === "destructive" && "bg-destructive text-white hover:bg-destructive/90",
      (!local.variant || local.variant === "default") && "bg-primary text-primary-foreground hover:bg-primary/90",
      local.size === "sm" ? "h-8 px-3" : local.size === "icon" ? "size-9" : local.size === "icon-sm" ? "size-8" : "h-9 px-4 py-2",
      local.class,
    )}
  />;
}

export function Spinner(props: { class?: string; [key: string]: unknown }) {
  return <LoaderCircleIcon aria-hidden="true" class={cn("size-4 animate-spin", props.class)} />;
}

export function Badge(props: ParentProps<{ class?: string; variant?: "default" | "secondary" | "outline" }>) {
  return <span class={cn("inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium", props.variant === "secondary" && "bg-secondary text-secondary-foreground", props.class)}>{props.children}</span>;
}

export function Dialog(props: ParentProps<{ open: boolean; onOpenChange: (open: boolean) => void }>) {
  return <KDialog.Root open={props.open} onOpenChange={props.onOpenChange}>{props.children}</KDialog.Root>;
}

export function DialogTrigger(props: ParentProps<{ as?: keyof JSX.IntrinsicElements; class?: string }>) {
  return <KDialog.Trigger as={props.as || "button"} class={props.class}>{props.children}</KDialog.Trigger>;
}

export function DialogContent(props: ParentProps<{ class?: string; title?: string; description?: string; closeLabel?: string }>) {
  return <KDialog.Portal>
    <KDialog.Overlay class="fixed inset-0 z-50 bg-black/50 data-[expanded]:animate-in data-[closed]:animate-out" />
    <KDialog.Content class={cn("fixed left-1/2 top-1/2 z-50 grid w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 gap-4 rounded-lg border bg-background p-6 shadow-lg outline-none", props.class)}>
      <Show when={props.title}><KDialog.Title class="text-lg font-semibold">{props.title}</KDialog.Title></Show>
      <Show when={props.description}><KDialog.Description class="text-sm text-muted-foreground">{props.description}</KDialog.Description></Show>
      {props.children}
      <KDialog.CloseButton class="absolute right-4 top-4 rounded-sm opacity-70 hover:opacity-100" aria-label={props.closeLabel || "Close"}><XIcon class="size-4" /></KDialog.CloseButton>
    </KDialog.Content>
  </KDialog.Portal>;
}

export function DialogTitle(props: ParentProps<{ class?: string }>) {
  return <KDialog.Title class={cn("text-lg font-semibold", props.class)}>{props.children}</KDialog.Title>;
}

export function DialogDescription(props: ParentProps<{ class?: string }>) {
  return <KDialog.Description class={cn("text-sm text-muted-foreground", props.class)}>{props.children}</KDialog.Description>;
}

export function DialogClose(props: ParentProps<{ class?: string }>) {
  return <KDialog.CloseButton class={props.class}>{props.children}</KDialog.CloseButton>;
}

export const Menu = KMenu;
export const MenuTrigger = KMenu.Trigger;
export const MenuGroup = KMenu.Group;
export const MenuRadioGroup = KMenu.RadioGroup;
export const MenuSub = KMenu.Sub;

export function MenuContent(props: ParentProps<{ class?: string }>) {
  return <KMenu.Portal><KMenu.Content class={cn("z-[100] min-w-40 rounded-md border bg-popover p-1 text-popover-foreground shadow-md outline-none", props.class)}>{props.children}</KMenu.Content></KMenu.Portal>;
}
export function MenuItem(props: ParentProps<{ class?: string; disabled?: boolean; onSelect?: () => void; textValue?: string }>) {
  return <KMenu.Item disabled={props.disabled} onSelect={props.onSelect} textValue={props.textValue} class={cn("relative flex cursor-default select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none data-[highlighted]:bg-accent data-[disabled]:pointer-events-none data-[disabled]:opacity-50", props.class)}>{props.children}</KMenu.Item>;
}
export function MenuRadioItem(props: ParentProps<{ class?: string; value: string; disabled?: boolean }>) {
  return <KMenu.RadioItem value={props.value} disabled={props.disabled} class={cn("relative flex cursor-default select-none items-center gap-2 rounded-sm py-1.5 pl-8 pr-2 text-sm outline-none data-[highlighted]:bg-accent data-[disabled]:opacity-50", props.class)}><KMenu.ItemIndicator class="absolute left-2">✓</KMenu.ItemIndicator>{props.children}</KMenu.RadioItem>;
}
export function MenuLabel(props: ParentProps<{ class?: string }>) { return <KMenu.GroupLabel class={cn("px-2 py-1.5 text-xs font-medium text-muted-foreground", props.class)}>{props.children}</KMenu.GroupLabel>; }
export function MenuSeparator() { return <KMenu.Separator class="-mx-1 my-1 h-px bg-border" />; }
export function MenuSubTrigger(props: ParentProps<{ class?: string; disabled?: boolean }>) { return <KMenu.SubTrigger disabled={props.disabled} class={cn("flex cursor-default items-center rounded-sm px-2 py-1.5 text-sm outline-none data-[highlighted]:bg-accent data-[disabled]:opacity-50", props.class)}>{props.children}</KMenu.SubTrigger>; }
export function MenuSubContent(props: ParentProps<{ class?: string }>) { return <KMenu.Portal><KMenu.SubContent class={cn("z-[100] min-w-40 rounded-md border bg-popover p-1 shadow-md outline-none", props.class)}>{props.children}</KMenu.SubContent></KMenu.Portal>; }

export function ContextMenu(props: ParentProps) { return <KContextMenu modal={false}>{props.children}</KContextMenu>; }
export const ContextMenuTrigger = KContextMenu.Trigger;
export function ContextMenuContent(props: ParentProps<{ class?: string }>) { return <KContextMenu.Portal><KContextMenu.Content class={cn("z-[100] min-w-36 rounded-md border bg-popover p-1 shadow-md outline-none", props.class)}>{props.children}</KContextMenu.Content></KContextMenu.Portal>; }
export function ContextMenuItem(props: ParentProps<{ disabled?: boolean; onSelect?: () => void; class?: string }>) { return <KContextMenu.Item disabled={props.disabled} onSelect={props.onSelect} class={cn("flex cursor-default items-center rounded-sm px-2 py-1.5 text-sm outline-none data-[highlighted]:bg-accent data-[disabled]:opacity-50", props.class)}>{props.children}</KContextMenu.Item>; }
export const ContextMenuSub = KContextMenu.Sub;
export function ContextMenuSubTrigger(props: ParentProps<{ disabled?: boolean }>) { return <KContextMenu.SubTrigger disabled={props.disabled} class="flex cursor-default items-center rounded-sm px-2 py-1.5 text-sm outline-none data-[highlighted]:bg-accent data-[disabled]:opacity-50">{props.children}</KContextMenu.SubTrigger>; }
export function ContextMenuSubContent(props: ParentProps) { return <KContextMenu.Portal><KContextMenu.SubContent class="pointer-events-auto z-[100] min-w-28 rounded-md border bg-popover p-1 shadow-md outline-none">{props.children}</KContextMenu.SubContent></KContextMenu.Portal>; }
export const ContextMenuRadioGroup = KContextMenu.RadioGroup;
export function ContextMenuRadioItem(props: ParentProps<{ value: string }>) { return <KContextMenu.RadioItem value={props.value} class="relative flex cursor-default items-center rounded-sm py-1.5 pl-8 pr-2 text-sm outline-none data-[highlighted]:bg-accent"><KContextMenu.ItemIndicator class="absolute left-2">✓</KContextMenu.ItemIndicator>{props.children}</KContextMenu.RadioItem>; }
export function ContextMenuSeparator() { return <KContextMenu.Separator class="-mx-1 my-1 h-px bg-border" />; }

export function Field(props: ParentProps<{ class?: string }>) { return <div data-slot="field" class={cn("flex flex-col gap-2", props.class)}>{props.children}</div>; }
export function FieldGroup(props: ParentProps<{ class?: string }>) { return <div data-slot="field-group" class={cn("flex flex-col gap-4", props.class)}>{props.children}</div>; }
export function FieldLabel(props: ParentProps<JSX.LabelHTMLAttributes<HTMLLabelElement>>) { const [local, rest] = splitProps(props, ["class", "children"]); return <label {...rest} class={cn("text-sm font-medium", local.class)}>{local.children}</label>; }
export function Input(props: JSX.InputHTMLAttributes<HTMLInputElement>) { return <input {...props} class={cn("h-9 w-full rounded-md border bg-transparent px-3 text-sm outline-none focus:ring-2 focus:ring-ring/50", props.class)} />; }
export function Textarea(props: JSX.TextareaHTMLAttributes<HTMLTextAreaElement>) { return <textarea {...props} class={cn("min-h-16 w-full resize-none rounded-md border bg-transparent px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring/50", props.class)} />; }
