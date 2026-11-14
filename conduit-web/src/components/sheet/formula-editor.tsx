/*
 * The sheet's formula editor: one edit of a cell's input, shown and typed alike in the cell (over the grid) and in the formula bar. It is the
 * sheet's own and not the grid's: the grid's editor is a React portal made after the key that opens it, so keys typed before it took focus were
 * lost, and a composition (IME) begun on that key had nowhere to go. This one stands in the page and takes focus while the opening key is still
 * being dispatched, so the browser types that key, and every one after it, into it.
 */
import { batch, createEffect, createMemo, createSignal, For, onCleanup, Show, untrack, type Accessor } from "solid-js";
import { Item, Match, Section } from "@/components/ui";
import { Popover, PopoverContent } from "@/components/ui/menus";
import { a1, rangeA1 } from "@/sheet-format.js";
import { contextAt, cycleAnchors, finish, INKS, inksOf, isFormula, tokenize, type FormulaContext, type FormulaToken } from "./formula";
import { argumentAt, FUNCTION_HELP } from "./functions";
import type { SheetGrid, SheetReference } from "./host";

type Cell = { row: number; col: number };
/** Where an edit is shown and typed: over the cell, or in the formula bar. */
export type FormulaPlace = "cell" | "bar";
/** `enter`: begun by typing over the cell; arrows point at cells where a reference can go, else end the edit and move. `edit`: opened on what the cell holds; arrows move the caret. F2 turns one into the other. */
export type FormulaMode = "enter" | "edit";

/** What the editor needs of the sheet. */
export type FormulaEditorHost = {
  grid(): SheetGrid | undefined;
  /** What was typed in a cell. */
  input(row: number, col: number): string;
  /** Every function the engine has registered, custom ones included. */
  functions(): readonly string[];
  write(row: number, col: number, input: string): void;
};

/** One edit, which every FormulaField given it shows; the sheet drives it from the grid (keys, presses, drags). */
export interface FormulaEditor {
  editing: Accessor<(Cell & { mode: FormulaMode }) | null>;
  text: Accessor<string>;
  caret: Accessor<number>;
  tokens: Accessor<readonly FormulaToken[]>;
  /** Each distinct reference's ink (formula.ts INKS), by its key. */
  inks: Accessor<ReadonlyMap<string, number>>;
  references: Accessor<readonly SheetReference[]>;
  context: Accessor<FormulaContext>;
  /** Functions offered for the name being typed, and the one the arrows are on. */
  offered: Accessor<readonly string[]>;
  active: Accessor<number>;
  /** The call the caret is in, for its signature. */
  hint: Accessor<{ name: string; arg: number } | null>;
  place: Accessor<FormulaPlace>;
  /** The field of the place last typed in, which the help stands under. */
  anchor(): HTMLElement | undefined;
  field(place: FormulaPlace, element: HTMLElement): void;
  begin(cell: Cell, mode: FormulaMode, place: FormulaPlace): void;
  /** Writes the edit and ends it; `move` the selection by rows and columns; `focus` hands the keyboard back to the grid. */
  commit(move?: readonly [number, number], focus?: boolean): void;
  cancel(): void;
  typed(text: string, caret: number): void;
  caretAt(caret: number): void;
  keydown(event: KeyboardEvent, place: FormulaPlace): void;
  focused(place: FormulaPlace): void;
  left(to: Element | null): void;
  /** A press on a cell while editing: true when it was pointed into the formula (with Shift, as the far corner from the last one pointed at). */
  press(cell: Cell, extend: boolean): boolean;
  drag(cell: Cell): void;
  accept(name: string): void;
}

const OFFERED = 8;
const ARROWS: Readonly<Record<string, readonly [number, number]>> = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
const box = (a: Cell, b: Cell) => ({ top: Math.min(a.row, b.row), bottom: Math.max(a.row, b.row), left: Math.min(a.col, b.col), right: Math.max(a.col, b.col) });
const sameReference = (a: SheetReference, b: SheetReference | undefined) => !!b && a.ink === b.ink && a.pointing === b.pointing && a.range.top === b.range.top && a.range.left === b.range.left && a.range.bottom === b.range.bottom && a.range.right === b.range.right;

