import { createEffect, createMemo, createSignal, For, Show } from "solid-js";
import { Dynamic } from "solid-js/web";
import { BoxesIcon, SearchIcon } from "lucide-solid";
import { Button, Field, FieldLabel, Input } from "@/components/primitives";
import type { WorkspaceAppearance } from "../api/contracts";
import {
  normalizeWorkspaceAppearance,
  WorkspaceGlyph,
  WORKSPACE_COLOR_OPTIONS,
  WORKSPACE_ICON_OPTIONS,
  workspaceColorOption,
  workspaceIconOption,
} from "./workspace-appearance";

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

export function WorkspaceAppearanceEditor(props: {
  value?: WorkspaceAppearance | null;
  saving?: boolean;
  compact?: boolean;
  onSave: (appearance: WorkspaceAppearance) => void;
}) {
  const [draft, setDraft] = createSignal(normalizeWorkspaceAppearance(props.value));
  const [showIconBrowser, setShowIconBrowser] = createSignal(false);
  const [iconQuery, setIconQuery] = createSignal("");
  const [showCustomColor, setShowCustomColor] = createSignal(false);
  const [customHex, setCustomHex] = createSignal("#cba6f7");

  createEffect(() => {
    const normalized = normalizeWorkspaceAppearance(props.value);
    setDraft(normalized);
    setCustomHex(workspaceColorOption(normalized.color).hex);
    setShowCustomColor(HEX_COLOR.test(normalized.color));
  });

  const setMode = (mode: WorkspaceAppearance["mode"]) => {
    setDraft((current) => ({
      ...current,
      mode,
      value: mode === "monogram"
        ? current.mode === "monogram" ? current.value : "Aa"
        : workspaceIconOption(current.mode === "icon" ? current.value : undefined).id,
    }));
  };
  const setMonogram = (value: string) => {
    const monogram = [...value.trim()].slice(0, 2).join("").toUpperCase();
    setDraft((current) => ({ ...current, mode: "monogram", value: monogram }));
  };
  const canSave = () => draft().mode === "icon" || Boolean([...draft().value.trim()].length);
  const preview = () => canSave() ? draft() : { ...draft(), mode: "monogram" as const, value: "Aa" };
  const selectedIcon = () => workspaceIconOption(draft().mode === "icon" ? draft().value : undefined);
  const filteredIconOptions = createMemo(() => {
    const query = iconQuery().trim().toLowerCase();
    if (!query) return WORKSPACE_ICON_OPTIONS;
    return WORKSPACE_ICON_OPTIONS.filter((option) => `${option.label} ${option.id}`.toLowerCase().includes(query));
  });
  const setCustomColor = (value: string) => {
    const normalized = value.trim().toLowerCase();
    setCustomHex(value);
    if (HEX_COLOR.test(normalized)) setDraft((current) => ({ ...current, color: normalized }));
  };

  return <section class={`workspace-appearance-editor${props.compact ? " workspace-appearance-editor-compact" : ""}`} data-workspace-appearance="editor" aria-labelledby="workspace-appearance-title">
    <Show when={!props.compact}>
      <div class="workspace-appearance-heading">
        <div>
          <h2 id="workspace-appearance-title">Workspace identity</h2>
          <p>Choose a short mark or a Lucide icon, then give it a Catppuccin Mocha color.</p>
        </div>
        <WorkspaceGlyph appearance={preview()} class="workspace-appearance-preview" />
      </div>
    </Show>

    <div class="workspace-appearance-modes" role="radiogroup" aria-label="Workspace marker type">
      <button type="button" role="radio" aria-checked={draft().mode === "monogram"} data-selected={draft().mode === "monogram"} onClick={() => setMode("monogram")}>
        <span class="workspace-appearance-mode-mark">Aa</span>
        <span><strong>Short name</strong><small>One or two letters</small></span>
      </button>
      <button type="button" role="radio" aria-checked={draft().mode === "icon"} data-selected={draft().mode === "icon"} onClick={() => setMode("icon")}>
        <span class="workspace-appearance-mode-mark"><BoxesIcon /></span>
        <span><strong>Lucide icon</strong><small>Choose a workspace symbol</small></span>
      </button>
    </div>

    <Show when={draft().mode === "monogram"} fallback={<div class="workspace-appearance-control">
      <span class="workspace-appearance-label">Icon</span>
      <div class="workspace-appearance-icon-choice">
        <button type="button" class="workspace-appearance-selected-icon" role="radio" aria-label={selectedIcon().label} aria-checked="true" onClick={() => setShowIconBrowser(true)}>
          <Dynamic component={selectedIcon().component} />
          <span>{selectedIcon().label}</span>
        </button>
        <Button type="button" variant="ghost" size="sm" class="workspace-appearance-browse" onClick={() => setShowIconBrowser((open) => !open)}>
          {showIconBrowser() ? "Hide icons" : "Browse icons"}<small>{WORKSPACE_ICON_OPTIONS.length}</small>
        </Button>
      </div>
      <Show when={showIconBrowser()}>
        <div class="workspace-appearance-icon-browser">
          <div class="workspace-appearance-search"><SearchIcon /><Input aria-label="Search icons" placeholder="Search Lucide icons" value={iconQuery()} onInput={(event) => setIconQuery(event.currentTarget.value)} /></div>
          <Show when={filteredIconOptions().length} fallback={<p class="workspace-appearance-empty">No icons match that search.</p>}>
            <div class="workspace-appearance-icon-grid" role="radiogroup" aria-label="Workspace icon choices">
              <For each={filteredIconOptions()}>{(option) => <button type="button" role="radio" aria-label={option.label} aria-checked={draft().mode === "icon" && draft().value === option.id} data-selected={draft().mode === "icon" && draft().value === option.id} title={option.label} onClick={() => setDraft((current) => ({ ...current, mode: "icon", value: option.id }))}>
                <Dynamic component={option.component} />
              </button>}</For>
            </div>
          </Show>
        </div>
      </Show>
    </div>}>
      <div class="workspace-appearance-control">
        <Field>
          <FieldLabel for="workspace-monogram">Short name</FieldLabel>
          <Input id="workspace-monogram" value={draft().value} maxlength="2" autocomplete="off" onInput={(event) => setMonogram(event.currentTarget.value)} />
        </Field>
        <small class="workspace-appearance-help">Use up to two letters. This mark appears in the rail and sidebar.</small>
      </div>
    </Show>

    <div class="workspace-appearance-control">
      <div class="workspace-appearance-control-heading">
        <span class="workspace-appearance-label">Color</span>
        <Button type="button" variant="ghost" size="sm" class="workspace-appearance-more-colors" onClick={() => {
          setShowCustomColor((open) => !open);
          setCustomHex(workspaceColorOption(draft().color).hex);
        }}>{showCustomColor() ? "Use Mocha colours" : "More colours"}</Button>
      </div>
      <div class="workspace-appearance-color-grid" role="radiogroup" aria-label="Workspace color">
        <For each={WORKSPACE_COLOR_OPTIONS}>{(option) => <button type="button" role="radio" aria-label={option.label} aria-checked={draft().color === option.id} data-selected={draft().color === option.id} title={option.label} style={{ background: option.hex }} onClick={() => { setCustomHex(option.hex); setDraft((current) => ({ ...current, color: option.id })); }} />}</For>
      </div>
      <Show when={showCustomColor()}>
        <div class="workspace-appearance-custom-color">
          <label class="workspace-appearance-color-input"><span>Custom colour</span><input aria-label="Custom colour" type="color" value={workspaceColorOption(draft().color).hex} onInput={(event) => setCustomColor(event.currentTarget.value)} /></label>
          <Input aria-label="Hex colour" value={customHex()} maxlength="7" spellcheck="false" onInput={(event) => setCustomColor(event.currentTarget.value)} />
        </div>
      </Show>
    </div>

    <div class="workspace-appearance-actions">
      <Button variant="outline" size="sm" data-workspace-appearance-save disabled={Boolean(props.saving) || !canSave()} onClick={() => props.onSave({ ...draft(), value: draft().value.trim() })}>
        {props.saving ? "Saving…" : "Save identity"}
      </Button>
    </div>
  </section>;
}
