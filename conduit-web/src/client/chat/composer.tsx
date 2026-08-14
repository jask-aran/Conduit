import { createEffect, createMemo, createSignal, For, lazy, onCleanup, onMount, Show } from "solid-js";
import { ArrowUpIcon, ChevronDownIcon, MicIcon, PaperclipIcon, SquareIcon, TriangleAlertIcon, WaypointsIcon } from "lucide-solid";
import {
  Button,
  Menu,
  MenuContent,
  MenuGroup,
  MenuItem,
  MenuLabel,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuTrigger,
  Spinner,
} from "@/components/primitives";
import type { Template } from "../api/contracts";
import type { ActiveChatStore } from "../state/active-chat";
import { filesFromDataTransfer } from "../state/attachments";
import type { AttachmentsStore } from "../state/attachments";
import type { ModelSettings } from "../state/model-settings";
import { formatContextMetrics, type ContextMetricId } from "./context-metrics";
import { AttachmentCards } from "./attachments";
import { createVoiceDictationClient, type VoiceDictationState } from "./voice-dictation-client";
import type { AudioSignalLevel } from "./voice-audio";
import { toast } from "solid-sonner";
import { audioTransferLost, beginDictatedRange, matchesShortcut, releasesShortcut, replaceDictatedRange, shouldAutoSend, shouldReportNoSignal } from "./voice-dictation";
import { createVoiceWaveformController, VoiceWaveform, type VoiceWaveformController } from "./voice-waveform";
import { isMobileLayout } from "../navigation/mobile-layout";

const thinkingLabel = (value: string) => value ? value[0]!.toUpperCase() + value.slice(1) : "Off";
export const SPINNING_ACTIVITY = new Set(["starting", "thinking", "responding", "using_tool", "retrying", "compacting", "stopping", "waiting_for_model"]);
const MobileComposerOptions = lazy(() => import("./mobile-composer-options"));

export interface ComposerStatus {
  dictationState: () => VoiceDictationState;
  dictationLabel: () => string;
  dictationError: () => string;
  micSilent: () => boolean;
  dictating: () => boolean;
  recorderMonitorState: () => "connecting" | "listening" | "stopped";
  waveform: VoiceWaveformController;
}

