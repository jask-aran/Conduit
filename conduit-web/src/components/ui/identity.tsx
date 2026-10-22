import { For, Show, type JSX } from "solid-js";
import { BoxesIcon, SearchIcon } from "lucide-solid";
import { Button, Field, Input, Swatch } from "./controls";

type IdentityValue = { mode: "monogram" | "icon"; value: string; color: string };
type Toggle = (value: boolean | ((current: boolean) => boolean)) => void;
/** Identity editor: the caller owns the draft and save; every control and its
 * presentation belong to v2. Palette colours are the workspace's data. */
export function IdentityEditor(props: {
  compact?: boolean; saving?: boolean; preview: JSX.Element;
  draft: () => IdentityValue; canSave: () => boolean;
  selectedIcon: () => { label: string; icon: JSX.Element };
  filteredIconOptions: () => { id: string; label: string; icon: JSX.Element }[];
  iconCount: number; iconQuery: () => string; setIconQuery: (value: string) => void;
  showIconBrowser: () => boolean; setShowIconBrowser: Toggle;
  showCustomColor: () => boolean; setShowCustomColor: Toggle;
  customHex: () => string; setCustomHex: (value: string) => void;
  setCustomColor: (value: string) => void; colorHex: string;
  colors: readonly { id: string; label: string; colour: string }[];
  setMode: (mode: IdentityValue["mode"]) => void; setMonogram: (value: string) => void;
  onIcon: (id: string) => void; onColor: (id: string, colour: string) => void; onSave: () => void;
}) {
  const { draft, canSave, selectedIcon, filteredIconOptions, iconQuery, setIconQuery, showIconBrowser, setShowIconBrowser, showCustomColor, setShowCustomColor, customHex, setCustomHex, setCustomColor, setMode, setMonogram } = props;
  return <section class="ui-identity" data-workspace-appearance="editor" aria-label="Workspace identity">
    <Show when={!props.compact}>
      <div class="ui-identity-heading">
        <div>
          <h2>Workspace identity</h2>
          <p>Choose a short mark or a Lucide icon, then give it a Catppuccin Mocha color.</p>
        </div>
        <div class="ui-identity-preview">{props.preview}</div>
      </div>
    </Show>

    <div class="ui-identity-modes" role="radiogroup" aria-label="Workspace marker type">
      <Button variant="ghost" type="button" role="radio" aria-checked={draft().mode === "monogram"} data-selected={draft().mode === "monogram"} onClick={() => setMode("monogram")}>
        <span class="ui-identity-mode-mark">Aa</span>
        <span><strong>Short name</strong><small>One or two letters</small></span>
      </Button>
      <Button variant="ghost" type="button" role="radio" aria-checked={draft().mode === "icon"} data-selected={draft().mode === "icon"} onClick={() => setMode("icon")}>
        <span class="ui-identity-mode-mark"><BoxesIcon /></span>
        <span><strong>Lucide icon</strong><small>Choose a workspace symbol</small></span>
      </Button>
    </div>

    <Show when={draft().mode === "monogram"} fallback={<div class="ui-identity-control">
      <span class="ui-identity-label">Icon</span>
      <div class="ui-identity-icon-choice">
        <Button variant="ghost" type="button" class="ui-identity-selected-icon" role="radio" aria-label={selectedIcon().label} aria-checked="true" onClick={() => setShowIconBrowser(true)}>
          {selectedIcon().icon}
          <span>{selectedIcon().label}</span>
        </Button>
        <Button type="button" variant="ghost" size="sm" class="ui-identity-browse" onClick={() => setShowIconBrowser((open) => !open)}>
          {showIconBrowser() ? "Hide icons" : "Browse icons"}<small>{props.iconCount}</small>
        </Button>
      </div>
      <Show when={showIconBrowser()}>
        <div class="ui-identity-icon-browser">
          <div class="ui-identity-search"><SearchIcon /><Input aria-label="Search icons" placeholder="Search Lucide icons" value={iconQuery()} onInput={(event) => setIconQuery(event.currentTarget.value)} /></div>
          <Show when={filteredIconOptions().length} fallback={<p class="ui-identity-empty">No icons match that search.</p>}>
            <div class="ui-identity-icon-grid" role="radiogroup" aria-label="Workspace icon choices">
              <For each={filteredIconOptions()}>{(option) => <Button variant="ghost" type="button" role="radio" aria-label={option.label} aria-checked={draft().mode === "icon" && draft().value === option.id} data-selected={draft().mode === "icon" && draft().value === option.id} title={option.label} onClick={() => props.onIcon(option.id)}>
                {option.icon}
              </Button>}</For>
            </div>
          </Show>
        </div>
      </Show>
    </div>}>
      <div class="ui-identity-control">
        <Field label="Short name">
          <Input id="workspace-monogram" value={draft().value} maxlength="2" autocomplete="off" onInput={(event) => setMonogram(event.currentTarget.value)} />
        </Field>
        <small class="ui-identity-help">Use up to two letters. This mark appears in the rail and sidebar.</small>
      </div>
    </Show>

    <div class="ui-identity-control">
      <div class="ui-identity-control-heading">
        <span class="ui-identity-label">Color</span>
        <Button type="button" variant="ghost" size="sm" class="ui-identity-more-colors" onClick={() => {
          setShowCustomColor((open) => !open);
          setCustomHex(props.colorHex);
        }}>{showCustomColor() ? "Use Mocha colours" : "More colours"}</Button>
      </div>
      <div class="ui-identity-color-grid" role="radiogroup" aria-label="Workspace color">
        <For each={props.colors}>{(option) => <Button variant="ghost" type="button" role="radio" aria-label={option.label} aria-checked={draft().color === option.id} data-selected={draft().color === option.id} title={option.label} onClick={() => { props.onColor(option.id, option.colour); }}><Swatch colour={option.colour} fill /></Button>}</For>
      </div>
      <Show when={showCustomColor()}>
        <div class="ui-identity-custom-color">
          <label class="ui-identity-color-input"><span>Custom colour</span><Input aria-label="Custom colour" type="color" value={props.colorHex} onInput={(event) => setCustomColor(event.currentTarget.value)} /></label>
          <Input aria-label="Hex colour" value={customHex()} maxlength="7" spellcheck="false" onInput={(event) => setCustomColor(event.currentTarget.value)} />
        </div>
      </Show>
    </div>

    <div class="ui-identity-actions">
      <Button variant="ghost" outline size="sm" data-workspace-appearance-save disabled={Boolean(props.saving) || !canSave()} onClick={() => props.onSave()}>
        {props.saving ? "Saving…" : "Save identity"}
      </Button>
    </div>
  </section>;
}
