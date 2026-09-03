import { createEffect, createSignal, onCleanup } from "solid-js";
import { Settings as SettingsCore } from "./settings-core";
import {
  COMPOSER_SURFACE_CHANGE_EVENT,
  saveComposerSurface,
  selectedComposerSurface,
  type ComposerSurfaceMode,
} from "../chat/composer-surface";
import type { VoiceDictationSettings } from "../chat/voice-dictation-types";
import { saveUiScale, selectedUiScale, type UiScale } from "../preferences/ui-scale";
import {
  applyTranscriptAppearance,
  saveCodeBlockCollapse,
  saveCodeBlockCollapseLines,
  saveCodeBlockWidth,
  selectedCodeBlockWidth,
  type CodeBlockWidthMode,
  savePanelMotion,
  selectedPanelMotion,
  type PanelMotionMode,
  saveUserMessageCollapse,
  selectedUserMessageCollapse,
  type UserMessageCollapseMode,
  saveTranscriptWideBlocks,
  saveTranscriptWidth,
  selectedCodeBlockCollapse,
  selectedCodeBlockCollapseLines,
  selectedTranscriptWideBlocks,
  selectedTranscriptWidth,
  type TranscriptWideBlocksMode,
  type TranscriptWidthMode,
} from "../chat/transcript-appearance";
import type { CodeBlockCollapseMode } from "../chat/code-block";
import "./voice-settings.css";

type CoreProps = Parameters<typeof SettingsCore>[0];
type SettingsProps = Omit<CoreProps,
  "composerSurface" | "onComposerSurfaceChange"
  | "interfaceScale" | "onInterfaceScaleChange"
  | "transcriptWidth" | "onTranscriptWidthChange"
  | "transcriptWideBlocks" | "onTranscriptWideBlocksChange"
  | "codeBlockCollapse" | "onCodeBlockCollapseChange"
  | "codeBlockCollapseLines" | "onCodeBlockCollapseLinesChange"
  | "codeBlockWidth" | "onCodeBlockWidthChange"
  | "panelMotion" | "onPanelMotionChange"
  | "userMessageCollapse" | "onUserMessageCollapseChange"
  | "voiceSettings"> & {
  voiceSettings: VoiceDictationSettings;
};

// Current main owns the single Settings dialog, including the complete Voice
// section. This shell only supplies rebuild-owned presentation preferences; it
// never swaps Settings trees and performs no Voice lifecycle translation.
export function Settings(props: SettingsProps) {
  const [composerSurface, setComposerSurface] = createSignal<ComposerSurfaceMode>(selectedComposerSurface());
  const [interfaceScale, setInterfaceScale] = createSignal<UiScale>(selectedUiScale());
  const [transcriptWidth, setTranscriptWidth] = createSignal<TranscriptWidthMode>(selectedTranscriptWidth());
  const [transcriptWideBlocks, setTranscriptWideBlocks] = createSignal<TranscriptWideBlocksMode>(selectedTranscriptWideBlocks());
  const [codeBlockCollapse, setCodeBlockCollapse] = createSignal<CodeBlockCollapseMode>(selectedCodeBlockCollapse());
  const [codeBlockCollapseLines, setCodeBlockCollapseLines] = createSignal(selectedCodeBlockCollapseLines());
  const [codeBlockWidth, setCodeBlockWidth] = createSignal<CodeBlockWidthMode>(selectedCodeBlockWidth());
  const [panelMotion, setPanelMotion] = createSignal<PanelMotionMode>(selectedPanelMotion());
  const [userMessageCollapse, setUserMessageCollapse] = createSignal<UserMessageCollapseMode>(selectedUserMessageCollapse());

  createEffect(() => {
    if (!props.open) return;
    setComposerSurface(selectedComposerSurface());
  });

  createEffect(() => {
    if (typeof window === "undefined") return;
    const syncSurface = () => setComposerSurface(selectedComposerSurface());
    window.addEventListener(COMPOSER_SURFACE_CHANGE_EVENT, syncSurface);
    onCleanup(() => window.removeEventListener(COMPOSER_SURFACE_CHANGE_EVENT, syncSurface));
  });

  const updateComposerSurface = (surface: ComposerSurfaceMode) => {
    setComposerSurface(saveComposerSurface(surface));
  };
  const updateInterfaceScale = (scale: UiScale) => setInterfaceScale(saveUiScale(scale));
  // Each save writes localStorage and publishes the change; main.tsx mirrors it
  // to the server and stamps the document root, so the open transcript reflows
  // immediately without the dialog reaching into it.
  const updateTranscriptWidth = (mode: TranscriptWidthMode) => {
    const next = setTranscriptWidth(saveTranscriptWidth(mode));
    applyTranscriptAppearance({ width: next });
  };
  const updateTranscriptWideBlocks = (mode: TranscriptWideBlocksMode) => {
    const next = setTranscriptWideBlocks(saveTranscriptWideBlocks(mode));
    applyTranscriptAppearance({ wideBlocks: next });
  };
  const updateCodeBlockCollapse = (mode: CodeBlockCollapseMode) => {
    const next = setCodeBlockCollapse(saveCodeBlockCollapse(mode));
    applyTranscriptAppearance({ collapse: next });
  };
  const updateCodeBlockCollapseLines = (lines: number) => {
    const next = setCodeBlockCollapseLines(saveCodeBlockCollapseLines(lines));
    applyTranscriptAppearance({ collapseLines: next });
  };
  const updateCodeBlockWidth = (mode: CodeBlockWidthMode) => {
    const next = setCodeBlockWidth(saveCodeBlockWidth(mode));
    applyTranscriptAppearance({ codeWidth: next });
  };
  // Nothing to stamp on the root: the drag path subscribes to the published
  // preference directly.
  const updatePanelMotion = (mode: PanelMotionMode) => setPanelMotion(savePanelMotion(mode));
  const updateUserMessageCollapse = (mode: UserMessageCollapseMode) => {
    const next = setUserMessageCollapse(saveUserMessageCollapse(mode));
    applyTranscriptAppearance({ userMessageCollapse: next });
  };

  return <SettingsCore
      {...props}
      composerSurface={composerSurface()}
      onComposerSurfaceChange={updateComposerSurface}
      interfaceScale={interfaceScale()}
      onInterfaceScaleChange={updateInterfaceScale}
      transcriptWidth={transcriptWidth()}
      onTranscriptWidthChange={updateTranscriptWidth}
      transcriptWideBlocks={transcriptWideBlocks()}
      onTranscriptWideBlocksChange={updateTranscriptWideBlocks}
      codeBlockCollapse={codeBlockCollapse()}
      onCodeBlockCollapseChange={updateCodeBlockCollapse}
      codeBlockCollapseLines={codeBlockCollapseLines()}
      onCodeBlockCollapseLinesChange={updateCodeBlockCollapseLines}
      codeBlockWidth={codeBlockWidth()}
      onCodeBlockWidthChange={updateCodeBlockWidth}
      panelMotion={panelMotion()}
      onPanelMotionChange={updatePanelMotion}
      userMessageCollapse={userMessageCollapse()}
      onUserMessageCollapseChange={updateUserMessageCollapse}
      voiceSettings={props.voiceSettings}
    />;
}
