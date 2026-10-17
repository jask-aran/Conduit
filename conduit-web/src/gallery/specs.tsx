import { For, Show, createEffect, createSignal, on, onCleanup, onMount, type JSX } from "solid-js";
import { Button, Frost, type Motion } from "@/components/ui";

/*
 * The gallery's ways of showing a piece: In use (a scene, each place numbered, what it computes
 * to) and a forms table (each form down the side, where it sits across, its code and tokens).
 * Shared by Foundations and the families.
 */
/** A length as read, to a tenth (layout works in 64ths, so 6.4 reads back 6.39). */
export const px = (value: string) => value.replace(/(\d+\.\d+)px/g, (_, n: string) => `${Number(Number(n).toFixed(1))}px`);

/*
 * In use: a small scene drawn by the library, each place a foundation shows numbered
 * on it, and what it computes to beside the number -- at desktop and phone.
 */
/** side: the number above or below what it marks, for a part sharing its line with others; else in the gutter left of the scene. */
export interface Mark { selector: string; label: string; read: (el: HTMLElement) => string; side?: "above" | "below" }
/** A box of space drawn over a scene: a container's padding (edge) or the gap between two of its parts. */
type Band = { x: number; y: number; w: number; h: number; kind: "edge" | "gap"; label: string };
/** The bands of each container in the scene: its padding all round, and the gap between each pair of its children. */
const bandsOf = (scene: Element, selectors: string[]): Band[] => {
  const box = scene.getBoundingClientRect();
  const bands: Band[] = [];
  const add = (x: number, y: number, w: number, h: number, kind: Band["kind"]) => {
    if (w < 0.5 || h < 0.5) return;
    bands.push({ x: x - box.left, y: y - box.top, w, h, kind, label: px(`${w > h ? h : w}px`) });
  };
  for (const el of selectors.flatMap((selector) => [...scene.querySelectorAll(selector)])) {
    // Inside its border: the edge is the padding alone.
    const s = getComputedStyle(el); const line = parseFloat(s.borderTopWidth); const outer = el.getBoundingClientRect();
    const r = new DOMRect(outer.left + line, outer.top + line, outer.width - 2 * line, outer.height - 2 * line);
    const [t, rt, b, l] = [s.paddingTop, s.paddingRight, s.paddingBottom, s.paddingLeft].map(parseFloat);
    add(r.left, r.top, r.width, t!, "edge"); add(r.left, r.bottom - b!, r.width, b!, "edge");
    add(r.left, r.top + t!, l!, r.height - t! - b!, "edge"); add(r.right - rt!, r.top + t!, rt!, r.height - t! - b!, "edge");
    const kids = [...el.children].map((child) => child.getBoundingClientRect()).filter((rect) => rect.width && rect.height);
    for (let i = 1; i < kids.length; i++) {
      const a = kids[i - 1]!, c = kids[i]!;
      if (c.top >= a.bottom - 0.5) add(r.left + l!, a.bottom, r.width - l! - rt!, c.top - a.bottom, "gap");
      else add(a.right, Math.min(a.top, c.top), c.left - a.right, Math.max(a.bottom, c.bottom) - Math.min(a.top, c.top), "gap");
    }
  }
  return bands;
};
/** spacing: containers whose padding and gaps are drawn over the scene, each band labelled with its size. */
export function InUse(props: { scene: () => JSX.Element; marks: Mark[]; density?: boolean; spacing?: string[] }) {
  const columns = props.density === false ? [undefined] : (["desktop", "phone"] as const);
  const [values, setValues] = createSignal<string[][]>(columns.map(() => []));
  const Scene = (scene: { column: number; density?: "desktop" | "phone" }) => {
    const [spots, setSpots] = createSignal<({ x: number; y: number; to: number; drop?: number } | null)[]>([]);
    const [bands, setBands] = createSignal<Band[]>([]);
    let el!: HTMLDivElement;
    const measure = () => requestAnimationFrame(() => {
      const box = el.getBoundingClientRect();
      const found = props.marks.map((mark) => el.querySelector<HTMLElement>(mark.selector));
      // Each number in the gutter left of the scene, level with what it marks, a line out to it; marks on one line queue leftward.
      if (props.spacing) setBands(bandsOf(el, props.spacing));
      const placed: { x: number; y: number; to: number }[] = [];
      setSpots(found.map((node, at) => {
        if (!node) return null;
        const rect = node.getBoundingClientRect(), side = props.marks[at]!.side;
        if (side) { const edge = (side === "above" ? rect.top : rect.bottom) - box.top; const y = edge + (side === "above" ? -14 : 14);
          return { x: rect.left - box.left + rect.width / 2, y, to: 0, drop: edge - y }; }
        const y = rect.top - box.top + Math.min(rect.height / 2, 12);
        const x = -26 - 20 * placed.filter((spot) => Math.abs(spot.y - y) < 16).length;
        const spot = { x, y, to: rect.left - box.left };
        placed.push(spot);
        return spot;
      }));
      setValues((all) => all.map((row, index) => index === scene.column ? found.map((node, at) => node ? props.marks[at]!.read(node) : "—") : row));
    });
    onMount(() => {
      const observer = new ResizeObserver(measure); observer.observe(el);
      addEventListener("gallery:tune", measure);
      onCleanup(() => { observer.disconnect(); removeEventListener("gallery:tune", measure); });
    });
    return <div class="g-inuse-col" data-density={scene.density}>
      {scene.density && <small class="g-inuse-head">{scene.density === "desktop" ? "Desktop" : "Phone"}</small>}
      <div ref={el} class="g-inuse-scene">{props.scene()}
        <For each={bands()}>{(band) => <i class="g-band" data-kind={band.kind} style={{ left: `${band.x}px`, top: `${band.y}px`, width: `${band.w}px`, height: `${band.h}px` }}><small>{band.label}</small></i>}</For>
        <For each={spots()}>{(spot, index) => spot && <>
          {spot.drop === undefined
            ? <i class="g-lead" style={{ left: `${spot.x + 8}px`, top: `${spot.y}px`, width: `${Math.max(0, spot.to - spot.x - 8)}px` }} />
            : <i class="g-lead" style={{ left: `${spot.x}px`, top: `${spot.y + Math.min(0, spot.drop)}px`, width: "1px", height: `${Math.abs(spot.drop)}px` }} />}
          <span class="g-badge" style={{ left: `${spot.x}px`, top: `${spot.y}px` }}>{index() + 1}</span>
        </>}</For>
      </div>
    </div>;
  };
  return <div class="g-inuse">
    <div class="g-inuse-scenes"><For each={[...columns]}>{(density, index) => <Scene column={index()} density={density} />}</For></div>
    <div class="g-inuse-legend" data-columns={columns.length}>
      <For each={props.marks}>{(mark, index) => <div class="g-inuse-row">
        <span class="g-badge" data-static="">{index() + 1}</span><span>{mark.label}</span>
        <For each={values()}>{(column) => <code>{column[index()] ?? ""}</code>}</For>
      </div>}</For>
    </div>
  </div>;
}
/** Anatomy: an assembly's parts numbered on it, as In use numbers places -- each part's name and what it does, and what builds it. */
export type Part = [selector: string, name: string, from: string, does: string, side?: Mark["side"]];
export const Anatomy = (props: { scene: () => JSX.Element; parts: Part[] }) => <InUse density={false} scene={() => <div class="g-anatomy">{props.scene()}</div>}
  marks={props.parts.map(([selector, name, from, does, side]) => ({ selector, label: `${name}: ${does}`, read: () => from, side }))} />;
