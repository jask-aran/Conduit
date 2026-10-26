import { Icons } from "@/components/ui";
import { createDecisionScope } from "@/components/decision-dialog";
import { createEffect, createMemo, createSignal, For, lazy, on, onCleanup, onMount, Show } from "solid-js";
import { BotIcon, LaptopIcon, Mic2Icon } from "lucide-solid";
import { CloudIcon, HandIcon, MicOffIcon, RepeatIcon } from "lucide-solid";
import { AboutSettingsFooter } from "./about-settings";
import { DesktopSettingsTile } from "./desktop-settings";
import { DevicesSettingsTile } from "./devices-settings";
import { toast } from "@/components/notifications";
import { api, readShared } from "../api/client";
import { MARKDOWN_RENDERER_OPTIONS, type MarkdownRendererId } from "../chat/markdown-settings";
import { formatMicrophoneError, hasAudioSignal, rematchInputDevice, isUnavailableAudioInputError, listAudioInputDevices, MAX_AUDIO_INPUT_TEST_DURATION_MS, revokeAudioInputRecording, startAudioInputTest as beginAudioInputTest, type AudioInputDevice, type AudioInputTestResult, type AudioInputTestSession, } from "../chat/voice-audio";
import { shortcutFromKeyboardEvent } from "../chat/voice-dictation";
import type { VoiceDictationSettings } from "../chat/voice-dictation-types";
import { isWarmMicrophoneActive, stopWarmMicrophone } from "../chat/voice-dictation-client";
import { createVoiceWaveformController } from "../chat/voice-waveform";
import { VoiceWaveform } from "@/components/ui/voice";
import { ModelSelector } from "../chat/model-selector";
import { saveTabFrost, tabFrost } from "../preferences/tab-frost";
import { saveTranscriptFont, TRANSCRIPT_FONT_OPTIONS, transcriptFont, type TranscriptFont } from "../preferences/transcript-font";
import { saveTerminalFont, TERMINAL_FONT_OPTIONS, terminalFont, type TerminalFont } from "../preferences/terminal-font";
import { saveStreamFade, saveStreamMathFade, STREAM_FADE_OPTIONS, streamFadeMs, streamMathFade } from "../preferences/stream-fade";
import type { Project, Template, VoiceExecutionCatalogueView, VoiceExecutionProfile, VoiceLocalSelection, VoiceServerSettings } from "../api/contracts";
import type { ModelSettings } from "../state/model-settings";
import { MAX_SIDEBAR_CHAT_LIMIT, MIN_SIDEBAR_CHAT_LIMIT } from "../navigation/sidebar-preferences";
import type { ShortcutManager } from "../shortcuts/shortcut-manager";
import { parseUiScale, UI_SCALE_OPTIONS, type UiScale } from "../preferences/ui-scale";
import {
  CODE_BLOCK_COLLAPSE_LINE_CHOICES,
  CODE_BLOCK_COLLAPSE_OPTIONS,
  CODE_BLOCK_WIDTH_OPTIONS,
  type CodeBlockWidthMode,
  PANEL_MOTION_OPTIONS,
  type PanelMotionMode,
  TRANSCRIPT_WIDE_BLOCKS_OPTIONS,
  TRANSCRIPT_WIDTH_OPTIONS,
  USER_MESSAGE_COLLAPSE_OPTIONS,
  type UserMessageCollapseMode,
  type TranscriptWideBlocksMode,
  type TranscriptWidthMode,
} from "../chat/transcript-appearance";
import type { CodeBlockCollapseMode } from "../chat/code-block";
import { ShortcutsSettings } from "./shortcuts-settings";
import { Button, Input, TextArea, Spinner, Segmented, Switch } from "@/components/ui/controls";
import { Select } from "@/components/menus";
import { combineSaveStates, createAutosave, type SaveState } from "./autosave";
import { OverlayDialog } from "@/components/dialog";
import { NavGroup, NavRow, OverlayPage, OverlayRail, SettingGroup, SettingLine, SettingValue, SettingLink, SettingNote, SettingDetails, SettingWide, SettingLoading } from "@/components/ui";
import { isMobileLayout } from "../navigation/mobile-layout";
import { uiPreferenceSaves } from "../preferences/ui-preferences";

const sectionGroups = [
  { label: "Personal", sections: [{ id: "ui", label: "Appearance", icon: Icons.Monitor }, { id: "shortcuts", label: "Shortcuts", icon: Icons.Keyboard }] },
  { label: "AI", sections: [{ id: "models", label: "Models & accounts", icon: BotIcon }, { id: "prompts", label: "Prompts", icon: Icons.FileText }] },
  { label: "System", sections: [{ id: "runtime", label: "Runtime", icon: Icons.Runtime }, { id: "devices", label: "Devices", icon: LaptopIcon }] },
  { label: "Services", sections: [{ id: "voice", label: "Voice", icon: Mic2Icon }, { id: "search", label: "Web search", icon: Icons.Search }] },
] as const;
type VisibleSection = typeof sectionGroups[number]["sections"][number]["id"];
type Section = VisibleSection | "workspaces";
const sectionLabels: Record<Section, string> = {
  ui: "Appearance",
  shortcuts: "Shortcuts",
  models: "Models & accounts",
  prompts: "Prompts",
  runtime: "Runtime",
  devices: "Devices",
  workspaces: "Workspace profile",
  voice: "Voice",
  search: "Web search",
};
const label = (section: Section) => sectionLabels[section];
interface RuntimeSettings {
  maxLiveProcesses: number;
  maxGeneratingProcesses: number;
  liveCount?: number;
  generatingCount?: number;
}

interface GeneralPreferences {
  defaultTemplateId: string;
  sessionNameModel: string;
  sessionNameThinkingLevel: string;
}

interface EditablePrompt {
  id: string;
  label: string;
  kind: "profile" | "service";
  content: string;
  modified: boolean;
}

