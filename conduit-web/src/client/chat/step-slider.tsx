import { For, Show, createEffect, createSignal, createUniqueId, type JSX } from "solid-js";
import "./step-slider.css";
import { useLibrary } from "@/components/ui/swap";

export type StepOption = { value: string; label: string };

/** The slider's parts by name, for the pieces built from them (the context
 *  breakdown, the value that opens the levels): the library's in the gallery's
 *  Library previews (components/ui/swap.ts), the app's otherwise. */
export function sliderParts() {
  const lib = useLibrary();
  return lib
    ? { root: "ui-slider", header: "ui-slider-head", label: "ui-title-text", value: "ui-slider-value", input: "ui-slider-input", ticks: "ui-slider-ticks" }
    : { root: "step-slider", header: "step-slider-header", label: undefined, value: "step-slider-value", input: "step-slider-input", ticks: "step-slider-ticks" };
}

/**
 * One choice from an ordered list, set by sliding along it.
 *
 * The label follows the thumb while it moves and the choice is made when it is
 * let go, so dragging past a level never applies it. The host can make the
 * label a control -- a submenu of the same options, for anyone who would
 * rather pick one than slide to it. A native range input carries the keyboard
 * and touch handling, and keys stay with it rather than the menu around it.
 */
export function StepSlider(props: {
  label: string;
  valueControl?: (label: () => string) => JSX.Element;
  options: StepOption[];
  value: string;
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  const id = createUniqueId();
  const indexOf = (value: string) => Math.max(0, props.options.findIndex((option) => option.value === value));
  const [preview, setPreview] = createSignal(indexOf(props.value));
  createEffect(() => setPreview(indexOf(props.value)));
  const shown = () => props.options[preview()] || props.options[0];
  const commit = (index: number) => {
    const option = props.options[index];
    if (option && option.value !== props.value) props.onChange(option.value);
  };

  // In the gallery's Library previews this is the library's slider (components v2).
  const lib = useLibrary();
  const c = (app: string, library: string) => lib ? library : app;
  return <div class={c("step-slider", "ui-slider")} data-disabled={props.disabled ? "true" : undefined}
    onKeyDown={(event) => { if (event.target instanceof HTMLInputElement && event.key !== "Escape" && event.key !== "Tab") event.stopPropagation(); }}>
    <div class={c("step-slider-header", "ui-slider-head")}>
      <label for={id} class={lib ? "ui-title-text" : undefined}>{props.label}</label>
      <Show when={props.valueControl} fallback={<span class={c("step-slider-value", "ui-slider-value")}>{shown()?.label}</span>}>{(control) => control()(() => shown()?.label || "")}</Show>
    </div>
    <input id={id} class={c("step-slider-input", "ui-slider-input")} type="range" min={0} max={Math.max(0, props.options.length - 1)} step={1}
      value={preview()} disabled={props.disabled} aria-valuetext={shown()?.label}
      style={{ [lib ? "--fill" : "--step-fill"]: `${props.options.length > 1 ? (preview() / (props.options.length - 1)) * 100 : 0}%` }}
      onInput={(event) => setPreview(Number(event.currentTarget.value))}
      onChange={(event) => commit(Number(event.currentTarget.value))} />
    <div class={c("step-slider-ticks", "ui-slider-ticks")} aria-hidden="true">
      <For each={props.options}>{(_, index) => <i data-reached={index() <= preview() ? (lib ? "" : "true") : undefined} />}</For>
    </div>
  </div>;
}
