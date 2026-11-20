import { createEffect, createMemo, createSignal, For, Index, mergeProps, onCleanup, Show, type JSX } from "solid-js";
import { DashPath, Dot, IconButton, Icons, Input, Notice, PaneTab, PaneTabs, ToolBar } from "@/components/ui";
import { sheetDataIcons as DataIcons } from "@/components/ui/sheet-icons";
import { SHEET_INKS } from "@/sheet-styles.js";
import { SHEET_INK_TOKENS } from "./theme";
import { duration } from "@/components/ui/motion";
import { createDecisionScope } from "@/components/ui/decision-dialog";
import { createFolds } from "@/components/ui/fit";
import { ContextMenu, ContextMenuContent, ContextMenuTrigger, DropdownMenu, MenuContent, MenuControl, MenuRow, MenuSection, MenuSub, MenuSubContent, MenuSubTrigger } from "@/components/ui/menus";
import { toast } from "@/components/ui/notifications";
import { tabNameFault, type Tab } from "@/sheet-format.js";
import { createFigures, type SheetFigures } from "./stats";
import type { SheetTabs } from "./tabs";
import type { SheetRange } from "./host";
import { menuAt } from "./cell-menu";

// Shown as the grid shows a number: a long one cut to what a sheet shows.
const NUMBER = new Intl.NumberFormat(undefined, { maximumFractionDigits: 10 }), shown = (value: number) => NUMBER.format(Number(value.toPrecision(12)));
const FIGURES: { name: string; of(figures: SheetFigures): number | null }[] = [
  { name: "Sum", of: (f) => f.numbers ? f.sum : null },
  { name: "Average", of: (f) => f.numbers ? f.sum / f.numbers : null },
  { name: "Count", of: (f) => f.count },
  { name: "Min", of: (f) => f.numbers ? f.min : null },
  { name: "Max", of: (f) => f.numbers ? f.max : null },
];

/** The sheet's foot: its tabs, to show, add, rename, move, hide and delete, and the figures of the cells selected. */
/** `format`: how a range's figures but its count are drawn, where it has one number format throughout (formats.ts). */
// A tab dragged along the strip, as a spreadsheet's: its id, under a type of its own so nothing else dropped there moves a tab.
const DRAGGED = "application/x-conduit-sheet-tab";
const inkOf = (color: string) => (SHEET_INKS as readonly string[]).includes(color) ? `var(${SHEET_INK_TOKENS[color as keyof typeof SHEET_INK_TOKENS]})` : color;
const INK_NAMES: Record<string, string> = { red: "Red", amber: "Amber", green: "Green", blue: "Blue" };

/** Adds a tab after the last, named as a spreadsheet names it (Sheet 3), as Shift+F11 and the strip's Add do. */
export const addTab = (tabs: SheetTabs) => { const names = new Set(tabs.tabs().map((tab) => tab.name.toLowerCase())); let n = tabs.tabs().length + 1; while (names.has(`sheet${n}`) || names.has(`sheet ${n}`)) n++; void tabs.op({ op: "add-tab", name: `Sheet ${n}` }); };

