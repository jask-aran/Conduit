import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { CheckIcon, ChevronDownIcon, ChevronUpIcon, PaperclipIcon } from "lucide-react";
import { Bubble, BubbleContent } from "@/components/ui/bubble";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
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
import { Skeleton } from "@/components/ui/skeleton";
import { RenderedMarkdown } from "./rendered-markdown";
import { ResponseActions } from "./response-actions";

const ChatMarkdown = lazy(() => import("./chat-markdown").then((module) => ({
  default: module.ChatMarkdown,
})));

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
      <pre>{loading ? "Loading…" : typeof result === "string" ? result : JSON.stringify(result || tool.args || {}, null, 2)}</pre>
    </CollapsibleContent>
  </Collapsible>;
}

export function ChatThread({
  messages, tools, streaming, sessionId, hasOlder, loadingOlder, partialContinue,
  onLoadOlder, onCopyMessage, onEditMessage, onRegenerate, onContinue,
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
          {hasOlder && <MessageScrollerItem>
            <Button ref={older} variant="ghost" className="mx-auto" onClick={onLoadOlder} disabled={loadingOlder}>
              {loadingOlder ? "Loading earlier messages…" : "Load earlier messages"}
            </Button>
          </MessageScrollerItem>}
          {empty && <MessageScrollerItem className="empty-thread">
            <div className="welcome">
              <h1>How can I help you today?</h1>
            </div>
          </MessageScrollerItem>}
          {timeline.map((item) => {
            if (item.type === "tool") return <MessageScrollerItem key={`tool_${item.value.id}`}>
              <ToolCard tool={item.value} sessionId={sessionId} />
            </MessageScrollerItem>;
            const message = item.value;
            const isUser = message.role === "user";
            const isStreamingMessage = streaming && message === lastMessage && !isUser;
            const precedingUser = !isUser ? messages.slice(0, item.index).findLast((candidate) => candidate.role === "user") : null;
            return <MessageScrollerItem
              key={`message_${message.id}`}
              messageId={message.id}
              scrollAnchor={isUser}
            >
              <Message align={isUser ? "end" : "start"}>
                <MessageContent>
                  {message.timestamp && <MessageHeader>{time(message.timestamp)}</MessageHeader>}
                  <Bubble align={isUser ? "end" : "start"} variant={isUser ? "muted" : "ghost"}>
                    <BubbleContent>
                      {isUser ? <>
                        <span className="user-message-text">{String(message.content || "")}</span>
                        {message.attachments?.length > 0 && <div className="message-attachments" aria-label="Message attachments">
                          {message.attachments.map((attachment) => <span key={attachment.id}><PaperclipIcon />{attachment.name}</span>)}
                        </div>}
                      </> : message.html
                        ? <RenderedMarkdown html={message.html} />
                        : isStreamingMessage && (message.streamBlocks?.length || message.tail != null)
                          ? <>
                            {message.streamBlocks?.map((block) => <RenderedMarkdown key={block.block} html={block.html} />)}
                            {message.tail && <Suspense fallback={<Skeleton className="h-16 w-full" />}>
                              <ChatMarkdown streaming>{message.tail}</ChatMarkdown>
                            </Suspense>}
                          </>
                          : <Suspense fallback={<Skeleton className="h-16 w-full" />}>
                            <ChatMarkdown streaming={isStreamingMessage}>{message.content}</ChatMarkdown>
                          </Suspense>}
                      {message.stopped && <span className="stopped-label">{message.status === "stopping" ? "Stopping…" : "Stopped"}</span>}
                    </BubbleContent>
                  </Bubble>
                  {!streaming && <ResponseActions
                    message={message}
                    precedingUserId={precedingUser?.id}
                    partialContinue={partialContinue}
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
}
