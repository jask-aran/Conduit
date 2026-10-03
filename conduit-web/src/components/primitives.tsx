import "./phone-overlays";
import type { JSX, ParentProps } from "solid-js";
import type { FocusOutsideEvent } from "@kobalte/core";
import { createEffect, createMemo, createSignal, createUniqueId, For, on, onCleanup, onMount, Show, splitProps } from "solid-js";
import { DropdownMenu as KMenu } from "@kobalte/core/dropdown-menu";
import { ContextMenu as KContextMenu } from "@kobalte/core/context-menu";
import { Popover as KPopover } from "@kobalte/core/popover";
import * as KTooltip from "@kobalte/core/tooltip";
import { ChevronRightIcon, LoaderCircleIcon, XIcon } from "lucide-solid";
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

export function createFullscreenPortalMount() {
  const [mount, setMount] = createSignal<HTMLElement>();
  const sync = () => setMount(document.fullscreenElement instanceof HTMLElement ? document.fullscreenElement : undefined);
  onMount(() => {
    sync();
    document.addEventListener("fullscreenchange", sync);
  });
  onCleanup(() => document.removeEventListener("fullscreenchange", sync));
  return mount;
}

/* Menus share one dark, solid surface profile: --popover ground, hairline ring,
   rounded-lg shell over rounded-md items. Keep menus separate from composer
   material styling. */
const menuContentClass = "z-[100] min-w-40 rounded-lg bg-popover p-1 text-popover-foreground shadow-md ring-1 ring-foreground/10 outline-none";
/* Submenus get a smaller min-width so a flipped submenu can still fit beside
   its parent on narrow viewports instead of overflowing offscreen. */
const menuSubContentClass = "z-[100] min-w-28 rounded-lg bg-popover p-1 text-popover-foreground shadow-md ring-1 ring-foreground/10 outline-none";
const menuItemClass = "relative flex cursor-default select-none items-center gap-1.5 rounded-md px-1.5 py-1 text-sm outline-none data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50 data-[variant=destructive]:text-destructive data-[variant=destructive]:data-[highlighted]:bg-destructive/15";

export const Menu = KMenu;
export const MenuTrigger = KMenu.Trigger;
export const MenuGroup = KMenu.Group;
export const MenuRadioGroup = KMenu.RadioGroup;

export function MenuContent(props: ParentProps<{ class?: string; onOpenAutoFocus?: (event: Event) => void; onCloseAutoFocus?: (event: Event) => void; onFocusOutside?: (event: FocusOutsideEvent) => void; onPointerDown?: (event: PointerEvent) => void; onClick?: (event: MouseEvent) => void; "data-settling"?: boolean; onPointerDownOutside?: (event: Event) => void }>) {
  const portalMount = createFullscreenPortalMount();
  return <KMenu.Portal mount={portalMount()}><KMenu.Content data-slot="menu-content" data-settling={props["data-settling"]} onPointerDownOutside={props.onPointerDownOutside} onOpenAutoFocus={props.onOpenAutoFocus} onCloseAutoFocus={props.onCloseAutoFocus} onFocusOutside={props.onFocusOutside} onPointerDown={props.onPointerDown} onClick={props.onClick} class={cn(menuContentClass, props.class)}>{props.children}</KMenu.Content></KMenu.Portal>;
}
export function MenuItem(props: ParentProps<{ class?: string; disabled?: boolean; closeOnSelect?: boolean; variant?: "destructive"; onSelect?: () => void; textValue?: string; "aria-label"?: string }>) {
  return <KMenu.Item disabled={props.disabled} closeOnSelect={props.closeOnSelect} onSelect={props.onSelect} textValue={props.textValue} aria-label={props["aria-label"]} data-variant={props.variant} class={cn(menuItemClass, props.class)}>{props.children}</KMenu.Item>;
}
/* The current choice is the row's wash and a heavier weight -- never a tick,
   which costs a column the label could use. */