interface PiAuthProvider {
  id: string;
  label: string;
  oauth: boolean;
  usesCallbackServer: boolean;
  /** What its key goes with (Cloudflare's account ID), asked for beside it. */
  fields?: Array<{ name: string; label: string }>;
  /** kind: a stored credential's, a sign-in or a key. */
  auth: { configured: boolean; source: "stored" | "environment" | "managed" | null; kind?: "oauth" | "key" | null; removable: boolean };
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

interface ChatGptWebStatus {
  auth: "configured" | "missing";
  cookieNames: string[];
  curlCffiVersion: string;
  impersonate: string;
}

interface SearchProvider {
  id: string;
  label: string;
  description: string;
  docsUrl: string;
  /** How it can search now: its own key (stored, or the server's environment), the hub's sign-in, or no key at all. */
  source: "stored" | "environment" | "sign-in" | "keyless" | null;
  ready: boolean;
  stored: boolean;
  removable: boolean;
}

type SearchTool = "webSearch" | "fetchContent" | "sourceCheck" | "getSearchContent";
type SearchFetching = "github" | "video" | "pdf" | "extract";
interface SearchSettings {
  workflow: "none" | "managed";
  /** timeoutMs: a routed search's whole time (null: none); offTopic: answers judged off-topic go on down the route. */
  route: { first: string; fallback: boolean; useCurrentModel: boolean; timeoutMs: number | null; offTopic: boolean };
  tools: Record<SearchTool, boolean>;
  fetching: Record<SearchFetching, boolean>;
  /** Whether Pi can call Cloudflare Workers AI, which extract mode and the off-topic check run on. */
  cloudflare: boolean;
  providers: SearchProvider[];
}
type SearchEdit = { route?: Partial<SearchSettings["route"]>; tools?: Partial<SearchSettings["tools"]>; fetching?: Partial<SearchSettings["fetching"]> };

const SEARCH_SOURCE_LABELS: Record<NonNullable<SearchProvider["source"]>, string> = {
  stored: "key stored", environment: "key from the server", "sign-in": "ChatGPT sign-in", keyless: "no key needed",
};
const SEARCH_TOOLS: Array<{ key: SearchTool; label: string; title: string }> = [
  { key: "webSearch", label: "Search the web", title: "web_search: searches with the providers below and keeps the results for paging." },
  { key: "fetchContent", label: "Read pages", title: "fetch_content: reads a page, PDF, video or repository by its address." },
  { key: "sourceCheck", label: "Check sources", title: "source_check: gathers sources for a claim with passage-level citations." },
  { key: "getSearchContent", label: "Page stored results", title: "get_search_content: pages through a search's or a fetch's full stored results." },
];
const SEARCH_FETCHING: Array<{ key: SearchFetching; label: string; title: string }> = [
  { key: "github", label: "GitHub repositories", title: "Clones a repository to read its files, instead of scraping its pages." },
  { key: "video", label: "YouTube and video", title: "Transcripts, what is on screen and frames, for YouTube and local video files." },
  { key: "pdf", label: "PDFs", title: "Reads a PDF's text instead of returning the file." },
];
const ACCOUNT_SOURCES: Record<NonNullable<PiAuthProvider["auth"]["source"]> | "none", string> = {
  stored: "connected", environment: "key from the server", managed: "agent settings", none: "not connected",
};
const SEARCH_TIME_LIMITS: Array<{ ms: number | null; label: string }> = [
  { ms: null, label: "None" }, { ms: 15_000, label: "15 s" }, { ms: 30_000, label: "30 s" }, { ms: 60_000, label: "1 min" }, { ms: 120_000, label: "2 min" },
];
const CLOUDFLARE_NEEDED = "Needs a Cloudflare Workers AI key and account ID: add them under Providers below.";

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
// The runtime fields as typed, checked against the ranges the server keeps
// them in (runtime-settings.js), which it would otherwise clamp to silently.
type RuntimeDraft = { live: string; generating: string };
const RUNTIME_LIMITS = { live: [1, 32], generating: [1, 8] } as const;
const runtimeDraftOf = (settings: RuntimeSettings): RuntimeDraft => ({
  live: String(settings.maxLiveProcesses),
  generating: String(settings.maxGeneratingProcesses),
});
const runtimeFieldError = (draft: RuntimeDraft, field: keyof RuntimeDraft) => {
  const [min, max] = RUNTIME_LIMITS[field];
  const text = draft[field].trim();
  const value = Number(text);
  return text && Number.isInteger(value) && value >= min && value <= max ? "" : `A whole number from ${min} to ${max}`;
};
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
  /** False when Settings was opened without naming a section. */
  sectionWasNamed?: boolean;
  initialWorkspaceId?: string | null;
  onOpenChange: (open: boolean) => void;
  models: ModelSettings;
  templates: Template[];
  templatesLoading: boolean;
  defaultTemplateId: string;
  projects: Project[];
  onDefaultTemplateChange: (id: string) => Promise<unknown>;
  onWorkspaceDefaultChange: (id: string, templateId: string | null) => Promise<Project>;
  markdownRenderer: MarkdownRendererId;
  onMarkdownRendererChange: (renderer: MarkdownRendererId) => void;
  meteorField: boolean;
  onMeteorFieldChange: (enabled: boolean) => void;
  transcriptWidth: TranscriptWidthMode;
  onTranscriptWidthChange: (mode: TranscriptWidthMode) => void;
  transcriptWideBlocks: TranscriptWideBlocksMode;
  onTranscriptWideBlocksChange: (mode: TranscriptWideBlocksMode) => void;
  codeBlockCollapse: CodeBlockCollapseMode;
  onCodeBlockCollapseChange: (mode: CodeBlockCollapseMode) => void;
  codeBlockCollapseLines: number;
  onCodeBlockCollapseLinesChange: (lines: number) => void;
  codeBlockWidth: CodeBlockWidthMode;
  onCodeBlockWidthChange: (mode: CodeBlockWidthMode) => void;
  panelMotion: PanelMotionMode;
  onPanelMotionChange: (mode: PanelMotionMode) => void;
  userMessageCollapse: UserMessageCollapseMode;
  onUserMessageCollapseChange: (mode: UserMessageCollapseMode) => void;
  interfaceScale: UiScale;
  onInterfaceScaleChange: (scale: UiScale) => void;
  voiceSettings: VoiceDictationSettings;
  onVoiceSettingsSave: (settings: VoiceDictationSettings) => void;
  sidebarChatLimit: number;
  onSidebarChatLimitChange: (limit: number) => void;
  onOpenModelSelector: () => void;
  /** Adds a folder a paired device shares as a workspace (Devices). */
  onAddWorkspace: (input: { mode: "node"; nodeId: string; rootId: string }) => Promise<boolean>;
  onOpenDeviceTerminal: (node: { id: string; local?: boolean }) => void;
  /** A workspace from its device's list: Settings closes and the workspace opens. */
  onOpenWorkspace: (project: Project) => void;
  shortcuts: ShortcutManager;
}) {
  const { confirm: confirmDialog } = createDecisionScope(() => props.open ? promptId() : null);
  const [section, setSection] = createSignal<Section>(props.initialSection || "ui");
  const [frosted, setFrosted] = createSignal(tabFrost());
  const [transcriptFontChoice, setTranscriptFontChoice] = createSignal(transcriptFont());
  const [terminalFontChoice, setTerminalFontChoice] = createSignal(terminalFont());
  const [fadeMs, setFadeMs] = createSignal(streamFadeMs());
  /*
   * On a phone, Settings is two screens rather than a rail beside a pane.
   *
   * The rail was 190px of labelled rows on a desktop and 82px of unlabelled
   * icons on a phone, which is the same information with the part that said
   * what it meant removed. There is no room for both a list and what it opens,
   * so they take turns: the list, then the section, with a way back.
   */
  const [browsingSections, setBrowsingSections] = createSignal(true);
  const narrow = isMobileLayout;
  // On a phone the rail and a section take turns, so focus follows: into the section's title, and back to its row.
  const openSection = (id: Section) => {
    setSection(id);
    setBrowsingSections(false);
    if (narrow()) queueMicrotask(() => document.querySelector<HTMLElement>('[role="dialog"][aria-label="Settings"] main h2')?.focus());
  };
  const backToSections = () => {
    setBrowsingSections(true);
    queueMicrotask(() => document.querySelector<HTMLElement>('[role="dialog"][aria-label="Settings"] [role="tab"][aria-selected="true"]')?.focus());
  };
  /** The list is a screen of its own only when there is no room for both. */
  const showingIndex = () => narrow() && browsingSections();
  const [runtime, setRuntime] = createSignal<RuntimeSettings | null>(null);
  const [runtimeDraft, setRuntimeDraft] = createSignal<RuntimeDraft>({ live: "", generating: "" });
  const [runtimeStatus, setRuntimeStatus] = createSignal<"idle" | "loading" | "ready" | "error">("idle");
  const [runtimeError, setRuntimeError] = createSignal("");
  const runtimeAutosave = createAutosave<RuntimeSettings>({
    save: (value) => api<RuntimeSettings>("/v0/runtime/settings", { method: "PATCH", body: JSON.stringify(value) }),
    onSaved: (saved) => { setRuntime(saved); setRuntimeDraft(runtimeDraftOf(saved)); },
  });
  const [sessionNameModel, setSessionNameModel] = createSignal("");
  const [sessionNameThinkingLevel, setSessionNameThinkingLevel] = createSignal("off");
  const [generalLoading, setGeneralLoading] = createSignal(false);
  const namingAutosave = createAutosave<Pick<GeneralPreferences, "sessionNameModel" | "sessionNameThinkingLevel">>({
    save: (value) => api<GeneralPreferences>("/v0/preferences", { method: "PATCH", body: JSON.stringify(value) }),
    onSaved: (saved) => { setSessionNameModel(saved.sessionNameModel); setSessionNameThinkingLevel(saved.sessionNameThinkingLevel); },
  });
  const defaultProfileAutosave = createAutosave<string>({
    save: async (id) => { await props.onDefaultTemplateChange(id); return id; },
    onSaved: () => {},
  });
  const [prompts, setPrompts] = createSignal<EditablePrompt[]>([]);
  const [promptId, setPromptId] = createSignal("");
  const [promptDraft, setPromptDraft] = createSignal("");
  const [promptBaseline, setPromptBaseline] = createSignal("");
  const [promptStatus, setPromptStatus] = createSignal<"idle" | "loading" | "ready" | "error">("idle");
  const [promptSaving, setPromptSaving] = createSignal(false);
  const promptAutosave = createAutosave<{ id: string; content: string }>({
    save: async (value) => (await api<EditablePrompt>(`/v0/prompts/${encodeURIComponent(value.id)}`, { method: "PUT", body: JSON.stringify({ content: value.content }) })),
    onSaved: (saved) => {
      const prompt = saved as EditablePrompt;
      setPrompts((items) => items.map((item) => item.id === prompt.id ? prompt : item));
      if (prompt.id === promptId()) { setPromptDraft(prompt.content); setPromptBaseline(prompt.content); }
    },
    delayMs: 800,
  });
  const [promptError, setPromptError] = createSignal("");
  const [workspaceId, setWorkspaceId] = createSignal<string | null>(null);
  const [authProviders, setAuthProviders] = createSignal<PiAuthProvider[]>([]);
  const [authAttempt, setAuthAttempt] = createSignal<PiAuthAttempt | null>(null);
  // The provider chosen to add (not connected yet), and the one whose key form is open.
  const [addingAccount, setAddingAccount] = createSignal("");
  const [accountKeyFor, setAccountKeyFor] = createSignal("");
  const [apiKey, setApiKey] = createSignal("");
  const [apiKeyFields, setApiKeyFields] = createSignal<Record<string, string>>({});
  const [authResponse, setAuthResponse] = createSignal("");
  const [authLoading, setAuthLoading] = createSignal(false);
  const [authError, setAuthError] = createSignal("");
  const [authUnavailable, setAuthUnavailable] = createSignal(false);
  const [chatGptStatus, setChatGptStatus] = createSignal<ChatGptWebStatus | null>(null);
  const [chatGptCookie, setChatGptCookie] = createSignal("");
  const [chatGptBusy, setChatGptBusy] = createSignal(false);
  const [chatGptError, setChatGptError] = createSignal("");
  const [searchSettings, setSearchSettings] = createSignal<SearchSettings | null>(null);
  const [searchStatus, setSearchStatus] = createSignal<"idle" | "loading" | "ready" | "error">("idle");
  const [searchError, setSearchError] = createSignal("");
  // A provider's key being entered, in its row; one row at a time.
  const [keyFor, setKeyFor] = createSignal<string | null>(null);
  const [searchKey, setSearchKey] = createSignal("");
  const [searchSaving, setSearchSaving] = createSignal(false);
  // Each answer is the whole page; only the latest edit's is shown, so an
  // older answer never undoes a toggle made since.
  let searchSaved: SearchSettings | null = null;
  const searchAutosave = createAutosave<SearchEdit>({
    save: async (edit) => { searchSaved = await api<SearchSettings>("/v0/search/settings", { method: "PATCH", body: JSON.stringify(edit) }); return edit; },
    onSaved: () => { if (searchSaved) setSearchSettings(searchSaved); },
  });
  const [voiceServerSettings, setVoiceServerSettings] = createSignal<VoiceServerSettings | null>(null);
  const [voiceStatus, setVoiceStatus] = createSignal<"idle" | "loading" | "ready" | "error">("idle");
  const [voiceError, setVoiceError] = createSignal("");
  const [voiceSecret, setVoiceSecret] = createSignal("");
  const [voiceBusy, setVoiceBusy] = createSignal(false);
  const [voiceLicenseAccepted, setVoiceLicenseAccepted] = createSignal(false);
  const [voiceTestResult, setVoiceTestResult] = createSignal("");
  const [voiceDraft, setVoiceDraft] = createSignal<VoiceDictationSettings>({ ...props.voiceSettings });
  const [warmMicrophoneActive, setWarmMicrophoneActive] = createSignal(isWarmMicrophoneActive());
  const [voiceServerEdited, setVoiceServerEdited] = createSignal(false);
  const voiceAutosave = createAutosave<VoiceServerSettings>({
    save: (settings) => persistVoiceServer(settings),
    onSaved: (saved) => { setVoiceServerSettings(saved); setVoiceServerEdited(false); },
  });
  const voiceDraftAutosave = createAutosave<VoiceDictationSettings>({
    save: async (settings) => { props.onVoiceSettingsSave(settings); return settings; },
    onSaved: () => {},
  });
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
  let voiceInputSelect!: HTMLSelectElement;
  let returnFocus: HTMLElement | null = null;
  let wasOpen = false;
  let voiceLoadRequest = 0;
  let voiceSettingsGeneration = 0;
  let voiceSaveInFlight = 0;
  let authProvidersLoaded = false;
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
  const dismissEscape = (event: KeyboardEvent) => {
    if (event.key !== "Escape") return;
    const target = event.target instanceof Element ? event.target : null;
    if (target && !target.closest('[role="dialog"][aria-label="Settings"]')) return;
    if (props.shortcuts.isContextActive("shortcut-recorder")) {
      event.preventDefault();
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    // A key being entered in its row: Escape puts the row back, Settings stays.
    if (keyFor() && target?.closest('[id^="search-key-"]')) return closeKey();
    props.onOpenChange(false);
  };
  const navigateSettingsTabs = (event: KeyboardEvent) => {
    if (!["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
    const nav = event.currentTarget instanceof HTMLElement ? event.currentTarget.closest("nav") : null;
    const tabs = nav ? Array.from(nav.querySelectorAll<HTMLButtonElement>('[role="tab"]')) : [];
    const current = event.currentTarget instanceof HTMLButtonElement ? tabs.indexOf(event.currentTarget) : -1;
    if (current < 0 || !tabs.length) return;
    event.preventDefault();
    const index = event.key === "Home" ? 0
      : event.key === "End" ? tabs.length - 1
        : (current + (event.key === "ArrowDown" ? 1 : -1) + tabs.length) % tabs.length;
    // Beside its page the rail switches sections as it moves; as a phone's screen of its own it is a list to choose from.
    if (!narrow()) tabs[index]?.click();
    tabs[index]?.focus();
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
      audioInputWaveform.reset();
      clearAudioInputTest();
      setAudioInputSignalDetected(false);
      return;
    }
    setVoiceDraft({ ...props.voiceSettings });
    const initial = props.initialSection || "ui";
    setSection(initial);
    // Asked for a section by name -- from a command, or a link out of the app
    // -- so that is what was wanted, not a list with it somewhere in it.
    setBrowsingSections(!props.sectionWasNamed);
    setWorkspaceId(props.initialWorkspaceId || props.projects.find((project) => project.kind === "workspace" || ["linked", "created", "cloned"].includes(project.origin || ""))?.id || null);
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

  const loadRuntime = async () => {
    const request = ++runtimeRequest;
    setRuntimeStatus("loading");
    setRuntimeError("");
    try {
      // A save sent on leaving lands first, so coming back shows it.
      await runtimeAutosave.flush();
      const loaded = await api<RuntimeSettings>("/v0/runtime/settings");
      if (request !== runtimeRequest) return;
      setRuntime(loaded);
      if (!runtimeAutosave.busy()) setRuntimeDraft(runtimeDraftOf(loaded));
      setRuntimeStatus("ready");
    } catch (error) {
      if (request !== runtimeRequest) return;
      setRuntimeError((error as Error).message);
      setRuntimeStatus("error");
    }
  };
  createEffect(() => { if (props.open && section() === "runtime") void loadRuntime(); });

  const choosePrompt = (id: string, items = prompts()) => {
    if (id !== promptId()) void promptAutosave.flush();
    const selected = items.find((item) => item.id === id) || items[0];
    if (!selected) return;
    setPromptId(selected.id);
    setPromptDraft(selected.content);
    setPromptBaseline(selected.content);
  };
  const loadPrompts = async () => {
    setPromptStatus("loading");
    setPromptError("");
    try {
      await promptAutosave.flush();
      const result = await api<{ prompts: EditablePrompt[] }>("/v0/prompts");
      setPrompts(result.prompts);
      choosePrompt(promptId(), result.prompts);
      setPromptStatus("ready");
    } catch (error) {
      setPromptError((error as Error).message);
      setPromptStatus("error");
    }
  };
  createEffect(() => { if (props.open && section() === "prompts") void loadPrompts(); });
  // An empty prompt is held back rather than saved.
  const editPrompt = (content: string) => {
    setPromptDraft(content);
    if (!promptId()) return;
    if (!content.trim()) return promptAutosave.hold();
    promptAutosave.edit({ id: promptId(), content });
  };
  const resetPrompt = async () => {
    const current = prompts().find((item) => item.id === promptId());
    if (!current) return;
    if (!current.modified && promptDraft() === promptBaseline()) return;
    if (!(await confirmDialog(`Reset ${current.label} to its shipped default?`))) return;
    promptAutosave.hold();
    setPromptSaving(true);
    setPromptError("");
    try {
      await promptAutosave.flush();
      const reset = await api<EditablePrompt>(`/v0/prompts/${encodeURIComponent(current.id)}`, { method: "DELETE" });
      setPrompts((items) => items.map((item) => item.id === reset.id ? reset : item));
      setPromptDraft(reset.content);
      setPromptBaseline(reset.content);
      toast.success(`${reset.label} prompt reset`);
    } catch (error) { setPromptError((error as Error).message); }
    finally { setPromptSaving(false); }
  };

  const applyAuthProviders = (next: PiAuthProvider[]) => {
    const configured = (providers: PiAuthProvider[]) => providers
      .filter((provider) => provider.auth.configured)
      .map((provider) => provider.id)
      .sort()
      .join("\n");
    const changed = authProvidersLoaded && configured(authProviders()) !== configured(next);
    setAuthProviders(next);
    authProvidersLoaded = true;
    if (changed) void props.models.reload(undefined, true);
  };
  const loadPiAuth = async () => {
    setAuthLoading(true);
    try {
      const [status, attempt] = await Promise.all([
        api<{ providers: PiAuthProvider[] }>("/v0/pi-auth"),
        api<{ attempt: PiAuthAttempt | null }>("/v0/pi-auth/attempt"),
      ]);
      applyAuthProviders(status.providers);
      setAuthAttempt(attempt.attempt);
      if (status.providers.some((provider) => provider.id === addingAccount() && provider.auth.configured)) setAddingAccount("");
      setAuthError("");
      setAuthUnavailable(false);
    } catch (error) {
      const response = error as Error & { code?: string };
      setAuthUnavailable(response.code === "pi_auth_login_required");
      setAuthError(response.message);
    } finally { setAuthLoading(false); }
  };
  // Search shows Cloudflare Workers AI's account too (its off-topic check and extract mode run on it).
  createEffect(() => { if (props.open && (section() === "models" || section() === "search")) void loadPiAuth(); });
  const loadChatGptStatus = async () => {
    try { setChatGptStatus(await api<ChatGptWebStatus>("/v0/chatgpt-web/status")); setChatGptError(""); }
    catch (error) { setChatGptError((error as Error).message); }
  };
  const saveChatGptCookie = async () => {
    setChatGptBusy(true);
    try {
      setChatGptStatus(await api<ChatGptWebStatus>("/v0/chatgpt-web/credential", { method: "PUT", body: JSON.stringify({ cookie: chatGptCookie() }) }));
      setChatGptCookie("");
      setChatGptError("");
    } catch (error) { setChatGptError((error as Error).message); }
    finally { setChatGptBusy(false); }
  };
  const removeChatGptCookie = async () => {
    setChatGptBusy(true);
    try { setChatGptStatus(await api<ChatGptWebStatus>("/v0/chatgpt-web/credential", { method: "DELETE" })); setChatGptError(""); }
    catch (error) { setChatGptError((error as Error).message); }
    finally { setChatGptBusy(false); }
  };
  createEffect(() => { if (props.open && section() === "models") void loadChatGptStatus(); });
  createEffect(() => {
    if (!props.open || section() !== "models" || !authAttempt()?.active) return;
    const timer = window.setInterval(() => {
      api<{ attempt: PiAuthAttempt | null }>("/v0/pi-auth/attempt")
        .then((result) => {
          setAuthAttempt(result.attempt);
          if (!result.attempt?.active) return api<{ providers: PiAuthProvider[] }>("/v0/pi-auth")
            .then((status) => applyAuthProviders(status.providers));
        })
        .catch((error) => setAuthError((error as Error).message));
    }, 1000);
    onCleanup(() => window.clearInterval(timer));
  });

  const startOAuth = async (providerId: string) => {
    setAuthLoading(true);
    setAuthError("");
    try {
      const result = await api<{ attempt: PiAuthAttempt }>("/v0/pi-auth/oauth", { method: "POST", body: JSON.stringify({ providerId }) });
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
  const openAccountKey = (providerId: string) => { setApiKey(""); setApiKeyFields({}); setAccountKeyFor(providerId); };
  const closeAccountKey = () => { setApiKey(""); setApiKeyFields({}); setAccountKeyFor(""); };
  const saveApiKey = async () => {
    const providerId = accountKeyFor();
    if (!providerId || !apiKey().trim()) return;
    setAuthLoading(true);
    setAuthError("");
    try {
      await api("/v0/pi-auth/api-key", { method: "PUT", body: JSON.stringify({ providerId, key: apiKey(), env: apiKeyFields() }) });
      closeAccountKey();
      await loadPiAuth();
      if (section() === "search") void loadSearchSettings();
    } catch (error) { setAuthError((error as Error).message); }
    finally { setAuthLoading(false); }
  };
  const removePiAuth = async (providerId: string) => {
    setAuthLoading(true);
    try {
      await api(`/v0/pi-auth/${encodeURIComponent(providerId)}`, { method: "DELETE" });
      await loadPiAuth();
      if (section() === "search") void loadSearchSettings();
    }
    catch (error) { setAuthError((error as Error).message); }
    finally { setAuthLoading(false); }
  };
  /**
   * A provider account's line: how it is connected and its own actions (sign in, a key, remove), its key form in
   * place of them while open, the fields that go with the key and a sign-in under way below it. One credential,
   * shown in Models & accounts and, for what search runs on, in Web search.
   */
  const accountLine = (provider: PiAuthProvider, options: { label?: string; title?: string; pending?: boolean } = {}) => {
    const editing = () => accountKeyFor() === provider.id;
    const attempt = () => authAttempt()?.owned && authAttempt()!.providerId === provider.id ? authAttempt()! : null;
    const configured = () => provider.auth.configured;
    const signedIn = () => provider.auth.kind === "oauth";
    const state = () => provider.auth.kind ? (signedIn() ? "signed in" : "key stored") : ACCOUNT_SOURCES[provider.auth.source || "none"];
    return <>
      <SettingLine plain label={options.label || provider.label} title={options.title} state={<>{state()}</>}>
        <Show when={editing()} fallback={<>
          <Show when={provider.oauth && (!configured() || signedIn())}><Button variant="ghost" size="sm" disabled={authLoading() || Boolean(authAttempt()?.active)} onClick={() => void startOAuth(provider.id)}>{signedIn() ? "Sign in again" : "Sign in"}</Button></Show>
          <Show when={provider.auth.source !== "environment" && !signedIn()}><Button variant="ghost" size="sm" disabled={authLoading()} onClick={() => openAccountKey(provider.id)}>{provider.auth.removable ? "Replace" : provider.oauth ? "Use a key" : "Add key"}</Button></Show>
          <Show when={provider.auth.removable}><Button variant="ghost" size="sm" disabled={authLoading()} onClick={() => void removePiAuth(provider.id)}>Remove</Button></Show>
          <Show when={options.pending}><Button variant="ghost" size="sm" onClick={() => setAddingAccount("")}>Cancel</Button></Show>
        </>}>
          <Input id={`pi-api-key-${provider.id}`} aria-label={`${provider.label} API key`} type="password" autocomplete="new-password" data-1p-ignore data-lpignore="true" data-bwignore
            ref={(element: HTMLInputElement) => queueMicrotask(() => element.focus())}
            value={apiKey()} onInput={(event) => setApiKey(event.currentTarget.value)} placeholder="API key"
            onKeyDown={(event) => { if (event.key === "Enter") void saveApiKey(); if (event.key === "Escape") { event.stopPropagation(); closeAccountKey(); } }} />
          <Button size="sm" disabled={authLoading() || !apiKey().trim()} onClick={() => void saveApiKey()}>{authLoading() ? <Spinner /> : null}Save</Button>
          <Button variant="ghost" size="sm" disabled={authLoading()} onClick={closeAccountKey}>Cancel</Button>
        </Show>
      </SettingLine>
      <Show when={editing()}><For each={provider.fields || []}>{(field) =>
        <SettingLine plain label={field.label} title={`${field.name}, stored with the key. Left empty, the one stored before stays, or the server's own ${field.name} is used.`}>
          <Input id={`pi-api-key-${provider.id}-${field.name}`} aria-label={`${provider.label} ${field.label}`} value={apiKeyFields()[field.name] || ""} placeholder={provider.auth.kind === "key" ? "Unchanged" : ""}
            onInput={(event) => setApiKeyFields({ ...apiKeyFields(), [field.name]: event.currentTarget.value })} onKeyDown={(event) => { if (event.key === "Enter") void saveApiKey(); }} />
        </SettingLine>
      }</For></Show>
      <Show when={attempt()}>{(current) => <>
        <SettingLine plain label="Sign-in" state={<>{current().message}</>}>
          <Show when={current().authUrl}><SettingLink href={current().authUrl!}>Open sign-in</SettingLink></Show>
          <Show when={current().active}><Button variant="ghost" size="sm" onClick={() => void cancelOAuth()}>Cancel</Button></Show>
        </SettingLine>
        <Show when={current().authUrl && current().instructions}><SettingNote tone="quiet">{current().instructions}</SettingNote></Show>
        <Show when={current().deviceCode}><SettingLine plain label="Code" state={<><code>{current().deviceCode!.userCode}</code></>}><SettingLink href={current().deviceCode!.verificationUri}>Open verification page</SettingLink></SettingLine></Show>
        <Show when={current().prompt?.type === "select"}><SettingLine plain label={current().prompt!.message}><For each={current().prompt!.options || []}>{(option) => <Button variant="ghost" size="sm" disabled={authLoading()} onClick={() => void answerAuthPrompt(option.id)}>{option.label}</Button>}</For></SettingLine></Show>
        <Show when={current().prompt && current().prompt!.type !== "select"}><SettingLine plain label={current().prompt!.message}><Input id="pi-auth-response" aria-label={current().prompt!.message} type="text" autocomplete="off" value={authResponse()} onInput={(event) => setAuthResponse(event.currentTarget.value)} placeholder={current().prompt!.placeholder || ""} onKeyDown={(event) => { if (event.key === "Enter") void answerAuthPrompt(authResponse()); }} /><Button size="sm" disabled={authLoading() || !authResponse().trim()} onClick={() => void answerAuthPrompt(authResponse())}>Continue</Button></SettingLine></Show>
        <Show when={current().error}><SettingNote tone="error">{current().error}</SettingNote></Show>
      </>}</Show>
    </>;
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

  /** A change shown at once and saved straight after; the header says how it stands. */
  const editSearch = (edit: SearchEdit) => {
    const current = searchSettings();
    if (!current) return;
    setSearchSettings({ ...current, route: { ...current.route, ...edit.route }, tools: { ...current.tools, ...edit.tools }, fetching: { ...current.fetching, ...edit.fetching } });
    searchAutosave.edit(edit, "now");
  };
  const searchProvider = (id: string) => searchSettings()?.providers.find((provider) => provider.id === id);
  // What the route stands on, muted after its name.
  const routeState = () => {
    const first = searchSettings()?.route.first;
    if (!first || first === "auto") return "OpenAI on ChatGPT models, else Exa";
    const source = searchProvider(first)?.source;
    return source ? SEARCH_SOURCE_LABELS[source] : "not set up";
  };
  const openKey = (id: string) => { setSearchError(""); setSearchKey(""); setKeyFor(id); };
  const closeKey = () => { setKeyFor(null); setSearchKey(""); };
  const saveSearchKey = async () => {
    const id = keyFor();
    const key = searchKey().trim();
    if (!id || !key) return;
    setSearchSaving(true);
    setSearchError("");
    try {
      setSearchSettings(await api<SearchSettings>(`/v0/search/providers/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify({ key }) }));
      closeKey();
    } catch (error) { setSearchError((error as Error).message); }
    finally { setSearchSaving(false); }
  };
  const removeSearchKey = async (id: string) => {
    setSearchSaving(true);
    setSearchError("");
    try {
      setSearchSettings((await api<{ settings: SearchSettings }>(`/v0/search/providers/${encodeURIComponent(id)}`, { method: "DELETE" })).settings);
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
      if (request !== voiceLoadRequest || generation !== voiceSettingsGeneration || voiceSaveInFlight > 0 || voiceAutosave.busy()) return;
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
      const devices = await listAudioInputDevices();
      setAudioInputDevices(devices);
      setAudioInputStatus("ready");
      const moved = rematchInputDevice(voiceDraft(), devices);
      if (moved) updateVoiceDraft({ inputDeviceId: moved });
    } catch (error) {
      setAudioInputError(formatMicrophoneError(error));
      setAudioInputStatus("error");
    }
  };
  createEffect(() => {
    if (!props.open || section() !== "voice") return;
    void loadAudioInputs();
    // A microphone plugged in, or the list becoming visible, refreshes it.
    const changed = () => void loadAudioInputs();
    navigator.mediaDevices?.addEventListener("devicechange", changed);
    onCleanup(() => navigator.mediaDevices?.removeEventListener("devicechange", changed));
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

  // This browser's dictation settings are stored as they change.
  const updateVoiceDraft = (patch: Partial<VoiceDictationSettings>) => {
    if (patch.warmMicrophone === false) stopWarmMicrophone();
    const next = { ...voiceDraft(), ...patch };
    setVoiceDraft(next);
    voiceDraftAutosave.edit(next, "now");
  };
  // The server's: a choice at once, typing after a pause. A custom endpoint
  // that is not an https:// URL yet is held back rather than sent.
  const voiceEndpointError = (settings: VoiceServerSettings) => {
    if (settings.mode !== "remote" || settings.provider !== "custom") return "";
    try { return new URL(settings.endpoint).protocol === "https:" ? "" : "An https:// URL"; } catch { return "An https:// URL"; }
  };
  const editVoiceServer = (update: (current: VoiceServerSettings) => VoiceServerSettings, when: "pause" | "now" = "now") => {
    const current = voiceServerSettings();
    if (!current) return;
    const next = update(current);
    setVoiceServerSettings(next);
    setVoiceServerEdited(true);
    if (voiceEndpointError(next)) return voiceAutosave.hold();
    voiceAutosave.edit(next, when);
  };
  const updateVoiceServer = (patch: Partial<VoiceServerSettings>, when: "pause" | "now" = "now") => editVoiceServer((current) => ({ ...current, ...patch }), when);
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
  const persistVoiceServer = async (settings: VoiceServerSettings, secret = "") => {
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
          auth: { type: settings.auth.type, headerName: settings.auth.headerName, secret },
        }),
      });
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
      return savedState;
    } finally {
      voiceSettingsGeneration += 1;
      voiceSaveInFlight -= 1;
    }
  };
  // A key is a credential, so it is saved by its own button (or Enter), not
  // as it is typed; what else is waiting is sent first.
  const saveVoiceSecret = async () => {
    const secret = voiceSecret().trim();
    if (!secret) return;
    setVoiceBusy(true);
    setVoiceError("");
    setVoiceTestResult("");
    try {
      await voiceAutosave.flush();
      const settings = voiceServerSettings();
      if (!settings) return;
      setVoiceServerSettings(await persistVoiceServer(settings, secret));
      setVoiceServerEdited(false);
      setVoiceSecret("");
    } catch (error) { setVoiceError((error as Error).message); }
    finally { setVoiceBusy(false); }
  };
  const testVoiceServer = async () => {
    if (voiceSecret().trim()) await saveVoiceSecret();
    const settings = voiceServerSettings();
    if (!settings) return;
    setVoiceBusy(true);
    setVoiceError("");
    setVoiceTestResult("");
    try {
      await voiceAutosave.flush();
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
          toast.error("The selected microphone is no longer available. Choose another device.");
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

  const namingModels = createMemo(() => props.models.allModels().filter((model) => props.models.enabledModels().includes(model.spec)));
  const loadGeneralPreferences = async () => {
    setGeneralLoading(true);
    try {
      const loaded = await readShared<GeneralPreferences>("/v0/preferences");
      const model = loaded.sessionNameModel;
      const levels = namingModels().find((item) => item.spec === model)?.thinkingLevels || ["off"];
      setSessionNameModel(model);
      setSessionNameThinkingLevel(levels.includes(loaded.sessionNameThinkingLevel) ? loaded.sessionNameThinkingLevel : levels[0] || "off");
    } catch (error) { toast.error((error as Error).message); }
    finally { setGeneralLoading(false); }
  };
  const saveSessionNaming = (model: string, thinkingLevel: string) => {
    setSessionNameModel(model);
    setSessionNameThinkingLevel(thinkingLevel);
    namingAutosave.edit({ sessionNameModel: model, sessionNameThinkingLevel: thinkingLevel }, "now");
  };
  const chooseSessionNameModel = (model: string) => {
    const levels = namingModels().find((item) => item.spec === model)?.thinkingLevels || ["off"];
    const thinkingLevel = levels.includes(sessionNameThinkingLevel()) ? sessionNameThinkingLevel() : levels.includes("off") ? "off" : levels[0] || "off";
    void saveSessionNaming(model, thinkingLevel);
  };
  createEffect(() => {
    if (!props.open || section() !== "models") return;
    props.models.enabledModels().join("\n");
    void loadGeneralPreferences();
  });

  const workspaceProjects = createMemo(() => props.projects
    .filter((project) => project.kind === "workspace" || ["linked", "created", "cloned"].includes(project.origin || ""))
    .sort((left, right) => (left.id === workspaceId() ? -1 : right.id === workspaceId() ? 1 : left.name.localeCompare(right.name))));
  const workspaceDefaultLabel = (workspace: Project) => {
    const id = workspace.defaultTemplateId;
    return props.templates.find((item) => item.id === id)?.label || `Inherit global (${props.templates.find((item) => item.id === props.defaultTemplateId)?.label || "General"})`;
  };
  const saveWorkspace = async (workspace: Project, templateId: string | null) => props.onWorkspaceDefaultChange(workspace.id, templateId);

  const editRuntime = (field: keyof RuntimeDraft, text: string) => {
    const draft = { ...runtimeDraft(), [field]: text };
    setRuntimeDraft(draft);
    if ((["live", "generating"] as const).some((key) => runtimeFieldError(draft, key))) return runtimeAutosave.hold();
    runtimeAutosave.edit({ maxLiveProcesses: Number(draft.live), maxGeneratingProcesses: Number(draft.generating) });
  };
  // Each section saved as it is edited, and how its header says so. Leaving
  // the section or closing Settings sends what is waiting rather than
  // dropping it; a failure nobody is looking at any more is said in a toast.
  const autosaved: Partial<Record<Section, { label: string; saves: Array<ReturnType<typeof createAutosave<any>>> }>> = {
    runtime: { label: "Runtime settings", saves: [runtimeAutosave] },
    prompts: { label: "Prompt", saves: [promptAutosave] },
    voice: { label: "Voice settings", saves: [voiceAutosave, voiceDraftAutosave] },
    models: { label: "Model defaults", saves: [defaultProfileAutosave, namingAutosave] },
    search: { label: "Web search", saves: [searchAutosave] },
    ui: { label: "Appearance", saves: [uiPreferenceSaves] },
    shortcuts: { label: "Shortcuts", saves: [uiPreferenceSaves] },
  };
  for (const [id, entry] of Object.entries(autosaved) as Array<[Section, NonNullable<(typeof autosaved)[Section]>]>) {
    createEffect(on(() => props.open && section() === id, (showing, wasShowing) => {
      if (!wasShowing || showing) return;
      for (const save of entry.saves) void save.flush().then(() => {
        const state = save.state();
        if (state.kind === "failed" && !(props.open && section() === id)) toast.error(`${entry.label} not saved: ${state.message}`);
      });
    }));
  }
  // The header says how the section's edits stand: saving, saved, or not
  // saved with Retry. Sections that save on their own terms say nothing.
  const saveState = (): { state: SaveState; retry: () => void } | null => {
    const entry = autosaved[section()];
    return entry ? { state: combineSaveStates(entry.saves.map((save) => save.state())), retry: () => entry.saves.forEach((save) => save.retry()) } : null;
  };

  const close = () => props.onOpenChange(false);
  const status = () => {
    const kind = saveState()?.state.kind;
    return kind === "saving" ? { status: "Saving", busy: true } : kind === "saved" ? { status: "Saved" }
      : kind === "failed" ? { status: "Not saved", failed: true, why: (saveState()!.state as { message: string }).message, onRetry: saveState()!.retry } : {};
  };
  return <OverlayDialog
    open={props.open}
    onOpenChange={props.onOpenChange}
    label="Settings"
    placement="center"
    layout="rail"
    style={narrow() ? undefined : { "--overlay-width": "calc(70.3125 * var(--u-space))", "--overlay-height": "calc(64 * var(--u-space))" }}
    onEscapeKeyDown={dismissEscape}
    onCloseAutoFocus={(event) => { event.preventDefault(); if (returnFocus?.isConnected) returnFocus.focus(); returnFocus = null; }}
  >
    <Show when={!narrow() || showingIndex()}>
      <OverlayRail title="Settings" role="tablist" aria-label="Settings sections" aria-orientation="vertical" foot={<AboutSettingsFooter />} onClose={narrow() ? close : undefined}>
        <For each={sectionGroups}>{(group) => <NavGroup label={group.label}>
          <For each={group.sections}>{(item) => <NavRow role="tab" tabIndex={section() === item.id ? 0 : -1} aria-selected={section() === item.id} current={!narrow() && section() === item.id}
            icon={<item.icon />} end={narrow() ? <Icons.ChevronRight /> : undefined} onClick={() => openSection(item.id)} onKeyDown={navigateSettingsTabs}>{item.label}</NavRow>}</For>
        </NavGroup>}</For>
      </OverlayRail>
    </Show>
    <Show when={!showingIndex()}>
      <OverlayPage title={label(section())} {...status()} onBack={narrow() ? backToSections : undefined} onClose={close}>
          <Show when={section() === "prompts"}>
            <Show when={promptStatus() === "ready"} fallback={<Show when={promptStatus() === "error"} fallback={<SettingLoading>Loading prompts…</SettingLoading>}><SettingNote tone="error">{promptError()}</SettingNote></Show>}>
              <>
                <SettingGroup title="System prompt">
                  <SettingLine plain label="Prompt" state={<>{prompts().find((item) => item.id === promptId())?.modified ? "modified" : "default"}</>} title="Changes apply when the next runtime or naming request starts.">
                      <Select id="prompt-selector" aria-label="Prompt" value={promptId()} onChange={(event) => choosePrompt(event.currentTarget.value)}>
                        <For each={prompts()}>{(prompt) => <option value={prompt.id} selected={prompt.id === promptId()}>{prompt.label}{prompt.kind === "service" ? " · service" : ""}</option>}</For>
                      </Select>
                      <Button variant="ghost" size="icon-sm" aria-label="Reset to default" title="Reset to default" disabled={promptSaving() || (!prompts().find((item) => item.id === promptId())?.modified && promptDraft() === promptBaseline())} onClick={() => void resetPrompt()}><Icons.Reset /></Button>
                  </SettingLine>
                  <Show when={!promptDraft().trim()}><SettingNote tone="error">A prompt cannot be empty; it is not saved until it has text.</SettingNote></Show>
                  <Show when={promptError() || promptStatus() === "error"}><SettingNote tone="error">{promptError()}</SettingNote></Show>
                  <SettingWide><TextArea aria-label="System prompt" spellcheck={false} value={promptDraft()} onInput={(event) => editPrompt(event.currentTarget.value)} /></SettingWide>
                </SettingGroup>
              </>
            </Show>
          </Show>
          <Show when={section() === "ui"}>
            <>
              <SettingGroup title="Interface">
                  <SettingLine label="Interface size">
                    <Select id="interface-scale" aria-label="Interface size" value={props.interfaceScale} onChange={(event) => props.onInterfaceScaleChange(parseUiScale(event.currentTarget.value))}>
                      <For each={UI_SCALE_OPTIONS}>{(scale) => <option value={scale}>{Math.round(scale * 100)}%</option>}</For>
                    </Select>
                  </SettingLine>
                  <SettingLine label="Transcript font">
                    <Select id="transcript-font" aria-label="Transcript font" value={transcriptFontChoice()} onChange={(event) => setTranscriptFontChoice(saveTranscriptFont(event.currentTarget.value as TranscriptFont))}>
                      <For each={TRANSCRIPT_FONT_OPTIONS}>{(option) => <option value={option.value}>{option.label}</option>}</For>
                    </Select>
                  </SettingLine>
                  <SettingLine label="Terminal font">
                    <Select id="terminal-font" aria-label="Terminal font" value={terminalFontChoice()} onChange={(event) => setTerminalFontChoice(saveTerminalFont(event.currentTarget.value as TerminalFont))}>
                      <For each={TERMINAL_FONT_OPTIONS}>{(option) => <option value={option.value}>{option.label}</option>}</For>
                    </Select>
                  </SettingLine>
                  <SettingLine label="Sidebar chats">
                    <Input id="sidebar-chat-limit" type="number" min={MIN_SIDEBAR_CHAT_LIMIT} max={MAX_SIDEBAR_CHAT_LIMIT} step="1" value={props.sidebarChatLimit} onChange={(event) => props.onSidebarChatLimitChange(Number(event.currentTarget.value))} onBlur={(event) => props.onSidebarChatLimitChange(Number(event.currentTarget.value))} />
                  </SettingLine>
                  <SettingLine label="Tab row">
                    <Switch id="tab-frost" label="Frosted tab row" checked={frosted()} onChange={(on) => setFrosted(saveTabFrost(on))} />
                  </SettingLine>
                  <SettingLine label="Markdown">
                    <Select id="markdown-renderer" aria-label="Markdown renderer" title={MARKDOWN_RENDERER_OPTIONS.find((option) => option.value === props.markdownRenderer)?.description} value={props.markdownRenderer} onChange={(event) => props.onMarkdownRendererChange(event.currentTarget.value as MarkdownRendererId)}>
                      <For each={MARKDOWN_RENDERER_OPTIONS}>{(option) => <option value={option.value}>{option.label}</option>}</For>
                    </Select>
                  </SettingLine>
                  <Show when={props.markdownRenderer === "incremark"}>
                    <SettingLine label="Word fade">
                      <Select id="stream-fade" aria-label="Word fade time" value={fadeMs()} onChange={(event) => setFadeMs(saveStreamFade(Number(event.currentTarget.value)))}>
                        <For each={STREAM_FADE_OPTIONS}>{(option) => <option value={option.value}>{option.label}</option>}</For>
                      </Select>
                    </SettingLine>
                    <SettingLine label="Fade formulas in when complete">
                      <Switch id="stream-math-fade" label="Fade formulas in when complete" checked={streamMathFade()} onChange={saveStreamMathFade} />
                    </SettingLine>
                  </Show>
                  <SettingLine label="Meteor field">
                    <Switch id="meteor-field" label="Ambient meteor field" checked={props.meteorField} onChange={props.onMeteorFieldChange} />
                  </SettingLine>
              </SettingGroup>
              <DesktopSettingsTile />
              <SettingGroup title="Reading">
                  <SettingLine label="Transcript width">
                    <Select id="transcript-width" aria-label="Transcript width" value={props.transcriptWidth} onChange={(event) => props.onTranscriptWidthChange(event.currentTarget.value as TranscriptWidthMode)}>
                      <For each={TRANSCRIPT_WIDTH_OPTIONS}>{(option) => <option value={option.value}>{option.label}</option>}</For>
                    </Select>
                  </SettingLine>
                  <SettingLine label="Wide blocks">
                    <Select id="transcript-wide-blocks" aria-label="Wide blocks" value={props.transcriptWideBlocks} onChange={(event) => props.onTranscriptWideBlocksChange(event.currentTarget.value as TranscriptWideBlocksMode)}>
                      <For each={TRANSCRIPT_WIDE_BLOCKS_OPTIONS}>{(option) => <option value={option.value}>{option.label}</option>}</For>
                    </Select>
                  </SettingLine>
                  <SettingLine label="Code width">
                    <Select id="code-block-width" aria-label="Code block width" value={props.codeBlockWidth} onChange={(event) => props.onCodeBlockWidthChange(event.currentTarget.value as CodeBlockWidthMode)}>
                      <For each={CODE_BLOCK_WIDTH_OPTIONS}>{(option) => <option value={option.value}>{option.label}</option>}</For>
                    </Select>
                  </SettingLine>
                  <SettingLine label="Panel drag">
                    <Select id="panel-motion" aria-label="Panel drag" title={PANEL_MOTION_OPTIONS.find((option) => option.value === props.panelMotion)?.label} value={props.panelMotion} onChange={(event) => props.onPanelMotionChange(event.currentTarget.value as PanelMotionMode)}>
                      <For each={PANEL_MOTION_OPTIONS}>{(option) => <option value={option.value}>{option.label}</option>}</For>
                    </Select>
                  </SettingLine>
              </SettingGroup>
              <SettingGroup title="Collapse">
                  <SettingLine label="Code blocks">
                    <Select id="code-block-collapse" aria-label="Collapse code blocks" value={props.codeBlockCollapse} onChange={(event) => props.onCodeBlockCollapseChange(event.currentTarget.value as CodeBlockCollapseMode)}>
                      <For each={CODE_BLOCK_COLLAPSE_OPTIONS}>{(option) => <option value={option.value}>{option.label}</option>}</For>
                    </Select>
                  </SettingLine>
                  <SettingLine label="Fold over">
                    <Select id="code-block-collapse-lines" aria-label="Collapse code blocks over" disabled={props.codeBlockCollapse === "off"} value={props.codeBlockCollapseLines} onChange={(event) => props.onCodeBlockCollapseLinesChange(Number(event.currentTarget.value))}>
                      <For each={CODE_BLOCK_COLLAPSE_LINE_CHOICES}>{(lines) => <option value={lines}>{lines} lines</option>}</For>
                    </Select>
                  </SettingLine>
                  <SettingLine label="Your messages">
                    <Select id="user-message-collapse" aria-label="Collapse your messages" value={props.userMessageCollapse} onChange={(event) => props.onUserMessageCollapseChange(event.currentTarget.value as UserMessageCollapseMode)}>
                      <For each={USER_MESSAGE_COLLAPSE_OPTIONS}>{(option) => <option value={option.value}>{option.label}</option>}</For>
                    </Select>
                  </SettingLine>
              </SettingGroup>
              <SettingGroup title="Graphics">
                <SettingLine plain label="Hardware acceleration" title="For smooth animations, backdrop blur and high-refresh-rate rendering, turn on “Use graphics acceleration when available” in your browser settings, then relaunch the browser."><SettingValue>Turn on in browser</SettingValue></SettingLine>
              </SettingGroup>
            </>
          </Show>
          <Show when={section() === "devices"}><DevicesSettingsTile projects={props.projects} onAddWorkspace={props.onAddWorkspace} onOpenTerminal={props.onOpenDeviceTerminal} onOpenWorkspace={props.onOpenWorkspace} /></Show>
          <Show when={section() === "shortcuts"}><ShortcutsSettings manager={props.shortcuts} /></Show>
          <Show when={section() === "runtime"}>
            <>
              <Show when={runtimeStatus() === "ready" && runtime()} fallback={<Show when={runtimeStatus() === "error"} fallback={<SettingLoading>Loading runtime settings…</SettingLoading>}><SettingNote tone="error"><span>{runtimeError() || "Runtime settings could not be loaded."}</span><Button variant="secondary" size="sm" onClick={() => void loadRuntime()}>Retry</Button></SettingNote></Show>}>
                <SettingGroup title="Agent processes">
                  <SettingLine label="Warm processes" state={<><Show when={runtimeFieldError(runtimeDraft(), "live")} fallback={<>{runtime()!.liveCount || 0} live</>}>{(message) => message()}</Show></>}><Input id="warm-processes" type="number" inputMode="numeric" value={runtimeDraft().live} aria-invalid={Boolean(runtimeFieldError(runtimeDraft(), "live")) || undefined} onInput={(event) => editRuntime("live", event.currentTarget.value)} /></SettingLine>
                  <SettingLine label="Concurrent generations" state={<><Show when={runtimeFieldError(runtimeDraft(), "generating")} fallback={<>{runtime()!.generatingCount || 0} generating</>}>{(message) => message()}</Show></>}><Input id="generations" type="number" inputMode="numeric" value={runtimeDraft().generating} aria-invalid={Boolean(runtimeFieldError(runtimeDraft(), "generating")) || undefined} onInput={(event) => editRuntime("generating", event.currentTarget.value)} /></SettingLine>
                </SettingGroup>
              </Show>
            </>
          </Show>
          <Show when={section() === "workspaces"}>
            <Show when={!props.templatesLoading} fallback={<SettingLoading>Loading workspace settings…</SettingLoading>}><Show when={workspaceProjects().find((workspace) => workspace.id === workspaceId())} fallback={<SettingNote>This workspace is not available.</SettingNote>}>{(workspace) => <SettingGroup title={workspace().name}><SettingNote>{workspace().workingRoot}</SettingNote><SettingNote>Override: {workspaceDefaultLabel(workspace()).startsWith("Inherit") ? "None" : workspaceDefaultLabel(workspace())}</SettingNote><SettingLine label="Default profile"><Select id={`workspace-default-profile-${workspace().id}`} aria-label={`${workspace().name} default profile`} value={workspace().defaultTemplateId || ""} onChange={(event) => void saveWorkspace(workspace(), event.currentTarget.value || null)}>
                <option value="">Inherit global ({props.templates.find((item) => item.id === props.defaultTemplateId)?.label || "General"})</option>
                <For each={props.templates.filter((item) => item.defaultable !== false)}>{(item) => <option value={item.id}>{item.label}</option>}</For>
              </Select></SettingLine></SettingGroup>}</Show></Show>
          </Show>
          <Show when={section() === "voice"}>
            <Show when={voiceStatus() === "ready" && voiceServerSettings()} fallback={<Show when={voiceStatus() === "error"} fallback={<SettingLoading>Loading voice settings…</SettingLoading>}><SettingNote tone="error"><span>{voiceError() || "Voice settings could not be loaded."}</span><Button variant="secondary" size="sm" onClick={() => void loadVoiceSettings()}>Retry</Button></SettingNote></Show>}>
              <>
                <SettingGroup title="Transcription">
                  <SettingLine plain label="Source">
                    <Segmented arrows label="Transcription source" value={voiceServerSettings()!.mode} disabled={voiceBusy()} onChange={(mode) => updateVoiceServer({ mode })} options={[
                      { value: "off", label: "Off", icon: <MicOffIcon /> },
                      { value: "local", label: "Local", icon: <Icons.LocalModel />, title: "This machine" },
                      { value: "remote", label: "Cloud", icon: <CloudIcon /> },
                    ]} />
                  </SettingLine>
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
                    <SettingLine label="Provider"><Select id="voice-provider" disabled={voiceBusy()} value={voiceServerSettings()!.provider} onChange={(event) => {
                      const provider = voiceServerSettings()!.providers.find((candidate) => candidate.id === event.currentTarget.value)!;
                      setVoiceSecret("");
                      editVoiceServer((current) => ({ ...current, provider: provider.id, adapter: provider.adapter, endpoint: provider.endpoint, model: provider.models[0]?.id || "", auth: { ...current.auth, type: provider.id === "custom" ? current.auth.type : "bearer", configured: Boolean(provider.configured), source: provider.configured ? "stored" : null, removable: Boolean(provider.configured) } }));
                    }}><For each={voiceServerSettings()!.providers}>{(provider) => <option value={provider.id}>{provider.label}</option>}</For></Select></SettingLine>
                    <Show when={selectedVoiceProvider()?.models.length}>
                      <SettingLine label="Model" title={selectedVoiceProvider()!.models.find((model) => model.id === voiceServerSettings()!.model)?.description}><Select id="voice-cloud-model" disabled={voiceBusy()} title={selectedVoiceProvider()!.models.find((model) => model.id === voiceServerSettings()!.model)?.description} value={voiceServerSettings()!.model} onChange={(event) => {
                        const model = selectedVoiceProvider()!.models.find((candidate) => candidate.id === event.currentTarget.value);
                        updateVoiceServer({ model: event.currentTarget.value, ...(model?.adapter ? { adapter: model.adapter } : {}) });
                      }}><For each={selectedVoiceProvider()!.models}>{(model) => <option value={model.id}>{model.label}</option>}</For></Select></SettingLine>
                    </Show>
                    <Show when={voiceServerSettings()!.provider === "custom"}>
                      <SettingLine label="Protocol" title={selectedVoiceAdapter()?.description}><Select id="voice-adapter" disabled={voiceBusy()} title={selectedVoiceAdapter()?.description} value={voiceServerSettings()!.adapter} onChange={(event) => updateVoiceServer({ adapter: event.currentTarget.value })}><For each={voiceServerSettings()!.adapters}>{(adapter) => <option value={adapter.id}>{adapter.label}</option>}</For></Select></SettingLine>
                      <SettingLine label="Endpoint" state={<><Show when={voiceEndpointError(voiceServerSettings()!)}>{(message) => message()}</Show></>}><Input id="voice-endpoint" type="url" disabled={voiceBusy()} value={voiceServerSettings()!.endpoint} placeholder="https://…" onInput={(event) => updateVoiceServer({ endpoint: event.currentTarget.value }, "pause")} /></SettingLine>
                      <SettingLine label="Model parameter"><Input id="voice-custom-model" value={voiceServerSettings()!.model} placeholder="Optional" onInput={(event) => updateVoiceServer({ model: event.currentTarget.value }, "pause")} /></SettingLine>
                      <SettingLine plain label="Authentication">
                        <Segmented arrows label="Authentication" value={voiceServerSettings()!.auth.type} disabled={voiceBusy()} onChange={(type) => editVoiceServer((current) => ({ ...current, auth: { ...current.auth, type } }))} options={[
                          { value: "none", label: "None" },
                          { value: "bearer", label: "Bearer" },
                          { value: "header", label: "Header" },
                        ]} />
                      </SettingLine>
                      <Show when={voiceServerSettings()!.auth.type === "header"}>
                        <SettingLine label="Header name"><Input id="voice-auth-header" disabled={voiceBusy()} value={voiceServerSettings()!.auth.headerName} onInput={(event) => editVoiceServer((current) => ({ ...current, auth: { ...current.auth, headerName: event.currentTarget.value } }), "pause")} /></SettingLine>
                      </Show>
                    </Show>
                    <Show when={voiceServerSettings()!.provider !== "custom" || voiceServerSettings()!.auth.type !== "none"}>
                      <SettingLine plain label={selectedVoiceProvider()?.authLabel || "Key"} state={<>{voiceServerSettings()!.auth.configured ? "stored" : "not set"}</>}>
                          <Input id="voice-secret" aria-label={selectedVoiceProvider()?.authLabel || "Key"} type="password" autocomplete="new-password" data-1p-ignore data-lpignore="true" data-bwignore disabled={voiceBusy()} value={voiceSecret()} onInput={(event) => setVoiceSecret(event.currentTarget.value)} onKeyDown={(event) => { if (event.key === "Enter") void saveVoiceSecret(); }} placeholder={voiceServerSettings()!.auth.configured ? "Replace" : "Paste key"} />
                          <Show when={voiceSecret().trim()}><Button size="sm" disabled={voiceBusy()} onClick={() => void saveVoiceSecret()}>Save</Button></Show>
                          <Show when={!voiceSecret().trim() && voiceServerSettings()!.auth.removable}><Button variant="ghost" size="sm" disabled={voiceBusy()} onClick={() => void removeVoiceCredential()}>Remove</Button></Show>
                      </SettingLine>
                    </Show>
                    <SettingLine plain label="Connection" state={<>{voiceTestResult() || (cloudTiming().label === "Live" ? "live" : "after you stop")}</>}>
                      <Button variant="ghost" size="sm" disabled={voiceBusy()} onClick={() => void testVoiceServer()}>{voiceBusy() ? <Spinner /> : null}Test</Button>
                    </SettingLine>
                  </Show>
                </SettingGroup>

                <SettingGroup title="Input">
                  <SettingLine plain label="Microphone">
                      <Select ref={voiceInputSelect} id="voice-input-device" aria-label="Microphone" disabled={audioInputBusy()} value={voiceDraft().inputDeviceId} onChange={(event) => { const deviceId = event.currentTarget.value; updateVoiceDraft({ inputDeviceId: deviceId, inputDeviceLabel: audioInputDevices().find((device) => device.deviceId === deviceId)?.label || "" }); }}>
                        <option value="">System default</option>
                        <Show when={voiceDraft().inputDeviceId && !audioInputDevices().some((device) => device.deviceId === voiceDraft().inputDeviceId)}><option value={voiceDraft().inputDeviceId}>Unavailable microphone</option></Show>
                        <For each={audioInputDevices()}>{(device) => <option value={device.deviceId}>{device.label}</option>}</For>
                      </Select>
                      <Button variant="ghost" size="icon-sm" aria-label="Refresh microphones" title="Refresh microphones" disabled={audioInputBusy() || audioInputStatus() === "loading"} onClick={() => void loadAudioInputs()}><Icons.Refresh /></Button>
                      <Show when={audioInputTest()?.recording && !audioInputBusy()}><Button variant="ghost" size="icon-sm" aria-label={audioInputPlayback() ? "Stop playback" : "Play test recording"} title={audioInputPlayback() ? "Stop playback" : "Play test recording"} onClick={() => audioInputPlayback() ? stopAudioInputPlayback() : void playAudioInputTest()}>{audioInputPlayback() ? <Icons.Stop /> : <Icons.Play />}</Button></Show>
                      <Button variant="ghost" size="sm" disabled={audioInputStatus() === "loading"} onClick={() => audioInputBusy() ? stopAudioInputTest() : void testAudioInput()}>{audioInputBusy() ? "Stop" : "Test"}</Button>
                  </SettingLine>
                  <Show when={audioInputBusy() || audioInputTest()}>
                    {/* The composer's own waveform, so a test looks like dictation will. */}
                    <SettingLine plain label={audioInputBusy() ? (audioInputSignalDetected() ? "Signal" : "Listening…") : audioInputTest()!.signalDetected ? "Signal" : "No signal"} state={<>level {Math.round(audioInputWaveform.level() * 100)}% · peak {Math.round(audioInputWaveform.peak() * 100)}%</>}></SettingLine><SettingWide><VoiceWaveform history={audioInputWaveform.history} level={audioInputWaveform.level} peak={audioInputWaveform.peak} state={audioInputBusy() ? "listening" : "stopped"} variant="compact" barDensity={3} ariaLabel="Microphone input level" /></SettingWide>
                  </Show>
                  <Show when={audioInputError() || audioInputTest()?.recordingError || (audioInputStatus() === "error" && "Microphone list could not be loaded.")}>{(message) => <SettingNote tone="error">{message()}</SettingNote>}</Show>
                  <SettingLine plain label="Capture">
                    <Segmented arrows label="Capture profile" value={voiceDraft().captureProfile} disabled={audioInputBusy()} onChange={(captureProfile) => updateVoiceDraft({ captureProfile })} options={[
                      { value: "raw", label: "Raw" },
                      { value: "processed", label: "Processed" },
                    ]} />
                  </SettingLine>
                  <SettingLine label="Shortcut" title="Focus and press a shortcut"><Input id="dictation-shortcut" title="Focus and press a shortcut" value={voiceDraft().shortcut} readOnly onKeyDown={(event) => {
                    // Tab and Esc still leave the field; every other key is recorded.
                    if (event.key === "Tab" || event.key === "Escape") return;
                    event.preventDefault();
                    event.stopPropagation();
                    const shortcut = shortcutFromKeyboardEvent(event);
                    if (shortcut) updateVoiceDraft({ shortcut });
                  }} /></SettingLine>
                  <SettingLine plain label="Activation">
                    <Segmented arrows label="Activation" value={voiceDraft().activation} onChange={(activation) => updateVoiceDraft({ activation })} options={[
                      { value: "push_to_talk", label: "Hold", icon: <HandIcon /> },
                      { value: "toggle", label: "Toggle", icon: <RepeatIcon /> },
                    ]} />
                  </SettingLine>
                  <SettingLine label="Send when done"><Switch label="Send when done" checked={voiceDraft().autoSend} onChange={(autoSend) => updateVoiceDraft({ autoSend })} /></SettingLine>
                  <SettingLine plain label="Keep mic warm" state={<><Show when={warmMicrophoneActive()}>live</Show></>}>
                      <Show when={warmMicrophoneActive()}><Button variant="ghost" size="sm" onClick={stopWarmMicrophone}>Release</Button></Show>
                      <Switch label="Keep mic warm" checked={voiceDraft().warmMicrophone} onChange={(warmMicrophone) => updateVoiceDraft({ warmMicrophone })} />
                  </SettingLine>
                </SettingGroup>

                <Show when={voiceError()}><SettingNote tone="error">{voiceError()}</SettingNote></Show>
              </>
            </Show>
          </Show>
          <Show when={section() === "search"}>
            <Show when={searchStatus() === "ready" && searchSettings()} fallback={<Show when={searchStatus() === "error"} fallback={<SettingLoading>Loading search settings…</SettingLoading>}><SettingNote tone="error"><span>{searchError() || "Search settings could not be loaded."}</span><Button variant="secondary" size="sm" onClick={() => void loadSearchSettings()}>Retry</Button></SettingNote></Show>}>
              {(settings) => <>
                <SettingGroup title="Search">
                  <SettingLine label="Search with" title="Automatic is pi-web-access's own order: on a ChatGPT model, OpenAI on that sign-in first; otherwise Exa, then every other provider that can search."
                    state={<>{routeState()}</>}>
                    <Select id="search-route" value={settings().route.first} onChange={(event) => editSearch({ route: { first: event.currentTarget.value } })}>
                      <option value="auto">Automatic</option>
                      <For each={settings().providers.filter((provider) => provider.ready || provider.id === settings().route.first)}>{(provider) => <option value={provider.id}>{provider.label}</option>}</For>
                    </Select>
                  </SettingLine>
                  <Show when={settings().route.first !== "auto"}>
                    <SettingLine label="Fall back to the others" title="When it fails, is out of quota, or finds nothing (or nothing on the sites asked for), the search goes on to every other provider that can search, in the order below. If they all find nothing, the first answer is kept.">
                      <Switch label="Fall back to the others" checked={settings().route.fallback} onChange={(fallback) => editSearch({ route: { fallback } })} />
                    </SettingLine>
                    <Show when={settings().route.fallback}>
                      <SettingLine label="Skip off-topic results" title={settings().cloudflare
                        ? "Each answer is checked against the query by Cloudflare's Clef classifier on your Cloudflare account (the query, answer and snippets are sent to it); one about something else goes on to the next provider."
                        : CLOUDFLARE_NEEDED}>
                        <Switch label="Skip off-topic results" disabled={!settings().cloudflare && !settings().route.offTopic} checked={settings().route.offTopic} onChange={(offTopic) => editSearch({ route: { offTopic } })} />
                      </SettingLine>
                    </Show>
                    <SettingLine label="Time limit" title="The most one search may take across every provider it tries; when it runs out, the best answer so far is kept.">
                      <Select id="search-time-limit" value={String(settings().route.timeoutMs ?? "")} onChange={(event) => editSearch({ route: { timeoutMs: event.currentTarget.value ? Number(event.currentTarget.value) : null } })}>
                        <For each={SEARCH_TIME_LIMITS}>{(limit) => <option value={limit.ms === null ? "" : String(limit.ms)}>{limit.label}</option>}</For>
                      </Select>
                    </SettingLine>
                    <SettingLine label="Match the chat's model" title="A GPT model on OpenAI's own endpoints searches with its own hosted search; any other model goes on down the route.">
                      <Switch label="Match the chat's model" checked={settings().route.useCurrentModel} onChange={(useCurrentModel) => editSearch({ route: { useCurrentModel } })} />
                    </SettingLine>
                  </Show>
                </SettingGroup>
                <SettingGroup title="Tools">
                  <For each={SEARCH_TOOLS}>{(tool) =>
                    <SettingLine label={tool.label} title={tool.title}>
                      <Switch label={tool.label} checked={settings().tools[tool.key]} onChange={(on) => editSearch({ tools: { [tool.key]: on } })} />
                    </SettingLine>
                  }</For>
                  <SettingNote>Chats pick up tool changes when Conduit next restarts.</SettingNote>
                </SettingGroup>
                <SettingGroup title="Reading pages">
                  <For each={SEARCH_FETCHING}>{(item) =>
                    <SettingLine label={item.label} title={item.title}>
                      <Switch label={item.label} checked={settings().fetching[item.key]} onChange={(on) => editSearch({ fetching: { [item.key]: on } })} />
                    </SettingLine>
                  }</For>
                  <SettingLine label="Read values off pages" title={settings().cloudflare
                    ? "fetch_content's extract mode: a price, a date or a limit as a typed value, with the line it came from, or said not to be there. Read by Cloudflare's Clairic model on your Cloudflare account; the page text is sent to Cloudflare."
                    : CLOUDFLARE_NEEDED}>
                    <Switch label="Read values off pages" disabled={!settings().cloudflare && !settings().fetching.extract} checked={settings().fetching.extract} onChange={(extract) => editSearch({ fetching: { extract } })} />
                  </SettingLine>
                  <Show when={!settings().cloudflare}><SettingNote>{CLOUDFLARE_NEEDED}</SettingNote></Show>
                </SettingGroup>
                <SettingGroup title="Providers">
                  <For each={settings().providers}>{(provider) =>
                    <SettingLine plain label={provider.label} title={provider.description} state={<>{provider.source ? SEARCH_SOURCE_LABELS[provider.source] : "not set"}</>}>
                      <Show when={keyFor() === provider.id} fallback={<>
                        <Show when={provider.source !== "environment"}><Button variant="ghost" size="sm" disabled={searchSaving()} onClick={() => openKey(provider.id)}>{provider.stored ? "Replace" : "Add key"}</Button></Show>
                        <Show when={provider.removable}><Button variant="ghost" size="sm" disabled={searchSaving()} onClick={() => void removeSearchKey(provider.id)}>Remove</Button></Show>
                      </>}>
                        <Input id={`search-key-${provider.id}`} aria-label={`${provider.label} API key`} type="password" autocomplete="new-password" data-1p-ignore data-lpignore="true" data-bwignore
                          ref={(element: HTMLInputElement) => queueMicrotask(() => element.focus())}
                          value={searchKey()} onInput={(event) => setSearchKey(event.currentTarget.value)} placeholder="API key"
                          onKeyDown={(event) => { if (event.key === "Enter") void saveSearchKey(); }} />
                        <Button size="sm" disabled={searchSaving() || !searchKey().trim()} onClick={() => void saveSearchKey()}>{searchSaving() ? <Spinner /> : null}Save</Button>
                        <Button variant="ghost" size="sm" disabled={searchSaving()} onClick={closeKey}>Cancel</Button>
                      </Show>
                    </SettingLine>
                  }</For>
                  <Show when={authProviders().find((provider) => provider.id === "cloudflare-workers-ai")}>{(provider) => accountLine(provider(), {
                    title: "Checks routed results are on-topic (Clef) and reads values off pages (Clairic), on your Cloudflare account. The same account as in Models & accounts.",
                  })}</Show>
                  <Show when={searchError()}><SettingNote tone="error">{searchError()}</SettingNote></Show>
                  <Show when={authError() && !authUnavailable()}><SettingNote tone="error">{authError()}</SettingNote></Show>
                  <SettingNote>pi-web-access knows about forty more providers, set in its web-search.json. <SettingLink href="https://github.com/nicobailon/pi-web-access#configuration">Docs</SettingLink></SettingNote>
                </SettingGroup>
              </>}
            </Show>
          </Show>
          <Show when={section() === "models"}><>
            <SettingGroup title="Defaults">
              <Show when={!props.templatesLoading} fallback={<SettingLine plain label="Default profile" state={<>loading…</>}><span /></SettingLine>}>
                <SettingLine label="Default profile"><Select id="default-profile" value={props.defaultTemplateId} onChange={(event) => defaultProfileAutosave.edit(event.currentTarget.value, "now")}><For each={props.templates.filter((item) => item.defaultable !== false)}>{(item) => <option value={item.id}>{item.label}</option>}</For></Select></SettingLine>
              </Show>
              <SettingLine plain label="Session naming">
                <ModelSelector
                models={namingModels()}
                model={sessionNameModel()}
                thinkingLevel={sessionNameThinkingLevel()}
                disabled={generalLoading() || !namingModels().length}
                onModelChange={chooseSessionNameModel}
                onThinkingLevelChange={(level) => void saveSessionNaming(sessionNameModel(), level)}
                onManageModels={props.onOpenModelSelector}
              />
              </SettingLine>
              <SettingLine plain label="Models" state={<>{props.models.enabledModels().length} enabled</>}><Button variant="ghost" size="sm" onClick={props.onOpenModelSelector}>Manage</Button></SettingLine>
            </SettingGroup>
            <SettingGroup title="ChatGPT Web">
              <SettingLine plain label="Cookies" state={<>{chatGptStatus()?.auth === "configured" ? "connected" : "not connected"}</>} title={chatGptStatus() ? `Transport: curl_cffi ${chatGptStatus()!.curlCffiVersion}, ${chatGptStatus()!.impersonate}. Stored cookie names: ${chatGptStatus()!.cookieNames.join(", ") || "none"}.` : undefined}>
                  <Input id="chatgpt-web-cookie" aria-label="Cookies" type="password" autocomplete="off" data-1p-ignore data-lpignore="true" data-bwignore value={chatGptCookie()} onInput={(event) => setChatGptCookie(event.currentTarget.value)} placeholder={chatGptStatus()?.auth === "configured" ? "Replace" : "Paste the Cookie header"} onKeyDown={(event) => { if (event.key === "Enter" && chatGptCookie().trim()) void saveChatGptCookie(); }} />
                  <Show when={chatGptCookie().trim()}><Button size="sm" disabled={chatGptBusy()} onClick={() => void saveChatGptCookie()}>{chatGptBusy() ? <Spinner /> : null}Save</Button></Show>
                  <Show when={!chatGptCookie().trim() && chatGptStatus()?.auth === "configured"}><Button variant="ghost" size="sm" disabled={chatGptBusy()} onClick={() => void removeChatGptCookie()}>Remove</Button></Show>
              </SettingLine>
              <SettingDetails summary="Where to find them">
                <ol>
                  <li>Sign in at <SettingLink href="https://chatgpt.com">chatgpt.com</SettingLink>.</li>
                  <li>Open browser developer tools, select Network, then reload ChatGPT.</li>
                  <li>Select a request to <code>chatgpt.com</code>. In Request Headers, copy the complete <code>Cookie</code> value.</li>
                  <li>Paste it above. It must include <code>__Secure-next-auth.session-token</code>, whole or split into numbered parts such as <code>.0</code> and <code>.1</code>.</li>
                </ol>
                <SettingNote>Conduit stores it on this server and never returns its values. Treat it like a password: do not paste it into a chat, issue, or log.</SettingNote>
              </SettingDetails>
              <Show when={chatGptError()}><SettingNote tone="error">{chatGptError()}</SettingNote></Show>
            </SettingGroup>
            <SettingGroup title="Provider accounts">
              <Show when={authUnavailable()}><SettingNote tone="error">Set a Conduit password with <code>node scripts/conduit-auth.mjs set-password</code>, then sign in to manage agent credentials here.</SettingNote></Show>
              <Show when={authError() && !authUnavailable()}><SettingNote tone="error">{authError()}</SettingNote></Show>
              <Show when={!authUnavailable() && authLoading() && !authProviders().length} fallback={<Show when={!authUnavailable()}>
                <For each={authProviders().filter((provider) => provider.auth.configured)}>{(provider) => accountLine(provider)}</For>
                <Show when={authProviders().find((provider) => provider.id === addingAccount() && !provider.auth.configured)}>{(provider) => accountLine(provider(), { pending: true })}</Show>
                <Show when={authProviders().some((provider) => !provider.auth.configured && provider.id !== addingAccount())}>
                  <SettingLine label="Add an account" title="A model provider's sign-in or API key, kept by the Conduit durable agent on this server.">
                    <Select id="pi-auth-provider" aria-label="Add an account" value="" onChange={(event) => { setAddingAccount(event.currentTarget.value); closeAccountKey(); }}>
                      <option value="">Choose a provider</option>
                      <For each={authProviders().filter((provider) => !provider.auth.configured && provider.id !== addingAccount())}>{(provider) => <option value={provider.id}>{provider.label}</option>}</For>
                    </Select>
                  </SettingLine>
                </Show>
              </Show>}><SettingLine plain label="Accounts" state={<>loading…</>}><span /></SettingLine></Show>
            </SettingGroup>
          </></Show>
      </OverlayPage>
    </Show>
  </OverlayDialog>;
}
