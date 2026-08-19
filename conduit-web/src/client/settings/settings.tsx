import { createEffect, createMemo, createSignal, For, lazy, on, onCleanup, onMount, Show } from "solid-js";
import { Combobox as KCombobox } from "@kobalte/core/combobox";
import * as KDialog from "@kobalte/core/dialog";
import { CheckIcon, SearchIcon } from "lucide-solid";
import { toast } from "solid-sonner";
import { Button, Field, FieldGroup, FieldLabel, Input, Spinner } from "@/components/primitives";
import { api } from "../api/client";
import { MARKDOWN_RENDERER_OPTIONS, type MarkdownRendererId } from "../chat/markdown-settings";
import { CONTEXT_METRIC_GROUPS, CONTEXT_METRIC_OPTIONS, CONTEXT_METRIC_PRESETS, contextMetricPreset, metricsForContextMetricPreset, type ContextMetricId, type ContextMetricPresetId } from "../chat/context-metrics";
import { formatMicrophoneError, hasAudioSignal, isUnavailableAudioInputError, listAudioInputDevices, MAX_AUDIO_INPUT_TEST_DURATION_MS, revokeAudioInputRecording, startAudioInputTest as beginAudioInputTest, type AudioInputDevice, type AudioInputTestResult, type AudioInputTestSession, } from "../chat/voice-audio";
import { shortcutFromKeyboardEvent } from "../chat/voice-dictation";
import { isWarmMicrophoneActive, stopWarmMicrophone } from "../chat/voice-dictation-client";
import { createVoiceWaveformController, VoiceWaveform } from "../chat/voice-waveform";
import type { Installation, ModelOption, Project, Template, VoiceExecutionCatalogueView, VoiceExecutionProfile, VoiceLocalModel, VoiceLocalSelection, VoiceServerSettings } from "../api/contracts";
import type { ModelSettings } from "../state/model-settings";
import { MAX_SIDEBAR_CHAT_LIMIT, MIN_SIDEBAR_CHAT_LIMIT } from "../navigation/sidebar-preferences";
import type { ShortcutManager } from "../shortcuts/shortcut-manager";
import { ShortcutsSettings } from "./shortcuts-settings";

const sections = ["general", "ui", "shortcuts", "models", "profiles", "runtime", "workspaces", "voice", "search", "auth"] as const;
type Section = typeof sections[number];
const label = (section: Section) => section === "ui" ? "UI" : section[0]!.toUpperCase() + section.slice(1);
type VoiceDictationSettings = { shortcut: string; activation: "push_to_talk" | "toggle"; autoSend: boolean; inputDeviceId: string; captureProfile: "raw" | "processed"; warmMicrophone: boolean };

interface RuntimeSettings {
  maxLiveProcesses: number;
  maxGeneratingProcesses: number;
  idleProcessTtlMs: number;
  liveCount?: number;
  generatingCount?: number;
}

interface PiAuthProvider {
  id: string;
  label: string;
  oauth: boolean;
  usesCallbackServer: boolean;
  auth: { configured: boolean; source: "stored" | "environment" | "managed" | null; removable: boolean };
}

interface PiAuthAttempt {
  id: string;
  providerId: string;
  providerLabel: string;
  state: string;
  message: string;
  authUrl: string | null;
  instructions: string | null;
  deviceCode: { userCode: string; verificationUri: string; expiresInSeconds: number | null } | null;
  prompt: { type: "text" | "manual_code" | "select"; message: string; placeholder?: string; options?: { id: string; label: string }[] } | null;
  error: string | null;
  active: boolean;
  owned: boolean;
}

interface SearchProvider {
  id: string;
  label: string;
  description: string;
  docsUrl: string;
  enabled: boolean;
  editable: boolean;
  configured: boolean;
  stored: boolean;
  source: "stored" | "environment" | null;
  removable: boolean;
}

interface SearchSettings {
  workflow: "none" | "managed";
  providers: SearchProvider[];
}

const voiceSelectionFromProfile = (profile: VoiceExecutionProfile): VoiceLocalSelection => ({
  modelId: profile.modelId,
  artifactId: profile.artifactId,
  runtimeId: profile.runtimeId,
  execution: profile.execution,
  segmentation: profile.segmentation,
});
const voiceArtifactsForModel = (catalogue: VoiceExecutionCatalogueView, modelId: string) => catalogue.artifacts.filter((artifact) => artifact.modelId === modelId);
const voiceProfilesForBackend = (catalogue: VoiceExecutionCatalogueView, artifactId: string, runtimeId: string) => catalogue.profiles.filter((profile) => profile.artifactId === artifactId && profile.runtimeId === runtimeId);
const selectionMatchesProfile = (selection: VoiceLocalSelection, profile: VoiceExecutionProfile) => selection.modelId === profile.modelId
  && selection.artifactId === profile.artifactId
  && selection.runtimeId === profile.runtimeId
  && selection.execution === profile.execution
  && selection.segmentation === profile.segmentation;
const selectionArtifactMatchesProfile = (selection: VoiceLocalSelection, profile: VoiceExecutionProfile) => selection.artifactId === profile.artifactId
  && selection.runtimeId === profile.runtimeId
  && selection.execution === profile.execution
  && selection.segmentation === profile.segmentation;
const sameVoiceSelection = (left: VoiceLocalSelection | null | undefined, right: VoiceLocalSelection | null | undefined) => Boolean(left && right
  && left.modelId === right.modelId
  && left.artifactId === right.artifactId
  && left.runtimeId === right.runtimeId
  && left.execution === right.execution
  && left.segmentation === right.segmentation);
const sameVoiceDraft = (left: VoiceDictationSettings, right: VoiceDictationSettings) => left.shortcut === right.shortcut
  && left.activation === right.activation
  && left.autoSend === right.autoSend
  && left.inputDeviceId === right.inputDeviceId
  && left.captureProfile === right.captureProfile
  && left.warmMicrophone === right.warmMicrophone;
const sameScope = (left: string[], right: string[]) => [...left].sort().join("\n") === [...right].sort().join("\n");
const sameRuntime = (left: RuntimeSettings | null, right: RuntimeSettings | null) => Boolean(left && right
  && left.maxLiveProcesses === right.maxLiveProcesses
  && left.maxGeneratingProcesses === right.maxGeneratingProcesses
  && left.idleProcessTtlMs === right.idleProcessTtlMs);
const preserveVoiceServerDraft = (loaded: VoiceServerSettings, previous: VoiceServerSettings, preserveDraft: boolean): VoiceServerSettings => ({
  ...loaded,
  localModelId: previous.localModelId,
  ...(previous.localSelection ? { localSelection: previous.localSelection, resolvedProfileId: previous.resolvedProfileId } : {}),
  ...(preserveDraft ? {
    mode: previous.mode,
    provider: previous.provider,
    adapter: previous.adapter,
    model: previous.model,
    endpoint: previous.endpoint,
    auth: previous.auth,
  } : {}),
});

const VoiceLocalCatalogue = lazy(() => import("./voice-local-catalogue"));