// The current choice is shown by weight, not a wash (DESIGN.md, Interaction): styles.css.
const checkedItemClass = "";
export function MenuRadioItem(props: ParentProps<{ class?: string; value: string; disabled?: boolean; closeOnSelect?: boolean; onSelect?: () => void }>) {
  /* Conduit menus close after a selection by default; persistent pickers can
     opt out so the user can change several values before clicking away. */
  return <KMenu.RadioItem value={props.value} disabled={props.disabled} closeOnSelect={props.closeOnSelect ?? true} onSelect={props.onSelect} class={cn(menuItemClass, checkedItemClass, props.class)}>{props.children}</KMenu.RadioItem>;
}
export const MenuSub = KMenu.Sub;
export function MenuSubTrigger(props: ParentProps<{ class?: string; disabled?: boolean }>) { return <KMenu.SubTrigger disabled={props.disabled} class={cn(menuItemClass, "data-[expanded]:bg-accent", props.class)}>{props.children}<ChevronRightIcon class="menu-chevron" /></KMenu.SubTrigger>; }
export function MenuSubContent(props: ParentProps<{ class?: string }>) {
  const portalMount = createFullscreenPortalMount();
  return <KMenu.Portal mount={portalMount()}><KMenu.SubContent data-slot="menu-sub-content" class={cn(menuSubContentClass, props.class)}>{props.children}</KMenu.SubContent></KMenu.Portal>;
}
export function MenuLabel(props: ParentProps<{ class?: string }>) { return <KMenu.GroupLabel class={cn("px-1.5 py-1.5 text-xs font-medium text-muted-foreground", props.class)}>{props.children}</KMenu.GroupLabel>; }
export function MenuSeparator() { return <KMenu.Separator class="-mx-1 my-1 h-px bg-border" />; }

/*
 * A floating surface for something to be edited in place -- the menu's
 * material and radius, without a menu's key handling, which would swallow
 * typing into an input. Anchored to a trigger, or to `anchorRef` when the
 * thing that opened it is not always the one on screen.
 */
export function Popover(props: ParentProps<{ open?: boolean; onOpenChange?: (open: boolean) => void; anchorRef?: () => HTMLElement | undefined; placement?: "bottom-start" | "bottom-end" | "top-start" | "top-end" }>) {
  return <KPopover open={props.open} onOpenChange={props.onOpenChange} anchorRef={props.anchorRef} placement={props.placement || "bottom-end"} gutter={4} fitViewport overflowPadding={8}>{props.children}</KPopover>;
}
export const PopoverTrigger = KPopover.Trigger;
export function PopoverContent(props: ParentProps<{ class?: string; "aria-label"?: string; onPointerDownOutside?: (event: Event & { target: EventTarget | null }) => void; onOpenAutoFocus?: (event: Event) => void; onCloseAutoFocus?: (event: Event) => void }>) {
  const portalMount = createFullscreenPortalMount();
  return <KPopover.Portal mount={portalMount()}><KPopover.Content data-slot="popover-content" aria-label={props["aria-label"]} onPointerDownOutside={props.onPointerDownOutside} onOpenAutoFocus={props.onOpenAutoFocus} onCloseAutoFocus={props.onCloseAutoFocus} class={cn(menuContentClass, props.class)}>{props.children}</KPopover.Content></KPopover.Portal>;
}

/**
 * A popover that is a list to pick from, with a search at its head: the one
 * searchable list every such popover uses (DESIGN.md, Choosing in a menu).
 * The search keeps focus, so typing filters while the arrows walk the rows
 * with the wash and Enter picks the row under the cursor, or the first match.
 * Rows are the shared `menu-row`; a caller gives only the rows, how one reads,
 * which is current, and what picking does. Put it inside `PopoverContent`.
 */