export function createFormulaEditor(host: FormulaEditorHost): FormulaEditor {
  const [editing, setEditing] = createSignal<(Cell & { mode: FormulaMode }) | null>(null), [text, setText] = createSignal(""), [caret, setCaret] = createSignal(0);
  const [place, setPlace] = createSignal<FormulaPlace>("cell"), [active, setActive] = createSignal(0), [shut, setShut] = createSignal<string | null>(null);
  // The reference last pointed at: its span of the text, what was typed of it first (a range typed to its colon is finished by pointing), its corners.
  const [pointing, setPointing] = createSignal<{ from: number; to: number; prefix: string; anchor: Cell; at: Cell } | null>(null);
  const fields: Partial<Record<FormulaPlace, HTMLElement>> = {};
  const tokens = createMemo(() => tokenize(text())), inks = createMemo(() => inksOf(tokens()));
  const context = createMemo(() => contextAt(text(), tokens(), caret()));
  // Told to the grid only when they change: a key that changes no reference redraws nothing.
  const references = createMemo<readonly SheetReference[]>(() => {
    if (!editing()) return [];
    const seen = new Set<string>(), ink = inks(), pointed = pointing(), list: SheetReference[] = [];
    for (const token of tokens()) if (token.ref && token.key && !seen.has(token.key)) { seen.add(token.key); list.push({ range: token.ref, ink: ink.get(token.key)!, pointing: pointed?.from === token.from }); }
    return list;
  }, [], { equals: (a, b) => a.length === b.length && a.every((one, at) => sameReference(one, b[at])) });
  const names = createMemo(() => [...host.functions()].sort());
  const offered = createMemo(() => {
    const word = context().word;
    if (!editing() || !word || shut() === text()) return [];
    const typed = word.text.toUpperCase();
    return names().filter((name) => name.startsWith(typed)).slice(0, OFFERED);
  });
  const hint = createMemo(() => editing() ? context().call : null, null, { equals: (a, b) => a?.name === b?.name && a?.arg === b?.arg });
  createEffect(() => { offered(); setActive(0); });

  const put = (next: string, at: number) => batch(() => { setText(next); setCaret(at); });
  const end = () => batch(() => { setEditing(null); setPointing(null); setShut(null); });
  const commit = (move?: readonly [number, number], focus = true) => {
    const now = editing();
    if (!now) return;
    const input = finish(text()), grid = host.grid();
    end();
    if (input !== host.input(now.row, now.col)) host.write(now.row, now.col, input);
    // Moved as an arrow key moves the selection: scrolled only as far as it must be.
    if (move) { const row = Math.max(0, now.row + move[0]), col = Math.max(0, now.col + move[1]); grid?.select({ top: row, bottom: row, left: col, right: col }); grid?.show(row, col); }
    if (focus) grid?.focus();
  };
  const cancel = () => { if (!editing()) return; end(); host.grid()?.focus(); };
  const point = (anchor: Cell, at: Cell) => {
    const was = pointing(), spot = was ?? context().point, now = text();
    if (!spot) return false;
    const replaced = now.slice(spot.from, spot.to), prefix = was ? was.prefix : replaced.endsWith(":") ? replaced : "";
    const reference = prefix ? prefix + a1(at.row, at.col) : rangeA1(box(anchor, at)), to = spot.from + reference.length;
    batch(() => { put(now.slice(0, spot.from) + reference + now.slice(spot.to), to); setPointing({ from: spot.from, to, prefix, anchor, at }); });
    host.grid()?.show(at.row, at.col);
    return true;
  };
  const canPoint = () => isFormula(text()) && Boolean(pointing() || context().point);
  const accept = (name: string) => {
    const word = context().word, now = text();
    if (!word) return;
    const rest = now.slice(word.to);
    put(now.slice(0, word.from) + name + (rest.startsWith("(") ? "" : "(") + rest, word.from + name.length + 1);
  };
  const turnAnchors = () => {
    const spot = context().point, now = text();
    if (!spot || spot.from === spot.to) return;
    const next = cycleAnchors(now.slice(spot.from, spot.to));
    batch(() => { setPointing(null); put(now.slice(0, spot.from) + next + now.slice(spot.to), spot.from + next.length); });
  };

  return {
    editing, text, caret, tokens, inks, references, context, offered, active, hint, place, accept,
    field: (where, element) => { fields[where] = element; },
    anchor: () => fields[place()],
    begin: (cell, mode, where) => {
      if (editing()) return;
      const was = mode === "enter" ? "" : host.input(cell.row, cell.col);
      batch(() => { setPlace(where); setEditing({ ...cell, mode }); put(was, was.length); });
      // The cell's field opens with the caret at the end; the bar's keeps where it was pressed.
      const field = fields[where];
      if (!field || document.activeElement === field) return;
      field.focus();
      placeCaret(field, was.length);
    },
    commit, cancel,
    typed: (next, at) => { if (!editing()) return; batch(() => { setPointing(null); put(next, at); }); },
    caretAt: (at) => { setCaret(at); if (pointing() && pointing()!.to !== at) setPointing(null); },
    keydown: (event, where) => {
      const now = editing(), list = offered(), step = ARROWS[event.key];
      if (!now || event.isComposing) return;
      const take = () => event.preventDefault();
      if (list.length && step && !step[1]) { take(); setActive((at) => Math.min(list.length - 1, Math.max(0, at + step[0]))); return; }
      if (list.length && (event.key === "Tab" || event.key === "Enter") && !event.shiftKey) { take(); accept(list[active()]!); return; }
      if (list.length && event.key === "Escape") { take(); setShut(text()); return; }
      if (event.key === "Enter" && event.altKey) { take(); const at = caret(); put(text().slice(0, at) + "\n" + text().slice(at), at + 1); return; }
      if (event.key === "Enter" || event.key === "Tab") { take(); const back = event.shiftKey ? -1 : 1; commit(event.key === "Enter" ? [back, 0] : [0, back]); return; }
      if (event.key === "Escape") { take(); cancel(); return; }
      if (event.key === "F4") { take(); turnAnchors(); return; }
      if (event.key === "F2") { take(); setEditing({ ...now, mode: now.mode === "enter" ? "edit" : "enter" }); return; }
      if (!step || where !== "cell" || now.mode !== "enter" || event.ctrlKey || event.metaKey || event.altKey) return;
      take();
      if (!canPoint()) return commit(step);
      const from = pointing(), base = from?.at ?? now, at = { row: Math.max(0, base.row + step[0]), col: Math.max(0, base.col + step[1]) };
      point(event.shiftKey ? from?.anchor ?? base : at, at);
    },
    focused: (where) => { setPlace(where); const now = editing(); if (now && where === "bar" && now.mode === "enter") setEditing({ ...now, mode: "edit" }); },
    // Focus gone anywhere but the other field ends the edit; the window losing focus does not.
    left: (to) => { if (editing() && document.hasFocus() && !(to && Object.values(fields).some((field) => field.contains(to)))) commit(undefined, false); },
    press: (cell, extend) => editing() !== null && canPoint() && point(extend && pointing() ? pointing()!.anchor : cell, cell),
    drag: (cell) => { const was = pointing(); if (was && (was.at.row !== cell.row || was.at.col !== cell.col)) point(was.anchor, cell); },
  };
}

