import { createEffect, createMemo, createSignal, For, Index, lazy, on, onCleanup, onMount, Show, type JSX } from "solid-js";
import { ArrowUpIcon, ChevronDownIcon, KeyboardIcon, MicIcon, ShieldCheckIcon, SquareIcon, TriangleAlertIcon } from "lucide-solid";
import { ThinkingOrb } from "./thinking-orb";
import { PHONE_COMPOSER_CHANGE_EVENT, phoneComposerLayout } from "../preferences/phone-composer";
import {
  Button,
  Menu,
  MenuContent,
  MenuGroup,
  MenuLabel,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuTrigger,
  Spinner,
} from "@/components/primitives";
import type { BooleanCapability, Template } from "../api/contracts";
import type { ActiveChatStore } from "../state/active-chat";
import { filesFromDataTransfer } from "../state/attachments";
import type { ComposerAttachments } from "./composer-attachments";
import type { ComposerModels } from "./composer-models";
import type { ComposerPermissions } from "./composer-permissions";
import type { ServiceLevelSettings } from "../state/service-level-settings";
import type { VoiceDictationSettings } from "./voice-dictation-types";
import { isMobileLayout, KEYBOARD_HIDDEN_EVENT, MOBILE_LAYOUT_QUERY } from "../navigation/mobile-layout";
import { QueuedMessages } from "./queued-messages";
import { AttachmentStrip } from "./attachment-strip";
import { composerSlashCommands } from "./composer-slash-commands";
import { fileFromPastedText, insertTextAt, shouldAttachPastedText } from "./large-paste";
import { COMPOSER_SURFACE_CHANGE_EVENT, selectedComposerSurface, type ComposerSurfaceMode } from "./composer-surface";
import { createVoiceDictationClient, type VoiceDictationState } from "./voice-dictation-client";
import { ContextGauge } from "./context-gauge";
import type { AudioSignalLevel } from "./voice-audio";
import { toast } from "solid-sonner";
import { audioTransferLost, beginDictatedRange, matchesShortcut, releasesShortcut, replaceDictatedRange, shouldAutoSend, shouldReportNoSignal } from "./voice-dictation";
import { createVoiceWaveformController, MAX_RESPONSIVE_BAR_COUNT, VoiceWaveform, type VoiceWaveformController } from "./voice-waveform";
import { ModelSelector } from "./model-selector";
import { HarnessMark } from "../harness-brand";
import { parseReviewComments, removeReviewComment, reviewComments, updateReviewComment } from "./review-comments";
import { ReviewCommentCards } from "./review-comment-cards";
import "./performance-composer.css";
import "./composer-desktop.css";
import "./composer-voice.css";

export const SPINNING_ACTIVITY = new Set(["starting", "reconnecting", "thinking", "responding", "using_tool", "retrying", "compacting", "stopping", "waiting_for_model"]);

import { FolderPicker, type FolderOptions, type PlaceOptions } from "./place-picker";
import { COMPOSER_FOLDS, foldsFor, type ComposerFold } from "./composer-folds";
import { ComposerPlusMenu } from "./composer-plus-menu";
const MobileComposerOptions = lazy(() => import("./mobile-composer-options"));

export interface ComposerStatus {
  dictationState: () => VoiceDictationState;
  dictationLabel: () => string;
  dictationError: () => string;
  dictating: () => boolean;
  recording: () => boolean;
  recorderMonitorState: () => "connecting" | "listening" | "stopped";
  waveform: VoiceWaveformController;
}

