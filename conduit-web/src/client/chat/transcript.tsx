import { createEffect, createMemo, createSignal, For, lazy, onMount, Show, Suspense } from "solid-js";
import { CopyIcon, PencilIcon, PlayIcon, RefreshCwIcon } from "lucide-solid";
import { Button, Spinner } from "@/components/primitives";
import type { Message, RuntimeActivity, ToolItem } from "../api/contracts";
import type { ActiveChatStore } from "../state/active-chat";
import { AttachmentCards } from "./attachments";
import { ToolCard } from "./tool-card";
import { createTimelineStore } from "../state/timeline-store";

const ChatMarkdown = lazy(() => import("./markdown").then((module) => ({ default: module.ChatMarkdown })));
function Actions(props: { message: Message; precedingUserId?: string; chat: ActiveChatStore; partialContinue: boolean }) {
  const [copied, setCopied] = createSignal(false);
  const assistant = () => props.message.role !== "user";
  return <div class="response-actions">
    <Show when={!assistant() && !props.message.id.startsWith("user_")}>
      <Button variant="ghost" size="icon-sm" aria-label={props.chat.editingEntryId() === props.message.id ? "Cancel editing" : "Edit from here"} onClick={() => props.chat.edit(props.message)}><PencilIcon /></Button>
    </Show>
    <Show when={assistant()}>
      <Button variant="ghost" size="icon-sm" aria-label={copied() ? "Copied" : "Copy Markdown"} onClick={async () => { await navigator.clipboard.writeText(props.message.content || ""); setCopied(true); setTimeout(() => setCopied(false), 1600); }}><CopyIcon /></Button>
      <Show when={props.precedingUserId}><Button variant="ghost" size="icon-sm" aria-label="Regenerate response" onClick={() => void props.chat.regenerate(props.precedingUserId!)}><RefreshCwIcon /></Button></Show>
      <Show when={props.partialContinue && props.message.stopped}><Button variant="ghost" size="icon-sm" aria-label="Continue stopped response" onClick={() => void props.chat.continueResponse()}><PlayIcon /></Button></Show>
    </Show>
  </div>;
}

export function Transcript(props: { chat: ActiveChatStore; partialContinue: boolean }) {
  let viewport!: HTMLDivElement;
  let previousLoaded: string | null = null;
  let following = true;
  const timeline = createTimelineStore(props.chat.messages, props.chat.tools, props.chat.streaming);
  const empty = createMemo(() => !timeline.length && !props.chat.activity()?.label);

  const scrollBottom = () => requestAnimationFrame(() => { viewport.scrollTop = viewport.scrollHeight; });
  createEffect(() => {
    const loaded = props.chat.loadedId();
    props.chat.messages().length;
    props.chat.liveStream.content();
    if (loaded !== previousLoaded) { previousLoaded = loaded; following = true; scrollBottom(); }
    else if (following) scrollBottom();
  });

  onMount(() => viewport.addEventListener("scroll", () => { following = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight < 80; }, { passive: true }));

  return <div class="transcript" data-slot="message-scroller">
    <div ref={viewport} class="message-scroller-viewport" data-slot="message-scroller-viewport">
      <div class="thread" data-slot="message-scroller-content">
        <Show when={props.chat.pageBefore()}>
          <div data-slot="message-scroller-item"><Button variant="ghost" class="mx-auto" onClick={() => void props.chat.loadOlder()} disabled={props.chat.loadingOlder()}><Show when={props.chat.loadingOlder()}><Spinner /></Show>{props.chat.loadingOlder() ? "Loading earlier messages…" : "Load earlier messages"}</Button></div>
        </Show>
        <Show when={empty()}><div class="empty-thread" data-slot="message-scroller-item"><div class="welcome"><h1>How can I help you today?</h1></div></div></Show>
        <For each={timeline}>{(item) => {
          if (item.type === "tool") return <div data-slot="message-scroller-item"><ToolCard tool={item.value} sessionId={props.chat.loadedId()} /></div>;
          const message = createMemo(() => item.value);
          const user = createMemo(() => message().role === "user");
          const live = createMemo(() => {
            const last = props.chat.messages().at(-1);
            return props.chat.streaming() && !user() && Boolean(last && (message().key || message().id) === (last.key || last.id));
          });
          const preceding = createMemo(() => !user() ? props.chat.messages().slice(0, item.index).findLast((candidate) => candidate.role === "user") : undefined);
          return <div data-slot="message-scroller-item" data-message-id={message().id}>
            <article data-slot="message" data-align={user() ? "end" : "start"} class={user() ? "message-user" : "message-assistant"}>
              <div data-slot="message-content">
                <Show when={message().timestamp}><time>{new Date(message().timestamp!).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time></Show>
                <div data-slot="bubble" data-align={user() ? "end" : "start"} data-editing={props.chat.editingEntryId() === message().id ? "true" : "false"} class={user() ? "bubble bubble-user" : "bubble bubble-assistant"}>
                  <div data-slot="bubble-content">
                    <Show when={user()} fallback={<>
                      <Show when={live() && (props.chat.reasoning().content || props.chat.reasoning().active)}><details class="reasoning" open={props.chat.reasoning().active}><summary>{props.chat.reasoning().active ? "Thinking…" : "Reasoning"}</summary><p>{props.chat.reasoning().content}</p></details></Show>
                      <Suspense fallback={<div class="markdown-skeleton" />}><ChatMarkdown streaming={live()} streamVersion={props.chat.liveStream.version()}>{`${message().content || ""}${live() ? props.chat.liveStream.content() : ""}`}</ChatMarkdown></Suspense>
                    </>}><span class="user-message-text">{message().content || ""}</span></Show>
                  </div>
                </div>
                <Show when={user() && message().pending}><div class="marker">{message().queueMode === "steer" ? "Queued · steer (after tools)" : "Queued · follow-up (after turn)"}</div></Show>
                <Show when={user() && message().attachments?.length}><AttachmentCards items={message().attachments!} chatId={props.chat.loadedId()} label="Message attachments" /></Show>
                <Show when={message().stopped}><div class="marker">{message().status === "stopping" ? "Stopping…" : "Stopped"}</div></Show>
                <Actions message={message()} precedingUserId={preceding()?.id} chat={props.chat} partialContinue={props.partialContinue} />
              </div>
            </article>
          </div>;
        }}</For>
        <Show when={props.chat.activity()?.label && props.chat.activity()?.kind !== "idle"}><div data-slot="message-scroller-item" class="agent-activity"><Spinner /><span>{props.chat.activity()?.label}</span></div></Show>
      </div>
    </div>
    <Show when={!following}><Button class="message-scroller-button" aria-label="Scroll to latest" onClick={() => { following = true; scrollBottom(); }}>↓</Button></Show>
  </div>;
}
