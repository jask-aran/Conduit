import { HarnessMark } from "@/components/ui";
import { Icons } from "@/components/ui";
import { haptic } from "@/components/ui/haptics";
import { expectKeyboardTravel } from "@/components/ui/motion";
import { KEYBOARD_TRAVEL_EVENT } from "@/components/ui/keyboard-travel";
import { pickPhotos } from "../platform/photos";
import { openNativeCamera } from "../platform/camera";
import { composerKind, nativeComposer, nativeComposerAvailable, type ComposerAction, type ComposerInput } from "../platform/native-composer";
import { mirror } from "@/components/ui/native-phone-composer";
import type { PluginListenerHandle } from "@capacitor/core";
import { Button as LibraryButton, Viewfinder, Captions, Completion, ComposerField, DesktopComposer, Line, Lines, PhoneComposer, Picker, PillButton, PillField, PillWave, Rider, RiderMark, Spinner, StopGlyph, TextArea, Toolbar, VoiceRider } from "@/components/ui";
import { activeServer } from "../platform/servers";
import { changesWaiting, heldWrites } from "../api/client";
import { latestAway, scrollToLatest } from "./latest-away";
import { createEffect, createMemo, createSignal, For, lazy, on, onCleanup, onMount, Show, type JSX } from "solid-js";

import { DropdownMenu, MenuContent } from "@/components/ui/menus";
import type { BooleanCapability, Project, Template } from "../api/contracts";
import type { ActiveChatStore } from "../state/active-chat";
import { filesFromDataTransfer } from "../state/attachments";
import type { ComposerAttachments } from "./composer-attachments";
import type { ComposerModels } from "./composer-models";
import type { ComposerPermissions } from "./composer-permissions";
import type { ServiceLevelSettings } from "../state/service-level-settings";
import type { VoiceDictationSettings } from "./voice-dictation-types";
import { isMobileLayout, MOBILE_LAYOUT_QUERY } from "../navigation/mobile-layout";
import { KEYBOARD_HIDDEN_EVENT } from "@/components/ui/viewport";
import { QueuedMessages } from "./queued-messages";
import { RunningAgents } from "./agents";
import { AttachmentStrip } from "./attachment-strip";
import { composerSlashCommands } from "./composer-slash-commands";
import { fileFromPastedText, insertTextAt, shouldAttachPastedText } from "./large-paste";
import { createVoiceDictationClient, type VoiceDictationState } from "./voice-dictation-client";
import { ContextGauge } from "./context-gauge";
import type { AudioSignalLevel } from "./voice-audio";
import { toast } from "@/components/ui/notifications";
import { audioTransferLost, beginDictatedRange, matchesShortcut, releasesShortcut, replaceDictatedRange, shouldAutoSend, shouldReportNoSignal } from "./voice-dictation";
import { createVoiceWaveformController } from "./voice-waveform";
import { MAX_RESPONSIVE_BAR_COUNT } from "@/components/ui/voice-waveform-model";
import { ModelSelector } from "./model-selector";
import { COMMAND_IDS } from "../commands/command-registry";
import type { ShortcutManager } from "../shortcuts/shortcut-manager";

import { parseReviewComments, removeReviewComment, reviewComments, updateReviewComment } from "./review-comments";
import { ReviewCommentCards } from "./review-comment-cards";
import { HostUiRequests } from "./host-ui-card";

import { FolderPicker, type FolderOptions, type PlaceOptions } from "./place-picker";
import { COMPOSER_FOLDS, type ComposerFold } from "./composer-folds";
import { keptParts, watchFit } from "@/components/ui/fit";
import { createLeaving, riderMotion } from "./composer-cards";
import { ComposerPlusMenu, PermissionChoices, ProfileChoices, ServiceChoices } from "./composer-plus-menu";
const MobileComposerOptions = lazy(() => import("./mobile-composer-options"));

const EDIT_ACTIONS = [
  { key: "undo", label: "Undo", icon: () => <Icons.Undo /> },
  { key: "delete", label: "Delete word or selection", icon: () => <Icons.Backspace /> },
  { key: "left", label: "Previous word", icon: () => <Icons.ChevronLeft /> },
  { key: "right", label: "Next word", icon: () => <Icons.ChevronRight /> },
  { key: "end", label: "End of draft", icon: () => <Icons.InsertText /> },
] as const;