export function Composer(props: {
  chat: ActiveChatStore;
  attachments: ComposerAttachments;
  models: ComposerModels;
  modelsLoading?: boolean;
  permissions?: ComposerPermissions;
  serviceLevels?: ServiceLevelSettings;
  /** Surfaces without a Conduit chat behind them cannot carry attachments. */
  attachmentsSupported?: boolean;
  profiles: Template[];
  activeProfile?: Template | null;
  /** Absent where no adaptor reports usage; the gauge then reads 0% and greys out. */
  serverOnline: boolean;
  voiceSettings: VoiceDictationSettings;
  /** With two chats side by side, whether this composer's side has the keyboard, and with it the dictation key. */
  keyboardOwner?: () => boolean;
  onChooseProfile: (id: string) => void;
  onOpenSettings: (section: string) => void;
  onOpenModelSelector?: () => void;
  modelSelectorShortcut?: string | null;
  onOpenAttachments: () => void;
  onStatusChange?: (status: ComposerStatus | null) => void;
  onSendDraft?: (text: string) => Promise<void>;
  /** Sending starts the chat (through `onSendDraft`), so there is none to wait for. */
  launches?: boolean;
  /** The folder button beside attach: where this chat lives. */
  place?: PlaceOptions;
  /** A harness thread's folder, in the place button's slot. */
  folder?: FolderOptions;
  supports?: (capability: BooleanCapability) => boolean;
}) {
  let input!: HTMLTextAreaElement;
  let mobileActions!: HTMLDivElement;
  let actionsRow!: HTMLDivElement;
  let actionsLeft!: HTMLDivElement;
  const [slashOpen, setSlashOpen] = createSignal(false);
  const [dictationState, setDictationState] = createSignal<VoiceDictationState>("idle");
  const [dictationError, setDictationError] = createSignal("");
  const [transcriberReady, setTranscriberReady] = createSignal(false);
  const [dictatedRange, setDictatedRange] = createSignal<{ start: number; end: number } | null>(null);
  const [dictationSelectionOwned, setDictationSelectionOwned] = createSignal(false);
  const [composerSurface, setComposerSurface] = createSignal<ComposerSurfaceMode>(selectedComposerSurface());
  const [phoneLayout, setPhoneLayout] = createSignal(isMobileLayout());
  /* Voice-first phone layouts: idle is a row of buttons with no text line;
     typing (focused, or a draft kept) adds the text row on top; listening
     shows the orb, the coloured glow and the last lines of the transcript. */
  const [phoneComposer, setPhoneComposer] = createSignal(phoneComposerLayout());
  const [inputFocused, setInputFocused] = createSignal(false);
  const voiceFirst = () => phoneLayout() && phoneComposer() !== "classic";
  const phoneMode = () => !voiceFirst() ? undefined
    // Finishing and transcribing still look like listening, so stopping goes
    // straight to the result instead of flashing through the text row.
    // Once stopped, the row settles at once; the transcript lands when it lands.
    : ["starting", "listening"].includes(dictationState()) ? "listening"
    : inputFocused() || hasText() ? "typing" : "idle";
  // The text row was zero wide while hidden; measure it again once shown.
  createEffect(on(phoneMode, () => scheduleResize(), { defer: true }));
  // Dictation failures go through the app's normal toasts.
  createEffect(on(dictationError, (message) => { if (message) toast.error(message); }, { defer: true }));
  /* A new caption line pushes the old ones up; glide them instead of jumping. */
  const glideCaptions = (element: HTMLElement) => {
    let height = 0;
    const observer = new ResizeObserver(() => {
      const next = element.offsetHeight;
      if (height && next > height) element.animate([{ transform: `translateY(${next - height}px)` }, { transform: "none" }], { duration: 180, easing: "ease-out" });
      height = next;
    });
    observer.observe(element);
    onCleanup(() => observer.disconnect());
  };
  const dictatedText = () => { const range = dictatedRange(); return range ? props.chat.draft().slice(range.start, range.end) : ""; };
  // A phone has no model chip in its row, so the empty draft names the model --
  // it stays in view at no cost in height.
  const placeholder = () => {
    const model = phoneLayout() && (props.models.models().find((item) => item.spec === props.models.model())?.label || props.models.model());
    return model || "Send a message...";
  };
  const [mobileActionsStacked, setMobileActionsStacked] = createSignal(false);
  /* Desktop: the row's controls keep their size; those that do not fit fold
     into the + menu, least used first. Each one's width is kept from when it
     was last drawn, so a folded control comes back exactly when it fits. */
  const [folded, setFolded] = createSignal<ReadonlySet<ComposerFold>>(new Set());
  const foldWidths = new Map<ComposerFold, number>();
  const foldPresent: Record<ComposerFold, () => boolean> = {
    permissions: () => Boolean(props.permissions?.profiles().length || props.serviceLevels?.levels().length),
    profile: () => props.profiles.length > 0,
    context: () => true,
    model: () => true,
  };
  let refitFrame = 0;
  const refit = () => {
    cancelAnimationFrame(refitFrame);
    refitFrame = requestAnimationFrame(() => {
      if (phoneLayout() || !actionsRow?.isConnected) { if (folded().size) setFolded(new Set<ComposerFold>()); return; }
      for (const element of actionsLeft.querySelectorAll<HTMLElement>(":scope > [data-composer-fold]")) foldWidths.set(element.dataset.composerFold as ComposerFold, element.getBoundingClientRect().width);
      const widths = new Map<ComposerFold, number>();
      for (const key of COMPOSER_FOLDS) if (foldPresent[key]() && foldWidths.has(key)) widths.set(key, foldWidths.get(key)!);
      const gap = parseFloat(getComputedStyle(actionsLeft).columnGap) || 0;
      const fixedChildren = ([...actionsLeft.children] as HTMLElement[]).filter((child) => !child.dataset.composerFold);
      const fixed = fixedChildren.reduce((sum, child) => sum + child.getBoundingClientRect().width, 0) + gap * Math.max(0, fixedChildren.length - 1);
      const row = getComputedStyle(actionsRow);
      const others = ([...actionsRow.children] as HTMLElement[]).filter((child) => child !== actionsLeft);
      const available = actionsRow.clientWidth - (parseFloat(row.paddingLeft) || 0) - (parseFloat(row.paddingRight) || 0)
        - others.reduce((sum, child) => sum + child.getBoundingClientRect().width + (parseFloat(row.columnGap) || 0), 0);
      const next = foldsFor(available, fixed, widths, gap);
      const current = folded();
      if (next.size !== current.size || [...next].some((key) => !current.has(key))) setFolded(next);
    });
  };
  const shows = (key: ComposerFold) => phoneLayout() || !folded().has(key);
  const dictationWaveform = createVoiceWaveformController(MAX_RESPONSIVE_BAR_COUNT);
  let pushToTalkActive = false;
  /* One take per press of the mic. A stopped take keeps finalising on its own
     client and writes into its own range while the next one records; ranges
     after a take shift when its text changes length. */
  type DictationTake = { client: VoiceClient; range: { start: number; end: number } | null; cancelled: boolean; restoreFocus: boolean; autoSend: boolean };
  type VoiceClient = ReturnType<typeof createVoiceDictationClient>;
  const voiceClients: VoiceClient[] = [];
  const takes = new Map<VoiceClient, DictationTake>();
  let currentTake: DictationTake | null = null;
  let autoSendPending = false;
  const [finalisingTakes, setFinalisingTakes] = createSignal(0);
  let pendingDictationLaunch: { inputFocused: boolean; keyboardOpen: boolean; acceptedAt: number } | null = null;
  let historyIndex: number | null = null;
  let historyDraft = "";

  const busy = createMemo(() => props.chat.streaming());
  const interactive = () => Boolean(props.launches) || props.chat.interactionReady();
  const supports = (capability: BooleanCapability) => props.supports?.(capability)
    ?? props.chat.capabilities()?.[capability] !== false;
  const comments = createMemo(() => reviewComments(props.chat.loadedId() ?? ""));
  const hasText = createMemo(() => Boolean(props.chat.draft().trim()));
  const stoppable = createMemo(() => (busy() || props.chat.stopping()) && supports("cancel"));
  const hasPayload = createMemo(() => hasText() || comments().length > 0 || props.attachments.pendingIds().length > 0);
  /* A first send holds its text in the draft while the agent starts, so
     "working with a draft typed" would put Stop beside Send for that moment.
     The draft being sent is not a new one. */
  const newDraft = createMemo(() => hasPayload() && props.chat.generation() !== "submitting");
  const dictating = createMemo(() => ["starting", "listening"].includes(dictationState()) || finalisingTakes() > 0);
  const recording = createMemo(() => dictationState() === "listening");
  const recorderMonitorState = createMemo(() => dictationState() === "starting" ? "connecting" : dictationState() === "listening" ? "listening" : "stopped");
  const canSend = createMemo(() => hasPayload() && props.serverOnline && interactive() && props.chat.generation() !== "stopping"
    && (!busy() || supports("steer") || supports("followUpQueue")) && !dictating());
  const activity = createMemo(() => props.chat.activity());
  const sentPrompts = createMemo(() => props.chat.messages()
    .filter((message) => message.role === "user" && !message.pending && Boolean(message.content?.trim()))
    .map((message) => parseReviewComments(message.content!).text)
    .filter(Boolean));
  const slashCommandOptions = () => ({
    attachments: props.attachmentsSupported !== false,
    compaction: supports("compaction") && !busy() && !props.chat.compacting(),
    harnessCommands: props.chat.harnessCommands(),
  });
  const dictationLabel = createMemo(() => {
    if (dictationState() === "completed" && !dictatedRange()) return "";
    if (dictationState() === "failed" && !dictationError()) return "";
    return ({
      starting: "Preparing microphone…",
      listening: transcriberReady() ? "Recording…" : "Recording · preparing transcription…",
      finishing: "Finishing capture…",
      waiting: "Waiting for transcription engine…",
      transcribing: "Transcribing…",
      completed: "Dictation added to draft",
      failed: "Dictation failed",
      idle: "",
    })[dictationState()];
  });
  const composerStatus: ComposerStatus = {
    dictationState,
    dictationLabel,
    dictationError,
    dictating,
    recording,
    recorderMonitorState,
    waveform: dictationWaveform,
  };

  const setInputLevel = (level: AudioSignalLevel) => dictationWaveform.push(level);

  const resize = () => {
    input.style.height = "auto";
    input.style.height = `${Math.min(input.scrollHeight, 192)}px`;
    if (!phoneLayout() || voiceFirst() || !mobileActions) return setMobileActionsStacked(false);
    /* The actions stack the moment the draft reaches its third line. Stacked,
       the draft is a button wider and may rewrap to two lines; it stays
       stacked until it fits on one, which at the narrower width is at most
       two -- so the layout never flips back and forth. */
    const style = getComputedStyle(input);
    const lineHeight = Number.parseFloat(style.lineHeight) || Number.parseFloat(style.fontSize) * 1.4;
    const padding = Number.parseFloat(style.paddingTop) + Number.parseFloat(style.paddingBottom);
    const lines = Math.round((input.scrollHeight - padding) / lineHeight);
    setMobileActionsStacked(mobileActionsStacked() ? lines >= 2 : lines >= 3);
  };

  // Every reason to resize that arrives in one task resizes once: the first
  // open set the draft, the busy state and the layout in turn, and each
  // measurement laid out the page it was still building.
  let resizeQueued = false;
  const scheduleResize = () => {
    if (resizeQueued) return;
    resizeQueued = true;
    queueMicrotask(() => { resizeQueued = false; resize(); });
  };

  const keyboardWasOpen = (inputFocused: boolean) => {
    if (!isMobileLayout()) return true;
    if (!inputFocused) return false;
    const viewport = window.visualViewport;
    return viewport ? window.innerHeight - viewport.height > 120 : true;
  };

  const captureDictationLaunch = () => {
    if (dictating()) return;
    const inputFocused = document.activeElement === input;
    pendingDictationLaunch = { inputFocused, keyboardOpen: keyboardWasOpen(inputFocused), acceptedAt: performance.now() };
  };

  const change = (value: string, manual = true) => {
    if (manual) {
      historyIndex = null;
      historyDraft = "";
      setDictationSelectionOwned(false);
      if (dictatedRange() || [...takes.values()].some((take) => take.range)) cancelTakes();
    }
    props.chat.setDraft(value);
    if (value.startsWith("/")) void props.chat.loadHarnessCommands().then(() => {
      if (props.chat.draft() === value) setSlashOpen(composerSlashCommands(value, slashCommandOptions()).length > 0);
    });
    setSlashOpen(composerSlashCommands(value, slashCommandOptions()).length > 0);
    scheduleResize();
  };

  const setTakeRange = (take: DictationTake, range: { start: number; end: number } | null) => {
    take.range = range;
    if (take === currentTake) setDictatedRange(range);
  };
  const cancelTakes = () => {
    autoSendPending = false;
    for (const take of takes.values()) {
      if (!take.range && take.cancelled) continue;
      take.cancelled = true;
      setTakeRange(take, null);
      if (["starting", "listening"].includes(take.client.state())) take.client.stop();
    }
    setDictatedRange(null);
  };
  const countFinalising = () => setFinalisingTakes(voiceClients.filter((client) => ["finishing", "waiting", "transcribing"].includes(client.state())).length);

  const applyTranscript = (take: DictationTake, text: string) => {
    const range = take.range;
    if (!range || take.cancelled) return;
    const draft = props.chat.draft();
    const next = replaceDictatedRange(draft, range, text);
    const shift = next.text.length - draft.length;
    if (shift) for (const other of takes.values()) {
      if (other !== take && other.range && other.range.start >= range.end) setTakeRange(other, { start: other.range.start + shift, end: other.range.end + shift });
    }
    props.chat.setDraft(next.text);
    setTakeRange(take, next.range);
    if (take !== currentTake) { queueMicrotask(resize); return; }
    setDictationSelectionOwned(true);
    queueMicrotask(() => {
      resize();
      if (take.restoreFocus) input.focus({ preventScroll: true });
      input.setSelectionRange(next.range.start, next.range.end);
    });
  };

  const sendDraftNow = () => queueMicrotask(() => {
    if (props.onSendDraft) void props.onSendDraft(props.chat.draft());
    else void props.chat.send();
  });
  // Auto-send waits for every take still recording or finalising.
  const settleAutoSend = () => {
    if (!autoSendPending || voiceClients.some((client) => ["starting", "listening", "finishing", "waiting", "transcribing"].includes(client.state()))) return;
    autoSendPending = false;
    setDictatedRange(null);
    for (const take of takes.values()) take.range = null;
    sendDraftNow();
  };

  const createTakeClient = () => {
    const client: VoiceClient = createVoiceDictationClient({
      onState: (next) => {
        countFinalising();
        const take = takes.get(client);
        if (take && take === currentTake) {
          setDictationState(next);
          if (next === "starting") setTranscriberReady(false);
          if (next !== "listening") dictationWaveform.reset();
          if (["completed", "failed"].includes(next)) setTranscriberReady(false);
        }
        // The final transcript follows "completed"; auto-send settles after it.
        if (["failed", "idle"].includes(next)) settleAutoSend();
      },
      onRuntimeReady: () => { if (takes.get(client) === currentTake) setTranscriberReady(true); },
      onTranscriptionWaiting: () => { if (takes.get(client) === currentTake) setTranscriberReady(false); },
      onPartial: (text) => { const take = takes.get(client); if (take) applyTranscript(take, text); },
      onFinal: (text) => { const take = takes.get(client); if (take) applyTranscript(take, text); },
      onInputLevel: (level) => { if (takes.get(client) === currentTake) setInputLevel(level); },
      onCompleted: (completion) => {
        const take = takes.get(client);
        // After this body, whichever way it returns.
        queueMicrotask(settleAutoSend);
        window.dispatchEvent(new CustomEvent("conduit:voice-dictation-metrics", { detail: completion }));
        const clear = () => {
          if (take) setTakeRange(take, null);
          if (take === currentTake) setDictationSelectionOwned(false);
        };
        if (completion.speechDetector === "digital_zero") {
          clear();
          setDictationError("No microphone signal reached the transcription service. Check Voice → Microphone and Chrome site settings.");
          return;
        }
        const transcript = completion.text.trim();
        if (!transcript) {
          clear();
          if (!completion.inputSignalDetected && shouldReportNoSignal(completion)) {
            setDictationError(`No microphone signal detected after ${Math.max(1, Math.round(completion.captureDurationMs / 1000))}s (peak ${completion.maxInputPeak.toFixed(3)}). Check Voice → Microphone and Chrome site settings.`);
          } else if (completion.completionReason === "duration_limit") {
            setDictationError("Dictation reached the server time limit. Start another dictation to continue.");
          } else if (audioTransferLost(completion)) {
            setDictationError(`Microphone audio was truncated before transcription (${completion.serverAudioBytes} of ${completion.audioBytesSent} bytes reached the server). Check the connection and try again.`);
          }
          // Otherwise nothing was said: no error.
          return;
        }
        if (take) applyTranscript(take, transcript);
        if (completion.completionReason === "duration_limit") {
          setDictationError("Dictation reached the server time limit. Start another dictation to continue.");
        }
        if (audioTransferLost(completion)) {
          setDictationError(`Microphone audio was truncated before transcription (${completion.serverAudioBytes} of ${completion.audioBytesSent} bytes reached the server). Check the connection and try again.`);
        }
        if (take && !take.cancelled && take.autoSend && completion.completionReason !== "duration_limit" && shouldAutoSend({ enabled: props.voiceSettings.autoSend, ...completion })) {
          autoSendPending = true;
        }
      },
      onError: (error) => {
        setDictationError(error.message);
        const code = (error as Error & { code?: string }).code;
        if (props.voiceSettings.inputDeviceId && ["NotFoundError", "OverconstrainedError"].includes(code || "")) {
          toast.error("The selected microphone is no longer available. Choose another device and save Voice settings.");
        }
      },
    }, {
      getInputDeviceId: () => props.voiceSettings.inputDeviceId,
      getCaptureProfile: () => props.voiceSettings.captureProfile === "processed" ? "processed" : "raw",
      getWarmMicrophone: () => props.voiceSettings.warmMicrophone === true,
    });
    voiceClients.push(client);
    return client;
  };
  const recordingNow = () => ["starting", "listening"].includes(dictationState());
  const stopTake = () => currentTake?.client.stop();

  const startDictation = (acceptedAt = performance.now()) => {
    if (recordingNow()) return;
    dictationWaveform.reset();
    setDictationError("");
    setTranscriberReady(false);
    const draft = props.chat.draft();
    const launch = pendingDictationLaunch;
    pendingDictationLaunch = null;
    const launchAcceptedAt = launch?.acceptedAt ?? acceptedAt;
    const focused = launch?.inputFocused ?? document.activeElement === input;
    const restoreFocus = !isMobileLayout() ? true : (launch?.keyboardOpen ?? keyboardWasOpen(focused));
    const range = dictatedRange();
    const selectionIsAutomatic = Boolean(
      focused
      && dictationSelectionOwned()
      && range
      && input.selectionStart === range.start
      && input.selectionEnd === range.end,
    );
    const start = selectionIsAutomatic ? draft.length : focused ? input.selectionStart ?? draft.length : draft.length;
    const end = selectionIsAutomatic ? start : focused ? input.selectionEnd ?? start : start;
    // A client that has finished is reused, so a warm microphone stays warm.
    const client = voiceClients.find((candidate) => ["idle", "completed", "failed"].includes(candidate.state())) ?? createTakeClient();
    const take: DictationTake = { client, range: null, cancelled: false, restoreFocus, autoSend: true };
    takes.set(client, take);
    currentTake = take;
    setTakeRange(take, beginDictatedRange(draft, start, end));
    setDictationSelectionOwned(false);
    client.start(launchAcceptedAt);
  };

  const toggleDictation = () => {
    if (recordingNow()) stopTake();
    else startDictation();
  };

  const sendMessage = async (mode?: "steer" | "follow_up") => {
    historyIndex = null;
    historyDraft = "";
    autoSendPending = false;
    setDictatedRange(null);
    for (const take of takes.values()) take.range = null;
    setDictationSelectionOwned(false);
    setDictationError("");
    if (props.onSendDraft) await props.onSendDraft(props.chat.draft());
    else await props.chat.send(mode);
  };

  const attach = () => {
    setSlashOpen(false);
    props.onOpenAttachments();
    queueMicrotask(() => input.focus());
  };

  const slashCommands = createMemo(() => composerSlashCommands(props.chat.draft(), slashCommandOptions()));
  const slashCommand = createMemo(() => slashCommands()[0]);
  const completeSlashCommand = (item: ReturnType<typeof slashCommands>[number]) => {
    props.chat.setDraft(item.command);
    queueMicrotask(() => {
      resize();
      input.setSelectionRange(item.command.length, item.command.length);
    });
  };
  const runSlashCommand = (item: ReturnType<typeof slashCommands>[number]) => {
    setSlashOpen(false);
    if (item.source === "harness") {
      props.chat.setDraft(`${item.command} `);
      queueMicrotask(() => input.focus());
      return;
    }
    props.chat.setDraft("");
    if (item.id === "attach") attach();
    else if (item.id === "compact") void props.chat.compact();
  };

  const paste = (event: ClipboardEvent) => {
    const files = filesFromDataTransfer(event.clipboardData);
    if (files.length) {
      event.preventDefault();
      props.attachments.addFiles(files);
      return;
    }
    const text = event.clipboardData?.getData("text/plain") ?? "";
    if (!shouldAttachPastedText(text, { attachmentsSupported: props.attachmentsSupported !== false })) return;
    event.preventDefault();
    const start = input.selectionStart ?? props.chat.draft().length;
    const end = input.selectionEnd ?? start;
    const file = fileFromPastedText(text);
    props.attachments.addFiles([file]);
    const attached = props.attachments.items().at(-1);
    toast(`Pasted text attached as ${file.name}`, {
      description: "Large pastes are attached so they do not fill the model's context.",
      action: {
        label: "Paste inline",
        onClick: () => {
          if (attached) void props.attachments.remove(attached);
          const next = insertTextAt(props.chat.draft(), start, end, text);
          props.chat.setDraft(next.text);
          queueMicrotask(() => {
            resize();
            input.focus({ preventScroll: true });
            input.setSelectionRange(next.caret, next.caret);
          });
        },
      },
    });
  };

  const keydown = (event: KeyboardEvent) => {
    if (event.key === "Escape" && slashOpen()) { event.preventDefault(); setSlashOpen(false); return; }
    if (event.key === "Tab" && slashOpen()) {
      event.preventDefault();
      const selected = slashCommand();
      if (selected) completeSlashCommand(selected);
      return;
    }
    if (event.key === "Enter" && slashOpen()) {
      event.preventDefault();
      const selected = slashCommand();
      if (selected) runSlashCommand(selected);
      return;
    }
    if (event.key === "Enter" && !event.shiftKey && !event.ctrlKey && !event.metaKey) {
      event.preventDefault();
      if (canSend()) sendMessage();
    }
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey) && event.shiftKey && busy() && hasText()) {
      event.preventDefault();
      sendMessage("steer");
    }
    if (event.key === "ArrowUp" && (historyIndex !== null || props.chat.draft() === "")) {
      const prompts = sentPrompts();
      if (!prompts.length) return;
      event.preventDefault();
      if (historyIndex === null) {
        historyDraft = props.chat.draft();
        historyIndex = prompts.length - 1;
      } else {
        historyIndex = Math.max(0, historyIndex - 1);
      }
      props.chat.setDraft(prompts[historyIndex]!);
      queueMicrotask(() => {
        resize();
        input.setSelectionRange(input.value.length, input.value.length);
      });
    }
    if (event.key === "ArrowDown" && historyIndex !== null) {
      event.preventDefault();
      const prompts = sentPrompts();
      historyIndex += 1;
      const value = historyIndex < prompts.length ? prompts[historyIndex]! : historyDraft;
      if (historyIndex >= prompts.length) historyIndex = null;
      props.chat.setDraft(value);
      queueMicrotask(() => {
        resize();
        input.setSelectionRange(input.value.length, input.value.length);
      });
    }
  };

  const selectionChanged = () => {
    const range = dictatedRange();
    if (!range || (input.selectionStart === range.start && input.selectionEnd === range.end)) return;
    setDictationSelectionOwned(false);
  };

  onMount(() => {
    const media = typeof matchMedia === "function" ? matchMedia(MOBILE_LAYOUT_QUERY) : null;
    const syncPhoneLayout = () => {
      setPhoneLayout(Boolean(media?.matches));
      scheduleResize();
    };
    syncPhoneLayout();
    media?.addEventListener("change", syncPhoneLayout);
    const foldObserver = new ResizeObserver(refit);
    foldObserver.observe(actionsRow);
    foldObserver.observe(mobileActions);
    // What the controls say changes their width: a model's name, a permission.
    createEffect(() => {
      props.models.model(); props.models.effort(); props.permissions?.selected(); props.serviceLevels?.selected();
      props.activeProfile; props.profiles.length; phoneLayout();
      for (const key of COMPOSER_FOLDS) foldPresent[key]();
      refit();
    });
    onCleanup(() => { foldObserver.disconnect(); cancelAnimationFrame(refitFrame); });
    props.onStatusChange?.(composerStatus);
    createEffect(() => {
      props.chat.draft();
      busy();
      dictating();
      scheduleResize();
    });
    createEffect(() => {
      props.chat.loadedId();
      historyIndex = null;
      historyDraft = "";
    });
    const composerSurfaceChanged = (event: Event) => setComposerSurface((event as CustomEvent<ComposerSurfaceMode>).detail);
    const voiceKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || document.querySelector('.settings-dialog[data-state="open"]')) return;
      if (props.keyboardOwner && !props.keyboardOwner()) return;
      if (!matchesShortcut(event, props.voiceSettings.shortcut)) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      if (event.repeat) return;
      const acceptedAt = performance.now();
      if (props.voiceSettings.activation === "toggle") {
        if (recordingNow()) stopTake();
        else startDictation(acceptedAt);
        return;
      }
      pushToTalkActive = true;
      startDictation(acceptedAt);
    };
    const voiceKeyUp = (event: KeyboardEvent) => {
      if (props.voiceSettings.activation !== "push_to_talk") return;
      if (!pushToTalkActive || !releasesShortcut(event, props.voiceSettings.shortcut)) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      pushToTalkActive = false;
      stopTake();
    };
    const voiceToggle = () => { if (!props.keyboardOwner || props.keyboardOwner()) toggleDictation(); };
    const phoneComposerChanged = () => setPhoneComposer(phoneComposerLayout());
    // Keyboard put away with nothing typed: leave the text pill too.
    const keyboardHidden = () => { if (voiceFirst() && document.activeElement === input && !hasText()) input.blur(); };
    window.addEventListener(KEYBOARD_HIDDEN_EVENT, keyboardHidden);
    onCleanup(() => window.removeEventListener(KEYBOARD_HIDDEN_EVENT, keyboardHidden));
    window.addEventListener(PHONE_COMPOSER_CHANGE_EVENT, phoneComposerChanged);
    onCleanup(() => window.removeEventListener(PHONE_COMPOSER_CHANGE_EVENT, phoneComposerChanged));
    window.addEventListener(COMPOSER_SURFACE_CHANGE_EVENT, composerSurfaceChanged);
    window.addEventListener("keydown", voiceKeyDown, true);
    window.addEventListener("keyup", voiceKeyUp, true);
    window.addEventListener("conduit:toggle-dictation", voiceToggle);
    onCleanup(() => {
      media?.removeEventListener("change", syncPhoneLayout);
      props.onStatusChange?.(null);
      window.removeEventListener(COMPOSER_SURFACE_CHANGE_EVENT, composerSurfaceChanged);
      window.removeEventListener("keydown", voiceKeyDown, true);
      window.removeEventListener("keyup", voiceKeyUp, true);
      window.removeEventListener("conduit:toggle-dictation", voiceToggle);
      for (const client of voiceClients) client.dispose();
    });
  });

  return <div class="composer-wrap" data-part="composer" data-phone-layout={voiceFirst() ? phoneComposer() : undefined} data-phone-mode={phoneMode()} data-primary-hidden={voiceFirst() && !hasPayload() && !stoppable() ? "" : undefined} style={phoneMode() === "listening" ? { "--voice-level": String(dictationWaveform.level()) } : undefined}>
    <Show when={phoneMode() === "listening"}>
      <Show when={dictatedText()}><div class="composer-voice-captions" aria-live="polite"><p><span ref={glideCaptions} class="composer-voice-words"><Index each={dictatedText().split(/(?<=\s)/)}>{(word) => <span>{word()}</span>}</Index></span></p></div></Show>
    </Show>
    <QueuedMessages
      messages={props.chat.pendingMessages()}
      surface={composerSurface()}
      busy={busy()}
      canInterrupt={supports("cancel")}
      onInterruptAndSend={() => void props.chat.interruptAndSend()}
      onEdit={props.chat.editQueued}
      onDiscard={props.chat.discardQueued}
    />
    <ReviewCommentCards items={comments()} chatId={props.chat.loadedId() ?? ""} label="File references" onRemove={(comment) => removeReviewComment(comment.id)} onUpdate={(comment, note) => updateReviewComment(comment.id, note)} />
    <Show when={props.attachmentsSupported !== false}>
      <AttachmentStrip items={props.attachments.items()} chatId={props.chat.loadedId()} surface={composerSurface()} onRemove={(item) => props.attachments.remove(item)} onRetry={(item) => props.attachments.retry(item)} />
    </Show>
    <div class="composer-surface-shell" data-composer-surface={composerSurface()}>
      <div class="composer composer-surface-material" data-composer-surface={composerSurface()}>
                <Show when={voiceFirst()}><div class="composer-voice-track" onClick={() => { if (phoneMode() === "listening") toggleDictation(); }}><div class="composer-voice-glow" aria-hidden="true"><i /><i /><i /><i /></div><VoiceWaveform class="chat-status-waveform composer-voice-waveform" history={dictationWaveform.history} level={dictationWaveform.level} peak={dictationWaveform.peak} state={recorderMonitorState()} variant="compact" barDensity={4} gain={2.5} ariaLabel="Microphone input level" /></div></Show>
        <div class="composer-content">
          <MobileComposerOptions composer={props} />
          <div class="composer-input-shell">
            <textarea ref={input} rows={1} aria-label="Message the agent" data-has-text={hasText() ? "true" : "false"} data-dictated-range={dictationSelectionOwned() && dictatedRange() ? "true" : undefined} placeholder={!props.serverOnline ? "Server unavailable" : !props.chat.loadedId() ? "New chat" : interactive() ? placeholder() : "Reconnecting..."} value={props.chat.draft()} disabled={!props.serverOnline || !interactive()} onInput={(event) => change(event.currentTarget.value)} onPaste={paste} onSelect={selectionChanged} onKeyDown={keydown} onFocus={() => setInputFocused(true)} onBlur={() => setInputFocused(false)} />
            <Show when={slashOpen() && slashCommand()}>{(item) => <div class="slash-completion" aria-hidden="true"><span>{props.chat.draft()}</span>{item().command.slice(props.chat.draft().length)} <small>{item().description}</small></div>}</Show>
          </div>
          <div ref={actionsRow} class="composer-actions" data-mobile-actions-stacked={mobileActionsStacked()}
            onPointerDown={(event) => { const control = (event.target as Element).closest("button"); if (control) control.dataset.pointerOpened = ""; }}
            onKeyDown={(event) => { if (["Enter", " ", "ArrowDown", "ArrowUp"].includes(event.key)) delete (event.target as HTMLElement).dataset?.pointerOpened; }}>
            <div ref={actionsLeft} class="composer-actions-left">
              <Show when={voiceFirst()}><Button variant="ghost" size="icon-sm" class="composer-keyboard-trigger" aria-label={inputFocused() ? "Close the keyboard" : "Type a message"} disabled={!props.serverOnline || !interactive()} onPointerDown={(event) => event.preventDefault()} onClick={() => inputFocused() ? input.blur() : input.focus()}><KeyboardIcon /></Button></Show>
              <Show when={!phoneLayout()}><ComposerPlusMenu folded={folded()} chat={props.chat} models={props.models} permissions={props.permissions} serviceLevels={props.serviceLevels}
                profiles={props.profiles} activeProfile={props.activeProfile} place={props.place} disabled={!props.serverOnline || !interactive()} modelSwitch={supports("modelSwitch")}
                onChooseProfile={props.onChooseProfile} onOpenModelSelector={props.onOpenModelSelector} modelSelectorShortcut={props.modelSelectorShortcut}
                onAttach={props.attachmentsSupported !== false ? attach : undefined} /></Show>
              <Show when={props.folder}>{(folder) => <FolderPicker {...folder()} />}</Show>
              <Show when={shows("context")}><div class="composer-desktop-setting" data-composer-fold="context"><ContextGauge chat={props.chat} compact canCompact={supports("compaction")} /></div></Show>
              <Show when={props.profiles.length && shows("profile")}><div class="composer-desktop-setting" data-composer-fold="profile"><Menu><MenuTrigger class="model-trigger composer-profile-trigger" title={props.activeProfile?.label || "Profile"} aria-label={`Profile ${props.activeProfile?.label || "General"}`} disabled={!props.serverOnline || !interactive()}><HarnessMark id={props.activeProfile?.implementation || "conduit"} class="size-4" /><ChevronDownIcon /></MenuTrigger><MenuContent class="w-72"><MenuGroup><MenuLabel>Profile</MenuLabel><MenuRadioGroup value={props.activeProfile?.id || ""} onChange={props.onChooseProfile}><For each={props.profiles}>{(item) => <MenuRadioItem value={item.id} disabled={(props.chat.status() !== "draft" && item.id !== props.activeProfile?.id) || item.disabled}><HarnessMark id={item.implementation || "conduit"} class="size-4" /><span class="composer-profile-copy"><span>{item.label}</span><small>{item.implementation || "conduit"}</small></span></MenuRadioItem>}</For></MenuRadioGroup></MenuGroup></MenuContent></Menu></div></Show>
              <Show when={shows("model")}><div class="composer-desktop-setting" data-composer-fold="model">
                <ModelSelector models={props.models.models()} model={props.models.model()} thinkingLevel={props.models.effort()} notice={props.models.notice()} loading={props.modelsLoading} disabled={!props.serverOnline || !interactive() || !supports("modelSwitch")} onModelChange={(value) => void props.models.chooseModel(value)} onThinkingLevelChange={(value) => void props.models.chooseEffort(value)} onSearchModels={props.onOpenModelSelector} searchShortcut={props.modelSelectorShortcut} />
              </div></Show>
              <Show when={(props.permissions?.profiles().length || props.serviceLevels?.levels().length) && shows("permissions")}><div class="composer-desktop-setting" data-composer-fold="permissions"><Menu><MenuTrigger class="model-trigger composer-permission-trigger" aria-label="Session settings" disabled={!props.serverOnline || !interactive()}><ShieldCheckIcon /><span>{props.permissions?.profiles().find((profile) => profile.id === props.permissions?.selected())?.label || "Settings"}</span><ChevronDownIcon /></MenuTrigger><MenuContent class="w-72"><Show when={props.permissions?.profiles().length}><MenuGroup><MenuLabel>Permissions</MenuLabel><MenuRadioGroup value={props.permissions?.selected() || ""} onChange={(value) => void props.permissions?.choose(value)}><For each={props.permissions?.profiles() || []}>{(profile) => <MenuRadioItem value={profile.id} disabled={!profile.allowed}><span class="shrink-0 whitespace-nowrap">{profile.label}</span><Show when={profile.description}><span class="ml-auto max-w-40 truncate text-xs text-muted-foreground">{profile.description}</span></Show></MenuRadioItem>}</For></MenuRadioGroup></MenuGroup></Show><Show when={props.serviceLevels?.levels().length}><Show when={props.permissions?.profiles().length}><MenuSeparator /></Show><MenuGroup><MenuLabel>Service level</MenuLabel><MenuRadioGroup value={props.serviceLevels?.selected() || ""} onChange={(value) => void props.serviceLevels?.choose(value)}><For each={props.serviceLevels?.levels() || []}>{(level) => <MenuRadioItem value={level.id}>{level.label}</MenuRadioItem>}</For></MenuRadioGroup></MenuGroup></Show></MenuContent></Menu></div></Show>
            </div>
            <Show when={recording() && !phoneLayout()}><VoiceWaveform class="composer-status-waveform composer-actions-waveform" history={dictationWaveform.history} level={dictationWaveform.level} peak={dictationWaveform.peak} state={recorderMonitorState()} variant="compact" barDensity={3} ariaLabel={dictationLabel() || "Microphone input level"} /></Show>
            <div ref={mobileActions} class="composer-actions-right">
              <Show when={!recording() && (dictationLabel() || (activity()?.label && activity()?.label !== "Ready"))}><span class="composer-status-state composer-actions-status" role="status" aria-live="polite"><Show when={dictationLabel()} fallback={<><Show when={SPINNING_ACTIVITY.has(activity()?.kind || "")}><Spinner /></Show><Show when={["request_failed", "runtime_failed"].includes(activity()?.kind || "")}><TriangleAlertIcon aria-hidden="true" /></Show>{activity()?.label || "Ready"}</>}>{dictationLabel()}</Show></span></Show>
              <Button variant="ghost" size="icon-sm" class="dictation-trigger" data-state={dictationState()} aria-label={["starting", "listening"].includes(dictationState()) ? "Stop voice dictation" : "Start voice dictation"} aria-pressed={dictating()} title={`Voice dictation (${props.voiceSettings.shortcut})`} disabled={!props.serverOnline || !interactive()} onPointerDown={captureDictationLaunch} onClick={toggleDictation}><Show when={voiceFirst()} fallback={<Show when={dictationState() === "starting"} fallback={<MicIcon />}><Spinner /></Show>}><Show when={phoneComposer() === "bar"}><div class="composer-voice-glow" aria-hidden="true"><i /><i /><i /><i /></div></Show><span class="composer-voice-mic"><MicIcon /></span><ThinkingOrb state="listening" class="composer-voice-orb" paused={phoneMode() !== "listening"} /></Show></Button>
              {/* One primary slot, so nothing beside it moves. While the agent
                  works it is Stop; once a draft is typed it is Send again --
                  which queues the message for the agent -- and Stop steps to
                  its left. Each change scales the new action in. */}
              <Show when={stoppable() && newDraft()}>
                <Button variant="ghost" size="icon-sm" class="composer-stop-aside" aria-label="Stop response" onClick={props.chat.stop}><Show when={props.chat.stopping()} fallback={<SquareIcon />}><Spinner /></Show></Button>
              </Show>
              <Show when={voiceFirst() || !(phoneMode() === "idle" && !stoppable())}><span class="composer-primary-slot">
                <Show when={phoneMode() !== "listening"}>
                <Show when={stoppable() && !newDraft()} fallback={
                  <Button variant="ghost" size="icon-sm" class="composer-send-trigger" aria-label={busy() ? "Send to the agent" : "Send message"} title={busy() ? "Send — the agent takes it when the current step finishes" : undefined} disabled={!canSend()} onClick={() => sendMessage()}><ArrowUpIcon /></Button>}>
                  <Button variant="ghost" size="icon-sm" class="composer-stop-trigger" aria-label="Stop response" onClick={props.chat.stop}><Show when={props.chat.stopping()} fallback={<SquareIcon />}><Spinner /></Show></Button>
                </Show>
                </Show>
              </span></Show>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>;
}
