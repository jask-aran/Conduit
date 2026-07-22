import { createMemo, createSignal, For, onMount, Show } from "solid-js";
import { ArrowUpIcon, ChevronDownIcon, PaperclipIcon, SquareIcon, WaypointsIcon } from "lucide-solid";
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

const thinkingLabel = (value: string) => value ? value[0]!.toUpperCase() + value.slice(1) : "Off";

export function Composer(props: {
  chat: ActiveChatStore;
  attachments: AttachmentsStore;
  models: ModelSettings;
  profiles: Template[];
  activeProfile?: Template | null;
  serverOnline: boolean;
  onChooseProfile: (id: string) => void;
  onOpenSettings: (section: string) => void;
  onOpenAttachments: () => void;
}) {
  let input!: HTMLTextAreaElement;
  const [slashOpen, setSlashOpen] = createSignal(false);
  const selectedModel = createMemo(() => props.models.models().find((item) => item.spec === props.models.model()));
  const levels = createMemo(() => selectedModel()?.thinkingLevels || ["off"]);
  const busy = createMemo(() => props.chat.streaming());
  const hasText = createMemo(() => Boolean(props.chat.draft().trim()));
  const canSend = createMemo(() => hasText() && props.serverOnline && props.chat.generation() !== "stopping");
  const activity = createMemo(() => props.chat.activity());
  const contextPercent = () => Math.round((props.chat.contextUsage()?.percent || 0) * (props.chat.contextUsage()?.percent && props.chat.contextUsage()!.percent! <= 1 ? 100 : 1));
  const contextDetail = () => {
    const usage = props.chat.contextUsage();
    if (!usage) return "Context unavailable";
    if (!usage.contextWindow) return `Context ${contextPercent()}%`;
    return `Context ${(usage.tokens || 0).toLocaleString()} / ${usage.contextWindow.toLocaleString()} · ${contextPercent()}%`;
  };
  const queueCount = createMemo(() => props.chat.queue().steering.length + props.chat.queue().followUp.length);

  const resize = () => {
    input.style.height = "auto";
    input.style.height = `${Math.min(input.scrollHeight, 192)}px`;
  };

  const change = (value: string) => {
    props.chat.setDraft(value);
    setSlashOpen(/^\/[^\s]*$/.test(value) && "/attach".startsWith(value));
    queueMicrotask(resize);
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
      if (canSend()) void props.chat.send();
    }
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey) && event.shiftKey && busy() && hasText()) {
      event.preventDefault();
      void props.chat.send("steer");
    }
  };

  onMount(resize);

  return <div class="composer-wrap">
    <AttachmentCards items={props.attachments.items()} chatId={props.chat.loadedId()} label="Attachments" removable onRemove={(item) => void props.attachments.remove(item)} />
    <Show when={props.chat.queue().steering.length || props.chat.queue().followUp.length}>
      <div class="composer-queue"><span>Queued messages</span><Button variant="ghost" size="sm" onClick={props.chat.clearQueue}>Restore to draft</Button></div>
    </Show>
    <div class="composer">
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
      />
      <Show when={slashOpen()}>
        <div id="slash-suggestions" role="listbox" aria-label="Suggestions" class="slash-suggestions">
          <button type="button" role="option" aria-selected="true" onMouseDown={(event) => event.preventDefault()} onClick={attach}><strong>/attach</strong><span>Choose files to attach</span></button>
        </div>
      </Show>
      <div class="composer-actions">
        <div class="composer-actions-left">
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
            <Menu><MenuTrigger class="model-trigger" aria-label={`Profile ${props.activeProfile?.label || "General"}`} disabled={!props.serverOnline}><span>{props.activeProfile?.label || "Profile"}</span><ChevronDownIcon /></MenuTrigger>
              <MenuContent class="w-72"><MenuGroup><MenuLabel>Profile</MenuLabel>
                <Show when={props.chat.status() !== "draft"}><div class="px-2 pb-2 text-xs text-muted-foreground">Locked for this chat after the first message.</div></Show>
                <MenuRadioGroup value={props.activeProfile?.id || ""} onChange={props.onChooseProfile}><For each={props.profiles}>{(item) => <MenuRadioItem value={item.id} disabled={props.chat.status() !== "draft" || item.disabled}>{item.label}</MenuRadioItem>}</For></MenuRadioGroup>
              </MenuGroup><MenuSeparator /><MenuItem onSelect={() => props.onOpenSettings("profiles")}>Manage profiles…</MenuItem></MenuContent>
            </Menu>
          </Show>
        </div>
        <div class="composer-actions-right">
          <Show when={busy()}><Button variant={hasText() ? "outline" : "default"} size="icon-sm" aria-label="Stop response" onClick={props.chat.stop}><Show when={props.chat.stopping()} fallback={<SquareIcon />}><Spinner /></Show></Button></Show>
          <Show when={busy() && hasText()}><Button variant="outline" size="icon-sm" aria-label="Steer after tools" onClick={() => void props.chat.send("steer")}><WaypointsIcon /></Button></Show>
          <Button size="icon-sm" aria-label={busy() ? "Queue follow-up" : "Send message"} disabled={!canSend()} onClick={() => void props.chat.send()}><Show when={props.chat.generation() === "submitting"} fallback={<ArrowUpIcon />}><Spinner /></Show></Button>
        </div>
      </div>
    </div>
    <div class="agent-activity composer-status" role="status" aria-live="polite">
      <span class="composer-status-state"><Show when={activity()?.kind && activity()?.kind !== "idle"}><Spinner /></Show>{activity()?.label || "Ready"}</span>
      <span class="composer-status-segment">{contextDetail()}</span>
      <Show when={queueCount()}><span class="composer-status-segment">Queue {queueCount()}</span></Show>
    </div>
  </div>;
}