export function Composer(props: {
  chat: ActiveChatStore;
  /** In the context gauge's place: what this composer's page reads its particulars from (jbot's chip, in its room). */
  contextControl?: JSX.Element;
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
  /** The app's shortcut manager, which owns the composer's own chords (Steer). Without it they fall back to their defaults. */
  shortcuts?: ShortcutManager;
  onChooseProfile: (id: string) => void;
  onOpenSettings: (section: string) => void;
  onOpenModelSelector?: () => void;
  modelSelectorShortcut?: string | null;
  onOpenAttachments: () => void;
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
  const [nativeUp, setNativeUp] = createSignal(false);
  const [sendingTake, setSendingTake] = createSignal<DictationTake | null>(null);
  const sendingOut = () => Boolean(sendingTake()) || props.chat.generation() === "submitting";
  const toggleKeyboard = () => {
    if (startNativeTyping()) return;
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
  // A touch anywhere outside the phone composer while typing closes it, as the native composer's does: the keyboard
  // goes down and the composer goes idle (or stays typing with a draft). Not a menu or popover opened from it, and the
  // touch still reaches the page (a drag scrolls the transcript).
  onMount(() => {
    const outside = (event: PointerEvent) => {
      if (!voiceFirst() || nativeUp() || document.activeElement !== input) return;
      const target = event.target as Element | null;
      if (target?.closest(".ui-phone-composer, [data-surface='popover'], [role='menu'], [role='dialog'], [role='listbox']")) return;
      input.blur();
    };
    document.addEventListener("pointerdown", outside, { capture: true, passive: true });
    onCleanup(() => document.removeEventListener("pointerdown", outside, { capture: true }));
  });
  // A phone has one composer, voice-first: a field over a bar of buttons.
  const voiceFirst = () => phoneLayout();
  const phoneMode = (focused = inputFocused(), text = hasText()) => !voiceFirst() ? undefined
    // Finishing and transcribing still look like listening, so stopping goes
    // straight to the result instead of flashing through the text row.
    // Once stopped, the row settles at once; the transcript lands when it lands.
    : ["starting", "listening"].includes(dictationState()) ? "listening"
    // Sent, or stop-and-send waiting on its transcript: the text pill goes at
    // once rather than holding the draft until the agent takes it.
    : sendingOut() ? "idle"
    : focused || text ? "typing" : "idle";
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
    // What stays, last to fold first: the rest fold, least used first.
    const keep = COMPOSER_FOLDS.filter((key) => widths.has(key)).reverse();
    const kept = keptParts(available - fixed, keep.map((key) => widths.get(key)! + gap));
    const next = new Set(keep.slice(kept));
    const current = folded();
    if (next.size !== current.size || [...next].some((key) => !current.has(key))) setFolded(next);
  };
  const refit = () => { cancelAnimationFrame(refitFrame); refitFrame = requestAnimationFrame(fit); };
  const shows = (key: ComposerFold) => phoneLayout() || !folded().has(key);
  // The desktop row's folding, watched from whenever its Toolbar is drawn; a phone's row has none of it.
  const toolbarRef = (element: HTMLDivElement) => { actionsRow = element; watchFit(element, () => { cancelAnimationFrame(refitFrame); fit(); }); refit(); };
  const dictationWaveform = createVoiceWaveformController(MAX_RESPONSIVE_BAR_COUNT);
  let pushToTalkActive = false;
  /* One take per press of the mic. A stopped take keeps finalising on its own
     client and writes into its own range while the next one records; ranges
     after a take shift when its text changes length. */
  type DictationTake = { client: VoiceClient; chatId: string | null; range: { start: number; end: number } | null; cancelled: boolean; restoreFocus: boolean; autoSend: boolean; sendWhenDone?: boolean };
  type VoiceClient = ReturnType<typeof createVoiceDictationClient>;
  const voiceClients: VoiceClient[] = [];
  const takes = new Map<VoiceClient, DictationTake>();
  let currentTake: DictationTake | null = null;
  let autoSendPending: DictationTake | null = null;
  const takeIsCurrentChat = (take: DictationTake) => take.chatId === props.chat.loadedId();
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
  // A chat's own send waits in its outbox while the hub cannot be reached; a composer that starts its chat needs the hub.
  const canSend = createMemo(() => hasPayload() && (props.serverOnline || !props.onSendDraft) && interactive() && props.chat.generation() !== "stopping"
    && (!busy() || supports("steer") || supports("followUpQueue")) && !dictating());
  const sentPrompts = createMemo(() => props.chat.messages()
    // What the person wrote: a report or a run's line (a prompt the harness made, `origin`) is not theirs to recall.
    .filter((message) => message.role === "user" && message.origin !== "harness" && !message.pending && Boolean(message.content?.trim()))
    .map((message) => parseReviewComments(message.content!).text)
    .filter(Boolean));
  const slashCommandOptions = () => ({
    attachments: props.attachmentsSupported !== false,
    compaction: supports("compaction") && !busy() && !props.chat.compacting(),
    harnessCommands: props.chat.harnessCommands(),
  });
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
  const placeCursor = (start: number, end = start) => queueMicrotask(() => {
    if (!nativeUp()) input.focus({ preventScroll: true });
    input.setSelectionRange(start, end);
    if (nativeUp()) {
      lastNativeText = props.chat.draft();
      void nativeComposer.update({ text: props.chat.draft(), selectionStart: input.selectionStart, selectionEnd: input.selectionEnd });
    }
  });
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
  // The slash menu's lookups: each typed change is one; Escape ends the current one, so a lookup that finishes after the
  // menu was dismissed cannot open it again (Codex review).
  let slashLookup = 0;
  const change = (value: string, manual = true) => {
    if (manual && !restoringDraft) snapshot();
    if (manual) {
      historyIndex = null;
      historyDraft = "";
      setDictationSelectionOwned(false);
      if (dictatedRange() || [...takes.values()].some((take) => take.range)) cancelTakes();
    }
    props.chat.setDraft(value);
    const lookup = ++slashLookup;
    if (value.startsWith("/")) void props.chat.loadHarnessCommands().then(() => {
      if (lookup === slashLookup && props.chat.draft() === value) setSlashOpen(composerSlashCommands(value, slashCommandOptions()).length > 0);
    });
    setSlashOpen(composerSlashCommands(value, slashCommandOptions()).length > 0);
    scheduleResize();
  };

  const setTakeRange = (take: DictationTake, range: { start: number; end: number } | null) => {
    take.range = range;
    if (take === currentTake) setDictatedRange(range);
  };
  const cancelTakes = () => {
    autoSendPending = null;
    setSendingTake(null);
    for (const take of takes.values()) {
      if (!take.range && take.cancelled) continue;
      take.cancelled = true;
      setTakeRange(take, null);
      if (["starting", "listening"].includes(take.client.state())) take.client.stop();
    }
    setDictatedRange(null);
  };
  const countFinalising = () => setFinalisingTakes([...takes.values()].filter((take) => take.chatId === props.chat.loadedId() && ["finishing", "waiting", "transcribing"].includes(take.client.state())).length);

  const applyTranscript = (take: DictationTake, text: string) => {
    const range = take.range;
    if (!range || take.cancelled || !takeIsCurrentChat(take)) return;
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
      if (!takeIsCurrentChat(take) || take !== currentTake) return;
      resize();
      // The keyboard was up when dictation began: it comes back with focus.
      if (take.restoreFocus) { if (document.activeElement !== input) setKeyboardWanted(true); input.focus({ preventScroll: true }); }
      input.setSelectionRange(next.range.start, next.range.end);
    });
  };

  const sendDraftNow = (take: DictationTake) => queueMicrotask(() => {
    if (!takeIsCurrentChat(take)) return;
    if (props.onSendDraft) void props.onSendDraft(props.chat.draft());
    else void props.chat.send();
  });
  // Auto-send waits for every take still recording or finalising.
  const settleAutoSend = () => {
    const pending = autoSendPending;
    if (!pending || !takeIsCurrentChat(pending) || [...takes.values()].some((take) => take.chatId === props.chat.loadedId() && ["starting", "listening", "finishing", "waiting", "transcribing"].includes(take.client.state()))) return;
    autoSendPending = null;
    setDictatedRange(null);
    for (const take of takes.values()) take.range = null;
    sendDraftNow(pending);
    queueMicrotask(() => { if (sendingTake() === pending) setSendingTake(null); });
  };

  const createTakeClient = () => {
    const client: VoiceClient = createVoiceDictationClient({
      onState: (next) => {
        countFinalising();
        const take = takes.get(client);
        if (!take || !takeIsCurrentChat(take)) return;
        if (take && take === currentTake) {
          setDictationState(next);
          if (next !== "listening") dictationWaveform.reset();
        }
        // The final transcript follows "completed"; auto-send settles after it.
        if (["failed", "idle"].includes(next)) settleAutoSend();
      },
      onPartial: (text) => { const take = takes.get(client); if (take) applyTranscript(take, text); },
      onFinal: (text) => { const take = takes.get(client); if (take) applyTranscript(take, text); },
      onInputLevel: (level) => { if (takes.get(client) === currentTake) setInputLevel(level); },
      onCompleted: (completion) => {
        window.dispatchEvent(new CustomEvent("conduit:voice-dictation-metrics", { detail: completion }));
        const take = takes.get(client);
        if (!take || !takeIsCurrentChat(take)) return;
        // After this body, whichever way it returns.
        queueMicrotask(() => { settleAutoSend(); if (!autoSendPending && sendingTake() === take) setSendingTake(null); });
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
          if (take?.sendWhenDone && !take.cancelled && props.chat.draft().trim()) autoSendPending = take;
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
        if (take === currentTake) requestAnimationFrame(() => { if (takeIsCurrentChat(take) && take === currentTake) input.scrollTop = input.scrollHeight; });
        if (completion.completionReason === "duration_limit") {
          setDictationError("Dictation reached the server time limit. Start another dictation to continue.");
        }
        if (audioTransferLost(completion)) {
          setDictationError(`Microphone audio was truncated before transcription (${completion.serverAudioBytes} of ${completion.audioBytesSent} bytes reached the server). Check the connection and try again.`);
        }
        if (take?.sendWhenDone && !take.cancelled) autoSendPending = take;
        else if (take && !take.cancelled && take.autoSend && completion.completionReason !== "duration_limit" && shouldAutoSend({ enabled: props.voiceSettings.autoSend, ...completion })) {
          autoSendPending = take;
        }
      },
      onError: (error) => {
        const take = takes.get(client);
        if (!take || !takeIsCurrentChat(take)) return;
        if (sendingTake() === take) setSendingTake(null);
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
    const take = currentTake;
    if (!take || !takeIsCurrentChat(take)) return;
    take.sendWhenDone = true;
    setSendingTake(take);
    // Never left hiding the draft if the transcript does not come back.
    setTimeout(() => { if (sendingTake() === take) setSendingTake(null); }, 20_000);
    stopTake();
  };

  const startDictation = (acceptedAt = performance.now()) => {
    if (recordingNow()) return;
    snapshot(true);
    dictationWaveform.reset();
    setDictationError("");
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
    const take: DictationTake = { client, chatId: props.chat.loadedId(), range: null, cancelled: false, restoreFocus, autoSend: true };
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
    autoSendPending = null;
    setDictatedRange(null);
    for (const take of takes.values()) take.range = null;
    setDictationSelectionOwned(false);
    setDictationError("");
    if (props.onSendDraft) await props.onSendDraft(props.chat.draft());
    else await props.chat.send(mode);
  };

  // The camera button. Tap: the Viewfinder, the camera in a card (its Full camera, or a camera it can't open, hands
  // over to the platform's own through cameraInput). Hold: the platform's photo picker (photoInput in a browser);
  // Attach files in the plus menu keeps the whole file picker.
  let cameraInput!: HTMLInputElement;
  let photoInput!: HTMLInputElement;
  const [viewfinder, setViewfinder] = createSignal(false);
  let cameraHold: ReturnType<typeof setTimeout> | null = null;
  const addPhotos = (files: File[]) => { if (files.length) props.attachments.addFiles(files); };
  const pickPhotosHeld = async () => {
    const picked = await pickPhotos().catch(() => null);
    if (picked) addPhotos(picked); else photoInput.click();
  };
  const cameraPointerDown = (event: PointerEvent) => {
    event.preventDefault();
    cameraHold = setTimeout(() => { cameraHold = null; haptic("hold"); void pickPhotosHeld(); }, 450);
  };
  const cameraPointerCancel = () => { if (cameraHold) clearTimeout(cameraHold); cameraHold = null; };
  const cameraPointerUp = () => {
    if (!cameraHold) return;
    cameraPointerCancel();
    haptic("press");
    cameraTap();
  };
  const cameraTap = () => {
    void openNativeCamera().then((answer) => {
      if (answer instanceof File) addPhotos([answer]);
      else if (answer === "full" || answer === "failed") cameraInput.click();
      else if (answer === null) { if (typeof navigator.mediaDevices?.getUserMedia === "function") setViewfinder(true); else cameraInput.click(); }
    }).catch(() => cameraInput.click());
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

  // Steer (Ctrl+Shift+Enter by default) is a command; it runs only from this composer's field, with a turn running and
  // something to send, and not while the slash menu has Enter.
  const canSteer = () => busy() && hasText() && !slashOpen();
  if (props.shortcuts) {
    const shortcuts = props.shortcuts;
    const releaseSteer = (["chat", "dashboard"] as const).map((context) => shortcuts.registerHandler(COMMAND_IDS.steerTurn, context,
      () => void sendMessage("steer"), { when: () => document.activeElement === input && canSteer() }));
    onCleanup(() => releaseSteer.forEach((release) => release()));
  }
  // The field's own keys: the slash menu, Enter to send and Shift+Enter for a new line, and the prompt history.
  const keydown = (event: KeyboardEvent) => {
    // An input method composing text owns its keys: its Enter confirms a candidate, never sends.
    if (event.isComposing || event.keyCode === 229) return;
    if (event.key === "Escape" && slashOpen()) { event.preventDefault(); slashLookup++; setSlashOpen(false); return; }
    // Escape never stops a turn: it steps back (keyboard-model.md › Leave); stopping is Ctrl+Shift+Backspace or the button.
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
    if (!props.shortcuts && event.key === "Enter" && (event.ctrlKey || event.metaKey) && event.shiftKey && canSteer()) {
      event.preventDefault();
      sendMessage("steer");
    }
    // ↑/↓ walk the prompts sent before, from an empty field: text editing, like Enter and Shift+Enter above, so
    // they stay here rather than in the command registry.
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
    createEffect(on(() => props.chat.loadedId(), () => {
      // Final transcripts and queued sends belong to the chat that started them.
      cancelTakes();
      currentTake = null;
      pendingDictationLaunch = null;
      pushToTalkActive = false;
      setDictationState("idle");
      setDictationSelectionOwned(false);
      setDictationError("");
      dictationWaveform.reset();
      countFinalising();
    }, { defer: true }));
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
      window.removeEventListener("keydown", voiceKeyDown, true);
      window.removeEventListener("keyup", voiceKeyUp, true);
      window.removeEventListener("conduit:toggle-dictation", voiceToggle);
      for (const client of voiceClients) client.dispose();
    });
  });

  // Where the handoff to the native composer is: starting it, or handing the composer back to the web one after it ended.
  let nativePhase: "idle" | "starting" | "handing back" = "idle";
  let reopenNative = false;
  let nativeClosing = false;
  // A keyboard hide starting with the native composer up takes it out of typing now, before the travel measures where
  // it ends (keyboard-travel.ts), so the field's going rides the same motion; the closing event after is then a no-op.
  onMount(() => {
    const travel = (event: Event) => {
      if (!(event as CustomEvent<{ hiding: boolean }>).detail.hiding || !nativeUp() || nativeClosing) return;
      nativeClosing = true; setInputFocused(false); setKeyboardWanted(false);
    };
    document.addEventListener(KEYBOARD_TRAVEL_EVENT, travel);
    onCleanup(() => document.removeEventListener(KEYBOARD_TRAVEL_EVENT, travel));
  });
  let nativeDisposed = false;
  let nativeChat: string | null = null;
  let nativeAction: ComposerAction | null = null;
  let nativeListeners: PluginListenerHandle[] = [];
  let nativeMirror: ReturnType<typeof mirror> | null = null;
  const restoreWebComposer = () => { nativeMirror?.restore(); nativeMirror = null; };
  let lastNativeText = "";
  const mirrorNativeInput = (event: ComposerInput) => {
    // Native selection must be in the textarea before change() takes its undo snapshot.
    input.value = event.text;
    input.setSelectionRange(event.selectionStart, event.selectionEnd);
    lastNativeText = event.text;
    if (props.chat.draft() !== event.text) change(event.text);
  };
  const finishNativeTyping = async (event: ComposerInput) => {
    if (!nativeUp()) return;
    if (!nativeDisposed && nativeChat === props.chat.loadedId()) mirrorNativeInput(event);
    nativePhase = "handing back";
    restoreWebComposer();
    setNativeUp(false); setInputFocused(false); setKeyboardWanted(false);
    // end() acknowledges ended: the overlay remains at rest until the web row is visible. A failed one still hands back,
    // or the phase would stay and every later tap would wait on it.
    await nativeComposer.end().catch(() => {});
    for (const listener of nativeListeners) void listener.remove();
    nativeListeners = [];
    nativePhase = "idle"; nativeClosing = false;
    const action = nativeAction; nativeAction = null;
    if (nativeDisposed || nativeChat !== props.chat.loadedId()) return;
    // The keyboard pill tapped while the native composer was still handing back: open it again now.
    if (reopenNative) { reopenNative = false; if (!action || action === "keyboard") { startNativeTyping(); return; } }
    if (action === "attach") {
      const trigger = input.closest(".ui-phone-composer")?.querySelector<HTMLButtonElement>('button[aria-label="Message options"]');
      // Kobalte opens touch triggers on click only after pointerdown records the pointer type.
      trigger?.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerType: "touch", button: 0 }));
      trigger?.click();
    }
    else if (action === "camera") cameraTap();
    else if (action === "mic") toggleDictation();
  };
  const startNativeTyping = () => {
    if (!voiceFirst() || composerKind() !== "native" || !nativeComposerAvailable() || input.disabled) return false;
    if (nativeUp() && nativePhase !== "starting") { if (nativeClosing) reopenNative = true; return true; }
    // Handing back (the close's slide and the swap at rest): a tap now is not lost, it opens again once that is done.
    if (nativePhase !== "idle") { if (nativePhase === "handing back") reopenNative = true; return true; }
    nativePhase = "starting"; nativeClosing = false;
    nativeChat = props.chat.loadedId();
    void (async () => {
      try {
        // Register every event before begin can focus the EditText and start the IME.
        const listeners = await Promise.allSettled([
          nativeComposer.addListener("input", (event) => { if (nativeUp() && nativeChat === props.chat.loadedId()) mirrorNativeInput(event); }),
          nativeComposer.addListener("closing", (event) => {
            nativeClosing = true;
            if (!nativeUp() || nativeChat !== props.chat.loadedId()) return;
            mirrorNativeInput(event); setInputFocused(false); setKeyboardWanted(false);
          }),
          nativeComposer.addListener("ended", (event) => { void finishNativeTyping(event); }),
          nativeComposer.addListener("action", ({ name }) => {
            if (!nativeUp() || nativeChat !== props.chat.loadedId()) return;
            if (name === "send") {
              if (canSend()) void sendMessage().then(() => {
                if (nativeUp()) void nativeComposer.update({ text: props.chat.draft() });
              }, () => {
                toast.error("Message could not be sent.");
                if (nativeUp()) void nativeComposer.update({ text: props.chat.draft() });
              });
              else void nativeComposer.update({ text: props.chat.draft() });
            }
            else if (name === "stop") void props.chat.stop();
            else if (name === "latest") scrollToLatest();
            else if (name === "undo" || name === "delete" || name === "left" || name === "right" || name === "select") editActions[name === "select" ? "end" : name]();
            else if (name === "keyboard" && nativeClosing) reopenNative = true;
            // The rest are the web's to carry out once typing ends. Message options (+) closes the keyboard because its
            // menu is the web's popover, and the native composer's pills are drawn in a window over the app
            // (ComposerFrost): nothing the WebView draws can appear above them, so the web takes the composer back
            // first and opens the menu from its own pill (finishNativeTyping). The camera and the mic go the same way.
            else { nativeAction = name; void nativeComposer.end(); }
          }),
        ]);
        nativeListeners = listeners.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
        if (listeners.some((result) => result.status === "rejected")) throw new Error("Composer listener unavailable");
        if (nativeDisposed || nativeChat !== props.chat.loadedId()) throw new Error("Composer changed");
        resize();
        const root = input.closest<HTMLElement>(".ui-phone-composer");
        if (!root) throw new Error("Phone composer is not mounted");
        setNativeUp(true);
        lastNativeText = props.chat.draft();
        // Into typing only now, in the task that hands the composer to native and hides this one: flipped on the tap,
        // the web composer's field and edit pills faded in for the frames the listeners took to register.
        expectKeyboardTravel(); setInputFocused(true); setKeyboardWanted(true);
        nativeMirror = mirror(root, input, nativeComposer, () => ({ empty: phoneMode(false, false) ?? "idle", text: phoneMode(false, true) ?? "idle" }));
        await nativeMirror.ready;
        if (nativePhase === "starting") nativePhase = "idle";
        if (!nativeUp()) return;
        if (nativeDisposed || nativeChat !== props.chat.loadedId()) { await nativeComposer.end(); return; }
      } catch {
        restoreWebComposer(); setNativeUp(false); if (nativePhase === "starting") nativePhase = "idle";
        for (const listener of nativeListeners) void listener.remove();
        nativeListeners = [];
        if (!nativeDisposed && nativeChat === props.chat.loadedId()) input.focus({ preventScroll: true });
      }
    })();
    return true;
  };
  createEffect(() => {
    const text = props.chat.draft();
    const chat = props.chat.loadedId();
    if (!nativeUp()) return;
    if (chat !== nativeChat) { void nativeComposer.end(); return; }
    if (nativePhase !== "starting" && text !== lastNativeText) void nativeComposer.update({ text }).catch(() => void nativeComposer.end());
  });
  onCleanup(() => {
    nativeDisposed = true;
    restoreWebComposer();
    if (nativeUp()) void nativeComposer.end();
    else for (const listener of nativeListeners) void listener.remove();
  });

  const field = () => <>
    <TextArea ref={input} rows={1} onPointerDown={(event) => { if (startNativeTyping()) event.preventDefault(); }} data-composer-input="" aria-label="Message the agent" aria-expanded={slashOpen() ? "true" : undefined} data-held={dictationSelectionOwned() && dictatedRange() ? "" : undefined} placeholder={!props.chat.loadedId() ? "New chat" : interactive() ? placeholder() : "Reconnecting..."} value={props.chat.draft()} disabled={!interactive()} onInput={(event) => change(event.currentTarget.value)} onPaste={paste} onSelect={selectionChanged} onKeyDown={keydown} inputMode={voiceFirst() && !keyboardWanted() ? "none" : undefined} onFocus={() => setInputFocused(true)} onBlur={() => { setInputFocused(false); if (!refocusing) setKeyboardWanted(false); }} />
    <Show when={slashOpen() && slashCommand()}>{(item) => <Completion typed={props.chat.draft()} rest={item().command.slice(props.chat.draft().length)} detail={item().description} />}</Show>
  </>;
  // State, not composition: below the composer on a desktop (DesktopComposer's under), over it on a phone, where the
  // keyboard and the home bar have the bottom edge.
  const agents = () => <Show when={props.chat.agents().length}><RunningAgents agents={props.chat.agents()} onStop={(id) => void props.chat.stopAgent(id)} /></Show>;
  // The hub cannot be reached: a state rider (below a desktop composer, above a phone's, as the agents are), said once
  // and taking nothing away from the field.
  const unreachable = () => <Show when={!props.serverOnline}>
    <Rider label="Hub unreachable" motion="entering">
      <RiderMark icon={<Icons.Server />} label="Unreachable" />
      <Lines>
        <Line text={`Can't reach ${activeServer()?.name || "the hub"}${props.onSendDraft ? "" : " — messages will send when it's back"}`} />
        <Show when={heldWrites()}><Line text={changesWaiting(heldWrites())} /></Show>
      </Lines>
    </Rider>
  </Show>;
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
  const desktop = () => <DesktopComposer takeover={question()} opening={props.opening} under={<>{unreachable()}{agents()}</>}
    riders={<>{riders()}<Show when={voice.value()}><VoiceRider levels={dictationWaveform.history()} gain={2.5} level={Math.min(1, dictationWaveform.level() * 2.5)} motion={riderMotion(voice.leaving())} /></Show></>}>
    <ComposerField>{field()}</ComposerField>
    <Toolbar ref={toolbarRef}
      start={<>
        <ComposerPlusMenu folded={folded()} chat={props.chat} models={props.models} permissions={props.permissions} serviceLevels={props.serviceLevels}
          profiles={props.profiles} activeProfile={props.activeProfile} place={props.place} disabled={!props.serverOnline || !interactive()} modelSwitch={supports("modelSwitch")}
          onChooseProfile={props.onChooseProfile} onOpenModelSelector={props.onOpenModelSelector} modelSelectorShortcut={props.modelSelectorShortcut}
          onAttach={props.attachmentsSupported !== false ? attach : undefined} />
        <Show when={props.folder}>{(folder) => <FolderPicker {...folder()} />}</Show>
        <Show when={shows("context")}><div data-composer-fold="context">{props.contextControl ?? <ContextGauge chat={props.chat} compact canCompact={supports("compaction")} />}</div></Show>
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
    riders={<>{question()}{unreachable()}{agents()}{riders()}</>}
    field={<PillField>{field()}</PillField>}
    track={<PillWave levels={dictationWaveform.history()} gain={2.5} />}
    captions={<Show when={captionLead() || dictatedText()}><Captions lead={captionLead()} words={dictatedText().split(/(?<=\s)/)} ref={announceCaptions} /></Show>}
    edit={<For each={EDIT_ACTIONS}>{(action) => <PillButton haptic="select" label={action.label} icon={action.icon()} button={{ tabIndex: editing() ? 0 : -1, onPointerDown: (event) => event.preventDefault(), onClick: () => editActions[action.key]() }} />}</For>}>
    <MobileComposerOptions composer={props} onOpenChange={setOptionsOpen} />
    <Show when={props.attachmentsSupported !== false}>
      <input ref={cameraInput} type="file" accept="image/*" capture="environment" hidden onChange={(event) => { const files = Array.from(event.currentTarget.files || []); event.currentTarget.value = ""; addPhotos(files); }} />
      <input ref={photoInput} type="file" accept="image/*" multiple hidden onChange={(event) => { const files = Array.from(event.currentTarget.files || []); event.currentTarget.value = ""; addPhotos(files); }} />
      <Show when={viewfinder()}><Viewfinder onCapture={(file) => addPhotos([file])} onFull={() => cameraInput.click()} onClose={() => setViewfinder(false)} /></Show>
      <PillButton label="Take a photo" icon={<Icons.Camera />} button={{ "data-haptic": "press", title: "Take a photo (hold to choose photos)", disabled: !props.serverOnline || !interactive(), onPointerDown: cameraPointerDown, onPointerUp: cameraPointerUp, onPointerLeave: cameraPointerCancel, onPointerCancel: cameraPointerCancel, onContextMenu: (event) => event.preventDefault() }} />
    </Show>
    <PillButton haptic={keyboardWanted() ? "dismiss" : "open"} label={keyboardWanted() ? "Close the keyboard" : "Type a message"} icon={<Icons.Keyboard />} button={{ disabled: !interactive(), onPointerDown: (event) => event.preventDefault(), onClick: toggleKeyboard }} />
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
