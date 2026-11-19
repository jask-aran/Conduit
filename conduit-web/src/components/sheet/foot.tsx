import { createEffect, createSignal, For, mergeProps, onCleanup, Show, type JSX } from "solid-js";
import { DashPath, IconButton, Icons, Input, Notice, PaneTab, PaneTabs, ToolBar } from "@/components/ui";
import { duration } from "@/components/ui/motion";
import { createDecisionScope } from "@/components/ui/decision-dialog";
import { createFolds } from "@/components/ui/fit";
import { ContextMenu, ContextMenuContent, ContextMenuTrigger, DropdownMenu, MenuContent, MenuControl, MenuRow, MenuSection } from "@/components/ui/menus";
import { toast } from "@/components/ui/notifications";
import { tabNameFault, type Tab } from "@/sheet-format.js";
import { createFigures, type SheetFigures } from "./stats";
import type { SheetTabs } from "./tabs";

// Shown as the grid shows a number: a long one cut to what a sheet shows.
const shown = (value: number) => Number(value.toPrecision(12)).toLocaleString(undefined, { maximumFractionDigits: 10 });
const FIGURES: { name: string; of(figures: SheetFigures): number | null }[] = [
  { name: "Sum", of: (f) => f.numbers ? f.sum : null },
  { name: "Average", of: (f) => f.numbers ? f.sum / f.numbers : null },
  { name: "Count", of: (f) => f.count },
  { name: "Min", of: (f) => f.numbers ? f.min : null },
  { name: "Max", of: (f) => f.numbers ? f.max : null },
];

