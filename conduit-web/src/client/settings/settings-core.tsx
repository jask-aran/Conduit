import { Icons } from "@/components/ui";
import { createEffect, createMemo, createResource, createSignal, For, lazy, on, onCleanup, onMount, Show, untrack } from "solid-js";
import { holdBack } from "@/components/ui/back";
import { formatShortcutBinding } from "../shortcuts/shortcut-normalize";
import { BotIcon, ChartColumnIcon, LaptopIcon, Mic2Icon, NetworkIcon, SmartphoneIcon, SparklesIcon } from "lucide-solid";
import { AboutSettingsFooter } from "./about-settings";
import { TitleBarSettings } from "./title-bar-settings";
import { DevicesSettingsTile } from "./devices-settings";
import { ServerSettings } from "./server-settings";
import { BlocksSettings, createContextData, PromptsSettings } from "./context-settings";
import { createAgentSettings } from "./agent-settings";
import { ToolsSettings } from "./tools-settings";
import { AccountSettings } from "./account-settings";
import { BrowserSettings } from "./browser-settings";
import { SkillsSettings } from "./skills-settings";
import { IntegrationsSettings } from "./connectors-settings";
import { UsageSettings } from "./usage-settings";
import { agentView } from "../state/agent";
import { createLatest } from "../state/latest";
import { createSingleFlight } from "../state/single-flight";
import { toast } from "@/components/ui/notifications";
import { api, readShared } from "../api/client";
import { formatMicrophoneError, hasAudioSignal, microphoneName, rememberMicrophones, isUnavailableAudioInputError, listAudioInputDevices, MAX_AUDIO_INPUT_TEST_DURATION_MS, revokeAudioInputRecording, startAudioInputTest as beginAudioInputTest, type AudioInputDevice, type AudioInputTestResult, type AudioInputTestSession, } from "../chat/voice-audio";
import { installedClientKind } from "../platform/installed-client";
import { hexStatus, type HexStatus } from "../platform/hex-local";

import { isPhoneVoice, shortcutFromKeyboardEvent } from "../chat/voice-dictation";
import type { VoiceDictationSettings } from "../chat/voice-dictation-types";
import { isWarmMicrophoneActive, stopWarmMicrophone } from "../chat/voice-dictation-client";
import { createVoiceWaveformController } from "../chat/voice-waveform";
import { VoiceWaveform } from "@/components/ui/voice";
import { ModelSelector } from "../chat/model-selector";
import { saveTabFrost, tabFrost } from "../preferences/tab-frost";
import { saveTranscriptFont, TRANSCRIPT_FONT_OPTIONS, transcriptFont, type TranscriptFont } from "../preferences/transcript-font";
import { RUN_FORMS, runForm, saveRunForm, type RunForm } from "../preferences/run-form";
import { saveTranscriptScale, TRANSCRIPT_SCALE_OPTIONS, transcriptScale, type TranscriptScale } from "../preferences/transcript-scale";
import { MOTION_SCALE_OPTIONS, motionScale, saveMotionScale, type MotionScale } from "../preferences/motion-scale";
import { saveTerminalFont, TERMINAL_FONT_OPTIONS, terminalFont, type TerminalFont } from "../preferences/terminal-font";
import { saveStreamFade, saveStreamMathFade, STREAM_FADE_OPTIONS, streamFadeMs, streamMathFade } from "../preferences/stream-fade";
import type { PiAuthAttempt, PiAuthAttemptPayload, PiAuthProvider, PiAuthProvidersPayload, Project, Template, VoiceExecutionProfile, VoiceLocalSelection, VoiceServerSettings } from "../api/contracts";
import type { ModelSettings } from "../state/model-settings";
import { MAX_SIDEBAR_CHAT_LIMIT, MIN_SIDEBAR_CHAT_LIMIT } from "../navigation/sidebar-preferences";
import type { ShortcutManager } from "../shortcuts/shortcut-manager";
import { COMMAND_IDS } from "../commands/command-registry";
import { SETTINGS_SECTIONS } from "../palette/command-registry";
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
  AGENT_MESSAGES_WIDTH_OPTIONS,
  agentMessagesWidth,
  saveAgentMessagesWidth,
  type AgentMessagesWidthMode,
  USER_MESSAGE_COLLAPSE_OPTIONS,
  type UserMessageCollapseMode,
  type TranscriptWideBlocksMode,
  type TranscriptWidthMode,
} from "../chat/transcript-appearance";
import type { CodeBlockCollapseMode } from "../chat/code-block";
import { ShortcutsSettings } from "./shortcuts-settings";
import settingsIndex from "virtual:settings-index";
import { markSwept, readSettings, rememberSettings, seenSettings, sweptAt } from "./settings-values";
import { Button, Input, Spinner, Segmented, Slider, Switch } from "@/components/ui/controls";
import { Select } from "@/components/ui/menus";
import { combineSaveStates, createAutosave, type SaveState } from "./autosave";
import { Dialog, OverlayDialog } from "@/components/ui/dialog";
import { catchLoopback, loopbackPort } from "../platform/loopback";
import { OverlayPage, OverlayRail, SettingLine, SettingValue, SettingLink, SettingDetails, SettingWide, SettingCredential, SettingStep, SettingRecorder, Keycap, HarnessMark, Row, Group, Columns, Column, SettingViews, Note, Loading, LeadInput } from "@/components/ui";
import { isMobileLayout } from "../navigation/mobile-layout";
import { touchOnly } from "@/components/ui/layout";
import { COMPOSER_KINDS, composerKind, saveComposerKind } from "../platform/native-composer";
import { HAPTIC_STRENGTHS, hapticStrength, saveHapticStrength, type HapticStrength } from "@/components/ui/haptics";
import { uiPreferenceSaves } from "../preferences/ui-preferences";
import { conduitFloat, type FloatHoldTarget, type FloatStatus } from "../platform/float";

const allSectionGroups = [
  { label: "Personal", sections: [{ id: "account", label: "Account", icon: Icons.User }, { id: "ui", label: "Appearance", icon: Icons.Monitor }, { id: "shortcuts", label: "Shortcuts", icon: Icons.Keyboard }] },
  { label: "AI", sections: [{ id: "models", label: "Models", icon: BotIcon }, { id: "prompts", label: "Prompts", icon: Icons.FileText }, { id: "blocks", label: "Blocks", icon: Icons.Boxes }, { id: "tools", label: "Tools", icon: Icons.Tool }, { id: "skills", label: "Skills", icon: SparklesIcon }, { id: "agent", label: "Agent", icon: Icons.Agent }] },
  { label: "System", sections: [{ id: "server", label: "Server", icon: Icons.Server }, { id: "device", label: "This device", icon: installedClientKind === "android" ? SmartphoneIcon : LaptopIcon }, { id: "devices", label: "Network", icon: NetworkIcon }, { id: "usage", label: "Usage", icon: ChartColumnIcon }] },
  { label: "Services", sections: [{ id: "voice", label: "Voice", icon: Mic2Icon }, { id: "search", label: "Web search", icon: Icons.Search }, { id: "browser", label: "Hub browser", icon: Icons.Browser }, { id: "integrations", label: "Integrations", icon: Icons.ExternalLink }] },
] as const;
type VisibleSection = typeof allSectionGroups[number]["sections"][number]["id"];
const sectionGroups = touchOnly() ? allSectionGroups.map((group) => ({ ...group, sections: group.sections.filter((item) => item.id !== "shortcuts") })) : allSectionGroups;
type Section = VisibleSection | "workspaces";
const WIDE_SECTIONS = new Set<string>(["prompts", "blocks", "skills", "tools"]);
// Workspace profile is reached from a workspace, not the rail.
const sectionLabels = { ...Object.fromEntries(allSectionGroups.flatMap((group) => group.sections.map((item) => [item.id, item.label]))), workspaces: "Workspace profile" } as Record<Section, string>;
const label = (section: Section) => section === "agent" ? agentView()?.settings?.name || sectionLabels.agent : sectionLabels[section];
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
  reviewModel?: string;
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
  { key: "webSearch", label: "Search the web", title: "Searches with the providers below and keeps the results for paging." },
  { key: "fetchContent", label: "Read pages", title: "Reads a page, PDF, video or repository by its address." },
  { key: "sourceCheck", label: "Check sources", title: "Gathers sources for a claim with passage-level citations." },
  { key: "getSearchContent", label: "Page stored results", title: "Pages through a search's or a fetch's full stored results." },
];
const SEARCH_FETCHING: Array<{ key: SearchFetching; label: string; title: string }> = [
  { key: "github", label: "GitHub repositories", title: "Clones a repository to read its files, instead of scraping its pages." },
  { key: "video", label: "YouTube and video", title: "Transcripts, what is on screen and frames, for YouTube and local video files." },
  { key: "pdf", label: "PDFs", title: "Reads a PDF's text instead of returning the file." },
];
const ACCOUNT_SOURCES: Record<NonNullable<PiAuthProvider["auth"]["source"]> | "none", string> = {
  stored: "connected", environment: "key from the server", managed: "agent settings", none: "not connected",
};
const HEX_STATES: Record<HexStatus["state"], string> = { ready: "Found", idle: "Found, not listening", stopped: "Not running", absent: "Not found" };
const SEARCH_TIME_LIMITS: Array<{ ms: number | null; label: string }> = [
  { ms: null, label: "None" }, { ms: 15_000, label: "15 s" }, { ms: 30_000, label: "30 s" }, { ms: 60_000, label: "1 min" }, { ms: 120_000, label: "2 min" },
];
const CLOUDFLARE_NEEDED = "Needs a Cloudflare Workers AI key and account ID: add them in Models.";

const voiceSelectionFromProfile = (profile: VoiceExecutionProfile): VoiceLocalSelection => ({
  modelId: profile.modelId,
  artifactId: profile.artifactId,
  execution: profile.execution,
  segmentation: profile.segmentation,
});
const selectionMatchesProfile = (selection: VoiceLocalSelection, profile: VoiceExecutionProfile) => selection.modelId === profile.modelId
  && selection.artifactId === profile.artifactId
  && selection.execution === profile.execution
  && selection.segmentation === profile.segmentation;
const selectionArtifactMatchesProfile = (selection: VoiceLocalSelection, profile: VoiceExecutionProfile) => selection.artifactId === profile.artifactId
  && selection.execution === profile.execution
  && selection.segmentation === profile.segmentation;
const sameVoiceSelection = (left: VoiceLocalSelection | null | undefined, right: VoiceLocalSelection | null | undefined) => Boolean(left && right
  && left.modelId === right.modelId
  && left.artifactId === right.artifactId
  && left.execution === right.execution
  && left.segmentation === right.segmentation);
// Checked against the ranges the server keeps them in, which it would otherwise clamp to silently.
type RuntimeDraft = { live: string; generating: string };
const RUNTIME_LIMITS = { live: [1, 32], generating: [1, 8] } as const;
// A count chosen from steps, the current one kept among them when it is not one (set elsewhere).
const countSteps = (steps: number[], current: number | string) => [...new Set([...steps, Number(current)])].filter(Number.isFinite).sort((a, b) => a - b);
/** Whether this browser draws on the graphics card: a software renderer (SwiftShader, llvmpipe) says it does not. */
const gpuRendering = (() => {
  let known: boolean | null | undefined;
  return () => {
    if (known !== undefined) return known;
    try {
      const gl = document.createElement("canvas").getContext("webgl");
      const info = gl?.getExtension("WEBGL_debug_renderer_info");
      const renderer = gl && info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : "";
      known = !gl ? false : renderer ? !/swiftshader|llvmpipe|softpipe|software|basic render/i.test(renderer) : null;
    } catch { known = null; }
    return known;
  };
})();
const SIDEBAR_CHAT_STEPS = [5, 10, 15, 20, 30, 50, 75, 100];
const RUNTIME_STEPS = { live: [1, 2, 4, 6, 8, 12, 16, 24, 32], generating: [1, 2, 3, 4, 5, 6, 7, 8] } as const;
const SEARCH_INDEX_DELAY_MS = 600;
const SECTION_SWITCH_PAUSE_MS = 90;
const FOUND_MARK_MS = 1600;
const LOOKUP_RETRY_MS = 50;
const READ_SETTLE_MS = 400;
const SWEEP_START_MS = 300;
/** The wait for an idle moment where requestIdleCallback is missing. */
const IDLE_FALLBACK_MS = 50;
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
const VoiceHistory = lazy(() => import("./voice-history"));