export const style = (el: HTMLElement) => getComputedStyle(el);
export const bg = (el: HTMLElement) => style(el).backgroundColor;
export const fg = (el: HTMLElement) => style(el).color;
export const edge = (el: HTMLElement) => style(el).borderTopColor;
export const rounding = (el: HTMLElement) => px(style(el).borderTopLeftRadius);
export const tall = (el: HTMLElement) => px(`${el.getBoundingClientRect().height}px`);
export const icon = (el: HTMLElement) => `${px(`${el.getBoundingClientRect().width}px`)} · stroke ${style(el).strokeWidth.replace("px", "")}`;

/*
 * A control's forms down the side, the surfaces it sits on across: each cell drawn by the
 * library on that surface, at the page's density.
 */
export type Where = "frame" | "ground" | "frost";
/** A column: a surface the form sits on, or a density it is drawn at (for what is its own surface, like a card). */
export type Column = Where | "desktop" | "phone";
/** code: how to write it; tokens: what it reads, so a form can be named and tuned. */
export interface FormRow { name: string; use: string; code?: string; tokens?: string; sample: () => JSX.Element }
const On = (props: { where: Column; children: JSX.Element }) => props.where === "desktop" || props.where === "phone"
  ? <div class="g-form-density" data-density={props.where}>{props.children}</div>
  : props.where === "frost" ? <Frost class="g-surface g-form-surface">{props.children}</Frost>
  : <div class="g-surface g-form-surface" data-surface={props.where}>{props.children}</div>;
/** widths: every column's, the form's first (a phone column a phone wide, for what fills its width).
 *  stacked: each form's name over its samples, which then take the row's whole width. */