/** `filtered`: the rows under the filter's header and how many it shows, while it narrows them. `act`: a change made as one named step (history.ts). */
export function SheetFoot(props: { tabs: SheetTabs; id: string; format?: (range: SheetRange) => ((value: number) => string) | null; filtered?: () => { shown: number; total: number } | null; mode?: () => string | null; act(label: string, run: () => void): void }) {
  const tabs = props.tabs, decide = createDecisionScope(() => props.id);
  const [renaming, setRenaming] = createSignal<string>(), [draft, setDraft] = createSignal("");
  const figures = createFigures(tabs.model, tabs.selection);
  const visible = () => tabs.tabs().filter((tab) => !tab.hidden), hidden = () => tabs.tabs().filter((tab) => tab.hidden);
  // The figures fold before the tabs give way: first to the sum, then to none.
  let strip: HTMLDivElement | undefined;
  const folds = createFolds(2, { over: () => strip ? strip.scrollWidth - strip.clientWidth : 0, content: true });
  // Folded by an attribute, never by taking them out, so a change of figures is all the fold watches for.
  // Made again only as the figures, or the format of the cells they are of, change: never per move of the selection.
  const listed = createMemo(() => { const now = figures(), format = now && props.format?.(now.range); return now ? FIGURES.flatMap((figure) => { const value = figure.of(now); return value === null ? [] : [{ name: figure.name, value, text: format && figure.name !== "Count" ? format(value) : shown(value) }]; }) : []; });

  // Computing is said once it has taken a whole turn of the spinner, so a change computed at once never flashes it.
  const [slow, setSlow] = createSignal(false);
  createEffect(() => { if (!tabs.computing()) return setSlow(false); const wait = setTimeout(() => setSlow(true), duration("--duration-spin")); onCleanup(() => clearTimeout(wait)); });

  // The shown tab is kept in view in the strip.
  createEffect(() => { const id = tabs.shown(); queueMicrotask(() => strip?.querySelector<HTMLElement>(`[data-tab="${CSS.escape(id ?? "")}"]`)?.scrollIntoView({ block: "nearest", inline: "nearest" })); });

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
  const color = (tab: Tab, ink: string | null) => props.act("Tab colour", () => tabs.setColor(tab.id, ink));
  const drop = (event: DragEvent, onto: Tab) => {
    const id = event.dataTransfer?.getData(DRAGGED);
    if (!id || id === onto.id) return;
    event.preventDefault();
    void tabs.op({ op: "move-tab", tab: id, at: tabs.tabs().findIndex((one) => one.id === onto.id) });
  };

  // A tab reached by the keyboard (F6 from the ribbon): Left and Right (Home, End) go along the tabs, Enter shows one, F2 renames it, Shift+F10 or
  // the Menu key opens its menu, Esc goes back to the grid.
  const stripKeys = (event: KeyboardEvent) => {
    const at = (event.target as HTMLElement).closest<HTMLElement>(".ui-tab");
    if (!at || event.ctrlKey || event.altKey || event.metaKey) return;
    const list = [...strip!.querySelectorAll<HTMLElement>(".ui-tab")], by = { ArrowRight: 1, ArrowLeft: -1, Home: -Infinity, End: Infinity }[event.key];
    if (by) { event.preventDefault(); return list[Math.max(0, Math.min(list.length - 1, Number.isFinite(by) ? list.indexOf(at) + by : by > 0 ? list.length - 1 : 0))]?.querySelector<HTMLElement>(".ui-tab-open")?.focus(); }
    if (event.key === "Escape") { event.preventDefault(); return tabs.focus(); }
    if (event.key === "F11" && event.shiftKey) { event.preventDefault(); return addTab(tabs); }
    if ((event.key === "F10" && event.shiftKey) || event.key === "ContextMenu") { event.preventDefault(); const box = at.getBoundingClientRect(); menuAt(at, box.left + box.width / 2, box.top); }
  };
  const one = (tab: Tab) => {
    const at = () => visible().findIndex((one) => one.id === tab.id);
    // A long press opens the menu, and the lift's click must not then show the tab and take the keyboard, which shuts it.
    let held = false;
    return <Show when={renaming() === tab.id} fallback={
      <ContextMenu placement="bottom-start" onOpenChange={(open) => { held = open; }}>
        <ContextMenuTrigger as={(attrs: Omit<JSX.HTMLAttributes<HTMLSpanElement>, "draggable">) => <PaneTab id={tab.id} lit={tabs.shown() === tab.id} title={tab.name}
          icon={tabs.color(tab.id) ? <Dot style={{ color: inkOf(tabs.color(tab.id)!) }} /> : undefined}
          onOpen={() => { if (!held) { tabs.show(tab.id); tabs.focus(); } }} drag={mergeProps(attrs, {
            onDblClick: () => rename(tab), draggable: true, onKeyDown: (event: KeyboardEvent) => { if (event.key === "F2") { event.preventDefault(); rename(tab); } },
            onDragStart: (event: DragEvent) => { event.dataTransfer?.setData(DRAGGED, tab.id); if (event.dataTransfer) event.dataTransfer.effectAllowed = "move"; },
            onDragOver: (event: DragEvent) => { if (event.dataTransfer?.types.includes(DRAGGED)) event.preventDefault(); },
            onDrop: (event: DragEvent) => drop(event, tab),
          })} />} />
        {/* Shut, it gives the keyboard back to the grid, unless Rename took it. */}
        <ContextMenuContent onCloseAutoFocus={(event) => { event.preventDefault(); requestAnimationFrame(() => { if (!document.activeElement?.matches("input, [role=dialog] *, [role=alertdialog] *")) tabs.focus(); }); }}>
          <MenuSection>
            <MenuRow icon={<Icons.Edit />} keys={["F2"]} onSelect={() => rename(tab)}>Rename</MenuRow>
            <MenuRow icon={<DataIcons.duplicate />} onSelect={() => void tabs.op({ op: "duplicate-tab", tab: tab.id })}>Duplicate</MenuRow>
            <MenuSub><MenuSubTrigger icon={<DataIcons.color />}>Tab colour</MenuSubTrigger><MenuSubContent><MenuSection>
              <For each={SHEET_INKS}>{(ink) => <MenuRow icon={<Dot style={{ color: inkOf(ink) }} />} checked={tabs.color(tab.id) === ink} onSelect={() => color(tab, ink)}>{INK_NAMES[ink]}</MenuRow>}</For>
              <MenuRow checked={!tabs.color(tab.id)} onSelect={() => color(tab, null)}>No colour</MenuRow>
            </MenuSection></MenuSubContent></MenuSub>
            <MenuRow icon={<Icons.ChevronLeft />} disabled={at() < 1} onSelect={() => move(tab, -1)}>Move left</MenuRow>
            <MenuRow icon={<Icons.ChevronRight />} disabled={at() >= visible().length - 1} onSelect={() => move(tab, 1)}>Move right</MenuRow>
            <MenuRow icon={<Icons.Hide />} disabled={alone(tab)} onSelect={() => void tabs.op({ op: "hide-tab", tab: tab.id, hidden: true })}>Hide</MenuRow>
            <Show when={hidden().length}>
              <MenuSub><MenuSubTrigger icon={<Icons.Preview />}>Unhide</MenuSubTrigger><MenuSubContent><MenuSection>
                <For each={hidden()}>{(one) => <MenuRow onSelect={() => void tabs.op({ op: "hide-tab", tab: one.id, hidden: false })}>{one.name}</MenuRow>}</For>
              </MenuSection></MenuSubContent></MenuSub>
            </Show>
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
    <div ref={(element) => { strip = element; element.addEventListener("keydown", stripKeys); }} class="ui-spreadsheet-tabs" role="tablist" aria-label="Tabs">
      <PaneTabs><For each={visible()}>{one}</For></PaneTabs>
    </div>
    <IconButton label="Add a tab" onClick={() => addTab(tabs)}><Icons.Add /></IconButton>
    <span class="ui-spreadsheet-figures" aria-live="polite">
      <Index each={listed()}>{(figure) => <DashPath title={`Copy the ${figure().name.toLowerCase()}`} path={`${figure().name} ${figure().text}`} onCopy={() => copy(figure().name, figure().value)} />}</Index>
    </span>
    <Show when={props.filtered?.()}>{(rows) => <Notice kind="tool">{rows().shown} of {rows().total} rows</Notice>}</Show>
    <Show when={props.mode?.()}>{(said) => <Notice kind="tool" live>{said()}</Notice>}</Show>
    <Show when={slow()}><Notice kind="tool" busy live>Computing</Notice></Show>
  </ToolBar>;
}
