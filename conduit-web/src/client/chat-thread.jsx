import { lazy, memo, Suspense, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { CheckIcon, ChevronDownIcon, ChevronUpIcon } from "lucide-react";
import { Bubble, BubbleContent } from "@/components/ui/bubble";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Empty, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import {
  Message,
  MessageContent,
  MessageHeader,
} from "@/components/ui/message";
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@/components/ui/message-scroller";
import { Marker, MarkerContent } from "@/components/ui/marker";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { ResponseActions } from "./response-actions";
import { AttachmentCards } from "./attachment-tray";

const ChatMarkdown = lazy(() => import("./chat-markdown").then((module) => ({
  default: module.ChatMarkdown,
})));

// Timeline rows participate in the message-scroller's pre-paint scroll math, so
// they must lay out at their real height. Override the generated wrapper's lazy
// [content-visibility:auto]/[contain-intrinsic-size] placeholders (tailwind-merge
// keeps these later arbitrary-property values); pristine wrapper preserved.
const eagerItem = "[content-visibility:visible] [contain-intrinsic-size:none]";

const time = (value) => value
  ? new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
  : "";

function ToolCard({ tool, sessionId }) {
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState(tool.result);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (tool.result != null) setResult(tool.result);
  }, [tool.result]);
  useEffect(() => {
    if (!open || !tool.resultDeferred || result != null || loading || !sessionId) return;
    setLoading(true);
    fetch(`/v0/sessions/${encodeURIComponent(sessionId)}/tools/${encodeURIComponent(tool.id)}`)
      .then((response) => response.ok ? response.json() : Promise.reject(new Error("Could not load tool output")))
      .then((payload) => setResult(payload.result || ""))
      .catch(() => setResult("Could not load tool output"))
      .finally(() => setLoading(false));
  }, [loading, open, result, sessionId, tool.id, tool.resultDeferred]);
  return <Collapsible open={open} onOpenChange={setOpen} className="tool-card">
    <CollapsibleTrigger asChild>
      <Button variant="outline" className="w-full justify-start">
        {tool.done && <CheckIcon data-icon="inline-start" />}
        <span className="truncate">{tool.name || "Tool"}</span>
        <span className="ml-auto text-xs text-muted-foreground">{tool.done ? "Complete" : "Running"}</span>
        {open ? <ChevronUpIcon data-icon="inline-end" /> : <ChevronDownIcon data-icon="inline-end" />}
      </Button>
    </CollapsibleTrigger>
    <CollapsibleContent>
      <pre>{loading ? <span className="flex items-center gap-2"><Spinner />Loading…</span> : typeof result === "string" ? result : JSON.stringify(result || tool.args || {}, null, 2)}</pre>
    </CollapsibleContent>
  </Collapsible>;
}

function AssistantMessage({ message, liveStore, live }) {
  const stream = useSyncExternalStore(liveStore.subscribe, liveStore.getSnapshot, liveStore.getServerSnapshot);
  const text = live ? `${message.content || ""}${stream.content}` : String(message.content || "");
  return <ChatMarkdown streaming={live}>{text}</ChatMarkdown>;
}