export function Composer(props: {
  chat: ActiveChatStore;
  attachments: AttachmentsStore;
  models: ModelSettings;
  profiles: Template[];
  activeProfile?: Template | null;
  serverOnline: boolean;
  voiceSettings: { shortcut: string; activation: "push_to_talk" | "toggle"; autoSend: boolean; inputDeviceId: string };
  contextMetrics: () => readonly ContextMetricId[];
  onChooseProfile: (id: string) => void;
  onOpenSettings: (section: string) => void;
  onOpenAttachments: () => void;
  onStatusChange?: (status: ComposerStatus | null) => void;
}) {
  let input!: HTMLTextAreaElement;
  const [slashOpen, setSlashOpen] = createSignal(false);
  const [dictationState, setDictationState] = createSignal<VoiceDictationState>("idle");
  const [dictationError, setDictationError] = createSignal("");
  const [micSilent, setMicSilent] = createSignal(false);
  const [dictatedRange, setDictatedRange] = createSignal<{ start: number; end: number } | null>(null);
  const [dictationSelectionOwned, setDictationSelectionOwned] = createSignal(false);
  const dictationWaveform = createVoiceWaveformController();
  let dictationCancelled = false;
  let pushToTalkActive = false;
  let dictationRestoreFocus = true;
  let pendingDictationLaunch: { inputFocused: boolean; keyboardOpen: boolean } | null = null;
  const selectedModel = createMemo(() => props.models.models().find((item) => item.spec === props.models.model()));
  const levels = createMemo(() => selectedModel()?.thinkingLevels || ["off"]);
  const busy = createMemo(() => props.chat.streaming());
  const hasText = createMemo(() => Boolean(props.chat.draft().trim()));
  const dictating = createMemo(() => ["connecting", "active", "stopping"].includes(dictationState()));
  const recorderMonitorState = createMemo(() => dictationState() === "connecting" ? "connecting" : dictationState() === "active" ? "listening" : "stopped");
  const canSend = createMemo(() => hasText() && props.serverOnline && props.chat.generation() !== "stopping" && !dictating());
  const activity = createMemo(() => props.chat.activity());
  const contextDetail = createMemo(() => formatContextMetrics({
    enabled: props.contextMetrics(),
    contextUsage: props.chat.contextUsage(),
    sessionStats: props.chat.sessionStats(),
    cacheStats: props.chat.cacheStats(),
  }));
  const queueCount = createMemo(() => props.chat.queue().steering.length + props.chat.queue().followUp.length);
  const dictationLabel = createMemo(() => {
    if (dictationState() === "completed" && !dictatedRange()) return "";
    if (dictationState() === "failed" && !dictationError()) return "";
    return ({
      connecting: "Connecting microphone…",
      active: "Listening…",
      stopping: "Finalising dictation…",
      completed: "Dictation added to draft",
      failed: "Dictation failed",
      idle: "",
    })[dictationState()];
  });
  const composerStatus: ComposerStatus = {
    dictationState,
    dictationLabel,
    dictationError,
    micSilent,
    dictating,
    recorderMonitorState,
    waveform: dictationWaveform,
  };

  const setInputLevel = (level: AudioSignalLevel) => dictationWaveform.push(level);

  const resize = () => {
    input.style.height = "auto";
    input.style.height = `${Math.min(input.scrollHeight, 192)}px`;
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
    pendingDictationLaunch = { inputFocused, keyboardOpen: keyboardWasOpen(inputFocused) };
  };

  const change = (value: string, manual = true) => {
    if (manual) {
      setDictationSelectionOwned(false);
      if (dictatedRange()) {
        dictationCancelled = true;
        setDictatedRange(null);
        voiceClient.stop();
      }
    }
    props.chat.setDraft(value);
    setSlashOpen(/^\/[^\s]*$/.test(value) && "/attach".startsWith(value));
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
      if (!["connecting", "active", "stopping"].includes(next)) {
        dictationWaveform.reset();
        setMicSilent(false);
      }
    },
    onPartial: applyTranscript,
    onFinal: applyTranscript,
    onInputLevel: setInputLevel,
    onInputWarning: (warning) => setMicSilent(warning?.kind === "mic_silent"),
    onCompleted: (completion) => {
      window.dispatchEvent(new CustomEvent("conduit:voice-dictation-metrics", { detail: completion }));
      if (!completion.inputSignalDetected) {
        setDictatedRange(null);
        setDictationSelectionOwned(false);
        if (shouldReportNoSignal(completion)) {
          setDictationError(`No microphone signal detected after ${Math.max(1, Math.round(completion.captureDurationMs / 1000))}s (peak ${completion.maxInputPeak.toFixed(3)}). Check Voice → Microphone and Chrome site settings.`);
        } else {
          setDictationError("");
        }
        return;
      }
      if (completion.text) applyTranscript(completion.text);
      if (completion.completionReason === "duration_limit") {
        setDictationError("Dictation reached the server time limit. Start another dictation to continue.");
      }
      if (audioTransferLost(completion)) {
        setDictationError(`Microphone audio was truncated before transcription (${completion.serverAudioBytes} of ${completion.audioBytesSent} bytes reached the server). Check the connection and try again.`);
      }
      if (!dictationCancelled && completion.completionReason !== "duration_limit" && shouldAutoSend({ enabled: props.voiceSettings.autoSend, ...completion }) && completion.text.trim()) {
        setDictatedRange(null);
        queueMicrotask(() => void props.chat.send());
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
  });

  const startDictation = () => {
    if (dictating()) return;
    dictationCancelled = false;
    dictationWaveform.reset();
    setDictationError("");
    const draft = props.chat.draft();
    const launch = pendingDictationLaunch;
    pendingDictationLaunch = null;
    const focused = launch?.inputFocused ?? document.activeElement === input;
    dictationRestoreFocus = !isMobileLayout()
      ? true
      : (launch?.keyboardOpen ?? keyboardWasOpen(focused));
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
    voiceClient.start();
  };

  const toggleDictation = () => {
    if (["connecting", "active"].includes(dictationState())) voiceClient.stop();
    else if (dictationState() !== "stopping") startDictation();
  };

  const sendMessage = (mode?: "steer" | "follow_up") => {
    setDictatedRange(null);
    setDictationSelectionOwned(false);
    setDictationError("");
    void props.chat.send(mode);
  };

  const attach = () => {
    setSlashOpen(false);
    props.onOpenAttachments();
    queueMicrotask(() => input.focus());
  };

  const paste = (event: ClipboardEvent) => {
    const files = filesFromDataTransfer(event.clipboardData);
    if (!files.length) return;
    event.preventDefault();
    props.attachments.addFiles(files);
  };

  const keydown = (event: KeyboardEvent) => {
    if (event.key === "Escape" && slashOpen()) { event.preventDefault(); setSlashOpen(false); return; }
    if (event.key === "Enter" && slashOpen()) { event.preventDefault(); props.chat.setDraft(""); attach(); return; }
    if (event.key === "Enter" && !event.shiftKey && !event.ctrlKey && !event.metaKey) {
      event.preventDefault();
      if (canSend()) sendMessage();
    }
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey) && event.shiftKey && busy() && hasText()) {
      event.preventDefault();
      sendMessage("steer");
    }
  };

  const selectionChanged = () => {
    const range = dictatedRange();
    if (!range || (input.selectionStart === range.start && input.selectionEnd === range.end)) return;
    setDictationSelectionOwned(false);
  };

  onMount(() => {
    props.onStatusChange?.(composerStatus);
    createEffect(() => {
      props.chat.draft();
      queueMicrotask(resize);
    });
    const voiceKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || document.querySelector('.settings-dialog[data-state="open"]')) return;
      if (!matchesShortcut(event, props.voiceSettings.shortcut)) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      if (event.repeat) return;
      if (props.voiceSettings.activation === "toggle") {
        toggleDictation();
        return;
      }
      pushToTalkActive = true;
      startDictation();
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
    window.addEventListener("keydown", voiceKeyDown, true);
    window.addEventListener("keyup", voiceKeyUp, true);
    window.addEventListener("conduit:toggle-dictation", voiceToggle);
    onCleanup(() => {
      props.onStatusChange?.(null);
      window.removeEventListener("keydown", voiceKeyDown, true);
      window.removeEventListener("keyup", voiceKeyUp, true);
      window.removeEventListener("conduit:toggle-dictation", voiceToggle);
      voiceClient.dispose();
    });
  });

  return <div class="composer-wrap">
    <AttachmentCards items={props.attachments.items()} chatId={props.chat.loadedId()} label="Attachments" removable onRemove={(item) => void props.attachments.remove(item)} />
    <Show when={props.chat.queue().steering.length || props.chat.queue().followUp.length}>
      <div class="composer-queue"><span>Queued messages</span><Button variant="ghost" size="sm" onClick={props.chat.clearQueue}>Restore to draft</Button></div>
    </Show>
    <div class="composer">
      <MobileComposerOptions composer={props} />
      <div class="composer-input-shell">
        <textarea
          ref={input}
          rows={1}
          aria-label="Message Pi"
          aria-expanded={slashOpen()}
          aria-controls={slashOpen() ? "slash-suggestions" : undefined}
          data-has-text={hasText() ? "true" : "false"}
          placeholder={props.serverOnline ? "Send a message..." : "Server unavailable"}
          value={props.chat.draft()}
          disabled={!props.serverOnline}
          onInput={(event) => change(event.currentTarget.value)}
          onPaste={paste}
          onSelect={selectionChanged}
          onKeyDown={keydown}
        />
      </div>
      <Show when={slashOpen()}>
        <div id="slash-suggestions" role="listbox" aria-label="Suggestions" class="slash-suggestions">
          <button type="button" role="option" aria-selected="true" onMouseDown={(event) => event.preventDefault()} onClick={attach}><strong>/attach</strong><span>Choose files to attach</span></button>
        </div>
      </Show>
      <div class="composer-actions">
        <div class="composer-actions-left">
          <Button variant={dictationState() === "active" ? "default" : "ghost"} size="icon-sm" class="dictation-trigger" data-state={dictationState()} aria-label={dictating() ? "Stop voice dictation" : "Start voice dictation"} aria-pressed={dictating()} title={`Voice dictation (${props.voiceSettings.shortcut})`} disabled={!props.serverOnline || dictationState() === "stopping"} onPointerDown={captureDictationLaunch} onClick={toggleDictation}><Show when={["connecting", "stopping"].includes(dictationState())} fallback={<Show when={dictationState() === "active"} fallback={<MicIcon />}><SquareIcon /></Show>}><Spinner /></Show></Button>
          <Button class="composer-desktop-attachment" variant="ghost" size="icon-sm" aria-label={`Attach files${props.attachments.items().length ? ` (${props.attachments.items().length})` : ""}`} disabled={!props.serverOnline} onClick={attach}><PaperclipIcon /></Button>
          <div class="composer-desktop-setting">
            <Menu>
              <MenuTrigger class="model-trigger" aria-label={`${selectedModel()?.label || props.models.model() || "Model"} ${props.models.effort() || "off"}`} disabled={!props.serverOnline}>
                <span>{selectedModel()?.label || props.models.model() || "Model"}</span><span class="text-muted-foreground">{props.models.effort() || "off"}</span><ChevronDownIcon />
              </MenuTrigger>
              <MenuContent class="w-72">
                <MenuGroup><MenuLabel>Model</MenuLabel>
                  <Show when={props.models.notice()}><div class="px-2 pb-2 text-xs text-muted-foreground">{props.models.notice()}</div></Show>
                  <MenuRadioGroup value={props.models.model()} onChange={(value) => void props.models.chooseModel(value)}>
                    <For each={props.models.models()}>{(item) => <MenuRadioItem value={item.spec}><span class="truncate">{item.label}</span><span class="ml-auto text-xs text-muted-foreground">{item.provider}</span></MenuRadioItem>}</For>
                  </MenuRadioGroup>
                </MenuGroup>
                <MenuSeparator />
                <MenuGroup><MenuLabel>Thinking</MenuLabel><MenuRadioGroup value={props.models.effort()} onChange={(value) => void props.models.chooseEffort(value)}>
                  <For each={levels()}>{(level) => <MenuRadioItem value={level}>{thinkingLabel(level)}</MenuRadioItem>}</For>
                </MenuRadioGroup></MenuGroup>
                <MenuSeparator /><MenuItem onSelect={() => props.onOpenSettings("models")}>Manage models…</MenuItem>
              </MenuContent>
            </Menu>
          </div>
          <Show when={props.profiles.length}>
            <div class="composer-desktop-setting">
              <Menu><MenuTrigger class="model-trigger" aria-label={`Profile ${props.activeProfile?.label || "General"}`} disabled={!props.serverOnline || props.chat.status() !== "draft"}><span>{props.activeProfile?.label || "Profile"}</span><ChevronDownIcon /></MenuTrigger>
                <MenuContent class="w-72"><MenuGroup><MenuLabel>Profile</MenuLabel>
                  <Show when={props.chat.status() !== "draft"}><div class="px-2 pb-2 text-xs text-muted-foreground">Locked for this chat after the first message.</div></Show>
                  <MenuRadioGroup value={props.activeProfile?.id || ""} onChange={props.onChooseProfile}><For each={props.profiles}>{(item) => <MenuRadioItem value={item.id} disabled={props.chat.status() !== "draft" || item.disabled}>{item.label}</MenuRadioItem>}</For></MenuRadioGroup>
                </MenuGroup><MenuSeparator /><MenuItem onSelect={() => props.onOpenSettings("profiles")}>Manage profiles…</MenuItem></MenuContent>
              </Menu>
            </div>
          </Show>
        </div>
        <div class="composer-actions-right">
          <Show when={busy()}><Button variant={hasText() ? "outline" : "default"} size="icon-sm" aria-label="Stop response" onClick={props.chat.stop}><Show when={props.chat.stopping()} fallback={<SquareIcon />}><Spinner /></Show></Button></Show>
          <Show when={busy() && hasText()}><Button variant="outline" size="icon-sm" aria-label="Steer after tools" disabled={dictating()} onClick={() => sendMessage("steer")}><WaypointsIcon /></Button></Show>
          <Button size="icon-sm" aria-label={busy() ? "Queue follow-up" : "Send message"} disabled={!canSend()} onClick={() => sendMessage()}><Show when={props.chat.generation() === "submitting"} fallback={<ArrowUpIcon />}><Spinner /></Show></Button>
        </div>
      </div>
    </div>
    <Show when={dictationError()}><div class="composer-dictation-error" role="alert"><TriangleAlertIcon />{dictationError()}</div></Show>
    <div class="agent-activity composer-status" role="status" aria-live="polite">
      <div class="composer-status-leading">
        <Show when={dictating()}>
          <VoiceWaveform class="composer-status-waveform" history={dictationWaveform.history} level={dictationWaveform.level} peak={dictationWaveform.peak} state={recorderMonitorState()} variant="compact" barDensity={3.5} ariaLabel={dictationState() === "connecting" ? "Connecting microphone" : "Microphone input level"} />
        </Show>
        <span class="composer-status-state">
          <Show when={dictationLabel()} fallback={<><Show when={SPINNING_ACTIVITY.has(activity()?.kind || "")}><Spinner /></Show><Show when={["request_failed", "runtime_failed"].includes(activity()?.kind || "")}><TriangleAlertIcon aria-hidden="true" /></Show>{activity()?.label || "Ready"}</>}>{dictationLabel()}</Show>
        </span>
      </div>
      <Show when={contextDetail()}><span class="composer-status-metrics">{contextDetail()}</span></Show>
      <Show when={queueCount()}><span class="composer-status-queue">Queue {queueCount()}</span></Show>
      <Show when={dictating() && micSilent()}><span class="composer-status-warning" role="alert"><TriangleAlertIcon />No microphone signal — check the mic</span></Show>
    </div>
  </div>;
}
