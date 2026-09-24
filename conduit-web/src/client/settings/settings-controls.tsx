import { For, type JSX } from "solid-js";
import "./settings-controls.css";

/**
 * A few choices side by side, one of them current: the gray wash sits under
 * the current one and slides to the next (~200ms) -- a choice, not a list,
 * so it reads at a glance. Arrow keys move it, as in any radio group.
 */
export function Segmented<T extends string>(props: {
  label: string;
  value: T;
  options: ReadonlyArray<{ value: T; label: string; icon?: JSX.Element; title?: string }>;
  onChange: (value: T) => void;
  disabled?: boolean;
  id?: string;
}) {
  const index = () => Math.max(0, props.options.findIndex((option) => option.value === props.value));
  const move = (event: KeyboardEvent) => {
    const step = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const next = props.options[(index() + step + props.options.length) % props.options.length]!;
    props.onChange(next.value);
    const group = event.currentTarget as HTMLElement;
    queueMicrotask(() => group.querySelector<HTMLElement>('[aria-checked="true"]')?.focus());
  };
  return <div
    id={props.id}
    class="settings-segmented"
    role="radiogroup"
    aria-label={props.label}
    aria-disabled={props.disabled || undefined}
    style={{ "--segments": props.options.length, "--segment": index() }}
    onKeyDown={move}
  >
    <span class="settings-segmented-thumb" aria-hidden="true" />
    <For each={props.options}>{(option) =>
      <button
        type="button"
        role="radio"
        title={option.title}
        aria-checked={option.value === props.value}
        tabIndex={option.value === props.value ? 0 : -1}
        disabled={props.disabled}
        onClick={() => option.value !== props.value && props.onChange(option.value)}
      >{option.icon}<span>{option.label}</span></button>
    }</For>
  </div>;
}

/** On or off, for a setting that is one or the other. */
export function Switch(props: { label: string; checked: boolean; onChange: (checked: boolean) => void; disabled?: boolean; id?: string }) {
  return <button
    id={props.id}
    type="button"
    role="switch"
    class="settings-switch"
    aria-label={props.label}
    aria-checked={props.checked}
    disabled={props.disabled}
    onClick={() => props.onChange(!props.checked)}
  ><span aria-hidden="true" /></button>;
}