export function PopoverSearchList<T>(props: {
  items: T[];
  /** Whether a row stays for the typed text (already trimmed and lower-cased). */
  matches: (item: T, needle: string) => boolean;
  onChoose: (item: T) => void;
  isCurrent?: (item: T) => boolean;
  placeholder: string;
  empty?: string;
  children: (item: T) => JSX.Element;
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
  createEffect(on(active, (index) => list?.children[index]?.scrollIntoView({ block: "nearest" })));
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
    <input class="popover-search" placeholder={props.placeholder} value={query()} onInput={(event) => setQuery(event.currentTarget.value)}
      role="combobox" aria-expanded="true" aria-controls={`${id}-list`} aria-activedescendant={active() >= 0 ? `${id}-${active()}` : undefined}
      onKeyDown={onKeyDown} autofocus />
    <div class="popover-search-list" id={`${id}-list`} role="listbox" ref={list}>
      <For each={rows()} fallback={<div class="popover-search-empty">{props.empty ?? "No matches."}</div>}>{(item, index) =>
        <button type="button" class="menu-row" role="option" id={`${id}-${index()}`} tabIndex={-1}
          aria-selected={active() === index()} data-highlighted={active() === index() || undefined} data-checked={props.isCurrent?.(item) || undefined}
          onPointerMove={() => setActive(index())} onClick={() => props.onChoose(item)}>{props.children(item)}</button>}
      </For>
    </div>
  </>;
}

export function ContextMenu(props: ParentProps<{ onOpenChange?: (open: boolean) => void; placement?: "bottom-start" | "right-start" }>) {
  return <KContextMenu modal={false} fitViewport overflowPadding={8} placement={props.placement || "right-start"} onOpenChange={props.onOpenChange}>{props.children}</KContextMenu>;
}
export const ContextMenuTrigger = KContextMenu.Trigger;
export const ContextMenuGroup = KContextMenu.Group;
export function ContextMenuContent(props: ParentProps<{ class?: string; shortcutScope?: string }>) { return <KContextMenu.Portal><KContextMenu.Content data-slot="context-menu-content" data-shortcut-scope={props.shortcutScope} class={cn(menuContentClass, props.class)}>{props.children}</KContextMenu.Content></KContextMenu.Portal>; }
export function ContextMenuItem(props: ParentProps<{ disabled?: boolean; variant?: "destructive"; onSelect?: () => void; class?: string }>) { return <KContextMenu.Item disabled={props.disabled} onSelect={props.onSelect} data-variant={props.variant} class={cn(menuItemClass, props.class)}>{props.children}</KContextMenu.Item>; }
export const ContextMenuSub = KContextMenu.Sub;
export function ContextMenuSubTrigger(props: ParentProps<{ disabled?: boolean }>) { return <KContextMenu.SubTrigger disabled={props.disabled} class={cn(menuItemClass, "data-[expanded]:bg-accent")}>{props.children}<ChevronRightIcon class="menu-chevron" /></KContextMenu.SubTrigger>; }
export function ContextMenuSubContent(props: ParentProps<{ class?: string }>) { return <KContextMenu.Portal><KContextMenu.SubContent data-slot="context-menu-sub-content" class={cn(menuSubContentClass, "pointer-events-auto", props.class)}>{props.children}</KContextMenu.SubContent></KContextMenu.Portal>; }
export const ContextMenuRadioGroup = KContextMenu.RadioGroup;
export function ContextMenuRadioItem(props: ParentProps<{ value: string }>) { return <KContextMenu.RadioItem value={props.value} closeOnSelect={true} class={cn(menuItemClass, checkedItemClass)}>{props.children}</KContextMenu.RadioItem>; }
export function ContextMenuSeparator() { return <KContextMenu.Separator class="-mx-1 my-1 h-px bg-border" />; }

export function Tooltip(props: ParentProps) { return <KTooltip.Root placement="right" openDelay={350}>{props.children}</KTooltip.Root>; }
export const TooltipTrigger = KTooltip.Trigger;
export function TooltipContent(props: ParentProps<{ class?: string }>) {
  return <KTooltip.Portal><KTooltip.Content class={cn("z-[120] rounded-md bg-popover px-2.5 py-1.5 text-xs text-popover-foreground shadow-md ring-1 ring-foreground/10", props.class)}>{props.children}</KTooltip.Content></KTooltip.Portal>;
}

export function Field(props: ParentProps<{ class?: string }>) { return <div data-slot="field" class={cn("flex flex-col gap-2", props.class)}>{props.children}</div>; }
export function FieldGroup(props: ParentProps<{ class?: string }>) { return <div data-slot="field-group" class={cn("flex flex-col gap-4", props.class)}>{props.children}</div>; }
export function FieldLabel(props: ParentProps<JSX.LabelHTMLAttributes<HTMLLabelElement>>) { const [local, rest] = splitProps(props, ["class", "children"]); return <label {...rest} class={cn("text-sm font-medium", local.class)}>{local.children}</label>; }
export function Input(props: JSX.InputHTMLAttributes<HTMLInputElement>) { return <input {...props} class={cn("h-9 w-full rounded-md border bg-transparent px-3 text-sm outline-none focus:border-foreground/30", props.class)} />; }
export function Textarea(props: JSX.TextareaHTMLAttributes<HTMLTextAreaElement>) { return <textarea {...props} class={cn("min-h-16 w-full resize-none rounded-md border bg-transparent px-3 py-2 text-sm outline-none focus:border-foreground/30", props.class)} />; }