/** The sheet's foot: its tabs, to show, add, rename, move, hide and delete, and the figures of the cells selected. */
/** `format`: how the selection's figures but its count are drawn, where it has one number format throughout (formats.ts). */
/** `filtered`: the rows under the filter's header and how many it shows, while it narrows them. */
export function SheetFoot(props: { tabs: SheetTabs; id: string; format?: () => ((value: number) => string) | null; filtered?: () => { shown: number; total: number } | null }) {
  const tabs = props.tabs, decide = createDecisionScope(() => props.id);
  const [renaming, setRenaming] = createSignal<string>(), [draft, setDraft] = createSignal("");
  const figures = createFigures(tabs.model, tabs.selection);
  const visible = () => tabs.tabs().filter((tab) => !tab.hidden), hidden = () => tabs.tabs().filter((tab) => tab.hidden);
  // The figures fold before the tabs give way: first to the sum, then to none.
  let strip: HTMLDivElement | undefined;
  const folds = createFolds(2, { over: () => strip ? strip.scrollWidth - strip.clientWidth : 0, content: true });
  // Folded by an attribute, never by taking them out, so a change of figures is all the fold watches for.
  const listed = () => { const format = figures() && props.format?.(); return FIGURES.flatMap((figure) => { const value = figures() && figure.of(figures()!); return value === null || value === undefined ? [] : [{ name: figure.name, value, text: format && figure.name !== "Count" ? format(value) : shown(value) }]; }); };

  // Computing is said once it has taken a whole turn of the spinner, so a change computed at once never flashes it.
  const [slow, setSlow] = createSignal(false);
  createEffect(() => { if (!tabs.computing()) return setSlow(false); const wait = setTimeout(() => setSlow(true), duration("--duration-spin")); onCleanup(() => clearTimeout(wait)); });

  // The shown tab is kept in view in the strip.
  createEffect(() => { const id = tabs.shown(); queueMicrotask(() => strip?.querySelector<HTMLElement>(`[data-tab="${CSS.escape(id ?? "")}"]`)?.scrollIntoView({ block: "nearest", inline: "nearest" })); });

  const add = () => { const names = new Set(tabs.tabs().map((tab) => tab.name.toLowerCase())); let n = tabs.tabs().length + 1; while (names.has(`sheet${n}`) || names.has(`sheet ${n}`)) n++; void tabs.op({ op: "add-tab", name: `Sheet ${n}` }); };
  const rename = (tab: Tab) => { setDraft(tab.name); setRenaming(tab.id); };
  const commit = (tab: Tab) => {
    const name = draft().trim();
    setRenaming(undefined);
    tabs.focus();
    if (!name || name === tab.name) return;
    const fault = tabNameFault(name);
    if (fault) return tabs.failed(fault);
    void tabs.op({ op: "rename-tab", tab: tab.id, name });
  };
  const move = (tab: Tab, by: -1 | 1) => { const list = visible(), at = list.findIndex((one) => one.id === tab.id), to = list[at + by]; if (to) void tabs.op({ op: "move-tab", tab: tab.id, at: tabs.tabs().findIndex((one) => one.id === to.id) }); };
  const remove = async (tab: Tab) => {
    if (tabs.filled(tab.id) && !await decide.confirm(`Delete ${tab.name}?`, { confirmLabel: "Delete", destructive: true })) return;
    void tabs.op({ op: "delete-tab", tab: tab.id });
  };
  const copy = (name: string, value: number) => void navigator.clipboard.writeText(String(Number(value.toPrecision(15)))).then(() => toast(`${name} copied`), () => tabs.failed("The figure could not be copied"));
  const alone = (tab: Tab) => !tab.hidden && visible().length < 2;

  const one = (tab: Tab) => {
    const at = () => visible().findIndex((one) => one.id === tab.id);
    // A long press opens the menu, and the lift's click must not then show the tab and take the keyboard, which shuts it.
    let held = false;
    return <Show when={renaming() === tab.id} fallback={
      <ContextMenu placement="bottom-start" onOpenChange={(open) => { held = open; }}>
        <ContextMenuTrigger as={(attrs: Omit<JSX.HTMLAttributes<HTMLSpanElement>, "draggable">) => <PaneTab id={tab.id} lit={tabs.shown() === tab.id} title={tab.name}
          onOpen={() => { if (!held) { tabs.show(tab.id); tabs.focus(); } }} drag={mergeProps(attrs, { onDblClick: () => rename(tab) })} />} />
        <ContextMenuContent>
          <MenuSection>
            <MenuRow icon={<Icons.Edit />} onSelect={() => rename(tab)}>Rename</MenuRow>
            <MenuRow icon={<Icons.ChevronLeft />} disabled={at() < 1} onSelect={() => move(tab, -1)}>Move left</MenuRow>
            <MenuRow icon={<Icons.ChevronRight />} disabled={at() >= visible().length - 1} onSelect={() => move(tab, 1)}>Move right</MenuRow>
            <MenuRow icon={<Icons.Hide />} disabled={alone(tab)} onSelect={() => void tabs.op({ op: "hide-tab", tab: tab.id, hidden: true })}>Hide</MenuRow>
            <MenuRow destructive icon={<Icons.Delete />} disabled={alone(tab) || tabs.tabs().length < 2} onSelect={() => void remove(tab)}>Delete</MenuRow>
          </MenuSection>
        </ContextMenuContent>
      </ContextMenu>}>
      <Input class="ui-spreadsheet-tab-name" aria-label="Tab name" spellcheck={false} value={draft()} ref={(field) => queueMicrotask(() => { field.focus(); field.select(); })}
        onInput={(event) => setDraft(event.currentTarget.value)} onBlur={() => { if (renaming() === tab.id) commit(tab); }}
        onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); commit(tab); } else if (event.key === "Escape") { event.preventDefault(); setRenaming(undefined); tabs.focus(); } }} />
    </Show>;
  };

  return <ToolBar edge="top" role="toolbar" aria-label="Tabs and figures" ref={folds.ref} data-folded={folds.count() || undefined}>
    <DropdownMenu modal={false} placement="top-start">
      <MenuControl kind="tool" as={IconButton} label="All tabs"><Icons.More /></MenuControl>
      <MenuContent>
        <MenuSection title="Tabs">
          <For each={visible()}>{(tab) => <MenuRow checked={tabs.shown() === tab.id} onSelect={() => { tabs.show(tab.id); tabs.focus(); }}>{tab.name}</MenuRow>}</For>
        </MenuSection>
        <Show when={hidden().length}>
          <MenuSection title="Hidden">
            <For each={hidden()}>{(tab) => <MenuRow icon={<Icons.Preview />} onSelect={() => void tabs.op({ op: "hide-tab", tab: tab.id, hidden: false })}>{tab.name}</MenuRow>}</For>
          </MenuSection>
        </Show>
      </MenuContent>
    </DropdownMenu>
    <div ref={strip} class="ui-spreadsheet-tabs" role="tablist" aria-label="Tabs">
      <PaneTabs><For each={visible()}>{one}</For></PaneTabs>
    </div>
    <IconButton label="Add a tab" onClick={add}><Icons.Add /></IconButton>
    <span class="ui-spreadsheet-figures" aria-live="polite">
      <For each={listed()}>{(figure) => <DashPath title={`Copy the ${figure.name.toLowerCase()}`} path={`${figure.name} ${figure.text}`} onCopy={() => copy(figure.name, figure.value)} />}</For>
    </span>
    <Show when={props.filtered?.()}>{(rows) => <Notice kind="tool">{rows().shown} of {rows().total} rows</Notice>}</Show>
    <Show when={slow()}><Notice kind="tool" busy live>Computing</Notice></Show>
  </ToolBar>;
}
