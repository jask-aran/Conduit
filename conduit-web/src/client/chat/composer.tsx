import { HarnessMark } from "@/components/ui";
import { Icons } from "@/components/ui";
import { Button as LibraryButton, Captions, Completion, ComposerField, DesktopComposer, PhoneComposer, Picker, PillButton, PillField, PillWave, Rider, Spinner, StopGlyph, TextArea, Toolbar, VoiceRider } from "@/components/ui";
import { latestAway, scrollToLatest } from "./latest-away";
import { createEffect, createMemo, createSignal, For, lazy, on, onCleanup, onMount, Show, type JSX } from "solid-js";

import { DropdownMenu, MenuContent } from "@/components/menus";
import type { BooleanCapability, Project, Template } from "../api/contracts";
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
import { createVoiceDictationClient, type VoiceDictationState } from "./voice-dictation-client";
import { ContextGauge } from "./context-gauge";
import type { AudioSignalLevel } from "./voice-audio";
import { toast } from "@/components/notifications";
import { audioTransferLost, beginDictatedRange, matchesShortcut, releasesShortcut, replaceDictatedRange, shouldAutoSend, shouldReportNoSignal } from "./voice-dictation";
import { createVoiceWaveformController, type VoiceWaveformController } from "./voice-waveform";
import { MAX_RESPONSIVE_BAR_COUNT } from "@/components/ui/voice-waveform-model";
import { ModelSelector } from "./model-selector";

import { parseReviewComments, removeReviewComment, reviewComments, updateReviewComment } from "./review-comments";
import { ReviewCommentCards } from "./review-comment-cards";
import { HostUiRequests } from "./host-ui-card";

export const SPINNING_ACTIVITY = new Set(["starting", "reconnecting", "thinking", "responding", "using_tool", "retrying", "compacting", "stopping", "waiting_for_model"]);

import { FolderPicker, type FolderOptions, type PlaceOptions } from "./place-picker";
import { COMPOSER_FOLDS, foldsFor, type ComposerFold } from "./composer-folds";
import { createLeaving, riderMotion } from "./composer-cards";
import { ComposerPlusMenu, PermissionChoices, ProfileChoices, ServiceChoices } from "./composer-plus-menu";
const MobileComposerOptions = lazy(() => import("./mobile-composer-options"));

export interface ComposerStatus {
  dictationState: () => VoiceDictationState;
  dictationError: () => string;
  dictating: () => boolean;
  recording: () => boolean;
  recorderMonitorState: () => "connecting" | "listening" | "stopped";
  waveform: VoiceWaveformController;
}

