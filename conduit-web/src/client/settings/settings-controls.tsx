import { createSignal, For, onCleanup, onMount, splitProps, type JSX } from "solid-js";
import { ChevronDownIcon } from "lucide-solid";
import { Menu, MenuContent, MenuRadioGroup, MenuRadioItem, MenuTrigger } from "@/components/primitives";
import "./settings-controls.css";

/**
 * A few choices side by side, one of them current: the gray wash sits under
 * the current one and slides to the next (~200ms) -- a choice, not a list,
 * so it reads at a glance. Arrow keys move it, as in any radio group.
 */
export function Segmented<T extends string>(props: {
  label: string;
  value: T;
  options: ReadonlyArray<{ value: T; label: string; icon?: JSX.Element; title?: string; detail?: JSX.Element }>;
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
      >{option.icon}<span>{option.label}</span>{option.detail}</button>
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

/**
 * A settings dropdown: the native select stays as the value's owner (ids,
 * labels, refs and onChange keep working) but is hidden, and a trigger opens
 * the app's own menu listing its options instead of the OS picker.
 */
export function Select(props: JSX.SelectHTMLAttributes<HTMLSelectElement>) {
  const [local, rest] = splitProps(props, ["ref", "class", "title", "disabled", "children"]);
  let select!: HTMLSelectElement;
  let trigger: HTMLButtonElement | undefined;
  const [value, setValue] = createSignal("");
  const [label, setLabel] = createSignal("");
  const [options, setOptions] = createSignal<Array<{ value: string; label: string; disabled: boolean }>>([]);
  const read = () => {
    setValue(select.value);
    setLabel(select.selectedOptions[0]?.textContent || "");
    setOptions(Array.from(select.options, (option) => ({ value: option.value, label: option.textContent || "", disabled: option.disabled })));
  };
  onMount(() => {
    read();
    const observer = new MutationObserver(read);
    observer.observe(select, { childList: true, subtree: true, characterData: true, attributes: true });
    onCleanup(() => observer.disconnect());
  });
  const choose = (value: string) => {
    if (value === select.value) return;
    select.value = value;
    select.dispatchEvent(new Event("change", { bubbles: true }));
    read();
  };
  return <span class={`settings-select${local.class ? ` ${local.class}` : ""}`}>
    <select {...rest} ref={(element) => { select = element; (local.ref as ((element: HTMLSelectElement) => void) | undefined)?.(element); }} disabled={local.disabled} tabIndex={-1} aria-hidden="true" onFocus={() => trigger?.focus()}>{local.children}</select>
    <Menu placement="bottom-end" gutter={4} onOpenChange={(open) => open && read()}>
      <MenuTrigger ref={trigger} as="button" type="button" class="settings-select-trigger" title={local.title} disabled={local.disabled} aria-label={select?.labels?.[0]?.textContent || undefined}>
        <span>{label()}</span><ChevronDownIcon aria-hidden="true" />
      </MenuTrigger>
      <MenuContent class="settings-select-menu">
        <MenuRadioGroup value={value()} onChange={choose}>
          <For each={options()}>{(option) => <MenuRadioItem value={option.value} disabled={option.disabled}>{option.label}</MenuRadioItem>}</For>
        </MenuRadioGroup>
      </MenuContent>
    </Menu>
  </span>;
}
