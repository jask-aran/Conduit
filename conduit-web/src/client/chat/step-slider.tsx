import { For, Show, createEffect, createSignal, createUniqueId, type JSX } from "solid-js";
import { CheckIcon, ChevronDownIcon } from "lucide-solid";
import "./step-slider.css";

export type StepOption = { value: string; label: string };

/**
 * One choice from an ordered list, set by sliding along it.
 *
 * The label follows the thumb while it moves and the choice is made when it is
 * let go, so dragging past a level never applies it. The label is also a
 * button: it opens the same options as a plain list, for anyone who would
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
  const [listOpen, setListOpen] = createSignal(false);
  createEffect(() => setPreview(indexOf(props.value)));
  const shown = () => props.options[preview()] || props.options[0];
  const commit = (index: number) => {
    const option = props.options[index];
    if (option && option.value !== props.value) props.onChange(option.value);
  };
  const choose = (value: string) => {
    setListOpen(false);
    if (value !== props.value) props.onChange(value);
  };

  return <div class="step-slider" data-disabled={props.disabled ? "true" : undefined}
    onKeyDown={(event) => { if (event.target instanceof HTMLInputElement && event.key !== "Escape" && event.key !== "Tab") event.stopPropagation(); }}>
    <div class="step-slider-header">
      <label for={id}>{props.label}</label>
      <Show when={props.valueControl} fallback={<button type="button" class="step-slider-value" aria-expanded={listOpen()} aria-controls={`${id}-list`} disabled={props.disabled}
        onClick={() => setListOpen(!listOpen())}>
        <span>{shown()?.label}</span><ChevronDownIcon data-open={listOpen() ? "true" : undefined} />
      </button>}>{(control) => control()(() => shown()?.label || "")}</Show>
    </div>
    <Show when={!listOpen()}>
      <input id={id} class="step-slider-input" type="range" min={0} max={Math.max(0, props.options.length - 1)} step={1}
        value={preview()} disabled={props.disabled} aria-valuetext={shown()?.label}
        style={{ "--step-fill": `${props.options.length > 1 ? (preview() / (props.options.length - 1)) * 100 : 0}%` }}
        onInput={(event) => setPreview(Number(event.currentTarget.value))}
        onChange={(event) => commit(Number(event.currentTarget.value))} />
      <div class="step-slider-ticks" aria-hidden="true">
        <For each={props.options}>{(_, index) => <i data-reached={index() <= preview() ? "true" : undefined} />}</For>
      </div>
    </Show>
    <Show when={listOpen()}>
      <div id={`${id}-list`} class="step-slider-list" role="listbox" aria-label={props.label}>
        <For each={props.options}>{(option) =>
          <button type="button" role="option" aria-selected={option.value === props.value} onClick={() => choose(option.value)}>
            <span class="step-slider-check">{option.value === props.value ? <CheckIcon /> : null}</span>
            <span>{option.label}</span>
          </button>
        }</For>
      </div>
    </Show>
  </div>;
}