export const ChatThread = memo(function ChatThread({
  messages, tools, streaming, sessionId, hasOlder, loadingOlder, partialContinue,
  editingEntryId, onLoadOlder, onCopyMessage, onEditMessage, onRegenerate, onContinue, liveStore,
}) {
  const older = useRef(null);
  useEffect(() => {
    if (!hasOlder || !older.current || !onLoadOlder) return undefined;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) onLoadOlder();
    }, { rootMargin: "240px" });
    observer.observe(older.current);
    return () => observer.disconnect();
  }, [hasOlder, onLoadOlder]);
  const lastMessage = messages[messages.length - 1];
  const timeline = [
    ...messages.flatMap((message, index) => {
      if (message.role !== "user" && message.role !== "assistant") return [];
      const showStreaming = streaming && message === lastMessage && message.role === "assistant";
      if (message.role === "assistant" && !String(message.content || "").trim() && !showStreaming) return [];
      return [{ type: "message", value: message, index }];
    }),
    ...tools.map((tool, index) => ({ type: "tool", value: tool, index: messages.length + index })),
  ].sort((left, right) => {
    const leftTime = Date.parse(left.value.timestamp || "");
    const rightTime = Date.parse(right.value.timestamp || "");
    if (Number.isNaN(leftTime) || Number.isNaN(rightTime) || leftTime === rightTime) return left.index - right.index;
    return leftTime - rightTime;
  });
  const empty = timeline.length === 0;

  return <MessageScrollerProvider autoScroll>
    <MessageScroller className="transcript">
      <MessageScrollerViewport>
        <MessageScrollerContent className="thread">
          {hasOlder && <MessageScrollerItem className={eagerItem}>
            <Button ref={older} variant="ghost" className="mx-auto" onClick={onLoadOlder} disabled={loadingOlder}>
              {loadingOlder && <Spinner data-icon="inline-start" />}{loadingOlder ? "Loading earlier messages…" : "Load earlier messages"}
            </Button>
          </MessageScrollerItem>}
          {empty && <MessageScrollerItem className={`empty-thread ${eagerItem}`}>
            <Empty className="welcome"><EmptyHeader><EmptyTitle><h1>How can I help you today?</h1></EmptyTitle></EmptyHeader></Empty>
          </MessageScrollerItem>}
          {timeline.map((item) => {
            if (item.type === "tool") return <MessageScrollerItem key={`tool_${item.value.id}`} className={eagerItem}>
              <ToolCard tool={item.value} sessionId={sessionId} />
            </MessageScrollerItem>;
            const message = item.value;
            const isUser = message.role === "user";
            const isEditing = message.id === editingEntryId;
            const live = streaming && message === lastMessage && !isUser;
            const precedingUser = !isUser ? messages.slice(0, item.index).findLast((candidate) => candidate.role === "user") : null;
            return <MessageScrollerItem
              key={`message_${message.key ?? message.id}`}
              className={eagerItem}
              messageId={message.id}
              scrollAnchor={isUser}
            >
              <Message align={isUser ? "end" : "start"}>
                <MessageContent>
                  {message.timestamp && <MessageHeader>{time(message.timestamp)}</MessageHeader>}
                  <Bubble
                    align={isUser ? "end" : "start"}
                    variant={isUser ? "muted" : "ghost"}
                    data-editing={isEditing}
                    className="data-[editing=true]:outline-2 data-[editing=true]:outline-offset-2 data-[editing=true]:outline-ring"
                  >
                    <BubbleContent>
                      {isUser ? <span className="user-message-text">{String(message.content || "")}</span>
                        : <Suspense fallback={<Skeleton className="h-16 w-full" />}>
                            <AssistantMessage message={message} liveStore={liveStore} live={live} />
                          </Suspense>}
                    </BubbleContent>
                  </Bubble>
                  {isUser && <AttachmentCards
                    items={message.attachments || []}
                    chatId={sessionId}
                    className="message-attachments"
                    label="Message attachments"
                  />}
                  {message.stopped && <Marker><MarkerContent>{message.status === "stopping" ? "Stopping…" : "Stopped"}</MarkerContent></Marker>}
                  {!streaming && <ResponseActions
                    message={message}
                    precedingUserId={precedingUser?.id}
                    partialContinue={partialContinue}
                    editing={isEditing}
                    onCopy={onCopyMessage}
                    onEdit={onEditMessage}
                    onRegenerate={onRegenerate}
                    onContinue={onContinue}
                  />}
                </MessageContent>
              </Message>
            </MessageScrollerItem>;
          })}
        </MessageScrollerContent>
      </MessageScrollerViewport>
      <MessageScrollerButton />
    </MessageScroller>
  </MessageScrollerProvider>;
});