export function Settings(props: {
  open: boolean;
  initialSection: Section;
  initialWorkspaceId?: string | null;
  onOpenChange: (open: boolean) => void;
  models: ModelSettings;
  templates: Template[];
  templatesLoading: boolean;
  defaultTemplateId: string;
  projects: Project[];
  installations: Installation[];
  installationsLoading: boolean;
  onInstallationsChange: (items: Installation[]) => void;
  onDefaultTemplateChange: (id: string) => Promise<unknown>;
  onWorkspaceDefaultChange: (id: string, templateId: string | null) => Promise<Project>;
  markdownRenderer: MarkdownRendererId;
  onMarkdownRendererChange: (renderer: MarkdownRendererId) => void;
  meteorField: boolean;
  onMeteorFieldChange: (enabled: boolean) => void;
  liquidGlassSurface: boolean;
  onLiquidGlassSurfaceChange: (enabled: boolean) => void;
  voiceSettings: VoiceDictationSettings;
  onVoiceSettingsSave: (settings: VoiceDictationSettings) => void;
  sidebarChatLimit: number;
  onSidebarChatLimitChange: (limit: number) => void;
  contextMetrics: ContextMetricId[];
  onContextMetricsChange: (metrics: ContextMetricId[]) => void;
  shortcuts: ShortcutManager;
}) {
  const [section, setSection] = createSignal<Section>(props.initialSection || "models");
  const [scope, setScope] = createSignal<string[]>([]);
  const [scopeEdited, setScopeEdited] = createSignal(false);
  const [runtime, setRuntime] = createSignal<RuntimeSettings | null>(null);
  const [runtimeBaseline, setRuntimeBaseline] = createSignal<RuntimeSettings | null>(null);
  const [runtimeStatus, setRuntimeStatus] = createSignal<"idle" | "loading" | "ready" | "error">("idle");
  const [runtimeError, setRuntimeError] = createSignal("");
  const [runtimeEdited, setRuntimeEdited] = createSignal(false);
  const [runtimeSaving, setRuntimeSaving] = createSignal(false);
  const [detecting, setDetecting] = createSignal(false);
  const [workspaceId, setWorkspaceId] = createSignal<string | null>(null);
  const [authProviders, setAuthProviders] = createSignal<PiAuthProvider[]>([]);
  const [authAttempt, setAuthAttempt] = createSignal<PiAuthAttempt | null>(null);
  const [authProviderId, setAuthProviderId] = createSignal("");
  const [apiKey, setApiKey] = createSignal("");
  const [authResponse, setAuthResponse] = createSignal("");
  const [authLoading, setAuthLoading] = createSignal(false);
  const [authError, setAuthError] = createSignal("");
  const [authUnavailable, setAuthUnavailable] = createSignal(false);
  const [searchSettings, setSearchSettings] = createSignal<SearchSettings | null>(null);
  const [searchStatus, setSearchStatus] = createSignal<"idle" | "loading" | "ready" | "error">("idle");
  const [searchError, setSearchError] = createSignal("");
  const [searchKey, setSearchKey] = createSignal("");
  const [searchSaving, setSearchSaving] = createSignal(false);
  const [voiceServerSettings, setVoiceServerSettings] = createSignal<VoiceServerSettings | null>(null);
  const [voiceStatus, setVoiceStatus] = createSignal<"idle" | "loading" | "ready" | "error">("idle");
  const [voiceError, setVoiceError] = createSignal("");
  const [voiceSecret, setVoiceSecret] = createSignal("");
  const [voiceBusy, setVoiceBusy] = createSignal(false);
  const [voiceLicenseAccepted, setVoiceLicenseAccepted] = createSignal(false);
  const [voiceTestResult, setVoiceTestResult] = createSignal("");
  const [voiceDraft, setVoiceDraft] = createSignal<VoiceDictationSettings>({ ...props.voiceSettings });
  const [voiceSettingsSaved, setVoiceSettingsSaved] = createSignal(false);
  const [warmMicrophoneActive, setWarmMicrophoneActive] = createSignal(isWarmMicrophoneActive());
  const [voiceServerEdited, setVoiceServerEdited] = createSignal(false);
  const [audioInputDevices, setAudioInputDevices] = createSignal<AudioInputDevice[]>([]);
  const [audioInputStatus, setAudioInputStatus] = createSignal<"idle" | "loading" | "ready" | "error">("idle");
  const [audioInputError, setAudioInputError] = createSignal("");
  const [audioInputBusy, setAudioInputBusy] = createSignal(false);
  const [audioInputTest, setAudioInputTest] = createSignal<AudioInputTestResult | null>(null);
  const [audioInputSignalDetected, setAudioInputSignalDetected] = createSignal(false);
  const [audioInputPlayback, setAudioInputPlayback] = createSignal(false);
  const audioInputWaveform = createVoiceWaveformController();
  let audioInputSession: AudioInputTestSession | null = null;
  let playbackAudio: HTMLAudioElement | null = null;
  let runtimeRequest = 0;
  let searchRequest = 0;
  let search!: HTMLInputElement;
  let voiceInputSelect!: HTMLSelectElement;
  let returnFocus: HTMLElement | null = null;
  let wasOpen = false;
  let voiceLoadRequest = 0;
  let voiceSettingsGeneration = 0;
  let voiceSaveInFlight = 0;
  const stopAudioInputPlayback = () => {
    const audio = playbackAudio;
    playbackAudio = null;
    setAudioInputPlayback(false);
    if (!audio) return;
    audio.onended = null;
    audio.pause();
    audio.currentTime = 0;
    audio.removeAttribute("src");
    audio.load();
  };
  const clearAudioInputTest = () => {
    stopAudioInputPlayback();
    revokeAudioInputRecording(audioInputTest()?.recording);
    setAudioInputTest(null);
  };
  const playAudioInputTest = async () => {
    const recording = audioInputTest()?.recording;
    if (!recording) return;
    stopAudioInputPlayback();
    let audio: HTMLAudioElement;
    try { audio = new Audio(recording.url); }
    catch {
      toast.error("The microphone test recording could not be played.");
      return;
    }
    playbackAudio = audio;
    audio.onended = () => {
      if (playbackAudio !== audio) return;
      playbackAudio = null;
      setAudioInputPlayback(false);
      audio.removeAttribute("src");
      audio.load();
    };
    setAudioInputPlayback(true);
    try {
      await audio.play();
    } catch {
      if (playbackAudio === audio) {
        playbackAudio = null;
        setAudioInputPlayback(false);
      }
      audio.removeAttribute("src");
      audio.load();
      toast.error("The microphone test recording could not be played.");
    }
  };
  const stopAudioInputTest = () => audioInputSession?.stop();
  const focusSearch = () => requestAnimationFrame(() => requestAnimationFrame(() => search?.focus()));
  const dismissEscape = (event: KeyboardEvent) => {
    if (event.key !== "Escape") return;
    if (props.shortcuts.isContextActive("shortcut-recorder")) {
      event.preventDefault();
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    props.onOpenChange(false);
  };

  createEffect(on(() => props.open, (open) => {
    if (open && !wasOpen) returnFocus = document.activeElement as HTMLElement | null;
    wasOpen = open;
    if (!open) {
      audioInputSession?.dispose();
      audioInputSession = null;
      setAudioInputBusy(false);
      setApiKey("");
      setAuthResponse("");
      setSearchKey("");
      setVoiceSecret("");
      setVoiceTestResult("");
      setVoiceSettingsSaved(false);
      audioInputWaveform.reset();
      clearAudioInputTest();
      setAudioInputSignalDetected(false);
      return;
    }
    setVoiceDraft({ ...props.voiceSettings });
    setVoiceSettingsSaved(false);
    const initial = props.initialSection || "models";
    setSection(initial);
    setWorkspaceId(props.initialWorkspaceId || props.projects.find((project) => project.kind === "workspace" || ["linked", "created", "cloned"].includes(project.origin || ""))?.id || null);
    setScopeEdited(false);
    if (initial === "models") focusSearch();
  }));

  onCleanup(() => {
    audioInputSession?.dispose();
    audioInputSession = null;
    clearAudioInputTest();
  });

  onMount(() => {
    const onWarmMicrophoneState = (event: Event) => {
      setWarmMicrophoneActive((event as CustomEvent<{ active?: boolean }>).detail?.active === true);
    };
    window.addEventListener("conduit:warm-microphone-state", onWarmMicrophoneState);
    onCleanup(() => window.removeEventListener("conduit:warm-microphone-state", onWarmMicrophoneState));
  });

  createEffect(() => {
    if (!props.open) return;
    const releaseSettingsContext = props.shortcuts.activateContext("settings");
    document.addEventListener("keydown", dismissEscape, true);
    onCleanup(() => {
      releaseSettingsContext();
      document.removeEventListener("keydown", dismissEscape, true);
    });
  });

  // Remote model settings remain authoritative until the user actually edits.
  createEffect(() => {
    if (!props.open || section() !== "models" || scopeEdited()) return;
    setScope([...props.models.enabledModels()]);
  });

  createEffect(() => {
    if (!props.open || section() !== "models") return;
    props.models.allModels().length;
    const timers = [40, 180].map((delay) => window.setTimeout(() => {
      if (props.open && section() === "models") search?.focus();
    }, delay));
    onCleanup(() => timers.forEach((timer) => window.clearTimeout(timer)));
  });

  const loadRuntime = async () => {
    const request = ++runtimeRequest;
    setRuntimeStatus("loading");
    setRuntimeError("");
    try {
      const loaded = await api<RuntimeSettings>("/v0/runtime/settings");
      if (request !== runtimeRequest) return;
      setRuntime(loaded);
      setRuntimeBaseline({ ...loaded });
      setRuntimeEdited(false);
      setRuntimeStatus("ready");
    } catch (error) {
      if (request !== runtimeRequest) return;
      setRuntimeError((error as Error).message);
      setRuntimeStatus("error");
    }
  };
  createEffect(() => { if (props.open && section() === "runtime") void loadRuntime(); });

  const loadPiAuth = async () => {
    setAuthLoading(true);
    try {
      const [status, attempt] = await Promise.all([
        api<{ providers: PiAuthProvider[] }>("/v0/pi-auth"),
        api<{ attempt: PiAuthAttempt | null }>("/v0/pi-auth/attempt"),
      ]);
      setAuthProviders(status.providers);
      setAuthAttempt(attempt.attempt);
      if (!authProviderId()) setAuthProviderId(status.providers[0]?.id || "");
      setAuthError("");
      setAuthUnavailable(false);
    } catch (error) {
      const response = error as Error & { code?: string };
      setAuthUnavailable(response.code === "pi_auth_login_required");
      setAuthError(response.message);
    } finally { setAuthLoading(false); }
  };
  createEffect(() => { if (props.open && section() === "auth") void loadPiAuth(); });
  createEffect(() => {
    if (!props.open || section() !== "auth" || !authAttempt()?.active) return;
    const timer = window.setInterval(() => {
      api<{ attempt: PiAuthAttempt | null }>("/v0/pi-auth/attempt")
        .then((result) => {
          setAuthAttempt(result.attempt);
          if (!result.attempt?.active) return api<{ providers: PiAuthProvider[] }>("/v0/pi-auth")
            .then((status) => setAuthProviders(status.providers));
        })
        .catch((error) => setAuthError((error as Error).message));
    }, 1000);
    onCleanup(() => window.clearInterval(timer));
  });

  const startOAuth = async () => {
    if (!authProviderId()) return;
    setAuthLoading(true);
    setAuthError("");
    try {
      const result = await api<{ attempt: PiAuthAttempt }>("/v0/pi-auth/oauth", { method: "POST", body: JSON.stringify({ providerId: authProviderId() }) });
      setAuthAttempt(result.attempt);
    } catch (error) { setAuthError((error as Error).message); }
    finally { setAuthLoading(false); }
  };
  const answerAuthPrompt = async (value: string) => {
    setAuthLoading(true);
    setAuthError("");
    try {
      const result = await api<{ attempt: PiAuthAttempt }>("/v0/pi-auth/attempt/respond", { method: "POST", body: JSON.stringify({ value }) });
      setAuthAttempt(result.attempt);
      setAuthResponse("");
    } catch (error) { setAuthError((error as Error).message); }
    finally { setAuthLoading(false); }
  };
  const cancelOAuth = async () => {
    try { await api("/v0/pi-auth/attempt/cancel", { method: "POST" }); await loadPiAuth(); }
    catch (error) { setAuthError((error as Error).message); }
  };
  const saveApiKey = async () => {
    if (!authProviderId() || !apiKey()) return;
    setAuthLoading(true);
    setAuthError("");
    try {
      await api("/v0/pi-auth/api-key", { method: "PUT", body: JSON.stringify({ providerId: authProviderId(), key: apiKey() }) });
      setApiKey("");
      await loadPiAuth();
    } catch (error) { setAuthError((error as Error).message); }
    finally { setAuthLoading(false); }
  };
  const removePiAuth = async (providerId: string) => {
    setAuthLoading(true);
    try { await api(`/v0/pi-auth/${encodeURIComponent(providerId)}`, { method: "DELETE" }); await loadPiAuth(); }
    catch (error) { setAuthError((error as Error).message); }
    finally { setAuthLoading(false); }
  };

  const loadSearchSettings = async () => {
    const request = ++searchRequest;
    setSearchStatus("loading");
    setSearchError("");
    try {
      const loaded = await api<SearchSettings>("/v0/search/settings");
      if (request !== searchRequest) return;
      setSearchSettings(loaded);
      setSearchStatus("ready");
    } catch (error) {
      if (request !== searchRequest) return;
      setSearchError((error as Error).message);
      setSearchStatus("error");
    }
  };
  createEffect(() => { if (props.open && section() === "search") void loadSearchSettings(); });

  const saveSearchKey = async () => {
    const key = searchKey().trim();
    if (!key) return;
    setSearchSaving(true);
    setSearchError("");
    try {
      await api<SearchSettings>("/v0/search/providers/brave", { method: "PUT", body: JSON.stringify({ key }) });
      setSearchKey("");
      await loadSearchSettings();
    } catch (error) { setSearchError((error as Error).message); }
    finally { setSearchSaving(false); }
  };

  const removeSearchKey = async () => {
    setSearchSaving(true);
    setSearchError("");
    try {
      await api("/v0/search/providers/brave", { method: "DELETE" });
      await loadSearchSettings();
    } catch (error) { setSearchError((error as Error).message); }
    finally { setSearchSaving(false); }
  };

  const loadVoiceSettings = async ({ quiet = false, preserveLocalSelection = false } = {}) => {
    const request = ++voiceLoadRequest;
    const generation = voiceSettingsGeneration;
    if (!quiet) setVoiceStatus("loading");
    setVoiceError("");
    try {
      const loaded = await api<VoiceServerSettings>("/v0/voice/settings");
      if (request !== voiceLoadRequest || generation !== voiceSettingsGeneration || voiceSaveInFlight > 0) return;
      const previous = voiceServerSettings();
      setVoiceServerSettings(preserveLocalSelection && previous ? preserveVoiceServerDraft(loaded, previous, voiceServerEdited()) : loaded);
      if (!preserveLocalSelection) setVoiceServerEdited(false);
      setVoiceStatus("ready");
    } catch (error) {
      if (request !== voiceLoadRequest || generation !== voiceSettingsGeneration || voiceSaveInFlight > 0) return;
      setVoiceError((error as Error).message);
      setVoiceStatus("error");
    }
  };
  createEffect(() => {
    if (!props.open || section() !== "voice") return;
    void loadVoiceSettings();
  });

  const loadAudioInputs = async () => {
    setAudioInputStatus("loading");
    setAudioInputError("");
    try {
      setAudioInputDevices(await listAudioInputDevices());
      setAudioInputStatus("ready");
    } catch (error) {
      setAudioInputError(formatMicrophoneError(error));
      setAudioInputStatus("error");
    }
  };
  createEffect(() => {
    if (props.open && section() === "voice") void loadAudioInputs();
  });
  createEffect(() => {
    const selectedDeviceId = voiceDraft().inputDeviceId;
    audioInputDevices();
    if (voiceInputSelect && audioInputStatus() === "ready") voiceInputSelect.value = selectedDeviceId;
  });
  createEffect(() => {
    if (!props.open || section() !== "voice" || !voiceServerSettings()?.local?.installingModelId) return;
    const timer = window.setInterval(() => void loadVoiceSettings({ quiet: true, preserveLocalSelection: true }), 750);
    onCleanup(() => window.clearInterval(timer));
  });

  const updateVoiceDraft = (patch: Partial<VoiceDictationSettings>) => {
    if (patch.warmMicrophone === false) stopWarmMicrophone();
    setVoiceDraft((current) => ({ ...current, ...patch }));
    setVoiceSettingsSaved(false);
  };
  const editVoiceServer = (update: (current: VoiceServerSettings) => VoiceServerSettings) => {
    setVoiceServerSettings((current) => current ? update(current) : current);
    setVoiceServerEdited(true);
    setVoiceSettingsSaved(false);
  };
  const updateVoiceServer = (patch: Partial<VoiceServerSettings>) => editVoiceServer((current) => ({ ...current, ...patch }));
  const selectedVoiceProvider = createMemo(() => voiceServerSettings()?.providers.find((provider) => provider.id === voiceServerSettings()?.provider));
  const voiceCatalogue = createMemo(() => voiceServerSettings()?.local?.catalogue || null);
  const selectedVoiceSelection = createMemo<VoiceLocalSelection | null>(() => {
    const settings = voiceServerSettings();
    const catalogue = voiceCatalogue();
    if (!settings || !catalogue) return null;
    const profile = settings.localSelection
      ? catalogue.profiles.find((candidate) => selectionMatchesProfile(settings.localSelection, candidate))
        || catalogue.profiles.find((candidate) => selectionArtifactMatchesProfile(settings.localSelection, candidate))
      : catalogue.profiles.find((candidate) => candidate.id === settings.resolvedProfileId)
        || catalogue.profiles.find((candidate) => candidate.modelId === settings.localModelId);
    return profile ? voiceSelectionFromProfile(profile) : settings.localSelection || null;
  });
  const selectedVoiceCatalogueModel = createMemo(() => {
    const catalogue = voiceCatalogue();
    const selection = selectedVoiceSelection();
    return catalogue && selection ? catalogue.models.find((model) => model.id === selection.modelId) || null : null;
  });
  const selectedVoiceArtifact = createMemo(() => {
    const catalogue = voiceCatalogue();
    const selection = selectedVoiceSelection();
    return catalogue && selection ? catalogue.artifacts.find((artifact) => artifact.id === selection.artifactId) || null : null;
  });
  const selectedVoiceInstallModelId = createMemo(() => selectedVoiceArtifact()?.legacyModelId || voiceServerSettings()?.localModelId || "");
  const selectedLocalVoiceModel = createMemo(() => voiceServerSettings()?.local?.models.find((model) => model.id === selectedVoiceInstallModelId()));
  const selectedVoiceBackendPath = createMemo(() => {
    const catalogue = voiceCatalogue();
    const selection = selectedVoiceSelection();
    return catalogue && selection ? catalogue.backendPaths.find((backendPath) => backendPath.artifactId === selection.artifactId && backendPath.runtimeId === selection.runtimeId) || null : null;
  });
  const selectedVoiceBackendStatus = createMemo(() => {
    const backendPath = selectedVoiceBackendPath();
    return backendPath ? voiceServerSettings()?.local?.backendPaths?.find((candidate) => candidate.backendPathId === backendPath.id) || null : null;
  });
  const selectedVoiceProfiles = createMemo(() => {
    const catalogue = voiceCatalogue();
    const backendPath = selectedVoiceBackendPath();
    return catalogue && backendPath ? catalogue.profiles.filter((profile) => profile.backendPathId === backendPath.id) : [];
  });
  const selectedVoiceAdapter = createMemo(() => {
    const settings = voiceServerSettings();
    return settings?.adapters.find((adapter) => adapter.id === settings.adapter) || null;
  });
  const cloudTiming = createMemo(() => selectedVoiceAdapter()?.transport === "ws"
    ? { label: "Live", description: "Text appears while you speak and may revise." }
    : { label: "After Stop", description: "Nothing appears until you stop." });
  const voiceDirty = createMemo(() => voiceServerEdited() || Boolean(voiceSecret().trim()) || !sameVoiceDraft(voiceDraft(), props.voiceSettings));
  const selectLocalProfile = (profile: VoiceExecutionProfile) => {
    const catalogue = voiceCatalogue();
    const artifact = catalogue?.artifacts.find((candidate) => candidate.id === profile.artifactId);
    if (!artifact) return;
    editVoiceServer((current) => ({
      ...current,
      mode: "local",
      localModelId: artifact.legacyModelId,
      localSelection: voiceSelectionFromProfile(profile),
      resolvedProfileId: profile.id,
    }));
    setVoiceLicenseAccepted(false);
  };
  const profileForArtifact = (catalogue: VoiceExecutionCatalogueView, artifactId: string, current: VoiceLocalSelection | null, runtimeId = current?.runtimeId) => {
    const artifact = catalogue.artifacts.find((candidate) => candidate.id === artifactId);
    if (!artifact) return null;
    const backendPath = catalogue.backendPaths
      .filter((candidate) => candidate.artifactId === artifact.id)
      .find((candidate) => candidate.runtimeId === runtimeId)
      || catalogue.backendPaths.find((candidate) => candidate.artifactId === artifact.id);
    if (!backendPath) return null;
    const profiles = voiceProfilesForBackend(catalogue, artifact.id, backendPath.runtimeId);
    return profiles.find((candidate) => candidate.execution === current?.execution && candidate.segmentation === current?.segmentation)
      || profiles.find((candidate) => candidate.execution === current?.execution)
      || profiles.find((candidate) => candidate.execution === "stop")
      || profiles[0]
      || null;
  };
  const selectLocalFamily = (modelId: string) => {
    const catalogue = voiceCatalogue();
    const current = selectedVoiceSelection();
    if (!catalogue) return;
    const artifact = voiceArtifactsForModel(catalogue, modelId).find((candidate) => candidate.id === current?.artifactId)
      || voiceArtifactsForModel(catalogue, modelId)[0];
    const profile = artifact && profileForArtifact(catalogue, artifact.id, current);
    if (profile) selectLocalProfile(profile);
  };
  const selectLocalRuntime = (runtimeId: string) => {
    const catalogue = voiceCatalogue();
    const current = selectedVoiceSelection();
    if (!catalogue || !current) return;
    const currentArtifact = catalogue.artifacts.find((candidate) => candidate.id === current.artifactId);
    const compatibleArtifacts = voiceArtifactsForModel(catalogue, current.modelId).filter((candidate) => catalogue.backendPaths.some((path) => path.artifactId === candidate.id && path.runtimeId === runtimeId));
    const artifact = compatibleArtifacts.find((candidate) => candidate.legacyModelId === currentArtifact?.legacyModelId)
      || compatibleArtifacts.find((candidate) => candidate.precision === currentArtifact?.precision)
      || compatibleArtifacts[0];
    const profile = artifact && profileForArtifact(catalogue, artifact.id, current, runtimeId);
    if (profile) selectLocalProfile(profile);
  };
  const selectLocalVariant = (artifactId: string) => {
    const catalogue = voiceCatalogue();
    const current = selectedVoiceSelection();
    const profile = catalogue && profileForArtifact(catalogue, artifactId, current);
    if (profile) selectLocalProfile(profile);
  };
  const selectLocalTiming = (profileId: string) => {
    const profile = selectedVoiceProfiles().find((candidate) => candidate.id === profileId);
    if (profile) selectLocalProfile(profile);
  };
  const persistVoiceServer = async (settings: VoiceServerSettings) => {
    voiceSettingsGeneration += 1;
    voiceSaveInFlight += 1;
    try {
      const saved = await api<VoiceServerSettings>("/v0/voice/settings", {
        method: "PUT",
        body: JSON.stringify({
          mode: settings.mode,
          localModelId: settings.localModelId,
          ...(settings.localSelection ? { localSelection: settings.localSelection } : {}),
          provider: settings.provider,
          adapter: settings.adapter,
          model: settings.model,
          endpoint: settings.endpoint,
          auth: { type: settings.auth.type, headerName: settings.auth.headerName, secret: voiceSecret() },
        }),
      });
      setVoiceSecret("");
      const savedState = settings.mode === "local" && settings.localSelection
        ? (() => {
          const responseSelection = saved.localSelection;
          if (sameVoiceSelection(responseSelection, settings.localSelection)) return saved;
          const requestedArtifact = saved.local?.catalogue?.artifacts.find((artifact) => artifact.id === settings.localSelection?.artifactId);
          const requestedProfile = saved.local?.catalogue?.profiles.find((profile) => selectionMatchesProfile(settings.localSelection!, profile));
          return {
            ...saved,
            localModelId: requestedArtifact?.legacyModelId || settings.localModelId,
            localSelection: settings.localSelection,
            resolvedProfileId: requestedProfile?.id || settings.resolvedProfileId,
          };
        })()
        : saved;
      setVoiceServerSettings(savedState);
      setVoiceServerEdited(false);
      return savedState;
    } finally {
      voiceSettingsGeneration += 1;
      voiceSaveInFlight -= 1;
    }
  };
  const saveVoiceSettings = async () => {
    const settings = voiceServerSettings();
    if (!settings) return;
    setVoiceBusy(true);
    setVoiceError("");
    setVoiceTestResult("");
    try {
      await persistVoiceServer(settings);
      props.onVoiceSettingsSave(voiceDraft());
      setVoiceSettingsSaved(true);
      toast.success("Voice settings saved");
    } catch (error) {
      setVoiceError((error as Error).message);
      toast.error((error as Error).message);
    }
    finally { setVoiceBusy(false); }
  };
  const testVoiceServer = async () => {
    const settings = voiceServerSettings();
    if (!settings) return;
    setVoiceBusy(true);
    setVoiceError("");
    setVoiceTestResult("");
    try {
      if (voiceServerEdited() || voiceSecret().trim()) await persistVoiceServer(settings);
      await api("/v0/voice/test", { method: "POST", body: "{}" });
      setVoiceTestResult("Connection successful");
      await loadVoiceSettings({ quiet: true });
    } catch (error) { setVoiceError((error as Error).message); }
    finally { setVoiceBusy(false); }
  };
  const testAudioInput = async () => {
    if (audioInputBusy()) return;
    setAudioInputBusy(true);
    setAudioInputError("");
    clearAudioInputTest();
    setAudioInputSignalDetected(false);
    audioInputWaveform.reset();
    const selectedDeviceId = voiceDraft().inputDeviceId;
    let session: AudioInputTestSession | null = null;
    try {
      session = beginAudioInputTest(selectedDeviceId, {
        profile: voiceDraft().captureProfile,
        maxDurationMs: MAX_AUDIO_INPUT_TEST_DURATION_MS,
        onLevel: (level) => {
          audioInputWaveform.push(level);
          if (hasAudioSignal(level)) setAudioInputSignalDetected(true);
        },
      });
      audioInputSession = session;
      const result = await session.result;
      if (audioInputSession !== session) return;
      setAudioInputTest(result);
      await loadAudioInputs();
      if (!result.signalDetected) setAudioInputError("No microphone signal detected. Check Chrome site settings and the selected input.");
    } catch (error) {
      if (audioInputSession === session) {
        const message = formatMicrophoneError(error);
        setAudioInputError(message);
        if (selectedDeviceId && isUnavailableAudioInputError(error)) {
          toast.error("The selected microphone is no longer available. Choose another device and save Voice settings.");
        }
      }
    } finally {
      if (audioInputSession === session) {
        audioInputSession = null;
        setAudioInputBusy(false);
      }
    }
  };
  const removeVoiceCredential = async () => {
    setVoiceBusy(true);
    try { await api("/v0/voice/credential", { method: "DELETE" }); await loadVoiceSettings({ quiet: true }); }
    catch (error) { setVoiceError((error as Error).message); }
    finally { setVoiceBusy(false); }
  };
  const installVoiceModel = async (modelId: string) => {
    setVoiceBusy(true);
    setVoiceError("");
    try {
      const loaded = await api<VoiceServerSettings>("/v0/voice/model/install", { method: "POST", body: JSON.stringify({ modelId, licenseAccepted: voiceLicenseAccepted() }) });
      setVoiceServerSettings((current) => current ? preserveVoiceServerDraft(loaded, current, voiceServerEdited()) : loaded);
    } catch (error) { setVoiceError((error as Error).message); }
    finally { setVoiceBusy(false); }
  };
  const cancelVoiceInstall = async () => {
    setVoiceBusy(true);
    try { await api("/v0/voice/model/cancel", { method: "POST", body: "{}" }); await loadVoiceSettings({ quiet: true }); }
    catch (error) { setVoiceError((error as Error).message); }
    finally { setVoiceBusy(false); }
  };
  const uninstallVoiceModel = async (modelId: string) => {
    setVoiceBusy(true);
    try { await api("/v0/voice/model", { method: "DELETE", body: JSON.stringify({ modelId }) }); await loadVoiceSettings({ quiet: true }); }
    catch (error) { setVoiceError((error as Error).message); }
    finally { setVoiceBusy(false); }
  };

  const selectedModels = createMemo(() => props.models.allModels().filter((model) => scope().includes(model.spec)));
  const scopeDirty = createMemo(() => scopeEdited() && !sameScope(scope(), props.models.enabledModels()));
  const modelFilter = (model: ModelOption, input: string) => {
    const words = input.toLowerCase().trim().split(/\s+/).filter(Boolean);
    return words.every((word) => `${model.label} ${model.spec} ${model.provider}`.toLowerCase().includes(word));
  };
  const updateScope = (models: ModelOption[]) => {
    setScope(models.map((model) => model.spec));
    setScopeEdited(true);
  };
  const saveScope = async () => {
    if (await props.models.saveScope(scope())) {
      setScope([...props.models.enabledModels()]);
      setScopeEdited(false);
    }
  };

  const workspaceProjects = createMemo(() => props.projects
    .filter((project) => project.kind === "workspace" || ["linked", "created", "cloned"].includes(project.origin || ""))
    .sort((left, right) => (left.id === workspaceId() ? -1 : right.id === workspaceId() ? 1 : left.name.localeCompare(right.name))));
  const workspaceDefaultLabel = (workspace: Project) => {
    const id = workspace.defaultTemplateId;
    if (id === "host-pi") return "Host Pi";
    return props.templates.find((item) => item.id === id)?.label || `Inherit global (${props.templates.find((item) => item.id === props.defaultTemplateId)?.label || "General"})`;
  };
  const saveWorkspace = async (workspace: Project, templateId: string | null) => props.onWorkspaceDefaultChange(workspace.id, templateId);
  const toggleContextMetric = (id: ContextMetricId, enabled: boolean) => {
    const next = enabled ? [...props.contextMetrics, id] : props.contextMetrics.filter((current) => current !== id);
    props.onContextMetricsChange(next);
  };

  const redetect = async () => {
    setDetecting(true);
    setRuntimeError("");
    try {
      const host = await api<Installation>("/v0/pi-installations/host/detect", { method: "POST" });
      props.onInstallationsChange(props.installations.some((item) => item.id === "host-pi")
        ? props.installations.map((item) => item.id === "host-pi" ? host : item)
        : [...props.installations, host]);
    } catch (error) { setRuntimeError((error as Error).message); }
    finally { setDetecting(false); }
  };

  const updateRuntime = (next: RuntimeSettings) => { setRuntime(next); setRuntimeEdited(true); setRuntimeError(""); };
  const runtimeDirty = createMemo(() => runtimeEdited() && !sameRuntime(runtime(), runtimeBaseline()));
  const saveRuntime = async () => {
    if (!runtime()) return;
    setRuntimeSaving(true);
    setRuntimeError("");
    try {
      const saved = await api<RuntimeSettings>("/v0/runtime/settings", { method: "PATCH", body: JSON.stringify(runtime()) });
      setRuntime(saved);
      setRuntimeBaseline({ ...saved });
      setRuntimeEdited(false);
    } catch (error) { setRuntimeError((error as Error).message); }
    finally { setRuntimeSaving(false); }
  };

  return <KDialog.Root open={props.open} onOpenChange={props.onOpenChange}>
    <KDialog.Portal><KDialog.Content data-state={props.open ? "open" : "closed"} class="settings-dialog" onEscapeKeyDown={dismissEscape} onCloseAutoFocus={(event) => { event.preventDefault(); if (returnFocus?.isConnected) returnFocus.focus(); returnFocus = null; }}>
      <div class="settings-shell">
        <div class="settings-rail">
          <KDialog.Title>Settings</KDialog.Title>
          <nav data-slot="tabs-list" role="tablist" aria-label="Settings sections" aria-orientation="vertical">
            <For each={sections}>{(item) => <button role="tab" aria-selected={section() === item} onClick={() => { setSection(item); if (item === "models") focusSearch(); }}>{label(item)}</button>}</For>
          </nav>
        </div>
        <main class="settings-content" data-section={section()}>
          <header><h2>{label(section())}</h2><Button variant="ghost" size="icon-sm" aria-label="Close" onClick={() => props.onOpenChange(false)}>×</Button></header>
          <Show when={section() === "general"}><Show when={!props.templatesLoading} fallback={<div class="settings-loading"><Spinner /><span>Loading profiles…</span></div>}><FieldGroup>
            <Field><FieldLabel for="default-profile">Default profile</FieldLabel><select id="default-profile" value={props.defaultTemplateId} onChange={(event) => void props.onDefaultTemplateChange(event.currentTarget.value)}><For each={props.templates.filter((item) => item.defaultable !== false)}>{(item) => <option value={item.id}>{item.label}</option>}</For></select></Field>
          </FieldGroup></Show></Show>
          <Show when={section() === "ui"}>
            <FieldGroup>
              <Field>
                <FieldLabel for="markdown-renderer">Markdown renderer</FieldLabel>
                <select id="markdown-renderer" aria-label="Markdown renderer" value={props.markdownRenderer} onChange={(event) => props.onMarkdownRendererChange(event.currentTarget.value as MarkdownRendererId)}>
                  <For each={MARKDOWN_RENDERER_OPTIONS}>{(option) => <option value={option.value}>{option.label}</option>}</For>
                </select>
                <small>Choose the Markdown renderer used for complete and streaming answers.</small>
              </Field>
              <Field>
                <FieldLabel for="sidebar-chat-limit">Chats shown in sidebar</FieldLabel>
                <Input id="sidebar-chat-limit" type="number" min={MIN_SIDEBAR_CHAT_LIMIT} max={MAX_SIDEBAR_CHAT_LIMIT} step="1" value={props.sidebarChatLimit} onChange={(event) => props.onSidebarChatLimitChange(Number(event.currentTarget.value))} onBlur={(event) => props.onSidebarChatLimitChange(Number(event.currentTarget.value))} />
                <small>Show this many recent chats in the Chats group. Use View all chats to search older chats.</small>
              </Field>
              <Field>
                <label class="settings-toggle">
                  <input type="checkbox" aria-label="Liquid glass surface" checked={props.liquidGlassSurface} onChange={(event) => props.onLiquidGlassSurfaceChange(event.currentTarget.checked)} />
                  <span><strong>Liquid glass composer surface</strong><small>Use the precomputed SVG refraction path. It costs more on mobile than the frost path.</small></span>
                </label>
              </Field>
              <Field>
                <label class="settings-toggle">
                  <input type="checkbox" aria-label="Ambient meteor field" checked={props.meteorField} onChange={(event) => props.onMeteorFieldChange(event.currentTarget.checked)} />
                  <span><strong>Ambient meteor field</strong><small>Show the animated meteor field behind chat surfaces.</small></span>
                </label>
              </Field>
              <Field>
                <FieldLabel>Composer context metrics</FieldLabel>
                <Field>
                  <FieldLabel for="context-metric-preset">Preset</FieldLabel>
                  <select id="context-metric-preset" aria-label="Composer context metric preset" value={contextMetricPreset(props.contextMetrics)} onChange={(event) => {
                    const value = event.currentTarget.value as ContextMetricPresetId | "custom";
                    if (value !== "custom") props.onContextMetricsChange(metricsForContextMetricPreset(value));
                  }}>
                    <option value="custom">Custom</option>
                    <For each={CONTEXT_METRIC_PRESETS}>{(preset) => <option value={preset.id}>{preset.label}</option>}</For>
                  </select>
                  <small><For each={CONTEXT_METRIC_PRESETS.filter((preset) => preset.id === contextMetricPreset(props.contextMetrics))}>{(preset) => preset.description}</For></small>
                </Field>
                <div class="flex flex-col gap-2" role="group" aria-label="Composer context metrics">
                  <For each={CONTEXT_METRIC_GROUPS}>{(group) => <fieldset class="flex flex-col gap-2">
                    <legend class="text-sm font-medium">{group.label}</legend>
                    <For each={CONTEXT_METRIC_OPTIONS.filter((option) => option.group === group.id)}>{(option) => <label class="flex items-start gap-2 text-sm">
                      <input type="checkbox" aria-label={option.label} checked={props.contextMetrics.includes(option.id)} onChange={(event) => toggleContextMetric(option.id, event.currentTarget.checked)} />
                      <span class="flex flex-col"><strong>{option.label}</strong><small>{option.description}</small></span>
                    </label>}</For>
                  </fieldset>}</For>
                </div>
                <small>Choose a preset or adjust individual measures. Manual changes use Custom. The line keeps canonical order and wraps when needed.</small>
              </Field>
            </FieldGroup>
          </Show>
          <Show when={section() === "shortcuts"}><ShortcutsSettings manager={props.shortcuts} /></Show>
          <Show when={props.open && section() === "models"}>
            <div class="model-scope">
              <Show when={props.models.settingsError()}><div role="alert" class="settings-error"><span>{props.models.settingsError()}</span><Button variant="outline" size="sm" onClick={() => void props.models.reload()}>Retry</Button></div></Show>
              <Show when={!props.models.settingsLoading() || props.models.allModels().length} fallback={<div class="settings-loading"><Spinner /><span>Loading models…</span></div>}>
                <KCombobox<ModelOption>
                  multiple
                  options={props.models.allModels()}
                  value={selectedModels()}
                  onChange={updateScope}
                  optionValue="spec"
                  optionTextValue={(model) => `${model.label} ${model.spec} ${model.provider}`}
                  optionLabel="label"
                  defaultFilter={modelFilter}
                  open
                  closeOnSelection={false}
                  selectionBehavior="toggle"
                  modal={false}
                  itemComponent={(itemProps) => <KCombobox.Item item={itemProps.item} data-slot="combobox-item">
                    <span class="model-check"><KCombobox.ItemIndicator><CheckIcon /></KCombobox.ItemIndicator></span>
                    <span><strong>{itemProps.item.rawValue.label}</strong><small>{itemProps.item.rawValue.spec}</small></span>
                  </KCombobox.Item>}
                >
                  <KCombobox.Control class="model-search"><SearchIcon /><KCombobox.Input ref={search} aria-label="Search available models" onKeyDown={(event) => {
                    if (event.key !== "Escape") return;
                    event.preventDefault();
                    event.stopPropagation();
                    props.onOpenChange(false);
                  }} /></KCombobox.Control>
                  <KCombobox.Content class="model-scope-list" data-slot="combobox-list"><KCombobox.Listbox /></KCombobox.Content>
                </KCombobox>
              </Show>
              <div class="settings-actions"><span>{scope().length} enabled</span><Button disabled={!scopeDirty() || !scope().length || props.models.saving()} onClick={() => void saveScope()}>{props.models.saving() ? <Spinner /> : null}Save changes</Button></div>
            </div>
          </Show>
          <Show when={section() === "profiles"}><Show when={!props.templatesLoading} fallback={<div class="settings-loading"><Spinner /><span>Loading profiles…</span></div>}><div class="settings-cards"><For each={props.templates}>{(item) => <article><h3>{item.label}</h3><p>{item.description || item.posture || item.tools?.join(" · ")}</p></article>}</For></div></Show></Show>
          <Show when={section() === "runtime"}>
            <Show when={runtimeStatus() === "ready" && runtime()} fallback={<Show when={runtimeStatus() === "error"} fallback={<div class="settings-loading"><Spinner /><span>Loading runtime settings…</span></div>}><div role="alert" class="settings-error"><span>{runtimeError() || "Runtime settings could not be loaded."}</span><Button variant="outline" size="sm" onClick={() => void loadRuntime()}>Retry</Button></div></Show>}>
              <FieldGroup>
                <Field><FieldLabel for="warm-processes">Max warm Pi processes</FieldLabel><Input id="warm-processes" type="number" value={runtime()!.maxLiveProcesses} onInput={(event) => updateRuntime({ ...runtime()!, maxLiveProcesses: Number(event.currentTarget.value) })} /><small>{runtime()!.liveCount || 0} live now</small></Field>
                <Field><FieldLabel for="generations">Max concurrent generations</FieldLabel><Input id="generations" type="number" value={runtime()!.maxGeneratingProcesses} onInput={(event) => updateRuntime({ ...runtime()!, maxGeneratingProcesses: Number(event.currentTarget.value) })} /><small>{runtime()!.generatingCount || 0} generating</small></Field>
                <Field><FieldLabel for="idle-ttl">Idle process TTL (seconds)</FieldLabel><Input id="idle-ttl" type="number" value={Math.round(runtime()!.idleProcessTtlMs / 1000)} onInput={(event) => updateRuntime({ ...runtime()!, idleProcessTtlMs: Number(event.currentTarget.value) * 1000 })} /></Field>
                <Show when={runtimeError()}><p role="alert" class="settings-inline-error">{runtimeError()}</p></Show>
                <Button disabled={!runtimeDirty() || runtimeSaving()} onClick={() => void saveRuntime()}>{runtimeSaving() ? <Spinner /> : null}Save runtime settings</Button>
              </FieldGroup>
            </Show>
            <Show when={!props.installationsLoading} fallback={<div class="settings-loading"><Spinner /><span>Loading Pi installations…</span></div>}><div class="installations"><For each={props.installations}>{(item) => <article><h3>{item.label}</h3><p>{item.available ? item.version ? `Pi ${item.version}` : "Available" : item.reason || (item as Installation & { error?: string }).error || "Unavailable"}</p></article>}</For><Button variant="outline" disabled={detecting()} onClick={() => void redetect()}>{detecting() ? <Spinner /> : null}Re-detect Host Pi</Button></div></Show>
          </Show>
          <Show when={section() === "workspaces"}>
            <Show when={!props.templatesLoading && !props.installationsLoading} fallback={<div class="settings-loading"><Spinner /><span>Loading workspace settings…</span></div>}><Show when={workspaceProjects().length} fallback={<p>No workspaces registered.</p>}><For each={workspaceProjects()}>{(workspace) => <div class="workspace-settings-card" data-current={workspace.id === workspaceId()}><h3>{workspace.name}</h3><p>{workspace.path || workspace.externalPath}</p><p>Override: {workspaceDefaultLabel(workspace).startsWith("Inherit") ? "None" : workspaceDefaultLabel(workspace)}</p>
              <Field><FieldLabel for={`workspace-default-profile-${workspace.id}`}>Default profile</FieldLabel><select id={`workspace-default-profile-${workspace.id}`} aria-label={`${workspace.name} default profile`} value={workspace.defaultTemplateId || ""} onChange={(event) => void saveWorkspace(workspace, event.currentTarget.value || null)}>
                <option value="">Inherit global ({props.templates.find((item) => item.id === props.defaultTemplateId)?.label || "General"})</option>
                <For each={props.templates.filter((item) => item.defaultable !== false)}>{(item) => <option value={item.id}>{item.label}</option>}</For>
                <option value="host-pi" disabled={!props.installations.find((item) => item.id === "host-pi")?.available}>Host Pi</option>
              </select></Field>
            </div>}</For></Show></Show>
          </Show>
          <Show when={section() === "voice"}>
            <Show when={voiceStatus() === "ready" && voiceServerSettings()} fallback={<Show when={voiceStatus() === "error"} fallback={<div class="settings-loading"><Spinner /><span>Loading voice settings…</span></div>}><div role="alert" class="settings-error"><span>{voiceError() || "Voice settings could not be loaded."}</span><Button variant="outline" size="sm" onClick={() => void loadVoiceSettings()}>Retry</Button></div></Show>}>
              <div class="voice-settings">
                <p class="voice-settings-intro">Dictation passes through authenticated Conduit. Microphone-test playback stays in browser memory. Server dictation can retain configured diagnostic WAV/JSON pairs; Cloud credentials stay server-side.</p>
                <FieldGroup>
                  <Field><FieldLabel for="voice-mode">Transcription source</FieldLabel><select id="voice-mode" disabled={voiceBusy()} value={voiceServerSettings()!.mode} onChange={(event) => {
                    const mode = event.currentTarget.value as VoiceServerSettings["mode"];
                    updateVoiceServer({ mode });
                  }}><option value="off">Off</option><option value="local">This machine</option><option value="remote">Cloud</option></select><small>Choose where Conduit runs dictation. The selected source controls the settings panel below.</small></Field>
                </FieldGroup>
                <Show when={voiceServerSettings()!.mode === "local" && voiceCatalogue()}>{(catalogue) => <VoiceLocalCatalogue
                  catalogue={catalogue()}
                  selection={selectedVoiceSelection()}
                  selectedModel={selectedVoiceCatalogueModel()}
                  selectedArtifact={selectedVoiceArtifact()}
                  selectedBackendPath={selectedVoiceBackendPath()}
                  backendStatus={selectedVoiceBackendStatus()}
                  backendStatuses={voiceServerSettings()!.local?.backendPaths || []}
                  selectedLocalModel={selectedLocalVoiceModel() || null}
                  profiles={selectedVoiceProfiles()}
                  busy={voiceBusy()}
                  installingModelId={voiceServerSettings()!.local?.installingModelId || null}
                  installProgress={voiceServerSettings()!.local?.progress || null}
                  licenseAccepted={voiceLicenseAccepted()}
                  dirty={voiceDirty()}
                  onFamilyChange={selectLocalFamily}
                  onRuntimeChange={selectLocalRuntime}
                  onVariantChange={selectLocalVariant}
                  onTimingChange={selectLocalTiming}
                  onLicenseChange={setVoiceLicenseAccepted}
                  onInstall={() => void installVoiceModel(selectedVoiceInstallModelId())}
                  onCancelInstall={() => void cancelVoiceInstall()}
                  onUninstall={() => void uninstallVoiceModel(selectedVoiceInstallModelId())}
                />}</Show>
                <Show when={voiceServerSettings()!.mode === "remote"}>
                  <div class="voice-card">
                    <h3>Cloud transcription</h3>
                    <FieldGroup>
                      <Field><FieldLabel for="voice-provider">Provider</FieldLabel><select id="voice-provider" disabled={voiceBusy()} value={voiceServerSettings()!.provider} onChange={(event) => {
                        const provider = voiceServerSettings()!.providers.find((candidate) => candidate.id === event.currentTarget.value)!;
                        setVoiceSecret("");
                        editVoiceServer((current) => ({ ...current, provider: provider.id, adapter: provider.adapter, endpoint: provider.endpoint, model: provider.models[0]?.id || "", auth: { ...current.auth, type: provider.id === "custom" ? current.auth.type : "bearer", configured: Boolean(provider.configured), source: provider.configured ? "stored" : null, removable: Boolean(provider.configured) } }));
                      }}><For each={voiceServerSettings()!.providers}>{(provider) => <option value={provider.id}>{provider.label}</option>}</For></select></Field>
                      <Show when={selectedVoiceProvider()?.models.length}><Field><FieldLabel for="voice-cloud-model">Model</FieldLabel><select id="voice-cloud-model" disabled={voiceBusy()} value={voiceServerSettings()!.model} onChange={(event) => {
                        const model = selectedVoiceProvider()!.models.find((candidate) => candidate.id === event.currentTarget.value);
                        updateVoiceServer({ model: event.currentTarget.value, ...(model?.adapter ? { adapter: model.adapter } : {}) });
                      }}><For each={selectedVoiceProvider()!.models}>{(model) => <option value={model.id}>{model.label}</option>}</For></select><small>{selectedVoiceProvider()!.models.find((model) => model.id === voiceServerSettings()!.model)?.description}</small></Field></Show>
                      <Show when={voiceServerSettings()!.provider === "custom"}>
                        <Field><FieldLabel for="voice-adapter">Protocol adapter</FieldLabel><select id="voice-adapter" disabled={voiceBusy()} value={voiceServerSettings()!.adapter} onChange={(event) => updateVoiceServer({ adapter: event.currentTarget.value })}><For each={voiceServerSettings()!.adapters}>{(adapter) => <option value={adapter.id}>{adapter.label}</option>}</For></select><small>{voiceServerSettings()!.adapters.find((adapter) => adapter.id === voiceServerSettings()!.adapter)?.description}</small></Field>
                        <Field><FieldLabel for="voice-endpoint">Endpoint URL</FieldLabel><Input id="voice-endpoint" type="url" disabled={voiceBusy()} value={voiceServerSettings()!.endpoint} placeholder="https://speech.example.com/v1/audio/transcriptions" onInput={(event) => updateVoiceServer({ endpoint: event.currentTarget.value })} /><small>Custom endpoints must resolve publicly and use HTTPS.</small></Field>
                        <Field><FieldLabel for="voice-custom-model">Model parameter</FieldLabel><Input id="voice-custom-model" value={voiceServerSettings()!.model} placeholder="Optional model ID" onInput={(event) => updateVoiceServer({ model: event.currentTarget.value })} /></Field>
                      <Field><FieldLabel for="voice-auth-type">Authentication</FieldLabel><select id="voice-auth-type" disabled={voiceBusy()} value={voiceServerSettings()!.auth.type} onChange={(event) => editVoiceServer((current) => ({ ...current, auth: { ...current.auth, type: event.currentTarget.value as VoiceServerSettings["auth"]["type"] } }))}><option value="none">None</option><option value="bearer">Bearer token</option><option value="header">API-key header</option></select></Field>
                      <Show when={voiceServerSettings()!.auth.type === "header"}><Field><FieldLabel for="voice-auth-header">Header name</FieldLabel><Input id="voice-auth-header" disabled={voiceBusy()} value={voiceServerSettings()!.auth.headerName} onInput={(event) => editVoiceServer((current) => ({ ...current, auth: { ...current.auth, headerName: event.currentTarget.value } }))} /></Field></Show>
                      </Show>
                      <Show when={voiceServerSettings()!.provider !== "custom" || voiceServerSettings()!.auth.type !== "none"}><Field><FieldLabel for="voice-secret">{selectedVoiceProvider()?.authLabel || "Credential"}</FieldLabel><Input id="voice-secret" type="password" autocomplete="off" disabled={voiceBusy()} value={voiceSecret()} onInput={(event) => { setVoiceSecret(event.currentTarget.value); setVoiceServerEdited(true); setVoiceSettingsSaved(false); }} placeholder={voiceServerSettings()!.auth.configured ? "Saved · enter a new key to replace" : "Enter API key"} /><small>{voiceServerSettings()!.auth.configured ? "Stored on this server" : "Not configured"}</small></Field></Show>
                    </FieldGroup>
                    <div class="voice-backend-facts" aria-label="Cloud backend and timing">
                      <div><span>Backend</span><strong>{selectedVoiceAdapter()?.label || "Not selected"}</strong><small>{selectedVoiceAdapter()?.transport === "ws" ? "WebSocket live PCM" : "HTTPS audio upload"} · {voiceServerSettings()!.auth.configured ? "credential configured" : "credential not configured"}</small></div>
                      <div><span>When to transcribe</span><strong>{cloudTiming().label}</strong><small>{cloudTiming().description}</small></div>
                    </div>
                    <div class="voice-actions"><Button variant="outline" disabled={voiceBusy()} onClick={() => void testVoiceServer()}>Test credentials</Button><Show when={voiceServerSettings()!.auth.removable}><Button variant="outline" disabled={voiceBusy()} onClick={() => void removeVoiceCredential()}>Remove credential</Button></Show></div>
                  </div>
                </Show>

                <details class="voice-advanced" id="voice-advanced">
                  <summary id="voice-advanced-summary"><span>Advanced</span><small>Input and capture behaviour</small></summary>
                  <FieldGroup>
                  <div class="voice-advanced-heading"><h3>Input</h3><p>These controls affect capture and draft delivery. They do not change the selected runtime.</p></div>
                  <div class="voice-input-test">
                    <Field><FieldLabel for="voice-input-device">Microphone</FieldLabel><select ref={voiceInputSelect} id="voice-input-device" disabled={audioInputBusy()} value={voiceDraft().inputDeviceId} onChange={(event) => updateVoiceDraft({ inputDeviceId: event.currentTarget.value })}>
                      <option value="">System default microphone</option>
                      <Show when={voiceDraft().inputDeviceId && !audioInputDevices().some((device) => device.deviceId === voiceDraft().inputDeviceId)}><option value={voiceDraft().inputDeviceId}>Selected microphone unavailable</option></Show>
                      <For each={audioInputDevices()}>{(device) => <option value={device.deviceId}>{device.label}</option>}</For>
                    </select><small>Chrome controls site permission. Choose the input that should feed dictation.</small></Field>
                    <Field><FieldLabel for="voice-capture-profile">Capture profile</FieldLabel><select id="voice-capture-profile" disabled={audioInputBusy()} value={voiceDraft().captureProfile} onChange={(event) => updateVoiceDraft({ captureProfile: event.currentTarget.value as "raw" | "processed" })}>
                      <option value="raw">Raw candidate (browser AGC off)</option>
                      <option value="processed">Processed browser profile (browser AGC on)</option>
                    </select><small>Both profiles keep echo cancellation and noise suppression requested. Raw disables browser automatic gain and Conduit never adds adaptive ASR gain.</small></Field>
                    <div class="voice-actions"><Button variant="outline" size="sm" disabled={audioInputBusy() || audioInputStatus() === "loading"} onClick={() => void loadAudioInputs()}>Refresh microphones</Button><Button variant="outline" size="sm" disabled={audioInputStatus() === "loading"} onClick={() => audioInputBusy() ? stopAudioInputTest() : void testAudioInput()}>{audioInputBusy() ? <><Spinner />Stop microphone test</> : "Test microphone"}</Button></div>
                    <Show when={audioInputBusy() || audioInputTest()}>
                      <VoiceWaveform class="settings-recorder-monitor" history={audioInputWaveform.history} level={audioInputWaveform.level} peak={audioInputWaveform.peak} state={audioInputBusy() ? "listening" : "stopped"} ariaLabel="Microphone input level" />
                    </Show>
                    <Show when={audioInputBusy() && audioInputSignalDetected()}><div class="voice-input-live-state" role="status">Signal detected · listening until you stop.</div></Show>
                    <Show when={audioInputStatus() === "error" && !audioInputError()}><p role="alert" class="settings-inline-error">Microphone list could not be loaded.</p></Show>
                    <Show when={audioInputTest()}>{(result) => <div class="voice-input-result" data-signal={result().signalDetected ? "detected" : "missing"}><strong>{result().signalDetected ? "Signal detected" : "No signal detected"}</strong><small>{result().label} · {result().sampleRate.toLocaleString()} Hz · peak {result().peak.toFixed(3)}</small></div>}</Show>
                    <Show when={audioInputTest()?.recording}>
                      <div class="voice-input-playback">
                        <span>Test recording kept in browser memory.</span>
                        <div class="voice-actions">
                          <Button variant="outline" size="sm" disabled={audioInputPlayback()} onClick={() => void playAudioInputTest()}>{audioInputPlayback() ? "Playing test recording…" : "Play test recording"}</Button>
                          <Button variant="outline" size="sm" disabled={!audioInputPlayback()} onClick={stopAudioInputPlayback}>Stop playback</Button>
                        </div>
                      </div>
                    </Show>
                    <Show when={audioInputTest()?.recordingError}><p role="status" class="voice-input-playback-error">{audioInputTest()?.recordingError}</p></Show>
                    <Show when={audioInputError()}><p role="alert" class="settings-inline-error">{audioInputError()}</p></Show>
                  </div>
                  <Field><FieldLabel for="dictation-shortcut">Dictation shortcut</FieldLabel><Input id="dictation-shortcut" value={voiceDraft().shortcut} readOnly onKeyDown={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    const shortcut = shortcutFromKeyboardEvent(event);
                    if (shortcut) updateVoiceDraft({ shortcut });
                  }} /><small>Focus the field and press a shortcut. The microphone button remains a start/stop toggle.</small></Field>
                  <Field><FieldLabel for="dictation-activation">Activation behaviour</FieldLabel><select id="dictation-activation" value={voiceDraft().activation} onChange={(event) => updateVoiceDraft({ activation: event.currentTarget.value as "push_to_talk" | "toggle" })}>
                    <option value="push_to_talk">Push to talk (hold)</option>
                    <option value="toggle">Toggle (press)</option>
                  </select><small>{voiceDraft().activation === "toggle" ? "Press the shortcut once to start and again to stop." : "Hold the shortcut while you speak. Release it to stop."}</small></Field>
                  <label class="dictation-auto-send"><input type="checkbox" checked={voiceDraft().autoSend} onChange={(event) => updateVoiceDraft({ autoSend: event.currentTarget.checked })} /><span><strong>Auto-send timely final dictation</strong><small>Off by default. Conduit only submits a server-confirmed final transcript settled within one second.</small></span></label>
                  <label class="dictation-auto-send"><input id="voice-warm-microphone" type="checkbox" checked={voiceDraft().warmMicrophone} onChange={(event) => updateVoiceDraft({ warmMicrophone: event.currentTarget.checked })} /><span><strong>Keep microphone warm between dictations</strong><small>Off by default. When enabled, Chrome keeps the microphone active after a dictation so the next one can start faster. Save this setting before use.</small></span></label>
                  <Show when={warmMicrophoneActive()} fallback={<Show when={voiceDraft().warmMicrophone}><p class="voice-input-live-state" role="status">Warm microphone retention is enabled for the next dictation.</p></Show>}>
                    <div class="voice-input-live-state" role="status">Microphone remains active between dictations.<Button variant="outline" size="sm" onClick={stopWarmMicrophone}>Stop warm microphone</Button></div>
                  </Show>
                  </FieldGroup>
                </details>

                <div class="voice-settings-footer"><Button disabled={voiceBusy()} onClick={() => void saveVoiceSettings()}>{voiceBusy() ? <Spinner /> : null}Save Voice settings</Button><span class="voice-draft-state" data-dirty={voiceDirty()}>{voiceDirty() ? "Unsaved changes" : "All voice settings saved"}</span><Show when={voiceSettingsSaved()}><span class="voice-save-success" role="status">Saved</span></Show></div>
                <Show when={voiceTestResult()}><p role="status" class="voice-test-success">{voiceTestResult()}</p></Show>
                <Show when={voiceError()}><p role="alert" class="settings-inline-error">{voiceError()}</p></Show>
              </div>
            </Show>
          </Show>
          <Show when={section() === "search"}>
            <Show when={searchStatus() === "ready" && searchSettings()} fallback={<Show when={searchStatus() === "error"} fallback={<div class="settings-loading"><Spinner /><span>Loading search settings…</span></div>}><div role="alert" class="settings-error"><span>{searchError() || "Search settings could not be loaded."}</span><Button variant="outline" size="sm" onClick={() => void loadSearchSettings()}>Retry</Button></div></Show>}>
              <div class="search-settings">
                <p class="search-settings-intro">Conduit uses OpenAI or Codex native search when the active provider supports it, then falls back to configured web providers. Search runs without Pi’s curator window.</p>
                <FieldGroup>
                  <Field>
                    <FieldLabel for="brave-search-api-key">Brave Search API key</FieldLabel>
                    <Input id="brave-search-api-key" type="password" autocomplete="off" value={searchKey()} onInput={(event) => setSearchKey(event.currentTarget.value)} placeholder={searchSettings()!.providers.find((provider) => provider.id === "brave")?.configured ? "A key is already configured" : "BSA_…"} onKeyDown={(event) => { if (event.key === "Enter") void saveSearchKey(); }} />
                    <small>The key stays on this server in the Conduit-owned Pi configuration. It is never returned to the browser.</small>
                  </Field>
                  <div class="search-provider-actions">
                    <span class="search-provider-status" data-configured={searchSettings()!.providers.find((provider) => provider.id === "brave")?.configured}>{searchSettings()!.providers.find((provider) => provider.id === "brave")?.source === "environment" ? "Using BRAVE_API_KEY from the server environment" : searchSettings()!.providers.find((provider) => provider.id === "brave")?.stored ? "Stored key active" : "No Brave key configured"}</span>
                    <div><Button disabled={searchSaving() || !searchKey().trim()} onClick={() => void saveSearchKey()}>{searchSaving() ? <Spinner /> : null}Save key</Button><Show when={searchSettings()!.providers.find((provider) => provider.id === "brave")?.removable}><Button variant="outline" disabled={searchSaving()} onClick={() => void removeSearchKey()}>Remove stored key</Button></Show></div>
                  </div>
                </FieldGroup>
                <Show when={searchError()}><p role="alert" class="settings-inline-error">{searchError()}</p></Show>
                <div class="search-provider-list"><For each={searchSettings()!.providers.filter((provider) => !provider.enabled)}>{(provider) => <article class="search-provider-card" data-disabled="true"><div><h3>{provider.label}<span>Coming later</span></h3><p>{provider.description}</p><a href={provider.docsUrl} target="_blank" rel="noreferrer">Provider documentation</a></div><Input type="password" disabled placeholder="Configuration not enabled yet" aria-label={`${provider.label} API key`} /></article>}</For></div>
              </div>
            </Show>
          </Show>
          <Show when={section() === "auth"}>
            <div class="pi-auth-panel">
              <p>Credentials are stored only in the Isolated Pi runtime. Host Pi accounts and environment credentials are never exposed or changed here.</p>
              <Show when={authUnavailable()}><p role="alert" class="settings-inline-error">Set a Conduit password with <code>node scripts/conduit-auth.mjs set-password</code>, then sign in to manage Pi credentials here.</p></Show>
              <Show when={authError() && !authUnavailable()}><p role="alert" class="settings-inline-error">{authError()}</p></Show>
              <Show when={!authUnavailable() && authLoading() && !authProviders().length} fallback={<Show when={!authUnavailable()}>
                <FieldGroup>
                  <Field><FieldLabel for="pi-auth-provider">Provider</FieldLabel><select id="pi-auth-provider" aria-label="Pi authentication provider" value={authProviderId()} onChange={(event) => setAuthProviderId(event.currentTarget.value)}><For each={authProviders()}>{(provider) => <option value={provider.id}>{provider.label}</option>}</For></select></Field>
                  <Show when={authProviders().find((provider) => provider.id === authProviderId())?.oauth}><Button disabled={authLoading() || Boolean(authAttempt()?.active)} onClick={() => void startOAuth()}>{authLoading() ? <Spinner /> : null}Sign in with browser</Button></Show>
                  <Field><FieldLabel for="pi-api-key">API key</FieldLabel><Input id="pi-api-key" type="password" autocomplete="off" value={apiKey()} onInput={(event) => setApiKey(event.currentTarget.value)} placeholder="Stored in Isolated Pi only" /></Field>
                  <Button variant="outline" disabled={authLoading() || !apiKey()} onClick={() => void saveApiKey()}>{authLoading() ? <Spinner /> : null}Save API key</Button>
                </FieldGroup>
                <Show when={authAttempt()?.owned}>
                  <article class="pi-auth-attempt"><h3>{authAttempt()!.providerLabel}</h3><p>{authAttempt()!.message}</p>
                    <Show when={authAttempt()!.authUrl}><a href={authAttempt()!.authUrl!} target="_blank" rel="noreferrer">Open provider sign-in</a><p>{authAttempt()!.instructions}</p></Show>
                    <Show when={authAttempt()!.deviceCode}><p>Code: <code>{authAttempt()!.deviceCode!.userCode}</code></p><a href={authAttempt()!.deviceCode!.verificationUri} target="_blank" rel="noreferrer">Open verification page</a></Show>
                    <Show when={authAttempt()!.prompt?.type === "select"}><p>{authAttempt()!.prompt!.message}</p><div class="pi-auth-options"><For each={authAttempt()!.prompt!.options || []}>{(option) => <Button variant="outline" disabled={authLoading()} onClick={() => void answerAuthPrompt(option.id)}>{option.label}</Button>}</For></div></Show>
                    <Show when={authAttempt()!.prompt && authAttempt()!.prompt!.type !== "select"}><Field><FieldLabel for="pi-auth-response">{authAttempt()!.prompt!.message}</FieldLabel><div class="pi-auth-response"><Input id="pi-auth-response" type="text" autocomplete="off" value={authResponse()} onInput={(event) => setAuthResponse(event.currentTarget.value)} placeholder={authAttempt()!.prompt!.placeholder || ""} onKeyDown={(event) => { if (event.key === "Enter") void answerAuthPrompt(authResponse()); }} /><Button disabled={authLoading() || !authResponse().trim()} onClick={() => void answerAuthPrompt(authResponse())}>Continue</Button></div></Field></Show>
                    <Show when={authAttempt()!.error}><p role="alert" class="settings-inline-error">{authAttempt()!.error}</p></Show>
                    <Show when={authAttempt()!.active}><Button variant="ghost" onClick={() => void cancelOAuth()}>Cancel sign-in</Button></Show>
                  </article>
                </Show>
                <div class="settings-cards"><For each={authProviders().filter((provider) => provider.auth.configured)}>{(provider) => <article><h3>{provider.label}</h3><p>{provider.auth.source === "stored" ? "Credential stored in Isolated Pi" : provider.auth.source === "environment" ? "Credential available from the server environment" : "Credential managed by Pi configuration"}</p><Show when={provider.auth.removable}><Button variant="outline" size="sm" disabled={authLoading()} onClick={() => void removePiAuth(provider.id)}>Remove credential</Button></Show></article>}</For></div>
              </Show>}><div class="settings-loading"><Spinner /><span>Loading Pi authentication…</span></div></Show>
            </div>
          </Show>
        </main>
      </div>
    </KDialog.Content></KDialog.Portal>
  </KDialog.Root>;
}