export function FormTable(props: { rows: FormRow[]; on: Column[]; widths?: string[]; stacked?: boolean }) {
  const columns = { "grid-template-columns": props.widths?.join(" ") ?? `300px repeat(${props.on.length}, minmax(0, 1fr))` };
  return <div class="g-scale g-forms">
    <div class="g-scale-head" style={columns}>{!props.stacked && <span>Form</span>}<For each={props.on}>{(where) => <span>{where[0]!.toUpperCase() + where.slice(1)}</span>}</For></div>
    <For each={props.rows}>{(row) => <div class="g-scale-row" style={columns} data-stacked={props.stacked ? "" : undefined}>
      {props.stacked
        ? <div class="g-scale-name g-stack-name"><p><strong>{row.name}</strong><small>{row.use}</small></p><p>{row.code && <code class="g-form-code">{row.code}</code>}{row.tokens && <small class="g-form-tokens">{row.tokens}</small>}</p></div>
        : <div class="g-scale-name"><strong>{row.name}</strong><small>{row.use}</small>
          {row.code && <code class="g-form-code">{row.code}</code>}{row.tokens && <small class="g-form-tokens">{row.tokens}</small>}</div>}
      <For each={props.on}>{(where) => <On where={where}>{row.sample()}</On>}</For>
    </div>}</For>
  </div>;
}
export const form = (name: string, use: string, sample: FormRow["sample"], code?: string, tokens?: string): FormRow => ({ name, use, sample, code, tokens });

/** Once the moves under it have played: their own animations and transitions, at whatever rate the page runs them. */
const settled = async (root: Element) => { await new Promise(requestAnimationFrame); await Promise.allSettled(root.getAnimations({ subtree: true }).map((a) => a.finished)); };
/**
 * A piece's own moves, played (each piece draws its moves; Foundations · Motion holds the tokens). Arrive draws it
 * again entering; each of `leaves` plays that leaving, then it arrives again.
 */
export function Replay(props: { leaves?: Motion[]; children: (motion: () => Motion | undefined) => JSX.Element }) {
  const [run, setRun] = createSignal(1), [motion, setMotion] = createSignal<Motion | undefined>(undefined);
  let stage!: HTMLDivElement, away = false;
  const enter = () => { away = false; setMotion("entering"); setRun(run() + 1); };
  // Held at its leave's end (forwards) until it arrives again, so the stage keeps its height.
  const leave = async (move: Motion) => { away = true; setMotion(move); await settled(stage); };
  // Arrive on a piece already there plays it away first, so it never blinks out.
  const arrive = async () => { if (!away) await leave("leaving"); enter(); };
  const cycle = async (move: Motion) => { await leave(move); setTimeout(enter, 400); };
  return <div class="g-replay">
    <div class="g-replay-bar"><Button size="sm" variant="ghost" outline onClick={arrive}>Arrive</Button>
      <For each={props.leaves ?? []}>{(move) => <Button size="sm" variant="ghost" outline onClick={() => cycle(move)}>{move === "removing" ? "Remove" : "Leave"}</Button>}</For></div>
    <div ref={stage} class="g-replay-stage"><Show when={run()} keyed>{(_) => props.children(motion)}</Show></div>
  </div>;
}

/** A piece's states, switched by hand: a button each, the piece drawn for the one chosen (it plays its own moves). */
export function States<T extends string>(props: { states: readonly T[]; children: (state: () => T) => JSX.Element }) {
  const [state, setState] = createSignal<T>(props.states[0]!);
  return <div class="g-replay">
    <div class="g-replay-bar"><For each={props.states}>{(name) => <Button size="sm" variant="ghost" outline={state() === name} aria-pressed={state() === name} onClick={() => setState(() => name)}>{name}</Button>}</For></div>
    <div class="g-replay-stage">{props.children(state)}</div>
  </div>;
}
/** Shows its child while `when`, arriving as it comes and playing its leave (default: back the way it came) before it goes. */
export function Presence(props: { when: boolean; leave?: Motion; children: (motion: () => Motion) => JSX.Element }) {
  const [shown, setShown] = createSignal(props.when), [motion, setMotion] = createSignal<Motion>("entering");
  createEffect(on(() => props.when, (when) => {
    if (when) { setMotion("entering"); setShown(true); return; }
    setMotion(props.leave ?? "leaving");
    let live = true; onCleanup(() => { live = false; });
    queueMicrotask(async () => { await settled(anchor.parentElement!); if (live) setShown(false); });
  }, { defer: true }));
  const anchor = document.createTextNode("");
  return <>{anchor}<Show when={shown()}>{props.children(motion)}</Show></>;
}
