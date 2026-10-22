import { createEffect, createMemo, createSignal } from "solid-js";
import { Dynamic } from "solid-js/web";
import { IdentityEditor } from "@/components/ui/identity";
import { colourHex } from "@/components/ui/palettes";
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
    setCustomHex(colourHex(workspaceColorOption(normalized.color).colour));
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

  return <IdentityEditor compact={props.compact} saving={props.saving}
    preview={<WorkspaceGlyph appearance={preview()} />} draft={draft} canSave={canSave}
    selectedIcon={() => ({ label: selectedIcon().label, icon: <Dynamic component={selectedIcon().component} /> })}
    filteredIconOptions={() => filteredIconOptions().map((option) => ({ id: option.id, label: option.label, icon: <Dynamic component={option.component} /> }))}
    iconCount={WORKSPACE_ICON_OPTIONS.length} iconQuery={iconQuery} setIconQuery={setIconQuery}
    showIconBrowser={showIconBrowser} setShowIconBrowser={setShowIconBrowser}
    showCustomColor={showCustomColor} setShowCustomColor={setShowCustomColor}
    customHex={customHex} setCustomHex={setCustomHex} setCustomColor={setCustomColor}
    colorHex={colourHex(workspaceColorOption(draft().color).colour)} colors={WORKSPACE_COLOR_OPTIONS}
    setMode={setMode} setMonogram={setMonogram}
    onIcon={(value) => setDraft((current) => ({ ...current, mode: "icon", value }))}
    onColor={(color, colour) => { setCustomHex(colourHex(colour)); setDraft((current) => ({ ...current, color })); }}
    onSave={() => props.onSave({ ...draft(), value: draft().value.trim() })} />;
}
