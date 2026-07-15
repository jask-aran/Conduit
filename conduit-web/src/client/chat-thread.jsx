import { lazy, Suspense, useState } from "react";
import { CheckIcon, ChevronDownIcon, ChevronUpIcon } from "lucide-react";
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

const ChatMarkdown = lazy(() => import("./chat-markdown").then((module) => ({
  default: module.ChatMarkdown,
})));

const time = (value) => value
  ? new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
  : "";

function ToolCard({ tool }) {
  const [open, setOpen] = useState(false);
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
      <pre>{JSON.stringify(tool.result || tool.args || {}, null, 2)}</pre>
    </CollapsibleContent>
  </Collapsible>;
}

export function ChatThread({ messages, tools, streaming }) {
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
          {empty && <MessageScrollerItem className="empty-thread">
            <div className="welcome">
              <h1>How can I help you today?</h1>
            </div>
          </MessageScrollerItem>}
          {timeline.map((item) => {
            if (item.type === "tool") return <MessageScrollerItem key={`tool_${item.value.id}`}>
              <ToolCard tool={item.value} />
            </MessageScrollerItem>;
            const message = item.value;
            const isUser = message.role === "user";
            const isStreamingMessage = streaming && message === lastMessage && !isUser;
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
                      {isUser
                        ? String(message.content || "")
                        : <Suspense fallback={<Skeleton className="h-16 w-full" />}>
                          <ChatMarkdown streaming={isStreamingMessage}>{message.content}</ChatMarkdown>
                        </Suspense>}
                    </BubbleContent>
                  </Bubble>
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
