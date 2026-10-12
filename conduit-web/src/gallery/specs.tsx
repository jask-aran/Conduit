import { For, createSignal, onCleanup, onMount, type JSX } from "solid-js";
import { Frost } from "@/components/ui";

/*
 * The gallery's ways of showing a piece: In use (a scene, each place numbered, what it computes
 * to) and a forms table (each form down the side, where it sits across, its code and tokens).
 * Shared by Foundations and the families.
 */
export const px = (value: string) => value.replace(/(\d+\.\d+)px/g, (_, n: string) => `${Number(Number(n).toFixed(2))}px`);

/*
 * In use: a small scene drawn by the library, each place a foundation shows numbered
 * on it, and what it computes to beside the number -- at desktop and phone.
 */
export interface Mark { selector: string; label: string; read: (el: HTMLElement) => string }
export function InUse(props: { scene: () => JSX.Element; marks: Mark[]; density?: boolean }) {
  const columns = props.density === false ? [undefined] : (["desktop", "phone"] as const);
  const [values, setValues] = createSignal<string[][]>(columns.map(() => []));
  const Scene = (scene: { column: number; density?: "desktop" | "phone" }) => {
    const [spots, setSpots] = createSignal<({ x: number; y: number; to: number } | null)[]>([]);
    let el!: HTMLDivElement;
    const measure = () => requestAnimationFrame(() => {
      const box = el.getBoundingClientRect();
      const found = props.marks.map((mark) => el.querySelector<HTMLElement>(mark.selector));
      // Each number in the gutter left of the scene, level with what it marks, a line out to it; marks on one line queue leftward.
      const placed: { x: number; y: number; to: number }[] = [];
      setSpots(found.map((node) => {
        if (!node) return null;
        const rect = node.getBoundingClientRect();
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
        <For each={spots()}>{(spot, index) => spot && <>
          <i class="g-lead" style={{ left: `${spot.x + 8}px`, top: `${spot.y}px`, width: `${Math.max(0, spot.to - spot.x - 8)}px` }} />
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
/** widths: every column's, the form's first (a phone column a phone wide, for what fills its width). */
export function FormTable(props: { rows: FormRow[]; on: Column[]; widths?: string[] }) {
  const columns = { "grid-template-columns": props.widths?.join(" ") ?? `300px repeat(${props.on.length}, minmax(0, 1fr))` };
  return <div class="g-scale g-forms">
    <div class="g-scale-head" style={columns}><span>Form</span><For each={props.on}>{(where) => <span>{where[0]!.toUpperCase() + where.slice(1)}</span>}</For></div>
    <For each={props.rows}>{(row) => <div class="g-scale-row" style={columns}>
      <div class="g-scale-name"><strong>{row.name}</strong><small>{row.use}</small>
        {row.code && <code class="g-form-code">{row.code}</code>}{row.tokens && <small class="g-form-tokens">{row.tokens}</small>}</div>
      <For each={props.on}>{(where) => <On where={where}>{row.sample()}</On>}</For>
    </div>}</For>
  </div>;
}
export const form = (name: string, use: string, sample: FormRow["sample"], code?: string, tokens?: string): FormRow => ({ name, use, sample, code, tokens });
