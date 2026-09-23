import { createSignal, onCleanup, Show } from "solid-js";
import { Popover, PopoverContent } from "@/components/primitives";
import type { ActiveChatStore } from "../state/active-chat";
import { contextUsagePercent, formatContextMetrics, type ContextMetricId } from "./context-metrics";

const HOVER_DELAY_MS = 150;

/* A live readout of how much room the next message has, so it sits with the
   composer's other "what will this send cost" controls rather than in the
   header, which holds identity and one-shot verbs.

   Hovering previews it; a click holds it open, so the session ID can be
   selected and copied, and a tap is how touch opens it at all. */
export function ContextGauge(props: { chat: ActiveChatStore; metrics?: () => readonly ContextMetricId[]; compact?: boolean }) {
  /* An adaptor that reports no context usage still gets a gauge: it reads 0%
     and greys out, which is the honest answer, rather than leaving a hole in
     the row that moves the controls beside it. */
  const reported = () => contextUsagePercent(props.chat.contextUsage());
  const percent = () => {
    const value = reported();
    return value == null ? 0 : Math.max(0, Math.min(100, value));
  };
  const tone = () => reported() == null ? "idle" : percent() >= 90 ? "critical" : percent() >= 70 ? "warning" : "normal";
  const detail = () => props.metrics ? formatContextMetrics({
    enabled: props.metrics(),
    contextUsage: props.chat.contextUsage(),
    sessionStats: props.chat.sessionStats(),
    cacheStats: props.chat.cacheStats(),
  }) : "";
  const sessionId = () => {
    const value = (props.chat.live() as { sessionId?: unknown } | null)?.sessionId;
    return typeof value === "string" ? value : "";
  };

  const [hovered, setHovered] = createSignal(false);
  const [held, setHeld] = createSignal(false);
  let trigger: HTMLButtonElement | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const hover = (value: boolean) => (event: PointerEvent) => {
    if (event.pointerType !== "mouse") return;
    clearTimeout(timer);
    timer = setTimeout(() => setHovered(value), HOVER_DELAY_MS);
  };
  const close = () => { clearTimeout(timer); setHeld(false); setHovered(false); };
  onCleanup(() => clearTimeout(timer));

  return <Popover open={hovered() || held()} onOpenChange={(open) => { if (!open) close(); }} anchorRef={() => trigger} placement="top-end">
    <button ref={trigger} type="button" class="chat-context-trigger" data-state={tone()} aria-label={`Context usage: ${Math.round(percent())}%`}
      aria-expanded={held()} onPointerEnter={hover(true)} onPointerLeave={hover(false)} onClick={() => { if (held()) close(); else setHeld(true); }}>
      <svg class="chat-context-gauge" viewBox="0 0 24 24" aria-hidden="true">
        <circle class="chat-context-gauge-track" cx="12" cy="12" r="9" pathLength="100" />
        <circle class="chat-context-gauge-value" cx="12" cy="12" r="9" pathLength="100" style={`stroke-dasharray: ${percent() || 0} 100`} />
      </svg>
      <Show when={!props.compact}><span class="chat-context-percent">{Math.round(percent())}%</span></Show>
    </button>
    <PopoverContent class="chat-context-menu" aria-label="Context usage"
      onOpenAutoFocus={(event) => event.preventDefault()} onCloseAutoFocus={(event) => event.preventDefault()}
      onPointerDownOutside={(event) => { if (trigger?.contains(event.target as Node)) event.preventDefault(); }}>
      <div onPointerEnter={hover(true)} onPointerLeave={hover(false)}>
        <div class="composer-context-label">Context · {reported() == null ? "Unavailable" : `${Math.round(percent())}%`}</div>
        <div class="chat-context-menu-values">{detail() || "No context metrics for this session."}</div>
        <Show when={sessionId()}><div class="composer-context-label">Session ID</div><div class="chat-context-menu-values"><code>{sessionId()}</code></div></Show>
      </div>
    </PopoverContent>
  </Popover>;
}
