import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js";
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
import type { AttachmentsStore } from "../state/attachments";
import type { ModelSettings } from "../state/model-settings";
import { AttachmentCards } from "./attachments";
import { createVoiceDictationClient, type VoiceDictationState } from "./voice-dictation-client";
import { beginDictatedRange, matchesShortcut, releasesShortcut, replaceDictatedRange, shouldAutoSend } from "./voice-dictation";

const thinkingLabel = (value: string) => value ? value[0]!.toUpperCase() + value.slice(1) : "Off";
const SPINNING_ACTIVITY = new Set(["starting", "thinking", "responding", "using_tool", "retrying", "compacting", "stopping", "waiting_for_model"]);

export function Composer(props: {
  chat: ActiveChatStore;
  attachments: AttachmentsStore;
  models: ModelSettings;
  profiles: Template[];
  activeProfile?: Template | null;
  serverOnline: boolean;
  voiceSettings: { shortcut: string; autoSend: boolean };
  onChooseProfile: (id: string) => void;
  onOpenSettings: (section: string) => void;
  onOpenAttachments: () => void;
}) {
  let input!: HTMLTextAreaElement;
  let highlightLayer!: HTMLDivElement;
  const [slashOpen, setSlashOpen] = createSignal(false);
  const [dictationState, setDictationState] = createSignal<VoiceDictationState>("idle");
  const [dictationError, setDictationError] = createSignal("");
  const [dictatedRange, setDictatedRange] = createSignal<{ start: number; end: number } | null>(null);
  let dictationCancelled = false;
  let pushToTalkActive = false;
  const selectedModel = createMemo(() => props.models.models().find((item) => item.spec === props.models.model()));
  const levels = createMemo(() => selectedModel()?.thinkingLevels || ["off"]);
  const busy = createMemo(() => props.chat.streaming());
  const hasText = createMemo(() => Boolean(props.chat.draft().trim()));
  const dictating = createMemo(() => ["connecting", "active", "stopping"].includes(dictationState()));
  const canSend = createMemo(() => hasText() && props.serverOnline && props.chat.generation() !== "stopping" && !dictating());
  const activity = createMemo(() => props.chat.activity());
  const contextPercent = () => Math.round((props.chat.contextUsage()?.percent || 0) * (props.chat.contextUsage()?.percent && props.chat.contextUsage()!.percent! <= 1 ? 100 : 1));
  const contextDetail = () => {
    const usage = props.chat.contextUsage();
    if (!usage) return "Context unavailable";
    if (!usage.contextWindow) return `Context ${contextPercent()}%`;
    return `Context ${(usage.tokens || 0).toLocaleString()} / ${usage.contextWindow.toLocaleString()} · ${contextPercent()}%`;
  };
  const queueCount = createMemo(() => props.chat.queue().steering.length + props.chat.queue().followUp.length);
  const highlight = createMemo(() => {
    const range = dictatedRange();
    const text = props.chat.draft();
    if (!range) return null;
    return { before: text.slice(0, range.start), dictated: text.slice(range.start, range.end), after: text.slice(range.end) };
  });
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

  const resize = () => {
    input.style.height = "auto";
    input.style.height = `${Math.min(input.scrollHeight, 192)}px`;
    if (highlightLayer) highlightLayer.style.height = input.style.height;
  };

  const syncHighlightScroll = () => {
    if (highlightLayer) {
      highlightLayer.scrollTop = input.scrollTop;
      highlightLayer.scrollLeft = input.scrollLeft;
    }
  };

  const change = (value: string, manual = true) => {
    if (manual && dictatedRange()) {
      dictationCancelled = true;
      setDictatedRange(null);
      voiceClient.stop();
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
    queueMicrotask(() => { resize(); input.setSelectionRange(next.range.end, next.range.end); });
  };

  const voiceClient = createVoiceDictationClient({
    onState: setDictationState,
    onPartial: applyTranscript,
    onFinal: applyTranscript,
    onCompleted: (completion) => {
      if (completion.text) applyTranscript(completion.text);
      if (!dictationCancelled && shouldAutoSend({ enabled: props.voiceSettings.autoSend, ...completion }) && completion.text.trim()) {
        setDictatedRange(null);
        queueMicrotask(() => void props.chat.send());
      }
    },
    onError: (error) => setDictationError(error.message),
  });

  const startDictation = () => {
    if (dictating()) return;
    dictationCancelled = false;
    setDictationError("");
    setDictatedRange(beginDictatedRange(props.chat.draft(), input.selectionStart ?? props.chat.draft().length));
    voiceClient.start();
  };

  const toggleDictation = () => {
    if (["connecting", "active"].includes(dictationState())) voiceClient.stop();
    else if (dictationState() !== "stopping") startDictation();
  };

  const sendMessage = (mode?: "steer" | "follow_up") => {
    setDictatedRange(null);
    setDictationError("");
    void props.chat.send(mode);
  };

  const attach = () => {
    setSlashOpen(false);
    props.onOpenAttachments();
    queueMicrotask(() => input.focus());
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

  onMount(() => {
    createEffect(() => {
      props.chat.draft();
      queueMicrotask(resize);
    });
    const voiceKeyDown = (event: KeyboardEvent) => {
      if (event.repeat || event.defaultPrevented || document.querySelector('.settings-dialog[data-state="open"]')) return;
      if (!matchesShortcut(event, props.voiceSettings.shortcut)) return;
      event.preventDefault();
      pushToTalkActive = true;
      startDictation();
    };
    const voiceKeyUp = (event: KeyboardEvent) => {
      if (!pushToTalkActive || !releasesShortcut(event, props.voiceSettings.shortcut)) return;
      event.preventDefault();
      pushToTalkActive = false;
      voiceClient.stop();
    };
    const voiceToggle = () => toggleDictation();
    window.addEventListener("keydown", voiceKeyDown);
    window.addEventListener("keyup", voiceKeyUp);
    window.addEventListener("conduit:toggle-dictation", voiceToggle);
    onCleanup(() => {
      window.removeEventListener("keydown", voiceKeyDown);
      window.removeEventListener("keyup", voiceKeyUp);
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
      <div class="composer-input-shell">
        <div ref={highlightLayer} class="composer-highlight-layer" aria-hidden="true"><Show when={highlight()}>{(parts) => <><span>{parts().before}</span><mark>{parts().dictated}</mark><span>{parts().after || "\u200b"}</span></>}</Show></div>
        <textarea
          ref={input}
          aria-label="Message Pi"
          aria-expanded={slashOpen()}
          aria-controls={slashOpen() ? "slash-suggestions" : undefined}
          placeholder={props.serverOnline ? "Send a message..." : "Server unavailable"}
          value={props.chat.draft()}
          disabled={!props.serverOnline}
          onInput={(event) => change(event.currentTarget.value)}
          onKeyDown={keydown}
          onScroll={syncHighlightScroll}
        />
      </div>
      <Show when={slashOpen()}>
        <div id="slash-suggestions" role="listbox" aria-label="Suggestions" class="slash-suggestions">
          <button type="button" role="option" aria-selected="true" onMouseDown={(event) => event.preventDefault()} onClick={attach}><strong>/attach</strong><span>Choose files to attach</span></button>
        </div>
      </Show>
      <div class="composer-actions">
        <div class="composer-actions-left">
          <Button variant={dictationState() === "active" ? "default" : "ghost"} size="icon-sm" class="dictation-trigger" data-state={dictationState()} aria-label={dictating() ? "Stop voice dictation" : "Start voice dictation"} aria-pressed={dictating()} title={`Voice dictation (${props.voiceSettings.shortcut})`} disabled={!props.serverOnline || dictationState() === "stopping"} onClick={toggleDictation}><Show when={["connecting", "stopping"].includes(dictationState())} fallback={<Show when={dictationState() === "active"} fallback={<MicIcon />}><SquareIcon /></Show>}><Spinner /></Show></Button>
          <Button variant="ghost" size="icon-sm" aria-label={`Attach files${props.attachments.items().length ? ` (${props.attachments.items().length})` : ""}`} disabled={!props.serverOnline} onClick={attach}><PaperclipIcon /></Button>
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
          <Show when={props.profiles.length}>
            <Menu><MenuTrigger class="model-trigger" aria-label={`Profile ${props.activeProfile?.label || "General"}`} disabled={!props.serverOnline || props.chat.status() !== "draft"}><span>{props.activeProfile?.label || "Profile"}</span><ChevronDownIcon /></MenuTrigger>
              <MenuContent class="w-72"><MenuGroup><MenuLabel>Profile</MenuLabel>
                <Show when={props.chat.status() !== "draft"}><div class="px-2 pb-2 text-xs text-muted-foreground">Locked for this chat after the first message.</div></Show>
                <MenuRadioGroup value={props.activeProfile?.id || ""} onChange={props.onChooseProfile}><For each={props.profiles}>{(item) => <MenuRadioItem value={item.id} disabled={props.chat.status() !== "draft" || item.disabled}>{item.label}</MenuRadioItem>}</For></MenuRadioGroup>
              </MenuGroup><MenuSeparator /><MenuItem onSelect={() => props.onOpenSettings("profiles")}>Manage profiles…</MenuItem></MenuContent>
            </Menu>
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
      <span class="composer-status-state">
        <Show when={dictationLabel()} fallback={<><Show when={SPINNING_ACTIVITY.has(activity()?.kind || "")}><Spinner /></Show><Show when={["request_failed", "runtime_failed"].includes(activity()?.kind || "")}><TriangleAlertIcon aria-hidden="true" /></Show>{activity()?.label || "Ready"}</>}>{dictationLabel()}</Show>
      </span>
      <span class="composer-status-segment">{contextDetail()}</span>
      <Show when={queueCount()}><span class="composer-status-segment">Queue {queueCount()}</span></Show>
    </div>
  </div>;
}