export function Settings(props: {
  open: boolean;
  initialSection: Section;
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
  onAddWorkspace: (input: { mode: "node"; nodeId: string; rootId: string }) => Promise<boolean>;
  onOpenDeviceTerminal: (node: { id: string; local?: boolean }) => void;
  onOpenDeviceBrowser?: (nodeId: string) => void;
  onOpenWorkspace: (project: Project) => void;
  shortcuts: ShortcutManager;
  /** Drawn out of sight to read every section's values: no dialog, no keys of its own; called when done. */
  harvest?: () => void;
}) {
  const [section, setSection] = createSignal<Section>(props.initialSection || "ui");
  const [frosted, setFrosted] = createSignal(tabFrost());
  const [hapticChoice, setHapticChoice] = createSignal<HapticStrength>(hapticStrength());
  const [composerChoice, setComposerChoice] = createSignal(composerKind());
  const [transcriptScaleChoice, setTranscriptScaleChoice] = createSignal(transcriptScale());
  const [motionScaleChoice, setMotionScaleChoice] = createSignal(motionScale());
  const [transcriptFontChoice, setTranscriptFontChoice] = createSignal(transcriptFont());
  const [terminalFontChoice, setTerminalFontChoice] = createSignal(terminalFont());
  const [fadeMs, setFadeMs] = createSignal(streamFadeMs());
  // On a phone there is no room for both the rail and a section, so they take turns.
  const [browsingSections, setBrowsingSections] = createSignal(true);
  const narrow = isMobileLayout;
  const openSection = (id: Section) => {
    setSection(id);
    setBrowsingSections(false);
    if (narrow()) queueMicrotask(() => document.querySelector<HTMLElement>('[role="dialog"][aria-label="Settings"] main h2')?.focus());
  };
  const [query, setQuery] = createSignal("");
  const [cursor, setCursor] = createSignal(0);
  createEffect(on(query, () => setCursor(0)));
  // The first search fetches what only the hub knows (accounts, search providers, documents), so they can be found
  // before their sections were ever opened.
  let searched = false;
  createEffect(() => { if (!query().trim() || searched) return; searched = true; void loadPiAuth(); void loadSearchSettings(); if (!context.data()) void context.load(); });
  type Entry = { section: Section; group: string | null; label: string; words?: string; acts?: string; value?: string };
  // Text as search reads it: lowered, in words (letters and digits), so a key matches from a word's start.
  const wordsOf = (text: string) => text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  // Everything search can find, each with its text lowered once: built when searching starts and again only when what
  // it is made of changes (a value read, an account added), never per keystroke.
  const [searchable, setSearchable] = createSignal(false);
  createEffect(() => { if (query().trim()) setSearchable(true); });
  // ...or, sooner, in an idle moment once Settings is open, so the first key finds it made.
  createEffect(() => {
    if (!props.open || props.harvest || searchable()) return;
    const timer = window.setTimeout(() => setSearchable(true), SEARCH_INDEX_DELAY_MS);
    onCleanup(() => clearTimeout(timer));
  });
  const entries = createMemo(() => {
    if (!searchable()) return [];
    const sections: Entry[] = sectionGroups.flatMap((group) => group.sections.map((item) => ({ section: item.id as Section, group: null, label: label(item.id as Section),
      words: SETTINGS_SECTIONS.find((known) => known.id === item.id)?.keywords.join(" ") })));
    const known = new Set(sections.map((item) => item.section));
    const live: Entry[] = [
      ...props.shortcuts.commands.map((command) => ({ section: "shortcuts" as Section, group: "Shortcuts", label: command.label, words: command.contexts.join(" "),
        value: props.shortcuts.effectiveBindings(command.id).map((binding) => formatShortcutBinding(binding, props.shortcuts.environment)).join(" · ") })),
      ...authProviders().filter((provider) => provider.auth.configured).map((provider) => ({ section: "integrations" as Section, group: "Model providers", label: provider.label, words: "account" })),
      ...(searchSettings()?.providers ?? []).filter((provider) => provider.ready).map((provider) => ({ section: "search" as Section, group: "Providers", label: provider.label })),
      ...(context.data()?.documents ?? []).map((document) => ({ section: "prompts" as Section, group: "Documents", label: document.role.label, words: "prompt document" })),
      ...(context.data()?.blocks ?? []).map((block) => block.skill ? { section: "skills" as Section, group: "Skills", label: block.label, words: "skill" } : { section: "blocks" as Section, group: "Blocks", label: block.label, words: "block" }),
    ];
    const values = new Map(seenSettings().map((seen) => [`${seen.section}\0${seen.label}`, seen]));
    const named = [...settingsIndex.map((entry) => ({ ...entry, section: entry.section as Section })), ...live];
    const have = new Set(named.map((entry) => `${entry.section}\0${entry.label}`));
    const all: Entry[] = [...sections, ...[...named.map((entry) => ({ ...entry, value: (entry as Entry).value ?? values.get(`${entry.section}\0${entry.label}`)?.value })),
      ...[...values.values()].filter((seen) => !have.has(`${seen.section}\0${seen.label}`)).map((seen) => ({ ...seen, section: seen.section as Section }))].filter((entry) => known.has(entry.section))];
    const once = new Set<string>();
    // A setting is found by its name, its group, its page, what it is set to and what its buttons do. What else it says
    // (its description, its other options) stands in only until its value has been read, or "medium" would find every
    // setting that could be Medium.
    return all.filter((entry) => { const key = `${entry.section}\0${entry.label}`; if (once.has(key)) return false; once.add(key); return true; }).map((entry) => ({
      entry, whole: entry.group === null && entry.label === label(entry.section), plain: entry.label.toLowerCase(),
      name: wordsOf(entry.label), where: wordsOf(`${label(entry.section)} ${entry.group ?? ""}`), set: wordsOf(entry.value ?? ""),
      said: wordsOf(`${entry.acts ?? ""} ${entry.value === undefined || entry.group === null ? entry.words ?? "" : ""}`),
    }));
  });
  const results = createMemo(() => {
    const typed = query().trim().toLowerCase();
    const words = wordsOf(typed);
    if (!words.length) return [];
    const begins = (list: string[], word: string) => list.some((item) => item.startsWith(word));
    const scored: Array<Entry & { score: number }> = [];
    for (const { entry, whole, plain, name, where, set, said } of entries()) {
      let score = plain === typed ? 0 : plain.startsWith(typed) ? 0.5 : 1;
      for (const word of words) {
        const at = begins(name, word) ? 1 : begins(where, word) ? 2 : begins(set, word) ? 2.5 : begins(said, word) ? 3 : -1;
        if (at < 0) { score = -1; break; }
        if (at > score) score = at;
      }
      if (score >= 0) scored.push({ ...entry, score: score - (whole ? 0.25 : 0) });
    }
    return scored.sort((a, b) => a.score - b.score);
  });
  const matches = createMemo(() => {
    const found = new Map<Section, ReturnType<typeof results>>();
    for (const group of sectionGroups) for (const item of group.sections) {
      const whole = (result: { group: string | null; label: string }) => result.group === null && result.label === label(item.id as Section);
      const mine = results().filter((result) => result.section === item.id).sort((a, b) => Number(whole(b)) - Number(whole(a)));
      if (mine.length) found.set(item.id as Section, mine);
    }
    return found;
  });
  const flat = createMemo(() => [...matches().values()].flat());
  let before: Section | null = null;
  let moved: Section | null = null;
  createEffect(() => {
    if (narrow()) return;
    if (!query().trim()) {
      if (before && moved === untrack(section)) setSection(before);
      before = moved = null;
      return;
    }
    before ??= untrack(section);
    if (!matches().size || matches().has(section())) return;
    // Drawing a section costs a frame or more: it waits for a pause in the typing, so no key is held up by it.
    const next = [...matches().keys()][0]!;
    const timer = window.setTimeout(() => { moved = next; setSection(next); }, SECTION_SWITCH_PAUSE_MS);
    onCleanup(() => clearTimeout(timer));
  });
  // Lines arrive after their data, so the page is filtered again as it changes.
  const filterPage = (body: Element, found: ReturnType<typeof results> | null) => {
    for (const element of body.querySelectorAll("[data-filtered-out], [data-filter-first]")) { element.removeAttribute("data-filtered-out"); element.removeAttribute("data-filter-first"); }
    // The whole page only when the section was found by its own name, not by a word it also answers to.
    if (!found || found.some((result) => result.group === null && result.label === label(result.section) && result.score <= 1)) return;
    const groups = [...body.querySelectorAll<HTMLElement>('.ui-group[data-group="setting"]')];
    if (!groups.length) return;
    const names = found.filter((result) => result.group !== null).map((result) => result.label);
    const titles = found.filter((result) => result.group === null).map((result) => result.label);
    const out: Element[] = [];
    let shown = 0;
    for (const group of groups) {
      const title = group.querySelector(":scope > .ui-nav-label")?.textContent?.trim() ?? "";
      if (title && titles.some((name) => title.startsWith(name))) { shown++; continue; }
      const kept = [...group.querySelectorAll<HTMLElement>(".ui-setting-line")].filter((line) => names.some((name) => line.textContent?.trim().startsWith(name)));
      if (!kept.length) { out.push(group); continue; }
      shown++;
      for (const child of group.children) if (!child.matches(".ui-nav-label") && !kept.some((line) => child === line || child.contains(line))) out.push(child);
    }
    if (!shown) return;
    for (const child of body.children) if (!groups.some((group) => child === group || child.contains(group))) out.push(child);
    for (const element of out) element.setAttribute("data-filtered-out", "");
    groups.find((group) => !out.includes(group))?.setAttribute("data-filter-first", "");
  };
  createEffect(() => {
    const searching = !narrow() && Boolean(query().trim());
    const found = searching ? matches().get(section()) ?? null : null;
    const body = dialogEl()?.querySelector(".ui-overlay-page-body");
    if (!body) return;
    filterPage(body, found);
    if (searching && !matches().size) {
      for (const child of body.children) child.setAttribute("data-filtered-out", "");
      onCleanup(() => { for (const element of body.querySelectorAll("[data-filtered-out]")) element.removeAttribute("data-filtered-out"); });
    }
    if (!found) return;
    let frame = 0;
    const watcher = new MutationObserver(() => { cancelAnimationFrame(frame); frame = requestAnimationFrame(() => filterPage(body, found)); });
    watcher.observe(body, { childList: true, subtree: true });
    onCleanup(() => { watcher.disconnect(); cancelAnimationFrame(frame); for (const element of body.querySelectorAll("[data-filtered-out], [data-filter-first]")) { element.removeAttribute("data-filtered-out"); element.removeAttribute("data-filter-first"); } });
  });
  // Each opened result's lookup is its own: a newer one, another section or closing Settings ends an older one's retries.
  const lookup = createLatest();
  const openResult = (result: { section: Section; label: string; group: string | null }) => {
    openSection(result.section);
    if (result.group === null && result.label === label(result.section)) { requestAnimationFrame(focusPage); return; }
    // The section renders on the next frames (some after their data): look for the line a few times.
    let tries = 0;
    const mine = lookup.next();
    const find = () => {
      if (!mine() || !props.open || section() !== result.section) return;
      const dialog = document.querySelector('[role="dialog"][aria-label="Settings"] main');
      const line = [...(dialog?.querySelectorAll<HTMLElement>(".ui-setting-line, .ui-switch, .ui-nav-label, .ui-group-title, .ui-title, summary, .ui-chain-line") ?? [])]
        .find((element) => element.textContent?.trim().startsWith(result.label));
      const target = line?.closest<HTMLElement>(".ui-setting-line") ?? line;
      if (target) {
        target.scrollIntoView({ block: "center" });
        target.querySelector<HTMLElement>('input:not([type="hidden"]), select, textarea, button:not([disabled]), [tabindex="0"], [contenteditable="true"]')?.focus({ preventScroll: true });
        target.dataset.found = "";
        setTimeout(() => { delete target.dataset.found; }, FOUND_MARK_MS);
      } else if (++tries < 20) setTimeout(find, LOOKUP_RETRY_MS);
    };
    requestAnimationFrame(find);
  };
  const backToSections = () => {
    setBrowsingSections(true);
    queueMicrotask(() => document.querySelector<HTMLElement>('[role="dialog"][aria-label="Settings"] [role="tab"][aria-selected="true"]')?.focus());
  };
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
  const [reviewModel, setReviewModel] = createSignal("");
  const reviewAutosave = createAutosave<Pick<GeneralPreferences, "reviewModel">>({
    save: (value) => api<GeneralPreferences>("/v0/preferences", { method: "PATCH", body: JSON.stringify(value) }),
    onSaved: (saved) => setReviewModel(saved.reviewModel || ""),
  });
  const namingAutosave = createAutosave<Pick<GeneralPreferences, "sessionNameModel" | "sessionNameThinkingLevel">>({
    save: (value) => api<GeneralPreferences>("/v0/preferences", { method: "PATCH", body: JSON.stringify(value) }),
    onSaved: (saved) => { setSessionNameModel(saved.sessionNameModel); setSessionNameThinkingLevel(saved.sessionNameThinkingLevel); },
  });
  const defaultProfileAutosave = createAutosave<string>({
    save: async (id) => { await props.onDefaultTemplateChange(id); return id; },
    onSaved: () => {},
  });
  // Prompts and Blocks share one load of the context: a block opened from a document's stack opens in Blocks, and a
  // document a block is used in opens in Prompts.
  const context = createContextData();
  const [contextDocument, setContextDocument] = createSignal("");
  const [contextBlock, setContextBlock] = createSignal("");
  const [openSkill, setOpenSkill] = createSignal("");
  createEffect(() => { if (props.open && (section() === "prompts" || section() === "blocks")) void context.load(); });
  const [workspaceId, setWorkspaceId] = createSignal<string | null>(null);
  const [authProviders, setAuthProviders] = createSignal<PiAuthProvider[]>([]);
  const [authAttempt, setAuthAttempt] = createSignal<PiAuthAttempt | null>(null);
  // Load, poll, start and answer each write the attempt; the last one asked wins, so an older answer cannot bring
  // back a prompt already answered.
  const attemptWrites = createLatest();
  const [addingAccount, setAddingAccount] = createSignal("");
  const [addingSearch, setAddingSearch] = createSignal("");
  const [authResponse, setAuthResponse] = createSignal("");
  const [authLoading, setAuthLoading] = createSignal(false);
  const [authError, setAuthError] = createSignal("");
  const [authUnavailable, setAuthUnavailable] = createSignal(false);
  const [chatGptStatus, setChatGptStatus] = createSignal<ChatGptWebStatus | null>(null);
  const [chatGptBusy, setChatGptBusy] = createSignal(false);
  const [chatGptError, setChatGptError] = createSignal("");
  const [searchSettings, setSearchSettings] = createSignal<SearchSettings | null>(null);
  const [searchStatus, setSearchStatus] = createSignal<"idle" | "loading" | "ready" | "error">("idle");
  const [searchError, setSearchError] = createSignal("");
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
  const [voiceBusy, setVoiceBusy] = createSignal(false);
  const [recordingVoiceKeys, setRecordingVoiceKeys] = createSignal(false);
  const [voiceView, setVoiceView] = createSignal<"settings" | "history">("settings");
  const [voiceKeys, setVoiceKeys] = createSignal("");
  const [voiceLicenseAccepted, setVoiceLicenseAccepted] = createSignal(false);
  const [voiceTestResult, setVoiceTestResult] = createSignal("");
  const [voiceDraft, setVoiceDraft] = createSignal<VoiceDictationSettings>({ ...props.voiceSettings });
  const [floatStatus, setFloatStatus] = createSignal<FloatStatus | null>(null);
  const [floatBusy, setFloatBusy] = createSignal(false);
  const [floatError, setFloatError] = createSignal("");
  const floatFailure = (error: unknown) => setFloatError(error instanceof Error ? error.message : "Could not update Float.");
  const floatSetupLeft = () => {
    const status = floatStatus();
    if (!status) return 0;
    return (status.screenContext ? 0 : 1) + (status.assistant ? (status.sideKey === "unset" ? 1 : 0) : 1);
  };
  const refreshFloat = () => {
    if (installedClientKind !== "android") return;
    void conduitFloat.status().then(setFloatStatus).catch(floatFailure);
  };
  createEffect(() => {
    if (!props.open || section() !== "device" || installedClientKind !== "android") return;
    refreshFloat();
    const visible = () => { if (document.visibilityState === "visible") refreshFloat(); };
    window.addEventListener("focus", refreshFloat);
    document.addEventListener("visibilitychange", visible);
    onCleanup(() => {
      window.removeEventListener("focus", refreshFloat);
      document.removeEventListener("visibilitychange", visible);
    });
  });
  const changeFloat = async (enabled: boolean) => {
    setFloatBusy(true);
    setFloatError("");
    try { setFloatStatus(await (enabled ? conduitFloat.start(voiceDraft()) : conduitFloat.stop())); }
    catch (error) { floatFailure(error); refreshFloat(); }
    finally { setFloatBusy(false); }
  };
  const changeFloatHold = async (options: { holdToTalk?: boolean; holdTarget?: FloatHoldTarget }) => {
    setFloatError("");
    try { setFloatStatus(await conduitFloat.setHold(options)); }
    catch (error) { floatFailure(error); }
  };
  const changeSideKey = async (options: { sideKeyOnly?: boolean; sideKeyScreenshot?: boolean; sideKeyDictates?: boolean; sideKeyTarget?: FloatHoldTarget }) => {
    setFloatError("");
    try { setFloatStatus(await conduitFloat.setSideKey(options)); }
    catch (error) { floatFailure(error); }
  };
  const allowFloatOverlay = async () => {
    setFloatBusy(true);
    setFloatError("");
    try { setFloatStatus(await conduitFloat.openOverlaySettings()); }
    catch (error) { floatFailure(error); }
    finally { setFloatBusy(false); }
  };
  const [warmMicrophoneActive, setWarmMicrophoneActive] = createSignal(isWarmMicrophoneActive());
  const [hexHere, { refetch: refetchHex }] = createResource(hexStatus);
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
  const runtimeRequest = createLatest();
  const searchRequest = createLatest();
  let voiceInputSelect!: HTMLSelectElement;
  let returnFocus: HTMLElement | null = null;
  let wasOpen = false;
  const voiceLoadRequest = createLatest();
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
    // A secret being entered in its row, or keys being recorded: their own Escape puts the row back, Settings stays.
    if (target?.closest("[data-credential], .ui-setting-recorder")) return;
    if (target?.matches('[aria-label="Search settings"]') && query()) { event.preventDefault(); event.stopPropagation(); setQuery(""); return; }
    if (!narrow() && target?.closest('[role="dialog"][aria-label="Settings"] main')) {
      event.preventDefault();
      // A search over the rail: it clears first, then its rail comes back to step to (no rail tab exists under results).
      if (query()) { setQuery(""); requestAnimationFrame(focusRail); return; }
      // A field answers its own Escape first (a title puts its name back): the step back waits until it has, so moving
      // focus never blurs an edit into a save.
      if (target.matches("input, textarea, [contenteditable='true']")) { queueMicrotask(focusRail); return; }
      event.stopPropagation(); focusRail(); return;
    }
    event.preventDefault();
    event.stopPropagation();
    props.onOpenChange(false);
  };
  // The rail's and the results' arrows are list grammar, so they stay with their lists.
  const dialogEl = () => document.querySelector<HTMLElement>('[role="dialog"][aria-label="Settings"]');
  const focusRail = () => dialogEl()?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')?.focus();
  const focusPage = () => {
    const main = dialogEl()?.querySelector("main");
    const first = [...(main?.querySelectorAll<HTMLElement>('input:not([type="hidden"]):not([disabled]), select, textarea, button:not([disabled]), a[href], [tabindex="0"], [contenteditable="true"]') ?? [])]
      .find((element) => !element.closest(".ui-overlay-page-head") && element.getClientRects().length);
    first?.focus();
  };
  const focusSearch = () => dialogEl()?.querySelector<HTMLInputElement>('[aria-label="Search settings"]')?.focus();
  // Find in Settings acts from inside the dialog, and not in a code editor, which has its own find. (A bare `/` never
  // reaches it from a field: the manager leaves unmodified keys to whatever is being typed in.)
  const findAvailable = () => {
    const focused = document.activeElement;
    return Boolean(focused?.closest('[role="dialog"][aria-label="Settings"]') && !focused.closest(".cm-editor"));
  };
  const navigateSettingsTabs = (event: KeyboardEvent) => {
    if ((event.key === "ArrowRight" || event.key === "Enter") && !narrow()) { event.preventDefault(); if (event.key === "Enter") (event.currentTarget as HTMLElement).click(); requestAnimationFrame(focusPage); return; }
    if (!["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
    const nav = event.currentTarget instanceof HTMLElement ? event.currentTarget.closest("nav") : null;
    const tabs = nav ? Array.from(nav.querySelectorAll<HTMLButtonElement>('[role="tab"]')) : [];
    const current = event.currentTarget instanceof HTMLButtonElement ? tabs.indexOf(event.currentTarget) : -1;
    if (current < 0 || !tabs.length) return;
    event.preventDefault();
    const index = event.key === "Home" ? 0
      : event.key === "End" ? tabs.length - 1
        : current + (event.key === "ArrowDown" ? 1 : -1);
    if (index < 0) { focusSearch(); return; }
    if (index >= tabs.length) return;
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
      setAuthResponse("");
      setVoiceTestResult("");
      audioInputWaveform.reset();
      clearAudioInputTest();
      setAudioInputSignalDetected(false);
      return;
    }
    setVoiceDraft({ ...props.voiceSettings });
    const initial = props.initialSection || "ui";
    setSection(initial);
    // A section asked for by name is what was wanted, not a list with it somewhere in it.
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
    if (!props.open || props.harvest) return;
    // A modal: the app's chords do not reach the page under it; its own chord (Ctrl+,) closes it.
    const releaseSettingsContext = props.shortcuts.activateContext("settings", { exclusive: true });
    const releaseClose = props.shortcuts.registerHandler(COMMAND_IDS.openSettings, "settings", () => props.onOpenChange(false));
    const releaseFind = props.shortcuts.registerHandler(COMMAND_IDS.findInSettings, "settings", focusSearch, { when: findAvailable });
    document.addEventListener("keydown", dismissEscape, true);
    const releaseBack = holdBack(() => {
      if (query()) return void setQuery("");
      if (narrow() && !browsingSections()) return void backToSections();
      props.onOpenChange(false);
    });
    onCleanup(() => {
      releaseBack();
      releaseSettingsContext();
      releaseClose();
      releaseFind();
      document.removeEventListener("keydown", dismissEscape, true);
    });
  });

  const loadRuntime = async () => {
    const current = runtimeRequest.next();
    setRuntimeStatus("loading");
    setRuntimeError("");
    try {
      // A save sent on leaving lands first, so coming back shows it.
      await runtimeAutosave.flush();
      const loaded = await api<RuntimeSettings>("/v0/runtime/settings");
      if (!current()) return;
      setRuntime(loaded);
      if (!runtimeAutosave.busy()) setRuntimeDraft(runtimeDraftOf(loaded));
      setRuntimeStatus("ready");
    } catch (error) {
      if (!current()) return;
      setRuntimeError((error as Error).message);
      setRuntimeStatus("error");
    }
  };
  createEffect(() => { if (props.open && section() === "server") void loadRuntime(); });
  type LiveProcess = { id: string; chatId: string; status: string; activity?: string; generation?: unknown; model?: string; createdAt?: string };
  const [processes, setProcesses] = createSignal<LiveProcess[]>([]);
  const chatTitles = new Map<string, string>();
  const [titlesSeen, setTitlesSeen] = createSignal(0);
  // One read out at a time: the 5 s poll, a slow answer outlasting it, follows that answer rather than racing it.
  const loadProcesses = createSingleFlight(async () => {
    try {
      const { sessions } = await api<{ sessions: LiveProcess[] }>("/v0/live-sessions");
      const live = sessions.filter((session) => session.status !== "stopped");
      setProcesses(live);
      const unknown = live.filter((session) => !chatTitles.has(session.chatId));
      await Promise.all(unknown.map(async (session) => {
        const chat = await api<{ title?: string; status?: string }>(`/v0/chats/${encodeURIComponent(session.chatId)}`).catch(() => null);
        // An empty draft is a new chat started ahead, so the next one opens at once.
        chatTitles.set(session.chatId, chat?.title || (chat?.status === "draft" ? "New chat" : "Untitled chat"));
      }));
      if (unknown.length) setTitlesSeen((count) => count + 1);
    } catch { /* the counts above still say how many */ }
  });
  createEffect(() => {
    if (!props.open || section() !== "server") return;
    void loadProcesses();
    const timer = window.setInterval(() => void loadProcesses(), 5000);
    onCleanup(() => window.clearInterval(timer));
  });
  const stopProcess = async (id: string) => {
    try { await api(`/v0/live-sessions/${encodeURIComponent(id)}/process`, { method: "DELETE", replay: false }); }
    catch (error) { setRuntimeError((error as Error).message); }
    await Promise.all([loadProcesses(), loadRuntime()]);
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
    const latest = attemptWrites.next();
    try {
      const [status, attempt] = await Promise.all([
        api<PiAuthProvidersPayload>("/v0/pi-auth"),
        api<PiAuthAttemptPayload>("/v0/pi-auth/attempt"),
      ]);
      applyAuthProviders(status.providers);
      if (latest()) setAuthAttempt(attempt.attempt);
      if (status.providers.some((provider) => provider.id === addingAccount() && provider.auth.configured)) setAddingAccount("");
      setAuthError("");
      setAuthUnavailable(false);
    } catch (error) {
      const response = error as Error & { code?: string };
      setAuthUnavailable(response.code === "pi_auth_login_required");
      setAuthError(response.message);
    } finally { setAuthLoading(false); }
  };
  createEffect(() => { if (props.open && (section() === "models" || section() === "integrations")) void loadPiAuth(); });
  const loadChatGptStatus = async () => {
    try { setChatGptStatus(await api<ChatGptWebStatus>("/v0/chatgpt-web/status")); setChatGptError(""); }
    catch (error) { setChatGptError((error as Error).message); }
  };
  const saveChatGptCookie = async (cookie: string) => {
    setChatGptBusy(true);
    try {
      setChatGptStatus(await api<ChatGptWebStatus>("/v0/chatgpt-web/credential", { method: "PUT", body: JSON.stringify({ cookie }), replay: false }));
      setChatGptError("");
    } catch (error) { setChatGptError((error as Error).message); throw error; }
    finally { setChatGptBusy(false); }
  };
  const removeChatGptCookie = async () => {
    setChatGptBusy(true);
    try { setChatGptStatus(await api<ChatGptWebStatus>("/v0/chatgpt-web/credential", { method: "DELETE" })); setChatGptError(""); }
    catch (error) { setChatGptError((error as Error).message); }
    finally { setChatGptBusy(false); }
  };
  createEffect(() => { if (props.open && (section() === "models" || section() === "integrations")) void loadChatGptStatus(); });
  // An installed app catches the sign-in's last page itself (it ends on this device's localhost) and hands its
  // address to the hub, so nothing is copied; a browser tab cannot listen, and keeps the paste.
  const authTarget = createMemo(() => { const attempt = authAttempt(); return attempt?.active && attempt.owned && attempt.authUrl ? loopbackPort(attempt.authUrl) : null; });
  const [catching, setCatching] = createSignal(false);
  createEffect(() => {
    const port = authTarget();
    const held = port === null ? null : catchLoopback(port);
    setCatching(Boolean(held));
    if (!held) return;
    let over = false;
    void held.url.then((url) => { if (over) return; setCatching(false); if (url) void answerAuthPrompt(url); });
    onCleanup(() => { over = true; held.stop(); });
  });
  // The sign-in dialog lives in Integrations and the providers in Models, so the poll follows the attempt, not the section.
  const pollAttempt = createSingleFlight(async () => {
    const latest = attemptWrites.next();
    try {
      const result = await api<PiAuthAttemptPayload>("/v0/pi-auth/attempt");
      if (!latest()) return;
      setAuthAttempt(result.attempt);
      if (!result.attempt?.active) applyAuthProviders((await api<PiAuthProvidersPayload>("/v0/pi-auth")).providers);
    } catch (error) { setAuthError((error as Error).message); }
  });
  createEffect(() => {
    if (!props.open || !authAttempt()?.active) return;
    // A tick while a load or an answer is out leaves the attempt to it, so the poll never retires the answer.
    const timer = window.setInterval(() => { if (!authLoading()) void pollAttempt(); }, 1000);
    onCleanup(() => window.clearInterval(timer));
  });

  const startOAuth = async (providerId: string) => {
    setAuthLoading(true);
    setAuthError("");
    const latest = attemptWrites.next();
    try {
      const result = await api<{ attempt: PiAuthAttempt }>("/v0/pi-auth/oauth", { method: "POST", body: JSON.stringify({ providerId }) });
      if (latest()) setAuthAttempt(result.attempt);
    } catch (error) { setAuthError((error as Error).message); }
    finally { setAuthLoading(false); }
  };
  const answerAuthPrompt = async (value: string) => {
    setAuthLoading(true);
    setAuthError("");
    const latest = attemptWrites.next();
    try {
      const result = await api<{ attempt: PiAuthAttempt }>("/v0/pi-auth/attempt/respond", { method: "POST", body: JSON.stringify({ value }) });
      if (latest()) setAuthAttempt(result.attempt);
      setAuthResponse("");
    } catch (error) { setAuthError((error as Error).message); }
    finally { setAuthLoading(false); }
  };
  const cancelOAuth = async () => {
    try { await api("/v0/pi-auth/attempt/cancel", { method: "POST" }); await loadPiAuth(); }
    catch (error) { setAuthError((error as Error).message); }
  };
  const saveApiKey = async (providerId: string, key: string, env: Record<string, string>) => {
    setAuthError("");
    try {
      await api("/v0/pi-auth/api-key", { method: "PUT", body: JSON.stringify({ providerId, key, env }), replay: false });
      await loadPiAuth();
      if (section() === "search") void loadSearchSettings();
    } catch (error) { setAuthError((error as Error).message); throw error; }
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
  const accountLine = (provider: PiAuthProvider, options: { label?: string; title?: string; pending?: boolean } = {}) => {
    const configured = () => provider.auth.configured;
    const signedIn = () => provider.auth.kind === "oauth";
    const state = () => provider.auth.kind ? (signedIn() ? "signed in" : "key stored") : ACCOUNT_SOURCES[provider.auth.source || "none"];
    return <>
      <SettingCredential label={options.label || provider.label} title={options.title} state={<>{state()}</>} busy={authLoading()}
        stored={provider.auth.removable && !signedIn()} editable={provider.auth.source !== "environment" && !signedIn()} add={provider.oauth ? "Use a key" : "Add key"}
        fields={(provider.fields || []).map((field) => ({ ...field, placeholder: provider.auth.kind === "key" ? "Unchanged" : "",
          title: `${field.name}, stored with the key. Left empty, the one stored before stays, or the server's own ${field.name} is used.` }))}
        onSave={(key, env) => saveApiKey(provider.id, key, env)} onRemove={provider.auth.removable ? () => void removePiAuth(provider.id) : undefined}
        actions={<>
          <Show when={provider.oauth && !configured()}><Button variant="secondary" size="sm" disabled={authLoading() || Boolean(authAttempt()?.active)} onClick={() => void startOAuth(provider.id)}>Sign in</Button></Show>
          <Show when={provider.oauth && signedIn()}><Button variant="ghost" size="icon-sm" aria-label={`Sign in to ${provider.label} again`} title="Sign in again" disabled={authLoading() || Boolean(authAttempt()?.active)} onClick={() => void startOAuth(provider.id)}><Icons.Refresh /></Button></Show>
          <Show when={signedIn() && provider.auth.removable}><Button variant="ghost" size="icon-sm" haptic="destructive" aria-label={`Remove ${provider.label}`} title="Remove" disabled={authLoading()} onClick={() => void removePiAuth(provider.id)}><Icons.Delete /></Button></Show>
          <Show when={options.pending}><Button variant="ghost" size="sm" onClick={() => setAddingAccount("")}>Cancel</Button></Show>
        </>} />
    </>;
  };

  const loadSearchSettings = async () => {
    const current = searchRequest.next();
    setSearchStatus("loading");
    setSearchError("");
    try {
      const loaded = await api<SearchSettings>("/v0/search/settings");
      if (!current()) return;
      setSearchSettings(loaded);
      setSearchStatus("ready");
    } catch (error) {
      if (!current()) return;
      setSearchError((error as Error).message);
      setSearchStatus("error");
    }
  };
  createEffect(() => { if (props.open && section() === "search") void loadSearchSettings(); });

  const editSearch = (edit: SearchEdit) => {
    const current = searchSettings();
    if (!current) return;
    setSearchSettings({ ...current, route: { ...current.route, ...edit.route }, tools: { ...current.tools, ...edit.tools }, fetching: { ...current.fetching, ...edit.fetching } });
    searchAutosave.edit(edit, "now");
  };
  const searchProvider = (id: string) => searchSettings()?.providers.find((provider) => provider.id === id);
  const routeState = () => {
    const first = searchSettings()?.route.first;
    if (!first || first === "auto") return "OpenAI on ChatGPT models, else Exa";
    const source = searchProvider(first)?.source;
    return source ? SEARCH_SOURCE_LABELS[source] : "not set up";
  };
  const saveSearchKey = async (id: string, key: string) => {
    setSearchSaving(true);
    setSearchError("");
    try { setSearchSettings(await api<SearchSettings>(`/v0/search/providers/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify({ key }), replay: false })); }
    catch (error) { setSearchError((error as Error).message); throw error; }
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
    const request = voiceLoadRequest.next();
    const generation = voiceSettingsGeneration;
    if (!quiet) setVoiceStatus("loading");
    setVoiceError("");
    try {
      const loaded = await api<VoiceServerSettings>("/v0/voice/settings");
      if (!request() || generation !== voiceSettingsGeneration || voiceSaveInFlight > 0 || voiceAutosave.busy()) return;
      const previous = voiceServerSettings();
      setVoiceServerSettings(preserveLocalSelection && previous ? preserveVoiceServerDraft(loaded, previous, voiceServerEdited()) : loaded);
      if (!preserveLocalSelection) setVoiceServerEdited(false);
      setVoiceStatus("ready");
    } catch (error) {
      if (!request() || generation !== voiceSettingsGeneration || voiceSaveInFlight > 0) return;
      setVoiceError((error as Error).message);
      setVoiceStatus("error");
    }
  };
  createEffect(() => {
    if (!props.open || (section() !== "voice" && section() !== "integrations")) return;
    void loadVoiceSettings();
  });

  const loadAudioInputs = async () => {
    setAudioInputStatus("loading");
    setAudioInputError("");
    try {
      const devices = await listAudioInputDevices();
      setAudioInputDevices(devices);
      setAudioInputStatus("ready");
      const patch = rememberMicrophones(voiceDraft(), devices);
      if (Object.keys(patch).length) updateVoiceDraft(patch);
    } catch (error) {
      setAudioInputError(formatMicrophoneError(error));
      setAudioInputStatus("error");
    }
  };
  createEffect(() => {
    if (!props.open || section() !== "voice") return;
    void loadAudioInputs();
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

  const updateVoiceDraft = (patch: Partial<VoiceDictationSettings>) => {
    if (patch.warmMicrophone === false) stopWarmMicrophone();
    const next = { ...voiceDraft(), ...patch };
    setVoiceDraft(next);
    voiceDraftAutosave.edit(next, "now");
    // A running Float takes other audio's handling with it; its status is read first when the Phone section has not
    // been opened yet, or the change would never reach it.
    if (installedClientKind === "android" && (patch.otherAudio !== undefined || patch.otherAudioLevel !== undefined)) {
      const known = floatStatus();
      void (known ? Promise.resolve(known) : conduitFloat.status())
        .then((status) => { setFloatStatus(status); return status.enabled ? conduitFloat.start(next).then(setFloatStatus) : undefined; })
        .catch(floatFailure);
    }
  };
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
  const selectedVoiceArtifact = createMemo(() => {
    const catalogue = voiceCatalogue();
    const selection = selectedVoiceSelection();
    return catalogue && selection ? catalogue.artifacts.find((artifact) => artifact.id === selection.artifactId) || null : null;
  });
  const selectedVoiceInstallModelId = createMemo(() => selectedVoiceArtifact()?.legacyModelId || voiceServerSettings()?.localModelId || "");
  const selectedLocalVoiceModel = createMemo(() => voiceServerSettings()?.local?.models.find((model) => model.id === selectedVoiceInstallModelId()));
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
  // A managed model is one artifact with one stop profile; the hub saves the selection in the catalogue's terms.
  const selectLocalModel = (id: string) => {
    const catalogue = voiceCatalogue();
    const artifact = catalogue?.artifacts.find((candidate) => candidate.legacyModelId === id);
    const profile = artifact && catalogue!.profiles.find((candidate) => candidate.artifactId === artifact.id);
    if (profile) selectLocalProfile(profile);
  };
  const persistVoiceServer = async (settings: VoiceServerSettings, secret = "") => {
    voiceSettingsGeneration += 1;
    voiceSaveInFlight += 1;
    try {
      // Not kept to send again: it carries the provider's secret.
      const saved = await api<VoiceServerSettings>("/v0/voice/settings", {
        method: "PUT",
        replay: false,
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
  const saveVoiceSecret = async (secret: string) => {
    setVoiceBusy(true);
    setVoiceError("");
    setVoiceTestResult("");
    try {
      await voiceAutosave.flush();
      const settings = voiceServerSettings();
      if (!settings) return;
      setVoiceServerSettings(await persistVoiceServer(settings, secret));
      setVoiceServerEdited(false);
    } catch (error) { setVoiceError((error as Error).message); throw error; }
    finally { setVoiceBusy(false); }
  };
  const testVoiceServer = async () => {
    const settings = voiceServerSettings();
    if (!settings) return;
    setVoiceBusy(true);
    setVoiceError("");
    setVoiceTestResult("");
    try {
      await voiceAutosave.flush();
      await api("/v0/voice/test", { method: "POST", body: "{}", timeout: false });
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
    const selectedDeviceId = isPhoneVoice() && voiceDraft().preferSpeakerphone ? voiceDraft().speakerphoneId : voiceDraft().inputDeviceId;
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
      if (!result.signalDetected) setAudioInputError("No microphone signal detected. Check the browser's site settings and the selected input.");
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
      setReviewModel(loaded.reviewModel || "");
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
  const agentSettings = createAgentSettings({ models: namingModels, onManageModels: props.onOpenModelSelector,
    onOpenBlock: (id) => { setContextBlock(id); openSection("blocks"); }, onOpenDocument: (id) => { setContextDocument(id); openSection("prompts"); } });
  const autosaved: Partial<Record<Section, { label: string; saves: Array<ReturnType<typeof createAutosave<any>>> }>> = {
    server: { label: "Agent process settings", saves: [runtimeAutosave] },
    voice: { label: "Voice settings", saves: [voiceAutosave, voiceDraftAutosave] },
    models: { label: "Model defaults", saves: [defaultProfileAutosave, namingAutosave, reviewAutosave] },
    search: { label: "Web search", saves: [searchAutosave] },
    ui: { label: "Appearance", saves: [uiPreferenceSaves] },
    shortcuts: { label: "Shortcuts", saves: [uiPreferenceSaves] },
    agent: { label: "Agent settings", saves: [agentSettings.autosave] },
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
  const pages = () => <>
          <Show when={section() === "prompts"}><PromptsSettings context={context} documentId={contextDocument()} onDocument={setContextDocument} onEditBlock={(id) => { setContextBlock(id); openSection("blocks"); }} onOpenSkill={(id) => { setOpenSkill(id.replace(/^skill-/, "")); openSection("skills"); }} models={namingModels} onManageModels={props.onOpenModelSelector} /></Show>
          <Show when={section() === "blocks"}><BlocksSettings context={context} blockId={contextBlock()} onBlock={setContextBlock} onOpenDocument={(id) => { setContextDocument(id); openSection("prompts"); }} /></Show>
          <Show when={section() === "ui"}>
            <>
              {/* This device's own: its screen and hand differ from the next one's. The other groups are taste. */}
              <Group title="Display" scope="This device">
                  <SettingLine label="Interface size">
                    <Select id="interface-scale" aria-label="Interface size" value={props.interfaceScale} onChange={(event) => props.onInterfaceScaleChange(parseUiScale(event.currentTarget.value))}>
                      <For each={UI_SCALE_OPTIONS}>{(scale) => <option value={scale}>{Math.round(scale * 100)}%</option>}</For>
                    </Select>
                  </SettingLine>
                  <SettingLine label="Animation speed" title="Slows every animation on this device, to look at one closely.">
                    <Select id="motion-scale" aria-label="Animation speed" value={String(motionScaleChoice())} onChange={(event) => setMotionScaleChoice(saveMotionScale(Number(event.currentTarget.value) as MotionScale))}>
                      <For each={MOTION_SCALE_OPTIONS}>{(scale) => <option value={String(scale)}>{scale === 1 ? "Normal" : `${scale}× slower`}</option>}</For>
                    </Select>
                  </SettingLine>
                <SettingLine plain label="Hardware acceleration"><SettingValue>{gpuRendering() === false ? "Off" : gpuRendering() ? "On" : "Unknown"}</SettingValue></SettingLine>
                <Show when={gpuRendering() === false}><Note>This browser draws without the graphics card, so motion and blur run slowly. Turn on “Use graphics acceleration when available” in its settings, then relaunch it.</Note></Show>
              </Group>
              <TitleBarSettings />
              <Show when={touchOnly()}>
                <Group title="Touch" scope="This device">
                    <SettingLine label="Composer" title="Use the web composer, or a native typing row on Android.">
                      <Select id="composer-kind" aria-label="Composer" value={composerChoice()} onChange={(event) => setComposerChoice(saveComposerKind(event.currentTarget.value === "native" ? "native" : "web"))}>
                        <For each={COMPOSER_KINDS}>{(option) => <option value={option.value}>{option.label}</option>}</For>
                      </Select>
                    </SettingLine>
                    <SettingLine label="Haptics" title="Each choice plays a press as you pick it.">
                      <Select id="haptic-strength" aria-label="Haptics" value={hapticChoice()} onChange={(event) => setHapticChoice(saveHapticStrength(event.currentTarget.value as HapticStrength))}>
                        <For each={HAPTIC_STRENGTHS}>{(option) => <option value={option.value}>{option.label}</option>}</For>
                      </Select>
                    </SettingLine>
                </Group>
              </Show>
              <Group title="Interface">
                  <SettingLine label="Terminal font">
                    <Select id="terminal-font" aria-label="Terminal font" value={terminalFontChoice()} onChange={(event) => setTerminalFontChoice(saveTerminalFont(event.currentTarget.value as TerminalFont))}>
                      <For each={TERMINAL_FONT_OPTIONS}>{(option) => <option value={option.value}>{option.label}</option>}</For>
                    </Select>
                  </SettingLine>
                  <SettingLine label="Sidebar chats">
                    <Select id="sidebar-chat-limit" aria-label="Sidebar chats" value={String(props.sidebarChatLimit)} onChange={(event) => props.onSidebarChatLimitChange(Number(event.currentTarget.value))}>
                      <For each={countSteps(SIDEBAR_CHAT_STEPS, props.sidebarChatLimit).filter((count) => count >= MIN_SIDEBAR_CHAT_LIMIT && count <= MAX_SIDEBAR_CHAT_LIMIT)}>{(count) => <option value={String(count)}>{count}</option>}</For>
                    </Select>
                  </SettingLine>
                  <SettingLine label="Tab row">
                    <Switch id="tab-frost" label="Frosted tab row" checked={frosted()} onChange={(on) => setFrosted(saveTabFrost(on))} />
                  </SettingLine>
                  <SettingLine label="Panel drag">
                    <Select id="panel-motion" aria-label="Panel drag" title={PANEL_MOTION_OPTIONS.find((option) => option.value === props.panelMotion)?.label} value={props.panelMotion} onChange={(event) => props.onPanelMotionChange(event.currentTarget.value as PanelMotionMode)}>
                      <For each={PANEL_MOTION_OPTIONS}>{(option) => <option value={option.value}>{option.label}</option>}</For>
                    </Select>
                  </SettingLine>
                  <SettingLine label="Meteor field">
                    <Switch id="meteor-field" label="Ambient meteor field" checked={props.meteorField} onChange={props.onMeteorFieldChange} />
                  </SettingLine>
              </Group>
              <Group title="Reading">
                  <SettingLine label="Transcript size" title="Messages and answers, on top of the Interface size; the chrome around them keeps its size.">
                    <Select id="transcript-scale" aria-label="Transcript size" value={String(transcriptScaleChoice())} onChange={(event) => setTranscriptScaleChoice(saveTranscriptScale(Number(event.currentTarget.value) as TranscriptScale))}>
                      <For each={TRANSCRIPT_SCALE_OPTIONS}>{(scale) => <option value={String(scale)}>{scale === 1 ? "As the interface" : `${Math.round(scale * 100)}%`}</option>}</For>
                    </Select>
                  </SettingLine>
                  <SettingLine label="Transcript font">
                    <Select id="transcript-font" aria-label="Transcript font" value={transcriptFontChoice()} onChange={(event) => setTranscriptFontChoice(saveTranscriptFont(event.currentTarget.value as TranscriptFont))}>
                      <For each={TRANSCRIPT_FONT_OPTIONS}>{(option) => <option value={option.value}>{option.label}</option>}</For>
                    </Select>
                  </SettingLine>
                  <SettingLine label="Transcript width">
                    <Select id="transcript-width" aria-label="Transcript width" value={props.transcriptWidth} onChange={(event) => props.onTranscriptWidthChange(event.currentTarget.value as TranscriptWidthMode)}>
                      <For each={TRANSCRIPT_WIDTH_OPTIONS}>{(option) => <option value={option.value}>{option.label}</option>}</For>
                    </Select>
                  </SettingLine>
                  <Show when={agentView()?.enabled}><SettingLine label={`${agentView()?.settings?.name || "The agent"}'s message view`} title="How wide its page's messages are: as the transcript, or its own width.">
                    <Select id="agent-messages-width" aria-label={`${agentView()?.settings?.name || "The agent"}'s message view width`} value={agentMessagesWidth()} onChange={(event) => saveAgentMessagesWidth(event.currentTarget.value as AgentMessagesWidthMode)}>
                      <For each={AGENT_MESSAGES_WIDTH_OPTIONS}>{(option) => <option value={option.value}>{option.label}</option>}</For>
                    </Select>
                  </SettingLine></Show>
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
                  <SettingLine label="Word fade">
                    <Select id="stream-fade" aria-label="Word fade time" value={fadeMs()} onChange={(event) => setFadeMs(saveStreamFade(Number(event.currentTarget.value)))}>
                      <For each={STREAM_FADE_OPTIONS}>{(option) => <option value={option.value}>{option.label}</option>}</For>
                    </Select>
                  </SettingLine>
                  <SettingLine label="Fade formulas in when complete">
                    <Switch id="stream-math-fade" label="Fade formulas in when complete" checked={streamMathFade()} onChange={saveStreamMathFade} />
                  </SettingLine>
              </Group>
              <Group title="Reasoning & tool use">
                  <SettingLine label="Work between texts" title={RUN_FORMS.find((option) => option.value === runForm())?.description}>
                    <Select id="run-form" aria-label="Work between texts" value={runForm()} onChange={(event) => saveRunForm(event.currentTarget.value as RunForm)}>
                      <For each={RUN_FORMS}>{(option) => <option value={option.value}>{option.label}</option>}</For>
                    </Select>
                  </SettingLine>
              </Group>
              <Group title="Collapse">
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
              </Group>
            </>
          </Show>
          <Show when={section() === "agent"}><agentSettings.Page /></Show>
          <Show when={section() === "tools"}><ToolsSettings /></Show>
          <Show when={section() === "skills"}><SkillsSettings context={context} skillId={openSkill()} onSkill={setOpenSkill} onOpenDocument={(id) => { setContextDocument(id); openSection("prompts"); }} /></Show>
          <Show when={section() === "account"}><AccountSettings /></Show>
          <Show when={section() === "browser"}><BrowserSettings /></Show>
          <Show when={section() === "integrations"}><>
            <Group title="Model providers">
              <Dialog open={Boolean(authAttempt()?.owned && (authAttempt()!.active || authAttempt()!.error))} onOpenChange={(open) => { if (!open) { if (authAttempt()?.active) void cancelOAuth(); else { attemptWrites.drop(); setAuthAttempt(null); } } }}
                title={`Sign in to ${authAttempt()?.providerLabel || "the provider"}`} description={authAttempt()?.message} close busy={authLoading()}>
                <Show when={authAttempt()}>{(current) => <>
                  <Show when={current().deviceCode}>{(device) => <>
                    <SettingStep step={1} label="Copy this code"><SettingValue mono>{device().userCode}</SettingValue>
                      <Button variant="ghost" size="icon-sm" aria-label="Copy the code" title="Copy" onClick={() => void navigator.clipboard.writeText(device().userCode).catch(() => {})}><Icons.Copy /></Button></SettingStep>
                    <SettingStep step={2} label="Enter it on the provider's page"><Button variant="secondary" size="sm" onClick={() => window.open(device().verificationUri, "_blank", "noopener,noreferrer")}><Icons.ExternalLink />Open page</Button></SettingStep>
                  </>}</Show>
                  <Show when={!current().deviceCode && current().authUrl}>
                    <SettingStep step={1} label="Sign in on the provider's page"><Button variant="secondary" size="sm" onClick={() => window.open(current().authUrl!, "_blank", "noopener,noreferrer")}><Icons.ExternalLink />Open sign-in</Button></SettingStep>
                    <Show when={catching()} fallback={<Show when={current().prompt && current().prompt!.type !== "select"}>
                      <Note tone="quiet">If the last page does not load, copy its address and paste it here.</Note>
                    </Show>}>
                      <SettingStep step={2} label="Come back here"><Spinner /></SettingStep>
                    </Show>
                  </Show>
                  <Show when={current().prompt?.type === "select"}><SettingLine plain label={current().prompt!.message}><For each={current().prompt!.options || []}>{(option) => <Button variant="secondary" size="sm" disabled={authLoading()} onClick={() => void answerAuthPrompt(option.id)}>{option.label}</Button>}</For></SettingLine></Show>
                  <Show when={!catching() && current().prompt && current().prompt!.type !== "select"}>
                    <Show when={current().authUrl} fallback={<SettingLine label={current().prompt!.message}>
                      <Input id="pi-auth-response" aria-label={current().prompt!.message} type="text" autocomplete="off" value={authResponse()} onInput={(event) => setAuthResponse(event.currentTarget.value)} placeholder={current().prompt!.placeholder || ""} onKeyDown={(event) => { if (event.key === "Enter" && authResponse().trim()) void answerAuthPrompt(authResponse()); }} />
                      <Button variant="ghost" size="icon-sm" aria-label="Paste" title="Paste" onClick={() => void navigator.clipboard.readText().then((text) => setAuthResponse(text.trim())).catch(() => {})}><Icons.Paste /></Button>
                    </SettingLine>}>
                      <SettingStep field step={2} label="Paste the address">
                      <Input id="pi-auth-response" aria-label={current().prompt!.message} type="text" autocomplete="off" value={authResponse()} onInput={(event) => setAuthResponse(event.currentTarget.value)} placeholder={current().prompt!.placeholder || ""} onKeyDown={(event) => { if (event.key === "Enter" && authResponse().trim()) void answerAuthPrompt(authResponse()); }} />
                      <Button variant="ghost" size="icon-sm" aria-label="Paste" title="Paste" onClick={() => void navigator.clipboard.readText().then((text) => setAuthResponse(text.trim())).catch(() => {})}><Icons.Paste /></Button>
                      </SettingStep>
                    </Show>
                    <SettingLine plain label=""><Button size="sm" disabled={authLoading() || !authResponse().trim()} onClick={() => void answerAuthPrompt(authResponse())}>Continue</Button></SettingLine>
                  </Show>
                  <Show when={current().error}><Note tone="error">{current().error}</Note></Show>
                </>}</Show>
              </Dialog>
              <Show when={authUnavailable()}><Note tone="error">Set a Conduit password with <code>node scripts/conduit-auth.mjs set-password</code>, then sign in to manage agent credentials here.</Note></Show>
              <Show when={authError() && !authUnavailable()}><Note tone="error">{authError()}</Note></Show>
              <Show when={!authUnavailable() && authLoading() && !authProviders().length} fallback={<Show when={!authUnavailable()}>
                <For each={authProviders().filter((provider) => provider.auth.configured)}>{(provider) => accountLine(provider)}</For>
                <Show when={authProviders().find((provider) => provider.id === addingAccount() && !provider.auth.configured)}>{(provider) => accountLine(provider(), { pending: true })}</Show>
                <Show when={authProviders().some((provider) => !provider.auth.configured && provider.id !== addingAccount())}>
                  <SettingLine label="Add an account" title="A model provider's sign-in or API key, kept on the hub.">
                    <Select id="pi-auth-provider" aria-label="Add an account" search="Search providers" value="" onChange={(event) => setAddingAccount(event.currentTarget.value)}>
                      <option value="">Choose a provider</option>
                      <For each={authProviders().filter((provider) => !provider.auth.configured && provider.id !== addingAccount())}>{(provider) => <option value={provider.id}>{provider.label}</option>}</For>
                    </Select>
                  </SettingLine>
                </Show>
              </Show>}><SettingLine plain label="Accounts" state={<>loading…</>}><span /></SettingLine></Show>
            </Group>
            <Show when={voiceServerSettings()?.mode === "remote" && voiceServerSettings()}>{(voice) => <Group title="Voice transcription">
              <Show when={voice().provider !== "custom" || voice().auth.type !== "none"}>
                <SettingCredential label={selectedVoiceProvider()?.authLabel || "Key"} state={<>{voice().auth.configured ? "stored" : "not set"}</>}
                  busy={voiceBusy()} stored={voice().auth.configured} placeholder={selectedVoiceProvider()?.authLabel || "Key"}
                  onSave={(secret) => saveVoiceSecret(secret)} onRemove={voice().auth.removable ? () => void removeVoiceCredential() : undefined} />
              </Show>
              <SettingLine plain label="Connection" state={<>{voiceTestResult() || (cloudTiming().label === "Live" ? "live" : "after you stop")}</>}>
                <Button variant="ghost" size="sm" disabled={voiceBusy()} onClick={() => void testVoiceServer()}>{voiceBusy() ? <Spinner /> : null}Test</Button>
              </SettingLine>
              <Show when={voiceError()}><Note tone="error">{voiceError()}</Note></Show>
            </Group>}</Show>
            <Group title="ChatGPT Web">
              <SettingCredential label="Cookies" state={<>{chatGptStatus()?.auth === "configured" ? "connected" : "not connected"}</>}
                busy={chatGptBusy()} stored={chatGptStatus()?.auth === "configured"} add="Add cookies" placeholder="Cookie header"
                onSave={(cookie) => saveChatGptCookie(cookie)} onRemove={() => void removeChatGptCookie()} />
              <SettingDetails summary="Where to find them">
                <ol>
                  <li>Sign in at <SettingLink href="https://chatgpt.com">chatgpt.com</SettingLink>.</li>
                  <li>Open browser developer tools, select Network, then reload ChatGPT.</li>
                  <li>Select a request to <code>chatgpt.com</code>. In Request Headers, copy the complete <code>Cookie</code> value.</li>
                  <li>Add it above. It must include <code>__Secure-next-auth.session-token</code>, whole or split into numbered parts such as <code>.0</code> and <code>.1</code>.</li>
                </ol>
                <Note>Treat it like a password: do not paste it into a chat, issue, or log.</Note>
              </SettingDetails>
              <Show when={chatGptError()}><Note tone="error">{chatGptError()}</Note></Show>
            </Group>
            <IntegrationsSettings />
          </></Show>
          <Show when={section() === "usage"}><UsageSettings /></Show>
          <Show when={section() === "server"}><ServerSettings projects={props.projects} runtime={<>
              <Show when={runtimeStatus() === "ready" && runtime()} fallback={<Show when={runtimeStatus() === "error"} fallback={<Loading>Loading runtime settings…</Loading>}><Note tone="error"><span>{runtimeError() || "Runtime settings could not be loaded."}</span><Button variant="secondary" size="sm" onClick={() => void loadRuntime()}>Retry</Button></Note></Show>}>
                <Group title="Agent processes">
                  <SettingLine label="Warm processes" state={<><Show when={runtimeFieldError(runtimeDraft(), "live")} fallback={<>{runtime()!.liveCount || 0} live</>}>{(message) => message()}</Show></>}><Select id="warm-processes" aria-label="Warm processes" value={runtimeDraft().live} onChange={(event) => editRuntime("live", event.currentTarget.value)}>
                    <For each={countSteps([...RUNTIME_STEPS.live], runtimeDraft().live)}>{(count) => <option value={String(count)}>{count}</option>}</For>
                  </Select></SettingLine>
                  <SettingLine label="Concurrent generations" state={<><Show when={runtimeFieldError(runtimeDraft(), "generating")} fallback={<>{runtime()!.generatingCount || 0} generating</>}>{(message) => message()}</Show></>}><Select id="generations" aria-label="Concurrent generations" value={runtimeDraft().generating} onChange={(event) => editRuntime("generating", event.currentTarget.value)}>
                    <For each={countSteps([...RUNTIME_STEPS.generating], runtimeDraft().generating)}>{(count) => <option value={String(count)}>{count}</option>}</For>
                  </Select></SettingLine>
                </Group>
                <Group title="Running now">
                  <For each={processes()} fallback={<Note>No agent processes are running.</Note>}>{(process) =>
                    <SettingLine plain label={(titlesSeen(), chatTitles.get(process.chatId) || "…")} title={`${process.model || ""}${process.createdAt ? ` · since ${new Date(process.createdAt).toLocaleString()}` : ""}`}
                      state={<>{process.generation || (process.activity && process.activity !== "idle") ? "working" : "idle"}{process.model ? ` · ${process.model.split("/").at(-1)}` : ""}</>}>
                      <Button variant="ghost" size="sm" onClick={() => void stopProcess(process.id)}>Stop</Button>
                    </SettingLine>
                  }</For>
                </Group>
              </Show>
            </>} /></Show>
          <Show when={section() === "devices"}><DevicesSettingsTile part="network" projects={props.projects} onAddWorkspace={props.onAddWorkspace} onOpenTerminal={props.onOpenDeviceTerminal} onOpenBrowser={props.onOpenDeviceBrowser} onOpenWorkspace={props.onOpenWorkspace} /></Show>
          <Show when={section() === "shortcuts"}>
            <Show when={!isPhoneVoice()}><Group title="Dictation" scope="This device">
              <SettingLine plain label="Dictate" state={voiceDraft().activation === "toggle" ? "press to start and stop" : "hold to talk"}>
                <Keycap label={`the dictation shortcut, ${voiceDraft().shortcut}`} onClick={() => { setVoiceKeys(""); setRecordingVoiceKeys(true); }}>{voiceDraft().shortcut}</Keycap>
              </SettingLine>
              <Show when={recordingVoiceKeys()}>
                    <SettingRecorder ref={(element) => queueMicrotask(() => element.focus())} label="Record the dictation shortcut" keys={voiceKeys() ? [voiceKeys()] : undefined}
                      onKeyDown={(event) => {
                        if (event.key === "Tab") return;
                        event.preventDefault();
                        event.stopPropagation();
                        if (event.key === "Escape") return setRecordingVoiceKeys(false);
                        if (event.key === "Backspace") return setVoiceKeys("");
                        const shortcut = shortcutFromKeyboardEvent(event);
                        if (shortcut) setVoiceKeys(shortcut);
                      }}
                      onSave={() => { updateVoiceDraft({ shortcut: voiceKeys() }); setRecordingVoiceKeys(false); }} onCancel={() => setRecordingVoiceKeys(false)} />
</Show>
            </Group></Show>
            <ShortcutsSettings manager={props.shortcuts} />
          </Show>
          <Show when={section() === "workspaces"}>
            <Show when={!props.templatesLoading} fallback={<Loading>Loading workspace settings…</Loading>}><Show when={workspaceProjects().find((workspace) => workspace.id === workspaceId())} fallback={<Note>This workspace is not available.</Note>}>{(workspace) => <Group title={workspace().name}><Note>{workspace().workingRoot}</Note><Note>Override: {workspaceDefaultLabel(workspace()).startsWith("Inherit") ? "None" : workspaceDefaultLabel(workspace())}</Note><SettingLine label="Default profile"><Select id={`workspace-default-profile-${workspace().id}`} aria-label={`${workspace().name} default profile`} value={workspace().defaultTemplateId || ""} onChange={(event) => void saveWorkspace(workspace(), event.currentTarget.value || null)}>
                <option value="">Inherit global ({props.templates.find((item) => item.id === props.defaultTemplateId)?.label || "General"})</option>
                <For each={props.templates.filter((item) => item.defaultable !== false)}>{(item) => <option value={item.id}>{item.label}</option>}</For>
              </Select></SettingLine></Group>}</Show></Show>
          </Show>
          <Show when={section() === "device"}>
            <DevicesSettingsTile part="device" projects={props.projects} onAddWorkspace={props.onAddWorkspace} onOpenTerminal={props.onOpenDeviceTerminal} onOpenBrowser={props.onOpenDeviceBrowser} onOpenWorkspace={props.onOpenWorkspace} />
            <Show when={installedClientKind === "android"}>
              <Group title="Float">
                    <SettingLine label="Float" title="Conduit at the edge of your screen, over any app: tap it to choose where to send.">
                      <Show when={floatStatus() && !floatStatus()!.overlayPermission}>
                        <Button variant="ghost" size="sm" disabled={floatBusy()} onClick={() => void allowFloatOverlay()}>Allow</Button>
                      </Show>
                      <Switch label="Float" checked={floatStatus()?.enabled ?? false} disabled={floatBusy() || !floatStatus()} onChange={(enabled) => void changeFloat(enabled)} />
                    </SettingLine>
                    <Show when={floatStatus()?.enabled}>
                      <Show when={floatSetupLeft() > 0}>
                        <SettingLine plain label="Setup" state={`${floatSetupLeft()} ${floatSetupLeft() === 1 ? "step" : "steps"} left`}
                          title="Goes through each step Float still lacks, any of which can be skipped.">
                          <Button size="sm" disabled={floatBusy()} onClick={() => void conduitFloat.setUp().then(setFloatStatus).catch(floatFailure)}>Set up</Button>
                        </SettingLine>
                      </Show>
                      <SettingLine plain label="Screen context"
                        title="Float's Accessibility service: Float's Screenshot, the text on screen with it, and Float's frosted panels. It reads only when you take a screenshot or open a panel.">
                        <SettingValue>{floatStatus()!.screenContext ? "On" : "Off"}</SettingValue>
                      </SettingLine>
                      <SettingLine plain label="Assistant"
                        title="Optional: make Conduit the phone's digital assistant so the side key opens Float with the screen and its text already taken.">
                        <SettingValue>{floatStatus()!.assistant ? "Conduit" : "Another app"}</SettingValue>
                      </SettingLine>
                      <Show when={floatStatus()!.assistant && floatStatus()!.sideKey !== "none"}>
                        <SettingLine plain label="Side key"
                          title="Hold the side key on any screen to open Float with that screen already captured: in Press and hold, choose Digital assistant.">
                          <SettingValue>{floatStatus()!.sideKey === "set" ? "Opens Float" : "Not set"}</SettingValue>
                        </SettingLine>
                        <Show when={floatStatus()!.sideKey === "set"}>
                          <SettingLine label="Only on side key" title="Float stays out of sight until you hold the side key, and goes again once you are done.">
                            <Switch label="Only on side key" checked={floatStatus()!.sideKeyOnly} disabled={floatBusy()} onChange={(sideKeyOnly) => void changeSideKey({ sideKeyOnly })} />
                          </SettingLine>
                          <SettingLine label="Side key screenshot" title="Holding the side key takes a screenshot of what is on screen as Float opens.">
                            <Switch label="Side key screenshot" checked={floatStatus()!.sideKeyScreenshot} disabled={floatBusy()} onChange={(sideKeyScreenshot) => void changeSideKey({ sideKeyScreenshot })} />
                          </SettingLine>
                          <SettingLine label="Side key dictates" title="Holding the side key starts dictating at once; hold it again to send.">
                            <Switch label="Side key dictates" checked={floatStatus()!.sideKeyDictates} disabled={floatBusy()} onChange={(sideKeyDictates) => void changeSideKey({ sideKeyDictates })} />
                          </SettingLine>
                          <Show when={floatStatus()!.sideKeyDictates}>
                            <SettingLine label="Side key talks to">
                              <Segmented label="Side key talks to" value={floatStatus()!.sideKeyTarget} disabled={floatBusy()} onChange={(sideKeyTarget: FloatHoldTarget) => void changeSideKey({ sideKeyTarget })} options={[
                                { value: "jbot", label: "jbot" }, { value: "chat", label: "New chat" },
                              ]} />
                            </SettingLine>
                          </Show>
                        </Show>
                      </Show>
                      <SettingLine label="Slot names" title="Show each slot's name beside it in Float's radial.">
                        <Switch label="Slot names" checked={floatStatus()!.slotNames} disabled={floatBusy()} onChange={(slotNames) => void conduitFloat.setSlotNames(slotNames).then(setFloatStatus).catch(floatFailure)} />
                      </SettingLine>
                      <SettingLine label="Hold to talk" title="Hold Float to record at once; let go to send.">
                        <Switch label="Hold to talk" checked={floatStatus()!.holdToTalk} disabled={floatBusy()} onChange={(holdToTalk) => void changeFloatHold({ holdToTalk })} />
                      </SettingLine>
                      <Show when={floatStatus()!.holdToTalk}>
                        <SettingLine label="Hold talks to">
                          <Segmented label="Hold talks to" value={floatStatus()!.holdTarget} disabled={floatBusy()} onChange={(holdTarget: FloatHoldTarget) => void changeFloatHold({ holdTarget })} options={[
                            { value: "jbot", label: "jbot" },
                            { value: "chat", label: "New chat" },
                          ]} />
                        </SettingLine>
                      </Show>
                    </Show>
                    <Show when={floatError()}>{(message) => <Note tone="error">{message()}</Note>}</Show>
              </Group>
            </Show>
          </Show>
          <Show when={section() === "voice"}>
            <Show when={voiceStatus() === "ready" && voiceServerSettings()} fallback={<Show when={voiceStatus() === "error"} fallback={<Loading>Loading voice settings…</Loading>}><Note tone="error"><span>{voiceError() || "Voice settings could not be loaded."}</span><Button variant="secondary" size="sm" onClick={() => void loadVoiceSettings()}>Retry</Button></Note></Show>}>
              <>
                <SettingViews aside={<Segmented arrows label="Transcription source" value={voiceServerSettings()!.mode} disabled={voiceBusy()} onChange={(mode) => updateVoiceServer({ mode })} options={[
                  { value: "off", label: "Off" },
                  { value: "local", label: "Private", title: "Hex on the hub: audio goes no further than your hub" },
                  { value: "remote", label: "Cloud" },
                ]} />}><Segmented arrows label="Voice" value={voiceView()} onChange={setVoiceView} options={[{ value: "settings", label: "Settings" }, { value: "history", label: "History" }]} /></SettingViews>
                <Show when={voiceView() === "settings"} fallback={<VoiceHistory />}>
                <Columns kind="lists" off={voiceServerSettings()!.mode === "off"}>
                <Column>
                <Group title="The hub" scope="Every device">
                  <Show when={voiceServerSettings()!.mode === "off"}><SettingLine plain label="Transcription"><SettingValue>Off</SettingValue></SettingLine></Show>
                  <Show when={voiceServerSettings()!.mode === "local" && voiceServerSettings()!.local}>{(local) => <VoiceLocalCatalogue
                    models={local().models}
                    model={selectedLocalVoiceModel() || null}
                    engine={local().engine || null}
                    busy={voiceBusy()}
                    installingModelId={local().installingModelId}
                    installProgress={local().progress}
                    licenseAccepted={voiceLicenseAccepted()}
                    onModelChange={selectLocalModel}
                    onLicenseChange={setVoiceLicenseAccepted}
                    onInstall={() => void installVoiceModel(selectedVoiceInstallModelId())}
                    onCancelInstall={() => void cancelVoiceInstall()}
                    onUninstall={() => void uninstallVoiceModel(selectedVoiceInstallModelId())}
                  />}</Show>
                  <Show when={voiceServerSettings()!.mode === "remote"}>
                    <SettingLine label="Provider"><Select id="voice-provider" disabled={voiceBusy()} value={voiceServerSettings()!.provider} onChange={(event) => {
                      const provider = voiceServerSettings()!.providers.find((candidate) => candidate.id === event.currentTarget.value)!;
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
                        <Button variant="ghost" size="sm" onClick={() => openSection("integrations")}>Integrations<Icons.ChevronRight /></Button>
                      </SettingLine>
                    </Show>
                  </Show>
                </Group>
                <Show when={hexHere()}>{(hex) => <Group title="Hex" scope="This computer">
                  <SettingLine plain label={<><HarnessMark id="hex" />Hex app</>} state={hex().version ? `version ${hex().version}` : undefined} title="The Hex dictation app on this computer. Conduit uses its models and settings as they are.">
                    <SettingValue>{HEX_STATES[hex().state]}</SettingValue>
                    <Button variant="ghost" size="icon-sm" aria-label="Look for Hex again" title="Look again" onClick={() => void refetchHex()}><Icons.Refresh /></Button>
                  </SettingLine>
                  <SettingLine label="Dictate with Hex" state={voiceDraft().useHex && hex().state !== "ready" ? "using the hub until Hex is listening" : undefined} title="Audio stays on this computer and text appears as you speak. A dictation Hex cannot take goes to the hub.">
                    <Switch label="Dictate with Hex" checked={voiceDraft().useHex} onChange={(useHex) => updateVoiceDraft({ useHex })} />
                  </SettingLine>
                </Group>}</Show>
                </Column>
                <Column>
                <Group title="Dictation" scope="This device">
                  <Show when={!isPhoneVoice()}>
                  <SettingLine plain label="Shortcut" title="Change it in Shortcuts">
                    <Keycap label={`the dictation shortcut, ${voiceDraft().shortcut}. Change it in Shortcuts`} onClick={() => { setVoiceKeys(""); setRecordingVoiceKeys(true); openSection("shortcuts"); }}>{voiceDraft().shortcut}</Keycap>
                  </SettingLine>
                  <SettingLine label="The shortcut">
                    <Select id="voice-activation" value={voiceDraft().activation} onChange={(event) => updateVoiceDraft({ activation: event.currentTarget.value as VoiceDictationSettings["activation"] })}>
                      <option value="push_to_talk">Is held</option><option value="toggle">Starts and stops</option>
                    </Select>
                  </SettingLine>
                  </Show>
                  <SettingLine label="Send when done"><Switch label="Send when done" checked={voiceDraft().autoSend} onChange={(autoSend) => updateVoiceDraft({ autoSend })} /></SettingLine>
                </Group>
                <Group title="Microphone" scope="This device">
                  <Show when={isPhoneVoice()}>
                    <SettingLine label="Prefer speakerphone" title="Listen through the phone's own microphone, not a Bluetooth headset's, so music keeps playing in your headphones.">
                      <Switch label="Prefer speakerphone" disabled={audioInputBusy()} checked={voiceDraft().preferSpeakerphone} onChange={(preferSpeakerphone) => updateVoiceDraft({ preferSpeakerphone })} />
                    </SettingLine>
                  </Show>
                  <SettingLine plain label="Microphone" state={isPhoneVoice() && voiceDraft().preferSpeakerphone ? "without a speakerphone" : undefined}>
                      <Select ref={voiceInputSelect} id="voice-input-device" aria-label="Microphone" disabled={audioInputBusy()} value={voiceDraft().inputDeviceId} onChange={(event) => { const deviceId = event.currentTarget.value; updateVoiceDraft({ inputDeviceId: deviceId, inputDeviceLabel: audioInputDevices().find((device) => device.deviceId === deviceId)?.label || "" }); }}>
                        <option value="">System default</option>
                        <Show when={voiceDraft().inputDeviceId && !audioInputDevices().some((device) => device.deviceId === voiceDraft().inputDeviceId)}><option value={voiceDraft().inputDeviceId}>Unavailable microphone</option></Show>
                        <For each={audioInputDevices()}>{(device, index) => <option value={device.deviceId}>{microphoneName(device, index())}</option>}</For>
                      </Select>
                      <Button variant="ghost" size="icon-sm" aria-label="Refresh microphones" title="Refresh microphones" disabled={audioInputBusy() || audioInputStatus() === "loading"} onClick={() => void loadAudioInputs()}><Icons.Refresh /></Button>
                  </SettingLine>
                  <SettingLine plain label="Test microphone">
                      <Show when={audioInputTest()?.recording && !audioInputBusy()}><Button variant="ghost" size="icon-sm" aria-label={audioInputPlayback() ? "Stop playback" : "Play test recording"} title={audioInputPlayback() ? "Stop playback" : "Play test recording"} onClick={() => audioInputPlayback() ? stopAudioInputPlayback() : void playAudioInputTest()}>{audioInputPlayback() ? <Icons.Stop /> : <Icons.Play />}</Button></Show>
                      <Button variant="ghost" size="sm" disabled={audioInputStatus() === "loading"} onClick={() => audioInputBusy() ? stopAudioInputTest() : void testAudioInput()}>{audioInputBusy() ? "Stop" : "Test"}</Button>
                  </SettingLine>
                  <Show when={audioInputBusy() || audioInputTest()}>
                    {/* The composer's own waveform, so a test looks like dictation will. */}
                    <SettingLine plain label={audioInputBusy() ? (audioInputSignalDetected() ? "Signal" : "Listening…") : audioInputTest()!.signalDetected ? "Signal" : "No signal"} state={<>level {Math.round(audioInputWaveform.level() * 100)}% · peak {Math.round(audioInputWaveform.peak() * 100)}%</>}></SettingLine><SettingWide><VoiceWaveform history={audioInputWaveform.history} level={audioInputWaveform.level} peak={audioInputWaveform.peak} state={audioInputBusy() ? "listening" : "stopped"} variant="compact" barDensity={3} ariaLabel="Microphone input level" /></SettingWide>
                  </Show>
                  <Show when={audioInputError() || audioInputTest()?.recordingError || (audioInputStatus() === "error" && "Microphone list could not be loaded.")}>{(message) => <Note tone="error">{message()}</Note>}</Show>
                  <Show when={installedClientKind === "android"}>
                    <SettingLine plain label="Other audio" title="What music and other sound does while you dictate">
                      <Slider label="While listening" value={voiceDraft().otherAudio === "lower" ? String(voiceDraft().otherAudioLevel) : voiceDraft().otherAudio}
                        onChange={(value) => updateVoiceDraft(value === "mute" || value === "keep" ? { otherAudio: value } : { otherAudio: "lower", otherAudioLevel: Number(value) })}
                        options={[{ value: "mute", label: "Muted" }, ...Array.from({ length: 16 }, (_, index) => ({ value: String(5 + index * 5), label: `${5 + index * 5}%` })), { value: "keep", label: "Kept" }]} />
                    </SettingLine>
                  </Show>
                  <SettingLine label="Sound" title="Raw is the microphone as it is. Processed adds the browser's echo and noise handling.">
                    <Select id="voice-capture" disabled={audioInputBusy()} value={voiceDraft().captureProfile} onChange={(event) => updateVoiceDraft({ captureProfile: event.currentTarget.value as VoiceDictationSettings["captureProfile"] })}>
                      <option value="raw">Raw</option><option value="processed">Processed</option>
                    </Select>
                  </SettingLine>
                  <SettingLine plain label="Keep mic warm" state={<><Show when={warmMicrophoneActive()}>live</Show></>}>
                      <Show when={warmMicrophoneActive()}><Button variant="ghost" size="sm" onClick={stopWarmMicrophone}>Release</Button></Show>
                      <Switch label="Keep mic warm" checked={voiceDraft().warmMicrophone} onChange={(warmMicrophone) => updateVoiceDraft({ warmMicrophone })} />
                  </SettingLine>
                </Group>
                </Column>
                </Columns>
                </Show>

                <Show when={voiceError()}><Note tone="error">{voiceError()}</Note></Show>
              </>
            </Show>
          </Show>
          <Show when={section() === "search"}>
            <Show when={searchStatus() === "ready" && searchSettings()} fallback={<Show when={searchStatus() === "error"} fallback={<Loading>Loading search settings…</Loading>}><Note tone="error"><span>{searchError() || "Search settings could not be loaded."}</span><Button variant="secondary" size="sm" onClick={() => void loadSearchSettings()}>Retry</Button></Note></Show>}>
              {(settings) => <>
                <Group title="Search">
                  <SettingLine label="Search with" title="Automatic: on a ChatGPT model, OpenAI on that sign-in first; otherwise Exa, then every other provider that can search."
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
                        ? "An answer about something else goes on to the next provider. The query, answer and snippets are sent to your Cloudflare account to check."
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
                </Group>
                <Group title="Tools">
                  <For each={SEARCH_TOOLS}>{(tool) =>
                    <SettingLine label={tool.label} title={tool.title}>
                      <Switch label={tool.label} checked={settings().tools[tool.key]} onChange={(on) => editSearch({ tools: { [tool.key]: on } })} />
                    </SettingLine>
                  }</For>
                  <Note>Chats pick up tool changes when Conduit next restarts.</Note>
                </Group>
                <Group title="Reading pages">
                  <For each={SEARCH_FETCHING}>{(item) =>
                    <SettingLine label={item.label} title={item.title}>
                      <Switch label={item.label} checked={settings().fetching[item.key]} onChange={(on) => editSearch({ fetching: { [item.key]: on } })} />
                    </SettingLine>
                  }</For>
                  <SettingLine label="Read values off pages" title={settings().cloudflare
                    ? "Reads a price, a date or a limit off a page, with the line it came from. The page text is sent to your Cloudflare account."
                    : CLOUDFLARE_NEEDED}>
                    <Switch label="Read values off pages" disabled={!settings().cloudflare && !settings().fetching.extract} checked={settings().fetching.extract} onChange={(extract) => editSearch({ fetching: { extract } })} />
                  </SettingLine>
                  <Show when={!settings().cloudflare}><Note>{CLOUDFLARE_NEEDED}</Note></Show>
                </Group>
                <Group title="Providers">
                  <For each={settings().providers.filter((provider) => provider.ready || provider.id === addingSearch())}>{(provider) =>
                    <SettingCredential label={provider.label} title={provider.description} state={<>{provider.source ? SEARCH_SOURCE_LABELS[provider.source] : "not set"}</>}
                      busy={searchSaving()} stored={provider.stored} optional={provider.ready} editable={provider.source !== "environment"}
                      actions={<Show when={!provider.ready}><Button variant="ghost" size="sm" onClick={() => setAddingSearch("")}>Cancel</Button></Show>}
                      onSave={async (key) => { await saveSearchKey(provider.id, key); setAddingSearch(""); }} onRemove={provider.removable ? () => void removeSearchKey(provider.id) : undefined} />
                  }</For>
                  <SettingLine plain label="Cloudflare Workers AI" state={settings().cloudflare ? "connected" : "not set"}
                    title="Skips off-topic results and reads values off pages.">
                    <Button variant="ghost" size="sm" onClick={() => openSection("integrations")}>Set in Integrations</Button>
                  </SettingLine>
                  <Show when={settings().providers.some((provider) => !provider.ready && provider.id !== addingSearch())}>
                    <SettingLine label="Add a provider" title="A search provider's API key, kept on the hub.">
                      <Select id="search-add-provider" aria-label="Add a provider" search="Search providers" value="" onChange={(event) => setAddingSearch(event.currentTarget.value)}>
                        <option value="">Choose a provider</option>
                        <For each={settings().providers.filter((provider) => !provider.ready && provider.id !== addingSearch())}>{(provider) => <option value={provider.id}>{provider.label}</option>}</For>
                      </Select>
                    </SettingLine>
                  </Show>
                  <Show when={searchError()}><Note tone="error">{searchError()}</Note></Show>
                  <Show when={authError() && !authUnavailable()}><Note tone="error">{authError()}</Note></Show>
                </Group>
              </>}
            </Show>
          </Show>
          <Show when={section() === "models"}><>
            <Group title="Defaults">
              <Show when={!props.templatesLoading} fallback={<SettingLine plain label="Default profile" state={<>loading…</>}><span /></SettingLine>}>
                <SettingLine label="Default profile"><Select id="default-profile" value={props.defaultTemplateId} onChange={(event) => defaultProfileAutosave.edit(event.currentTarget.value, "now")}><For each={props.templates.filter((item) => item.defaultable !== false)}>{(item) => <option value={item.id}>{item.label}</option>}</For></Select></SettingLine>
              </Show>
              <SettingLine plain label="Models" state={<>{props.models.enabledModels().length} enabled</>}><Button variant="ghost" size="sm" onClick={props.onOpenModelSelector}>Manage</Button></SettingLine>
            </Group>
            <Group title="Helper models">
              <SettingLine plain label="Naming" state={<>{sessionNameModel() ? "Its own model" : "None: new chats stay untitled"}</>}
                title="Titles each new chat from its first message, with the model chosen here.">
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
              <SettingLine plain label="Summary"
                title="When a chat's context fills, the chat's own model summarizes its older part.">
                <SettingValue>Chat's own model</SettingValue>
              </SettingLine>
              <SettingLine label="Review" state={<>{reviewModel() ? "Its own model" : sessionNameModel() ? "Inherits Naming's model" : "None: every held action asks you"}</>}
                title="Judges what the agent's tools hold for approval against your rules (Agent › Approvals), and asks you only for what it cannot allow.">
                <Select id="review-model" aria-label="Review model" value={reviewModel()} disabled={generalLoading()}
                  onChange={(event) => { setReviewModel(event.currentTarget.value); reviewAutosave.edit({ reviewModel: event.currentTarget.value }, "now"); }}>
                  <option value="">Same as Naming</option>
                  <For each={namingModels()}>{(model) => <option value={model.spec}>{model.label || model.spec}</option>}</For>
                </Select>
              </SettingLine>
            </Group>
            <Group title="Accounts">
              <SettingLine plain label="Model providers" state={<>{authProviders().filter((provider) => provider.auth.configured).length} signed in</>} title="Sign-ins and API keys are in Services › Integrations.">
                <Button variant="ghost" size="sm" onClick={() => openSection("integrations")}>Integrations</Button>
              </SettingLine>
            </Group>
          </></Show>
  </>;
  createEffect(() => {
    if (!props.open || props.harvest || showingIndex()) return;
    const shown = section();
    let over = false;
    let timer = 0;
    const read = () => { const body = dialogEl()?.querySelector(".ui-overlay-page-body"); if (body && !over) rememberSettings(shown, readSettings(body, shown)); };
    const watcher = new MutationObserver(() => { clearTimeout(timer); timer = window.setTimeout(read, READ_SETTLE_MS); });
    const attach = () => {
      if (over) return;
      const body = dialogEl()?.querySelector(".ui-overlay-page-body");
      if (!body) { requestAnimationFrame(attach); return; }
      watcher.observe(body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["aria-checked"] });
      timer = window.setTimeout(read, READ_SETTLE_MS);
    };
    attach();
    onCleanup(() => { over = true; watcher.disconnect(); clearTimeout(timer); });
  });
  const SWEPT: Section[] = ["ui", "account", "models", "agent", "server", "device", "devices", "voice", "search", "browser", "integrations"];
  const [sweeping, setSweeping] = createSignal(false);
  createEffect(() => {
    if (props.harvest || !props.open || sweeping() || Date.now() - sweptAt < 5 * 60_000) return;
    const timer = window.setTimeout(() => setSweeping(true), SWEEP_START_MS);
    onCleanup(() => clearTimeout(timer));
  });
  createEffect(() => { if (!props.open) setSweeping(false); });
  let harvestEl: HTMLDivElement | undefined;
  if (props.harvest) onMount(() => {
    let over = false;
    onCleanup(() => { over = true; });
    const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
    void (async () => {
      for (const id of SWEPT) {
        if (over) return;
        // Each section is drawn in a moment the page is idle, so the sweep never lands on a key or a frame in use.
        await new Promise<void>((resolve) => { if ("requestIdleCallback" in window) window.requestIdleCallback(() => resolve(), { timeout: 600 }); else setTimeout(resolve, IDLE_FALLBACK_MS); });
        if (over) return;
        setSection(id);
        let last = -1;
        for (let tries = 0; tries < 15 && !over; tries++) {
          await pause(100);
          const count = harvestEl?.querySelectorAll(".ui-setting-line").length ?? 0;
          if (count && count === last && !harvestEl?.querySelector(".ui-loading")) break;
          last = count;
        }
        if (!over && harvestEl) rememberSettings(id, readSettings(harvestEl, id));
      }
      if (!over) { markSwept(); props.harvest?.(); }
    })();
  });
  if (props.harvest) return <div ref={harvestEl} hidden aria-hidden="true">{pages()}</div>;

  return <><OverlayDialog
    open={props.open}
    onOpenChange={props.onOpenChange}
    label="Settings"
    placement="center"
    layout="rail"
    style={narrow() ? undefined : { "--overlay-width": WIDE_SECTIONS.has(section()) ? "calc(96 * var(--u-space))" : "calc(70.3125 * var(--u-space))", "--overlay-height": "calc(64 * var(--u-space))" }}
    onEscapeKeyDown={dismissEscape}
    onCloseAutoFocus={(event) => { event.preventDefault(); if (returnFocus?.isConnected) returnFocus.focus(); returnFocus = null; }}
  >
    <Show when={!narrow() || showingIndex()}>
      <OverlayRail title="Settings" role="tablist" aria-label="Settings sections" aria-orientation="vertical" foot={<AboutSettingsFooter />} onClose={narrow() ? close : undefined}>
        <LeadInput placeholder="Search settings" aria-label="Search settings" value={query()} onInput={(event) => setQuery(event.currentTarget.value)} onClear={() => setQuery("")}
          onKeyDown={(event) => {
            if (event.key === "Enter" && flat()[cursor()]) { event.preventDefault(); if (narrow()) openResult(flat()[cursor()]!); else focusPage(); }
            if ((event.key === "ArrowDown" || event.key === "ArrowUp") && narrow() && flat().length) {
              event.preventDefault();
              setCursor((cursor() + (event.key === "ArrowDown" ? 1 : -1) + flat().length) % flat().length);
              dialogEl()?.querySelector(`[data-result="${cursor()}"]`)?.scrollIntoView({ block: "nearest" });
            } else if (event.key === "ArrowDown") { event.preventDefault(); focusRail(); }
            if (event.key === "Escape" && query()) { event.preventDefault(); event.stopPropagation(); setQuery(""); }
          }} />
        <Show when={query().trim() && !flat().length}><Group kind="nav" title="No setting matches" /></Show>
        <Show when={query().trim() && narrow()}>
          <For each={[...matches()]}>{([id, found]) => <Group kind="nav" title={label(id)}>
            <For each={found}>{(result) => <Row density="nav" element="button" data-result={flat().indexOf(result)} data-focus-shown={flat().indexOf(result) === cursor() ? "" : undefined} tabIndex={-1}
              detail={result.group ?? undefined} meta={result.value || undefined} end={<Icons.ChevronRight />} onClick={() => openResult(result)}>{result.group === null && result.label === label(id) ? `All of ${label(id)}` : result.label}</Row>}</For>
          </Group>}</For>
        </Show>
        {/* The rows stay as they are while the search changes: one that does not match is taken out, never the list redrawn. */}
        <Show when={!(query().trim() && narrow())}><For each={sectionGroups}>{(group) => <Show when={!query().trim() || group.sections.some((item) => matches().has(item.id as Section))}><Group kind="nav" title={group.label}>
          <For each={group.sections}>{(item) => <Show when={!query().trim() || matches().has(item.id as Section)}> <Row density="nav" element="button" role="tab" tabIndex={section() === item.id ? 0 : -1} aria-selected={section() === item.id} current={!narrow() && section() === item.id}
            lead={<item.icon />} meta={query().trim() ? String(matches().get(item.id as Section)?.length ?? "") : undefined} end={narrow() ? <Icons.ChevronRight /> : undefined} onClick={() => openSection(item.id)} onKeyDown={navigateSettingsTabs}>{item.id === "agent" ? agentView()?.settings?.name || item.label : item.label}</Row></Show>}</For>
        </Group></Show>}</For></Show>
      </OverlayRail>
    </Show>
    <Show when={!showingIndex()}>
      <OverlayPage title={label(section())} {...status()} onBack={narrow() ? backToSections : undefined} onClose={close}>
{pages()}
      </OverlayPage>
    </Show>
  </OverlayDialog>
  <Show when={sweeping()}><Settings {...props} open harvest={() => setSweeping(false)} /></Show>
  </>;
}
