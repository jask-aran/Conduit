import { For } from "solid-js";
import { COMPOSER_SURFACE_OPTIONS, type ComposerSurfaceMode } from "./composer-surface";

export function ComposerRendererSwitch(props: {
  value: ComposerSurfaceMode;
  onChange: (value: ComposerSurfaceMode) => void;
}) {
  return <div class="composer-renderer-switch">
    <label>Composer renderer<select aria-label="Composer renderer" value={props.value} onChange={(event) => props.onChange(event.currentTarget.value as ComposerSurfaceMode)}>
      <For each={COMPOSER_SURFACE_OPTIONS}>{(option) => <option value={option.value}>{option.label}</option>}</For>
    </select></label>
  </div>;
}