/** Where the caret stands in a field, counted in characters of its text. */
const caretOf = (element: HTMLElement) => {
  const selection = getSelection();
  if (!selection?.rangeCount || !element.contains(selection.focusNode)) return null;
  const range = document.createRange();
  range.selectNodeContents(element); range.setEnd(selection.focusNode!, selection.focusOffset);
  return range.toString().length;
};
const placeCaret = (element: HTMLElement, at: number) => {
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const length = node.textContent!.length;
    if (at <= length) return getSelection()?.collapse(node, at);
    at -= length;
  }
  getSelection()?.collapse(element, element.childNodes.length);
};
/** The text as runs: plain text, or a reference's text and its ink. */
const runsOf = (text: string, tokens: readonly FormulaToken[] | null, inks: ReadonlyMap<string, number> | null) => {
  const runs: [string, number | null][] = [];
  let run = "";
  for (const token of tokens ?? []) {
    const part = text.slice(token.from, token.to), ink = token.key === undefined ? undefined : inks?.get(token.key);
    if (ink === undefined) { run += part; continue; }
    if (run) { runs.push([run, null]); run = ""; }
    runs.push([part, ink]);
  }
  if (!tokens) run = text;
  if (run) runs.push([run, null]);
  return runs;
};
/** Whether the field already shows these runs: what the browser typed into a run that stays one (most keys) needs no drawing again. */
const shows = (element: HTMLElement, runs: readonly [string, number | null][]) => {
  const nodes = element.childNodes;
  if (nodes.length !== runs.length) return false;
  return runs.every(([text, ink], at) => { const node = nodes[at]!; return node.textContent === text && (ink === null ? node.nodeType === Node.TEXT_NODE : (node as HTMLElement).dataset.ink === String(ink)); });
};
const paint = (element: HTMLElement, runs: readonly [string, number | null][]) => {
  element.replaceChildren(...runs.map(([text, ink]) => {
    if (ink === null) return text;
    const span = document.createElement("span");
    span.dataset.ink = String(ink); span.style.color = `var(${INKS[ink]})`; span.textContent = text;
    return span;
  }));
};

