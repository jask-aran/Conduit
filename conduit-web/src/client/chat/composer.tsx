import { createEffect, createMemo, createSignal, For, lazy, onCleanup, onMount, Show } from "solid-js";
import { ArrowUpIcon, ChevronDownIcon, MicIcon, PaperclipIcon, ShieldCheckIcon, SquareIcon, TriangleAlertIcon } from "lucide-solid";
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
import { isMobileLayout, MOBILE_LAYOUT_QUERY } from "../navigation/mobile-layout";
import { QueuedMessages } from "./queued-messages";
import { AttachmentCards } from "./attachments";
import { composerSlashCommands } from "./composer-slash-commands";
import { fileFromPastedText, insertTextAt, shouldAttachPastedText } from "./large-paste";
import { COMPOSER_SURFACE_CHANGE_EVENT, selectedComposerSurface, type ComposerSurfaceMode } from "./composer-surface";
import { createVoiceDictationClient, type VoiceDictationState } from "./voice-dictation-client";
import { ContextGauge } from "./context-gauge";
import type { ContextMetricId } from "./context-metrics";
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

export const SPINNING_ACTIVITY = new Set(["starting", "reconnecting", "thinking", "responding", "using_tool", "retrying", "compacting", "stopping", "waiting_for_model"]);

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
  contextMetrics?: () => readonly ContextMetricId[];
  serverOnline: boolean;
  voiceSettings: VoiceDictationSettings;
  onChooseProfile: (id: string) => void;
  onOpenSettings: (section: string) => void;
  onOpenModelSelector?: () => void;
  modelSelectorShortcut?: string | null;
  onOpenAttachments: () => void;
  onStatusChange?: (status: ComposerStatus | null) => void;
  onSendDraft?: (text: string) => Promise<void>;
  supports?: (capability: BooleanCapability) => boolean;
}) {
  let input!: HTMLTextAreaElement;
  let mobileActions!: HTMLDivElement;
  const [slashOpen, setSlashOpen] = createSignal(false);
  const [dictationState, setDictationState] = createSignal<VoiceDictationState>("idle");
  const [dictationError, setDictationError] = createSignal("");
  const [transcriberReady, setTranscriberReady] = createSignal(false);
  const [dictatedRange, setDictatedRange] = createSignal<{ start: number; end: number } | null>(null);
  const [dictationSelectionOwned, setDictationSelectionOwned] = createSignal(false);
  const [composerSurface, setComposerSurface] = createSignal<ComposerSurfaceMode>(selectedComposerSurface());
  const [phoneLayout, setPhoneLayout] = createSignal(isMobileLayout());
  const [mobileActionsStacked, setMobileActionsStacked] = createSignal(false);
  const dictationWaveform = createVoiceWaveformController(MAX_RESPONSIVE_BAR_COUNT);
  let dictationCancelled = false;
  let pushToTalkActive = false;
  let dictationRestoreFocus = true;
  let pendingDictationLaunch: { inputFocused: boolean; keyboardOpen: boolean; acceptedAt: number } | null = null;
  let historyIndex: number | null = null;
  let historyDraft = "";

  const busy = createMemo(() => props.chat.streaming());
  const interactive = () => props.chat.interactionReady();
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
  const dictating = createMemo(() => ["starting", "listening", "finishing", "waiting", "transcribing"].includes(dictationState()));
  const recording = createMemo(() => dictationState() === "listening");
  const recorderMonitorState = createMemo(() => dictationState() === "starting" ? "connecting" : dictationState() === "listening" ? "listening" : "stopped");
  const canSend = createMemo(() => hasPayload() && props.serverOnline && props.chat.interactionReady() && props.chat.generation() !== "stopping"
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
    if (!phoneLayout() || !mobileActions) return setMobileActionsStacked(false);
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
      if (dictatedRange()) {
        dictationCancelled = true;
        setDictatedRange(null);
        voiceClient.stop();
      }
    }
    props.chat.setDraft(value);
    if (value.startsWith("/")) void props.chat.loadHarnessCommands().then(() => {
      if (props.chat.draft() === value) setSlashOpen(composerSlashCommands(value, slashCommandOptions()).length > 0);
    });
    setSlashOpen(composerSlashCommands(value, slashCommandOptions()).length > 0);
    queueMicrotask(resize);
  };

  const applyTranscript = (text: string) => {
    const range = dictatedRange();
    if (!range || dictationCancelled) return;
    const next = replaceDictatedRange(props.chat.draft(), range, text);
    props.chat.setDraft(next.text);
    setDictatedRange(next.range);
    setDictationSelectionOwned(true);
    queueMicrotask(() => {
      resize();
      if (dictationRestoreFocus) input.focus({ preventScroll: true });
      input.setSelectionRange(next.range.start, next.range.end);
    });
  };

  const voiceClient = createVoiceDictationClient({
    onState: (next) => {
      setDictationState(next);
      if (next === "starting") setTranscriberReady(false);
      if (next !== "listening") {
        dictationWaveform.reset();
      }
      if (["completed", "failed"].includes(next)) setTranscriberReady(false);
    },
    onRuntimeReady: () => setTranscriberReady(true),
    onTranscriptionWaiting: () => setTranscriberReady(false),
    onPartial: applyTranscript,
    onFinal: applyTranscript,
    onInputLevel: setInputLevel,
    onCompleted: (completion) => {
      window.dispatchEvent(new CustomEvent("conduit:voice-dictation-metrics", { detail: completion }));
      if (completion.speechDetector === "digital_zero") {
        setDictatedRange(null);
        setDictationSelectionOwned(false);
        setDictationError("No microphone signal reached the transcription service. Check Voice → Microphone and Chrome site settings.");
        return;
      }
      const transcript = completion.text.trim();
      if (!transcript) {
        setDictatedRange(null);
        setDictationSelectionOwned(false);
        if (!completion.inputSignalDetected && shouldReportNoSignal(completion)) {
          setDictationError(`No microphone signal detected after ${Math.max(1, Math.round(completion.captureDurationMs / 1000))}s (peak ${completion.maxInputPeak.toFixed(3)}). Check Voice → Microphone and Chrome site settings.`);
        } else if (completion.completionReason === "duration_limit") {
          setDictationError("Dictation reached the server time limit. Start another dictation to continue.");
        } else if (audioTransferLost(completion)) {
          setDictationError(`Microphone audio was truncated before transcription (${completion.serverAudioBytes} of ${completion.audioBytesSent} bytes reached the server). Check the connection and try again.`);
        } else {
          setDictationError("No transcript returned. The audio reached the transcription service, but it returned no text.");
        }
        return;
      }
      applyTranscript(transcript);
      if (completion.completionReason === "duration_limit") {
        setDictationError("Dictation reached the server time limit. Start another dictation to continue.");
      }
      if (audioTransferLost(completion)) {
        setDictationError(`Microphone audio was truncated before transcription (${completion.serverAudioBytes} of ${completion.audioBytesSent} bytes reached the server). Check the connection and try again.`);
      }
      if (!dictationCancelled && completion.completionReason !== "duration_limit" && shouldAutoSend({ enabled: props.voiceSettings.autoSend, ...completion }) && transcript) {
        setDictatedRange(null);
        queueMicrotask(() => {
          if (props.onSendDraft) void props.onSendDraft(props.chat.draft());
          else void props.chat.send();
        });
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

  const startDictation = (acceptedAt = performance.now()) => {
    if (dictating()) return;
    dictationCancelled = false;
    dictationWaveform.reset();
    setDictationError("");
    setTranscriberReady(false);
    const draft = props.chat.draft();
    const launch = pendingDictationLaunch;
    pendingDictationLaunch = null;
    const launchAcceptedAt = launch?.acceptedAt ?? acceptedAt;
    const focused = launch?.inputFocused ?? document.activeElement === input;
    dictationRestoreFocus = !isMobileLayout() ? true : (launch?.keyboardOpen ?? keyboardWasOpen(focused));
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
    setDictatedRange(beginDictatedRange(draft, start, end));
    setDictationSelectionOwned(false);
    voiceClient.start(launchAcceptedAt);
  };

  const toggleDictation = () => {
    if (["starting", "listening"].includes(dictationState())) voiceClient.stop();
    else if (!["finishing", "waiting", "transcribing"].includes(dictationState())) startDictation();
  };

  const sendMessage = async (mode?: "steer" | "follow_up") => {
    historyIndex = null;
    historyDraft = "";
    setDictatedRange(null);
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
      queueMicrotask(resize);
    };
    syncPhoneLayout();
    media?.addEventListener("change", syncPhoneLayout);
    props.onStatusChange?.(composerStatus);
    createEffect(() => {
      props.chat.draft();
      busy();
      dictating();
      queueMicrotask(resize);
    });
    createEffect(() => {
      props.chat.loadedId();
      historyIndex = null;
      historyDraft = "";
    });
    const composerSurfaceChanged = (event: Event) => setComposerSurface((event as CustomEvent<ComposerSurfaceMode>).detail);
    const voiceKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || document.querySelector('.settings-dialog[data-state="open"]')) return;
      if (!matchesShortcut(event, props.voiceSettings.shortcut)) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      if (event.repeat) return;
      const acceptedAt = performance.now();
      if (props.voiceSettings.activation === "toggle") {
        if (["starting", "listening"].includes(dictationState())) voiceClient.stop();
        else if (!["finishing", "waiting", "transcribing"].includes(dictationState())) startDictation(acceptedAt);
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
      voiceClient.stop();
    };
    const voiceToggle = () => toggleDictation();
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
      voiceClient.dispose();
    });
  });

  return <div class="composer-wrap">
    <Show when={props.attachmentsSupported !== false}>
      <AttachmentCards items={props.attachments.items()} chatId={props.chat.loadedId()} label="Attachments" removable onRemove={(item) => void props.attachments.remove(item)} />
    </Show>
    <ReviewCommentCards items={comments()} chatId={props.chat.loadedId() ?? ""} label="File references" onRemove={(comment) => removeReviewComment(comment.id)} onUpdate={(comment, note) => updateReviewComment(comment.id, note)} />
    <QueuedMessages
      messages={props.chat.pendingMessages()}
      surface={composerSurface()}
      busy={busy()}
      canInterrupt={supports("cancel")}
      onInterruptAndSend={() => void props.chat.interruptAndSend()}
      onEdit={props.chat.editQueued}
      onDiscard={props.chat.discardQueued}
    />
    <div class="composer-surface-shell" data-composer-surface={composerSurface()}>
      <div class="composer composer-surface-material" data-composer-surface={composerSurface()}>
        <div class="composer-content">
          <MobileComposerOptions composer={props} />
          <div class="composer-input-shell">
            <textarea ref={input} rows={1} aria-label="Message the agent" data-has-text={hasText() ? "true" : "false"} data-dictated-range={dictationSelectionOwned() && dictatedRange() ? "true" : undefined} placeholder={!props.serverOnline ? "Server unavailable" : !props.chat.loadedId() ? "New chat" : interactive() ? "Send a message..." : "Reconnecting..."} value={props.chat.draft()} disabled={!props.serverOnline || !interactive()} onInput={(event) => change(event.currentTarget.value)} onPaste={paste} onSelect={selectionChanged} onKeyDown={keydown} />
            <Show when={slashOpen() && slashCommand()}>{(item) => <div class="slash-completion" aria-hidden="true"><span>{props.chat.draft()}</span>{item().command.slice(props.chat.draft().length)} <small>{item().description}</small></div>}</Show>
          </div>
          <div class="composer-actions" data-mobile-actions-stacked={mobileActionsStacked()}>
            <div class="composer-actions-left">
              <Show when={props.attachmentsSupported !== false}><Button class="composer-desktop-attachment" variant="ghost" size="icon-sm" aria-label={`Attach files${props.attachments.items().length ? ` (${props.attachments.items().length})` : ""}`} disabled={!props.serverOnline || !interactive()} onClick={attach}><PaperclipIcon /></Button></Show>
              <div class="composer-desktop-setting"><ContextGauge chat={props.chat} metrics={props.contextMetrics} compact /></div>
              <Show when={props.profiles.length}><div class="composer-desktop-setting"><Menu><MenuTrigger class="model-trigger composer-profile-trigger" title={props.activeProfile?.label || "Profile"} aria-label={`Profile ${props.activeProfile?.label || "General"}`} disabled={!props.serverOnline || !interactive()}><HarnessMark id={props.activeProfile?.implementation || "conduit"} class="size-4" /><ChevronDownIcon /></MenuTrigger><MenuContent class="w-72"><MenuGroup><MenuLabel>Profile</MenuLabel><MenuRadioGroup value={props.activeProfile?.id || ""} onChange={props.onChooseProfile}><For each={props.profiles}>{(item) => <MenuRadioItem value={item.id} disabled={(props.chat.status() !== "draft" && item.id !== props.activeProfile?.id) || item.disabled}><HarnessMark id={item.implementation || "conduit"} class="size-4" /><span class="composer-profile-copy"><span>{item.label}</span><small>{item.implementation || "conduit"}</small></span></MenuRadioItem>}</For></MenuRadioGroup></MenuGroup></MenuContent></Menu></div></Show>
              <div class="composer-desktop-setting">
                <ModelSelector models={props.models.models()} model={props.models.model()} thinkingLevel={props.models.effort()} notice={props.models.notice()} loading={props.modelsLoading} disabled={!props.serverOnline || !interactive() || !supports("modelSwitch")} onModelChange={(value) => void props.models.chooseModel(value)} onThinkingLevelChange={(value) => void props.models.chooseEffort(value)} onSearchModels={props.onOpenModelSelector} searchShortcut={props.modelSelectorShortcut} />
              </div>
              <Show when={props.permissions?.profiles().length || props.serviceLevels?.levels().length}><div class="composer-desktop-setting"><Menu><MenuTrigger class="model-trigger composer-permission-trigger" aria-label="Session settings" disabled={!props.serverOnline || !interactive()}><ShieldCheckIcon /><span>{props.permissions?.profiles().find((profile) => profile.id === props.permissions?.selected())?.label || "Settings"}</span><ChevronDownIcon /></MenuTrigger><MenuContent class="w-72"><Show when={props.permissions?.profiles().length}><MenuGroup><MenuLabel>Permissions</MenuLabel><MenuRadioGroup value={props.permissions?.selected() || ""} onChange={(value) => void props.permissions?.choose(value)}><For each={props.permissions?.profiles() || []}>{(profile) => <MenuRadioItem value={profile.id} disabled={!profile.allowed}><span class="shrink-0 whitespace-nowrap">{profile.label}</span><Show when={profile.description}><span class="ml-auto max-w-40 truncate text-xs text-muted-foreground">{profile.description}</span></Show></MenuRadioItem>}</For></MenuRadioGroup></MenuGroup></Show><Show when={props.serviceLevels?.levels().length}><Show when={props.permissions?.profiles().length}><MenuSeparator /></Show><MenuGroup><MenuLabel>Service level</MenuLabel><MenuRadioGroup value={props.serviceLevels?.selected() || ""} onChange={(value) => void props.serviceLevels?.choose(value)}><For each={props.serviceLevels?.levels() || []}>{(level) => <MenuRadioItem value={level.id}>{level.label}</MenuRadioItem>}</For></MenuRadioGroup></MenuGroup></Show></MenuContent></Menu></div></Show>
            </div>
            <Show when={recording() && !phoneLayout()}><VoiceWaveform class="composer-status-waveform composer-actions-waveform" history={dictationWaveform.history} level={dictationWaveform.level} peak={dictationWaveform.peak} state={recorderMonitorState()} variant="compact" barDensity={3} ariaLabel={dictationLabel() || "Microphone input level"} /></Show>
            <div ref={mobileActions} class="composer-actions-right">
              <Show when={!recording() && (dictationLabel() || (activity()?.label && activity()?.label !== "Ready"))}><span class="composer-status-state composer-actions-status" role="status" aria-live="polite"><Show when={dictationLabel()} fallback={<><Show when={SPINNING_ACTIVITY.has(activity()?.kind || "")}><Spinner /></Show><Show when={["request_failed", "runtime_failed"].includes(activity()?.kind || "")}><TriangleAlertIcon aria-hidden="true" /></Show>{activity()?.label || "Ready"}</>}>{dictationLabel()}</Show></span></Show>
              <Button variant="ghost" size="icon-sm" class="dictation-trigger" data-state={dictationState()} aria-label={["starting", "listening"].includes(dictationState()) ? "Stop voice dictation" : "Start voice dictation"} aria-pressed={dictating()} title={`Voice dictation (${props.voiceSettings.shortcut})`} disabled={!props.serverOnline || !interactive() || ["finishing", "waiting", "transcribing"].includes(dictationState())} onPointerDown={captureDictationLaunch} onClick={toggleDictation}><Show when={["starting", "finishing", "waiting", "transcribing"].includes(dictationState())} fallback={<MicIcon />}><Spinner /></Show></Button>
              {/* One primary slot, so nothing beside it moves. While the agent
                  works it is Stop; once a draft is typed it is Send again --
                  which queues the message for the agent -- and Stop steps to
                  its left. Each change scales the new action in. */}
              <Show when={stoppable() && newDraft()}>
                <Button variant="ghost" size="icon-sm" class="composer-stop-aside" aria-label="Stop response" onClick={props.chat.stop}><Show when={props.chat.stopping()} fallback={<SquareIcon />}><Spinner /></Show></Button>
              </Show>
              <span class="composer-primary-slot">
                <Show when={stoppable() && !newDraft()} fallback={
                  <Button variant="ghost" size="icon-sm" class="composer-send-trigger" aria-label={busy() ? "Send to the agent" : "Send message"} title={busy() ? "Send — the agent takes it when the current step finishes" : undefined} disabled={!canSend()} onClick={() => sendMessage()}><ArrowUpIcon /></Button>}>
                  <Button variant="ghost" size="icon-sm" class="composer-stop-trigger" aria-label="Stop response" onClick={props.chat.stop}><Show when={props.chat.stopping()} fallback={<SquareIcon />}><Spinner /></Show></Button>
                </Show>
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
    <Show when={dictationError()}><div class="composer-dictation-error" role="alert"><TriangleAlertIcon />{dictationError()}</div></Show>
  </div>;
}
