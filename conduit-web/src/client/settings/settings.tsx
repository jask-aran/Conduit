import { createEffect, createSignal, onCleanup, Show } from "solid-js";
import { Portal } from "solid-js/web";
import { Field } from "@/components/primitives";
import { Settings as PerformanceSettings } from "./settings-performance";
import { Settings as CurrentMainSettings } from "./settings-main";
import { COMPOSER_SURFACE_CHANGE_EVENT, saveComposerSurface, selectedComposerSurface, type ComposerSurfaceMode } from "../chat/composer-surface";
import { normalizeVoiceDictationSettings } from "../chat/voice-settings-compat";
import "./voice-main-bridge.css";

const SETTINGS_SECTIONS = ["general", "ui", "shortcuts", "models", "profiles", "runtime", "workspaces", "voice", "search", "auth"] as const;
type SettingsSection = typeof SETTINGS_SECTIONS[number];
const SETTINGS_SECTION_SET: ReadonlySet<string> = new Set(SETTINGS_SECTIONS);
const METEOR_FIELD_STORAGE_KEY = "conduit:meteor-field";

const normalizeSection = (value: unknown): SettingsSection => {
  const candidate = String(value || "general").toLowerCase();
  return SETTINGS_SECTION_SET.has(candidate) ? candidate as SettingsSection : "general";
};
const selectedMeteorField = () => typeof localStorage === "undefined" || localStorage.getItem(METEOR_FIELD_STORAGE_KEY) !== "false";
const applyMeteorField = (enabled: boolean) => {
  if (typeof document !== "undefined") document.documentElement.dataset.meteorField = enabled ? "on" : "off";
};
if (typeof document !== "undefined") applyMeteorField(selectedMeteorField());

const sectionFromTab = (event: MouseEvent): SettingsSection | null => {
  const target = event.target instanceof Element ? event.target : null;
  const tab = target?.closest<HTMLButtonElement>("button[role='tab']");
  if (!tab) return null;
  const value = (tab.textContent || "").trim().toLowerCase();
  return SETTINGS_SECTION_SET.has(value) ? value as SettingsSection : null;
};

// Keep every performance-rebuild settings surface except Voice. Voice is the
// exact current-main settings implementation, mounted only while that tab is
// active. This prevents current main's older transcript/material choices from
// leaking back into the rebuild.
export function Settings(props: any) {
  const initial = () => normalizeSection(props.initialSection);
  const initialValue = initial();
  const [voiceMode, setVoiceMode] = createSignal(initialValue === "voice");
  const [performanceSection, setPerformanceSection] = createSignal<SettingsSection>(initialValue === "voice" ? "general" : initialValue);
  const [meteorField, setMeteorField] = createSignal(selectedMeteorField());
  const [composerSurface, setComposerSurface] = createSignal<ComposerSurfaceMode>(selectedComposerSurface());
  const [meteorMount, setMeteorMount] = createSignal<HTMLElement | null>(null);
  let wasOpen = false;

  createEffect(() => {
    const open = Boolean(props.open);
    if (open && !wasOpen) {
      const section = initial();
      setVoiceMode(section === "voice");
      if (section !== "voice") setPerformanceSection(section);
      setMeteorField(selectedMeteorField());
      setComposerSurface(selectedComposerSurface());
    }
    wasOpen = open;
  });

  createEffect(() => {
    if (typeof window === "undefined") return;
    const syncSurface = () => setComposerSurface(selectedComposerSurface());
    window.addEventListener(COMPOSER_SURFACE_CHANGE_EVENT, syncSurface);
    onCleanup(() => window.removeEventListener(COMPOSER_SURFACE_CHANGE_EVENT, syncSurface));
  });

  createEffect(() => {
    if (!props.open) return;
    const onTabClick = (event: MouseEvent) => {
      const section = sectionFromTab(event);
      if (!section) return;
      if (voiceMode()) {
        if (section === "voice") return;
        event.preventDefault();
        event.stopImmediatePropagation();
        setPerformanceSection(section);
        setVoiceMode(false);
        return;
      }
      setPerformanceSection(section);
      if (section !== "voice") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      setVoiceMode(true);
    };
    document.addEventListener("click", onTabClick, true);
    onCleanup(() => document.removeEventListener("click", onTabClick, true));
  });

  createEffect(() => {
    setMeteorMount(null);
    if (!props.open || voiceMode() || performanceSection() !== "ui") return;
    let cancelled = false;
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (cancelled) return;
      const fieldGroup = document.querySelector<HTMLElement>(".settings-dialog .settings-content [data-slot='field-group']");
      const content = document.querySelector<HTMLElement>(".settings-dialog .settings-content");
      setMeteorMount(fieldGroup || content);
    }));
    onCleanup(() => { cancelled = true; });
  });

  const updateMeteorField = (enabled: boolean) => {
    setMeteorField(enabled);
    localStorage.setItem(METEOR_FIELD_STORAGE_KEY, String(enabled));
    applyMeteorField(enabled);
  };

  const updateLiquidCompatibility = (enabled: boolean) => {
    const next: ComposerSurfaceMode = enabled ? "liquid" : composerSurface() === "static" ? "static" : "frost";
    setComposerSurface(saveComposerSurface(next));
  };

  return <>
    <PerformanceSettings {...props} open={Boolean(props.open) && !voiceMode()} initialSection={performanceSection()} />
    <CurrentMainSettings
      {...props}
      open={Boolean(props.open) && voiceMode()}
      initialSection="voice"
      meteorField={meteorField()}
      onMeteorFieldChange={updateMeteorField}
      liquidGlassSurface={composerSurface() === "liquid"}
      onLiquidGlassSurfaceChange={updateLiquidCompatibility}
      voiceSettings={normalizeVoiceDictationSettings(props.voiceSettings)}
      onVoiceSettingsSave={(settings: any) => props.onVoiceSettingsSave(normalizeVoiceDictationSettings(settings))}
    />
    <Show when={meteorMount()}>{(mount) => <Portal mount={mount()}>
      <Field>
        <label class="meteor-settings-toggle">
          <input type="checkbox" aria-label="Ambient meteor field" checked={meteorField()} onChange={(event) => updateMeteorField(event.currentTarget.checked)} />
          <span><strong>Ambient meteor field</strong><small>Show the animated meteor field behind chat surfaces.</small></span>
        </label>
      </Field>
    </Portal>}</Show>
  </>;
}