const EDIT_ACTIONS = [
  { key: "undo", label: "Undo", icon: () => <Icons.Undo /> },
  { key: "delete", label: "Delete word or selection", icon: () => <Icons.Backspace /> },
  { key: "left", label: "Previous word", icon: () => <Icons.ChevronLeft /> },
  { key: "right", label: "Next word", icon: () => <Icons.ChevronRight /> },
  { key: "end", label: "End of draft", icon: () => <Icons.InsertText /> },
] as const;

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
  /** Its chat is still arriving (reattaching): the field alone shows. */
  opening?: boolean;
  /** The folder button beside attach: where this chat lives. */
  place?: PlaceOptions;
  /** A harness thread's folder, in the place button's slot. */
  folder?: FolderOptions;
  /** The workspace a page's unsent chat goes to, when no place is chosen in it (a workspace's page): what the composer says of its machine. */
  workspace?: Project;
  supports?: (capability: BooleanCapability) => boolean;
}) {
  let input!: HTMLTextAreaElement;
  let actionsRow: HTMLDivElement | undefined;
  const actionsLeft = () => actionsRow!.firstElementChild as HTMLElement;
  const [slashOpen, setSlashOpen] = createSignal(false);
  const [dictationState, setDictationState] = createSignal<VoiceDictationState>("idle");
  const [dictationError, setDictationError] = createSignal("");
  const [transcriberReady, setTranscriberReady] = createSignal(false);
  const [dictatedRange, setDictatedRange] = createSignal<{ start: number; end: number } | null>(null);
  const [dictationSelectionOwned, setDictationSelectionOwned] = createSignal(false);
  const [phoneLayout, setPhoneLayout] = createSignal(isMobileLayout());
  /* Voice-first phone layouts: idle is a row of buttons with no text line;
     typing (focused, or a draft kept) adds the text row on top; listening
     shows the orb, the coloured glow and the last lines of the transcript. */
  const [inputFocused, setInputFocused] = createSignal(false);
  /* In the voice layouts only the keyboard button raises the keyboard. A tap
     on the text pill places the cursor (where dictation will land) or starts
     a selection, with inputmode="none" keeping the keyboard down. */
  const [keyboardWanted, setKeyboardWanted] = createSignal(false);
  const [sendingTake, setSendingTake] = createSignal(false);
  const sendingOut = () => sendingTake() || props.chat.generation() === "submitting";
  const toggleKeyboard = () => {
    if (keyboardWanted()) { setKeyboardWanted(false); input.blur(); return; }
    // Focused with the keyboard down and nothing left (a dictation cleared
    // out): the button closes the edit row and text pill, back to idle.
    if (document.activeElement === input && !hasText()) { input.blur(); return; }
    setKeyboardWanted(true);
    // inputmode is read on focus, so an already focused field is focused anew.
    if (document.activeElement === input) { refocusing = true; input.blur(); refocusing = false; }
    queueMicrotask(() => input.focus({ preventScroll: true }));
  };
  let refocusing = false;
  // A phone has one composer, voice-first: a field over a bar of buttons.
  const voiceFirst = () => phoneLayout();
  const phoneMode = () => !voiceFirst() ? undefined
    // Finishing and transcribing still look like listening, so stopping goes
    // straight to the result instead of flashing through the text row.
    // Once stopped, the row settles at once; the transcript lands when it lands.
    : ["starting", "listening"].includes(dictationState()) ? "listening"
    // Sent, or stop-and-send waiting on its transcript: the text pill goes at
    // once rather than holding the draft until the agent takes it.
    : sendingOut() ? "idle"
    : inputFocused() || hasText() ? "typing" : "idle";
  const [optionsOpen, setOptionsOpen] = createSignal(false);
  // The text row was zero wide while hidden; measure it again once shown.
  createEffect(on(phoneMode, () => scheduleResize(), { defer: true }));
  // Dictation failures go through the app's normal toasts.
  // One toast for dictation's failure: pressing the mic again replaces it rather than stacking another.
  createEffect(on(dictationError, (message) => { if (message) toast.error(message, { id: "dictation-error" }); }, { defer: true }));
  // The transcript's scroll-to-latest and cancel editing ride above the captions.
  const announceCaptions = (element: HTMLElement) => {
    const observer = new ResizeObserver(() => window.dispatchEvent(new CustomEvent("conduit:voice-captions")));
    observer.observe(element);
    onCleanup(() => { observer.disconnect(); queueMicrotask(() => window.dispatchEvent(new CustomEvent("conduit:voice-captions"))); });
  };
  /* Captions open with the end of what is already in the composer, upright,
     so the new dictation reads as continuing it. Only the tail is kept: three
     lines show at most. */
  const captionLead = () => { const range = dictatedRange(); return range ? props.chat.draft().slice(Math.max(0, range.start - 240), range.start).trimStart() : ""; };
  const dictatedText = () => { const range = dictatedRange(); return range ? props.chat.draft().slice(range.start, range.end) : ""; };
  // A phone has no model chip in its row, so the empty draft names the model --
  // it stays in view at no cost in height.
  const placeholder = () => {
    const model = phoneLayout() && (props.models.models().find((item) => item.spec === props.models.model())?.label || props.models.model());
    return model || "Send a message...";
  };
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
  const fit = () => {
    if (phoneLayout() || !actionsRow?.isConnected) { if (folded().size) setFolded(new Set<ComposerFold>()); return; }
    for (const element of actionsLeft().querySelectorAll<HTMLElement>(":scope > [data-composer-fold]")) foldWidths.set(element.dataset.composerFold as ComposerFold, element.getBoundingClientRect().width);
    const widths = new Map<ComposerFold, number>();
    for (const key of COMPOSER_FOLDS) if (foldPresent[key]() && foldWidths.has(key)) widths.set(key, foldWidths.get(key)!);
    const gap = parseFloat(getComputedStyle(actionsLeft()).columnGap) || 0;
    const fixedChildren = ([...actionsLeft().children] as HTMLElement[]).filter((child) => !child.dataset.composerFold);
    const fixed = fixedChildren.reduce((sum, child) => sum + child.getBoundingClientRect().width, 0) + gap * Math.max(0, fixedChildren.length - 1);
    const row = getComputedStyle(actionsRow);
    const others = ([...actionsRow.children] as HTMLElement[]).filter((child) => child !== actionsLeft());
    const available = actionsRow.clientWidth - (parseFloat(row.paddingLeft) || 0) - (parseFloat(row.paddingRight) || 0)
      - others.reduce((sum, child) => sum + child.getBoundingClientRect().width + (parseFloat(row.columnGap) || 0), 0);
    const next = foldsFor(available, fixed, widths, gap);
    const current = folded();
    if (next.size !== current.size || [...next].some((key) => !current.has(key))) setFolded(next);
  };
  const refit = () => { cancelAnimationFrame(refitFrame); refitFrame = requestAnimationFrame(fit); };
  const shows = (key: ComposerFold) => phoneLayout() || !folded().has(key);
  // The desktop row's folding, observed from whenever its Toolbar is drawn; a phone's row has none of it.
  // Measured where the observer delivers, after layout: its reads are free there. Deferred to the next frame, they came
  // after that frame's writes -- the dock easing open set every pane's width -- and forced a whole layout of the page
  // per composer per frame (440ms of a 3s dock toggle with three composers drawn).
  const foldObserver = new ResizeObserver(() => { cancelAnimationFrame(refitFrame); fit(); });
  onCleanup(() => foldObserver.disconnect());
  const toolbarRef = (element: HTMLDivElement) => { actionsRow = element; foldObserver.observe(element); refit(); };
  const dictationWaveform = createVoiceWaveformController(MAX_RESPONSIVE_BAR_COUNT);
  let pushToTalkActive = false;
  /* One take per press of the mic. A stopped take keeps finalising on its own
     client and writes into its own range while the next one records; ranges
     after a take shift when its text changes length. */
  type DictationTake = { client: VoiceClient; range: { start: number; end: number } | null; cancelled: boolean; restoreFocus: boolean; autoSend: boolean; sendWhenDone?: boolean };
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
  const sentPrompts = createMemo(() => props.chat.messages()
    .filter((message) => message.role === "user" && !message.pending && Boolean(message.content?.trim()))
    .map((message) => parseReviewComments(message.content!).text)
    .filter(Boolean));
  const slashCommandOptions = () => ({
    attachments: props.attachmentsSupported !== false,
    compaction: supports("compaction") && !busy() && !props.chat.compacting(),
    harnessCommands: props.chat.harnessCommands(),
  });
  const composerStatus: ComposerStatus = {
    dictationState,
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

  /* Edit actions for the text pill in the voice layouts, where the keyboard
     is usually down: a cursor placed by finger is nudged a word at a time,
     and undo is the composer's own because programmatic draft changes
     (dictation, these actions) never reach the textarea's native stack. */
  type DraftSnapshot = { text: string; start: number; end: number };
  const undoStack: DraftSnapshot[] = [];
  let lastSnapshotAt = 0;
  const snapshot = (force = false) => {
    const now = performance.now();
    if (!force && now - lastSnapshotAt < 800) return;
    lastSnapshotAt = now;
    const text = props.chat.draft();
    if (undoStack.at(-1)?.text === text) return;
    undoStack.push({ text, start: input?.selectionStart ?? text.length, end: input?.selectionEnd ?? text.length });
    if (undoStack.length > 100) undoStack.shift();
  };
  const placeCursor = (start: number, end = start) => queueMicrotask(() => { input.focus({ preventScroll: true }); input.setSelectionRange(start, end); });
  const editDraft = (text: string, cursor: number) => {
    snapshot(true);
    restoringDraft = true;
    change(text);
    restoringDraft = false;
    // The next typed change starts a step of its own.
    lastSnapshotAt = 0;
    placeCursor(cursor);
  };
  const wordBefore = (text: string, at: number) => at - (text.slice(0, at).match(/\S+\s*$|\s+$/)?.[0].length ?? 0);
  const wordAfter = (text: string, at: number) => at + (text.slice(at).match(/^\s*\S+|^\s+/)?.[0].length ?? 0);
  const editActions = {
    undo: () => {
      const previous = undoStack.pop();
      if (!previous) return;
      restoringDraft = true;
      change(previous.text);
      restoringDraft = false;
      placeCursor(previous.start, previous.end);
    },
    delete: () => {
      const text = props.chat.draft();
      const start = input.selectionStart ?? text.length;
      const end = input.selectionEnd ?? start;
      const from = start === end ? wordBefore(text, start) : start;
      if (from === end) return;
      editDraft(text.slice(0, from) + text.slice(end), from);
    },
    left: () => placeCursor(wordBefore(props.chat.draft(), input.selectionStart ?? 0)),
    right: () => placeCursor(wordAfter(props.chat.draft(), input.selectionEnd ?? 0)),
    end: () => placeCursor(props.chat.draft().length),
  };
  // Whenever the text pill has the cursor, empty or not: clearing the draft
  // is exactly when undo is wanted.
  const editing = () => voiceFirst() && inputFocused() && phoneMode() === "typing";
  // The transcript's scroll-to-latest button moves above the edit actions.
  createEffect(on(editing, () => window.dispatchEvent(new CustomEvent("conduit:voice-captions")), { defer: true }));

  let restoringDraft = false;
  const change = (value: string, manual = true) => {
    if (manual && !restoringDraft) snapshot();
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
      // The keyboard was up when dictation began: it comes back with focus.
      if (take.restoreFocus) { if (document.activeElement !== input) setKeyboardWanted(true); input.focus({ preventScroll: true }); }
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
    queueMicrotask(() => setSendingTake(false));
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
        queueMicrotask(() => { settleAutoSend(); if (!autoSendPending) setSendingTake(false); });
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
          // Stop and send with nothing new said still sends what was there.
          if (take?.sendWhenDone && !take.cancelled && props.chat.draft().trim()) autoSendPending = true;
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
        // Finished: the text pill shows the end of the draft, not wherever the
        // dictated range left it scrolled.
        if (take === currentTake) requestAnimationFrame(() => { input.scrollTop = input.scrollHeight; });
        if (completion.completionReason === "duration_limit") {
          setDictationError("Dictation reached the server time limit. Start another dictation to continue.");
        }
        if (audioTransferLost(completion)) {
          setDictationError(`Microphone audio was truncated before transcription (${completion.serverAudioBytes} of ${completion.audioBytesSent} bytes reached the server). Check the connection and try again.`);
        }
        if (take?.sendWhenDone && !take.cancelled) autoSendPending = true;
        else if (take && !take.cancelled && take.autoSend && completion.completionReason !== "duration_limit" && shouldAutoSend({ enabled: props.voiceSettings.autoSend, ...completion })) {
          autoSendPending = true;
        }
      },
      onError: (error) => {
        setSendingTake(false);
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
  // Ends the take and sends the draft once its transcript lands.
  const stopAndSend = () => {
    if (!currentTake) return;
    currentTake.sendWhenDone = true;
    setSendingTake(true);
    // Never left hiding the draft if the transcript does not come back.
    setTimeout(() => setSendingTake(false), 20_000);
    stopTake();
  };

  const startDictation = (acceptedAt = performance.now()) => {
    if (recordingNow()) return;
    snapshot(true);
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

  let cameraInput!: HTMLInputElement;
  let cameraHold: ReturnType<typeof setTimeout> | null = null;
  let cameraHeld = false;
  const cameraPointerDown = (event: PointerEvent) => {
    event.preventDefault();
    cameraHeld = false;
    cameraHold = setTimeout(() => { cameraHold = null; cameraHeld = true; props.onOpenAttachments(); }, 450);
  };
  const cameraPointerCancel = () => { if (cameraHold) clearTimeout(cameraHold); cameraHold = null; };
  const cameraPointerUp = () => {
    if (!cameraHold) return;
    cameraPointerCancel();
    if (!cameraHeld) cameraInput.click();
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
    // What the controls say changes their width: a model's name, a permission.
    createEffect(() => {
      props.models.model(); props.models.effort(); props.permissions?.selected(); props.serviceLevels?.selected();
      props.activeProfile; props.profiles.length; phoneLayout();
      for (const key of COMPOSER_FOLDS) foldPresent[key]();
      refit();
    });
    onCleanup(() => cancelAnimationFrame(refitFrame));
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
    const voiceKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || document.querySelector('[role="dialog"][aria-label="Settings"][data-state="open"]')) return;
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
    // Keyboard put away with nothing typed: leave the text pill too.
    const keyboardHidden = () => {
      setKeyboardWanted(false);
      if (voiceFirst() && document.activeElement === input && !hasText()) input.blur();
    };
    window.addEventListener(KEYBOARD_HIDDEN_EVENT, keyboardHidden);
    onCleanup(() => window.removeEventListener(KEYBOARD_HIDDEN_EVENT, keyboardHidden));
    window.addEventListener("keydown", voiceKeyDown, true);
    window.addEventListener("keyup", voiceKeyUp, true);
    window.addEventListener("conduit:toggle-dictation", voiceToggle);
    onCleanup(() => {
      media?.removeEventListener("change", syncPhoneLayout);
      props.onStatusChange?.(null);
      window.removeEventListener("keydown", voiceKeyDown, true);
      window.removeEventListener("keyup", voiceKeyUp, true);
      window.removeEventListener("conduit:toggle-dictation", voiceToggle);
      for (const client of voiceClients) client.dispose();
    });
  });

  const field = () => <>
    <TextArea ref={input} rows={1} data-composer-input="" aria-label="Message the agent" data-held={dictationSelectionOwned() && dictatedRange() ? "" : undefined} placeholder={!props.serverOnline ? "Server unavailable" : !props.chat.loadedId() ? "New chat" : interactive() ? placeholder() : "Reconnecting..."} value={props.chat.draft()} disabled={!props.serverOnline || !interactive()} onInput={(event) => change(event.currentTarget.value)} onPaste={paste} onSelect={selectionChanged} onKeyDown={keydown} inputMode={voiceFirst() && !keyboardWanted() ? "none" : undefined} onFocus={() => setInputFocused(true)} onBlur={() => { setInputFocused(false); if (!refocusing) setKeyboardWanted(false); }} />
    <Show when={slashOpen() && slashCommand()}>{(item) => <Completion typed={props.chat.draft()} rest={item().command.slice(props.chat.draft().length)} detail={item().description} />}</Show>
  </>;
  const riders = () => <>
    <QueuedMessages messages={props.chat.pendingMessages()} busy={busy()} canInterrupt={supports("cancel")} onInterruptAndSend={() => void props.chat.interruptAndSend()} onEdit={props.chat.editQueued} onDiscard={props.chat.discardQueued} />
    <Show when={comments().length}><Rider label="File references"><ReviewCommentCards items={comments()} chatId={props.chat.loadedId() ?? ""} label="File references" onRemove={(comment) => removeReviewComment(comment.id)} onUpdate={(comment, note) => updateReviewComment(comment.id, note)} /></Rider></Show>
    <Show when={props.attachmentsSupported !== false}>
      <AttachmentStrip items={props.attachments.items()} chatId={props.chat.loadedId()} onRemove={(item) => props.attachments.remove(item)} onRetry={(item) => props.attachments.retry(item)} />
    </Show>
  </>;
  // What the agent is blocked on: on a desktop it takes the composer's place; on a phone it rides over the field.
  const question = () => <Show when={props.chat.hostUiRequests().length}><HostUiRequests requests={props.chat.hostUiRequests()} onRespond={props.chat.respondHostUi} onStop={() => props.chat.stop()} /></Show>;
  const stopButton = () => <LibraryButton variant="ghost" size="icon-sm" aria-label="Stop response" onClick={props.chat.stop}><Show when={props.chat.stopping()} fallback={<StopGlyph />}><Spinner /></Show></LibraryButton>;
  // Dictating, the voice rides over the composer on its Aura, as a phone's track does; the words go into the field as
  // they come. The agent's doing reads in the transcript, as on a phone.
  const listening = () => ["starting", "listening"].includes(dictationState());
  const voice = createLeaving(listening, (on) => on, () => "fade");
  const desktop = () => <DesktopComposer takeover={question()} opening={props.opening}
    riders={<>{riders()}<Show when={voice.value()}><VoiceRider levels={dictationWaveform.history()} gain={2.5} level={Math.min(1, dictationWaveform.level() * 2.5)} motion={riderMotion(voice.leaving())} /></Show></>}>
    <ComposerField>{field()}</ComposerField>
    <Toolbar ref={toolbarRef}
      start={<>
        <ComposerPlusMenu folded={folded()} chat={props.chat} models={props.models} permissions={props.permissions} serviceLevels={props.serviceLevels}
          profiles={props.profiles} activeProfile={props.activeProfile} place={props.place} disabled={!props.serverOnline || !interactive()} modelSwitch={supports("modelSwitch")}
          onChooseProfile={props.onChooseProfile} onOpenModelSelector={props.onOpenModelSelector} modelSelectorShortcut={props.modelSelectorShortcut}
          onAttach={props.attachmentsSupported !== false ? attach : undefined} />
        <Show when={props.folder}>{(folder) => <FolderPicker {...folder()} />}</Show>
        <Show when={shows("context")}><div data-composer-fold="context"><ContextGauge chat={props.chat} compact canCompact={supports("compaction")} /></div></Show>
        <Show when={props.profiles.length && shows("profile")}><div data-composer-fold="profile"><DropdownMenu>
          <DropdownMenu.Trigger as={Picker} icon={<HarnessMark id={props.activeProfile?.implementation || "conduit"} />} title={props.activeProfile?.label || "Profile"} aria-label={`Profile ${props.activeProfile?.label || "General"}`} disabled={!props.serverOnline || !interactive()} />
          <MenuContent><ProfileChoices profiles={props.profiles} active={props.activeProfile} locked={props.chat.status() !== "draft"} onChoose={props.onChooseProfile} /></MenuContent>
        </DropdownMenu></div></Show>
        <Show when={shows("model")}><div data-composer-fold="model">
          <ModelSelector models={props.models.models()} model={props.models.model()} thinkingLevel={props.models.effort()} notice={props.models.notice()} loading={props.modelsLoading} disabled={!props.serverOnline || !interactive() || !supports("modelSwitch")} onModelChange={(value) => void props.models.chooseModel(value)} onThinkingLevelChange={(value) => void props.models.chooseEffort(value)} onSearchModels={props.onOpenModelSelector} searchShortcut={props.modelSelectorShortcut} />
        </div></Show>
        <Show when={(props.permissions?.profiles().length || props.serviceLevels?.levels().length) && shows("permissions")}><div data-composer-fold="permissions"><DropdownMenu>
          <DropdownMenu.Trigger as={Picker} icon={<Icons.Permissions />} value={props.permissions?.profiles().find((profile) => profile.id === props.permissions?.selected())?.label || "Settings"} aria-label="Session settings" disabled={!props.serverOnline || !interactive()} />
          <MenuContent>
            <Show when={props.permissions?.profiles().length}><PermissionChoices permissions={props.permissions!} /></Show>
            <Show when={props.serviceLevels?.levels().length}><ServiceChoices levels={props.serviceLevels!} /></Show>
          </MenuContent>
        </DropdownMenu></div></Show>
      </>}
      end={<LibraryButton variant="ghost" size="icon-sm" data-state={dictationState()} aria-label={["starting", "listening"].includes(dictationState()) ? "Stop voice dictation" : "Start voice dictation"} aria-pressed={dictating()} title={`Voice dictation (${props.voiceSettings.shortcut})`} disabled={!props.serverOnline || !interactive()} onPointerDown={captureDictationLaunch} onClick={toggleDictation}><Show when={["starting", "finishing", "waiting", "transcribing"].includes(dictationState())} fallback={<Icons.Microphone />}><Spinner /></Show></LibraryButton>}
      // One primary slot, so nothing beside it moves: Stop while the agent works; once a draft is typed, Send again
      // (which queues the message for the agent), and Stop steps in beside it.
      aside={<Show when={stoppable() && newDraft()}>{stopButton()}</Show>}
      primary={<Show when={stoppable() && !newDraft()} fallback={<LibraryButton variant="ghost" size="icon-sm" aria-label={busy() ? "Send to the agent" : "Send message"} title={busy() ? "Send — the agent takes it when the current step finishes" : undefined} disabled={!canSend()} onClick={() => sendMessage()}><Icons.Send /></LibraryButton>}>{stopButton()}</Show>} />
  </DesktopComposer>;
  const phone = () => <PhoneComposer opening={props.opening} mode={phoneMode() ?? "idle"} layout="bar" under={optionsOpen()} editing={editing()} level={Math.min(1, dictationWaveform.level() * 2.5)} onTrack={toggleDictation}
    riders={<>{question()}{riders()}</>}
    field={<PillField>{field()}</PillField>}
    track={<PillWave levels={dictationWaveform.history()} gain={2.5} />}
    captions={<Show when={captionLead() || dictatedText()}><Captions lead={captionLead()} words={dictatedText().split(/(?<=\s)/)} ref={announceCaptions} /></Show>}
    edit={<For each={EDIT_ACTIONS}>{(action) => <PillButton label={action.label} icon={action.icon()} button={{ tabIndex: editing() ? 0 : -1, onPointerDown: (event) => event.preventDefault(), onClick: () => editActions[action.key]() }} />}</For>}>
    <MobileComposerOptions composer={props} onOpenChange={setOptionsOpen} />
    <Show when={props.attachmentsSupported !== false}>
      {/* Tap: the camera, through the platform's own capture. Hold: the same picker as Attach files. */}
      <input ref={cameraInput} type="file" accept="image/*" capture="environment" hidden onChange={(event) => { const files = Array.from(event.currentTarget.files || []); event.currentTarget.value = ""; if (files.length) props.attachments.addFiles(files); }} />
      <PillButton label="Take a photo" icon={<Icons.Camera />} button={{ title: "Take a photo (hold to choose files)", disabled: !props.serverOnline || !interactive(), onPointerDown: cameraPointerDown, onPointerUp: cameraPointerUp, onPointerLeave: cameraPointerCancel, onPointerCancel: cameraPointerCancel, onContextMenu: (event) => event.preventDefault() }} />
    </Show>
    <PillButton label={keyboardWanted() ? "Close the keyboard" : "Type a message"} icon={<Icons.Keyboard />} button={{ disabled: !props.serverOnline || !interactive(), onPointerDown: (event) => event.preventDefault(), onClick: toggleKeyboard }} />
    <PillButton folded={!latestAway()} label="Scroll to latest" icon={<Icons.ArrowDown />} button={{ onPointerDown: (event) => event.preventDefault(), onClick: scrollToLatest }} />
    <PillButton stretch aura haptic="press" label={["starting", "listening"].includes(dictationState()) ? "Stop voice dictation" : "Start voice dictation"} icon={<Icons.Microphone />} button={{ "data-state": dictationState(), "aria-pressed": dictating(), title: `Voice dictation (${props.voiceSettings.shortcut})`, disabled: !props.serverOnline || !interactive(), onPointerDown: captureDictationLaunch, onClick: toggleDictation }} />
    <PillButton haptic="press" folded={phoneMode() === "listening" || !(stoppable() && newDraft())} label="Stop response" icon={<Show when={props.chat.stopping()} fallback={<StopGlyph />}><Spinner /></Show>} button={{ onClick: props.chat.stop }} />
    {/* One slot, one arrow: Stop and send while listening, Send with a draft, Stop while the agent works; folded with none. */}
    <PillButton voice haptic="press" folded={phoneMode() !== "listening" && !hasPayload() && !stoppable()}
      label={phoneMode() === "listening" ? "Stop and send" : stoppable() && !newDraft() ? "Stop response" : busy() ? "Send to the agent" : "Send message"}
      icon={<Show when={phoneMode() !== "listening" && stoppable() && !newDraft()} fallback={<Icons.Send />}><Show when={props.chat.stopping()} fallback={<StopGlyph />}><Spinner /></Show></Show>}
      button={{ disabled: phoneMode() !== "listening" && !(stoppable() && !newDraft()) && !canSend(), onPointerDown: (event) => { if (phoneMode() === "listening") event.preventDefault(); },
        onClick: () => phoneMode() === "listening" ? stopAndSend() : stoppable() && !newDraft() ? props.chat.stop() : sendMessage() }} />
  </PhoneComposer>;
  return <Show when={voiceFirst()} fallback={desktop()}>{phone()}</Show>;
}