/** The editor's text, each reference in its ink; typed in as plain text. `idle`: what it shows while nothing is edited (the formula bar: the selected cell's input). */
export function FormulaField(props: { editor: FormulaEditor; place: FormulaPlace; label: string; idle?: () => string; disabled?: boolean; class?: string }) {
  const editor = props.editor;
  let element!: HTMLDivElement, composing = false;
  createEffect(() => {
    const live = editor.editing() !== null, text = live ? editor.text() : props.idle?.() ?? "", tokens = live ? editor.tokens() : null, inks = live ? editor.inks() : null;
    const runs = runsOf(text, tokens, inks);
    if (composing || shows(element, runs)) return;
    paint(element, runs);
    if (live && document.activeElement === element) placeCaret(element, untrack(editor.caret));
  });
  const read = () => editor.typed(element.textContent ?? "", caretOf(element) ?? 0);
  const moved = () => { if (!composing && document.activeElement === element && editor.editing()) { const at = caretOf(element); if (at !== null) editor.caretAt(at); } };
  document.addEventListener("selectionchange", moved);
  onCleanup(() => document.removeEventListener("selectionchange", moved));
  return <div ref={(made) => { element = made; editor.field(props.place, made); }} class={props.class} role="textbox" aria-label={props.label} aria-multiline={props.place === "cell"} spellcheck={false} autocapitalize="off"
    contentEditable={props.disabled ? false : "plaintext-only"} tabIndex={props.disabled ? -1 : 0}
    // The pane takes focus on a press that is not in a field it knows (a plain-text region is not one); a press here is the field's.
    onPointerDown={(event) => event.stopPropagation()}
    onFocus={() => editor.focused(props.place)} onFocusOut={(event) => editor.left(event.relatedTarget as Element | null)}
    onKeyDown={(event) => editor.keydown(event, props.place)} onInput={() => { if (!composing) read(); }}
    onCompositionStart={() => { composing = true; }} onCompositionEnd={() => { composing = false; read(); }} />;
}

/** What the editor offers as a formula is typed: the functions a name being typed could be, or the signature of the call the caret is in. */
/** `frame`: an element that holds still while the field grows, so the help is not placed again on every key; it stands under the field's box. */
export function FormulaHelp(props: { editor: FormulaEditor; frame: () => HTMLElement | undefined }) {
  const editor = props.editor, keep = (event: MouseEvent) => event.preventDefault();
  const signature = () => { const call = editor.hint(); return call ? { ...call, help: FUNCTION_HELP[call.name] } : null; };
  // Open while the edit has something to offer: a press outside (pointing at a cell) leaves it, and Escape is the field's to read.
  return <Popover open={editor.offered().length > 0 || signature() !== null} anchorRef={props.frame} anchorRect={() => editor.anchor()?.getBoundingClientRect()} placement="bottom-start" kept>
    <PopoverContent aria-label="Functions" width="md" onOpenAutoFocus={(event) => event.preventDefault()} onCloseAutoFocus={(event) => event.preventDefault()}>
      <Show when={editor.offered().length} fallback={<Show when={signature()}>{(call) => {
        const at = () => call().help ? argumentAt(call().help!, call().arg) : -1;
        return <div class="ui-formula-hint" onMouseDown={keep}>
          <span>{call().name}(<For each={call().help?.args}>{(arg, index) => <>{index() ? ", " : ""}<Show when={index() === at()} fallback={arg}><b>{arg}</b></Show></>}</For>)</span>
          <Show when={call().help}>{(help) => <small>{help().about}</small>}</Show>
        </div>;
      }}</Show>}>
        <Section role="listbox"><For each={editor.offered()}>{(name, at) =>
          <Item role="option" aria-selected={editor.active() === at()} active={editor.active() === at()} onMouseDown={keep} onClick={() => editor.accept(name)} detail={FUNCTION_HELP[name]?.about}>
            <Match text={name} query={editor.context().word?.text ?? ""} />
          </Item>}</For></Section>
      </Show>
    </PopoverContent>
  </Popover>;
}
