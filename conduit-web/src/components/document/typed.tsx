import { Extension, type Editor } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { createEffect, createMemo, createSignal, For, on, type Accessor, type JSX } from "solid-js";
import { ySyncPluginKey } from "y-prosemirror";
import { Popover, PopoverContent } from "@/components/ui/menus";
import { Item, Section } from "@/components/ui/popover";
import { blockById } from "./blocks";

/** A trigger typed and what follows it up to the caret (`from`..`to`, the trigger included). */
export type Typed = { from: number; to: number; query: string };
export type Typing = { at: Typed | null; dismissed: number | null };
export const sameTyped = (a: Typed | null, b: Typed | null) => a?.from === b?.from && a?.query === b?.query;

/**
 * A menu opened by typing: `pattern` finds the trigger and its query (its first group) ending at the caret, and says where it may start. The plugin
 * marks where it starts with `anchor` (what the menu is placed by); `keys` has the keys while the menu shows. It is started only by this person's
 * typing, so the caret put back after an old one opens nothing and neither does what someone else writes; one dismissed (`key`'s meta) stays shut.
 */
export const typing = (name: string, key: PluginKey<Typing>, pattern: RegExp, anchor: HTMLElement, told: (at: Typed | null) => void, keys: (event: KeyboardEvent) => boolean) => Extension.create({
  name,
  addProseMirrorPlugins: () => [new Plugin<Typing>({
    key,
    state: {
      init: () => ({ at: null, dismissed: null }),
      apply: (tr, old, _, state) => {
        const dismissed = tr.getMeta(key) ? old.at?.from ?? null : old.dismissed === null ? null : tr.mapping.map(old.dismissed);
        const { empty, $from } = state.selection;
        const typed = empty && $from.parent.isTextblock && !$from.parent.type.spec.code && ((tr.docChanged && !tr.getMeta(ySyncPluginKey)?.isChangeOrigin) || old.at) ? pattern.exec($from.parent.textBetween(0, $from.parentOffset, undefined, "￼")) : null;
        const at = typed ? { from: $from.start() + typed.index, to: $from.pos, query: typed[1]! } : null;
        return { at: at && at.from !== dismissed ? at : null, dismissed: at ? dismissed : null };
      },
    },
    props: {
      decorations: (state) => { const at = key.getState(state)?.at; return at ? DecorationSet.create(state.doc, [Decoration.widget(at.from, anchor, { key: name, side: -1 })]) : null; },
      handleKeyDown: (_view, event) => keys(event),
    },
    view: () => ({ update: (view) => told(key.getState(view.state)?.at ?? null) }),
  })],
});

/** A typed menu's keys: arrows move the cursor, Enter or Tab picks, Escape dismisses; any other key is the typing's. */
export const menuKeys = <T,>(event: KeyboardEvent, list: readonly T[], active: number, setActive: (at: number) => void, pick: (item: T) => void, dismiss: () => void) => {
  if (!list.length) return false;
  if (event.key === "ArrowDown" || event.key === "ArrowUp") setActive(Math.max(0, Math.min(list.length - 1, active + (event.key === "ArrowDown" ? 1 : -1))));
  else if (event.key === "Enter" || event.key === "Tab") pick(list[Math.min(active, list.length - 1)]!);
  else if (event.key === "Escape") dismiss();
  else return false;
  return true;
};

/** A menu would take the typing: the popover is placed at the trigger and the editor keeps the keys. */
export function TypedMenu<T>(props: { label: string; anchor: HTMLElement; items: readonly T[]; name: (item: T) => string; icon?: (item: T) => JSX.Element; active: number; onCursor: (at: number) => void; onPick: (item: T) => void; onDismiss: () => void }) {
  return <Popover open={props.items.length > 0} onOpenChange={(open) => { if (!open) props.onDismiss(); }} anchorRef={() => props.anchor} placement="bottom-start">
    <PopoverContent aria-label={props.label} width="sm" onOpenAutoFocus={(event) => event.preventDefault()} onCloseAutoFocus={(event) => event.preventDefault()}>
      <Section role="listbox"><For each={props.items}>{(item, at) => <Item role="option" icon={props.icon?.(item)} aria-selected={props.active === at()} active={props.active === at()} onCursor={() => props.onCursor(at())} onMouseDown={(event: MouseEvent) => event.preventDefault()} onClick={() => props.onPick(item)}>{props.name(item)}</Item>}</For></Section>
    </PopoverContent>
  </Popover>;
}

type Tool = { label: string; icon: () => JSX.Element; run(): void };
const slashed = new PluginKey<Typing>("slash");
/**
 * The block kinds, offered as `/` is typed where a word may start and filtered by what follows it; picked, the typed `/…` goes and the caret's block
 * becomes that kind. `made`: a block made only to offer them (the block handle's "+"), which goes again if the menu shuts with nothing but its `/`.
 */
export function createSlash(editor: Accessor<Editor | undefined>, tools: readonly Tool[]) {
  const anchor = document.createElement("span"), [asked, setAsked] = createSignal<Typed | null>(null, { equals: sameTyped }), [active, setActive] = createSignal(0);
  const offered = createMemo(() => { const query = asked()?.query.toLowerCase(); return query === undefined ? [] : tools.filter((tool) => tool.label.toLowerCase().includes(query)); });
  createEffect(() => { asked(); setActive(0); });
  let made: string | undefined;
  // After the transaction that shut it, never inside it.
  createEffect(on(asked, (now) => {
    const id = made;
    if (now || !id) return;
    made = undefined;
    queueMicrotask(() => {
      const view = editor()?.view, at = view ? blockById(view.state.doc, id) : null, node = at === null ? null : view!.state.doc.nodeAt(at);
      if (node?.textContent === "/") view!.dispatch(view!.state.tr.delete(at!, at! + node.nodeSize));
    });
  }, { defer: true }));
  const dismiss = () => { const view = editor()?.view; if (view && asked()) view.dispatch(view.state.tr.setMeta(slashed, true)); };
  const pick = (tool: Tool) => { const view = editor()?.view, at = asked(); if (!view || !at) return; view.dispatch(view.state.tr.delete(at.from, at.to)); tool.run(); };
  return {
    made: (id: string | undefined) => { made = id; },
    extension: () => typing("slash", slashed, /(?<!\S)\/([^\s/]*)$/, anchor, setAsked, (event) => menuKeys(event, offered(), active(), setActive, pick, dismiss)),
    menu: () => <TypedMenu label="Blocks" anchor={anchor} items={offered()} name={(tool) => tool.label} icon={(tool) => tool.icon()} active={active()} onCursor={setActive} onPick={pick} onDismiss={dismiss} />,
  };
}
