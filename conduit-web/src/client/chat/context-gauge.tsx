import { createEffect, createMemo, createSignal, For, on, onCleanup, Show } from "solid-js";
import { ChevronRightIcon } from "lucide-solid";
import { Popover, PopoverContent } from "@/components/primitives";
import type { ActiveChatStore } from "../state/active-chat";
import type { ContextCategory } from "../api/contracts";
import { cacheHitPercent, compactTokens, contextBreakdown, contextTokens, contextUsagePercent, contextWindow } from "./context-metrics";

/* One colour per kind of content, the same in every harness. What Conduit has
   not named takes the next of the spares. */
const CATEGORY_COLOURS: Record<string, string> = {
  messages: "oklch(0.72 0.15 300)", used: "oklch(0.72 0.15 300)",
  "system-prompt": "oklch(0.7 0.02 260)", "system-tools": "oklch(0.74 0.12 230)",
  "mcp-tools": "oklch(0.76 0.13 175)", "custom-agents": "oklch(0.78 0.14 75)",
  "memory-files": "oklch(0.75 0.15 30)", skills: "oklch(0.8 0.14 120)",
  "mcp-server-instructions": "oklch(0.72 0.12 200)",
};
const SPARES = ["oklch(0.72 0.16 350)", "oklch(0.8 0.12 95)", "oklch(0.7 0.13 150)", "oklch(0.7 0.1 50)"];
const colourOf = (category: ContextCategory, index: number) => category.kind === "free" ? "transparent"
  : category.kind === "buffer" ? "color-mix(in oklch, var(--muted-foreground), transparent 55%)"
  : CATEGORY_COLOURS[category.id] ?? SPARES[index % SPARES.length];

const HOVER_DELAY_MS = 150;

/* A live readout of how much room the next message has, so it sits with the
   composer's other "what will this send cost" controls rather than in the
   header, which holds identity and one-shot verbs.

   Hovering previews it; a click holds it open, so the session ID can be
   selected and copied, and a tap is how touch opens it at all. */
export function ContextGauge(props: { chat: ActiveChatStore; compact?: boolean }) {
  /* An adaptor that reports no context usage still gets a gauge: it reads 0%
     and greys out, which is the honest answer, rather than leaving a hole in
     the row that moves the controls beside it. */
  const reported = () => contextUsagePercent(props.chat.contextUsage());
  const percent = () => {
    const value = reported();
    return value == null ? 0 : Math.max(0, Math.min(100, value));
  };
  const tone = () => reported() == null ? "idle" : percent() >= 90 ? "critical" : percent() >= 70 ? "warning" : "normal";
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

  createEffect(on(() => hovered() || held(), (open) => { if (open) props.chat.refreshContext(); }, { defer: true }));
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
      <div onPointerEnter={hover(true)} onPointerLeave={hover(false)}><ContextBreakdown chat={props.chat} /></div>
    </PopoverContent>
  </Popover>;
}

/** The window as one bar of its parts, in their colours. */
export function ContextBar(props: { chat: ActiveChatStore }) {
  const usage = () => props.chat.contextUsage();
  const inWindow = () => contextBreakdown(usage()).filter((category) => category.kind !== "deferred");
  return <Show when={contextWindow(usage()) && inWindow().length}>
    <div class="context-breakdown-bar" aria-hidden="true">
      <For each={inWindow()}>{(category, index) => <span style={{ "flex-grow": category.tokens, background: colourOf(category, index()) }} />}</For>
    </div>
  </Show>;
}

/** What fills the window: the total, the bar, and each part with its share. */
export function ContextBreakdown(props: { chat: ActiveChatStore }) {
  const reported = () => contextUsagePercent(props.chat.contextUsage());
  const usage = () => props.chat.contextUsage();
  const categories = createMemo(() => contextBreakdown(usage()));
  const window = () => contextWindow(usage());
  const share = (tokens: number) => window() ? `${(tokens / window()! * 100).toFixed(1)}%` : "";
  const cache = () => cacheHitPercent(props.chat.sessionStats()?.tokens) ?? cacheHitPercent(usage()?.lastRequestUsage);
  const eligible = () => props.chat.cacheStats()?.eligibleHitRate ?? null;
  const cost = () => props.chat.sessionStats()?.cost || 0;
  const sessionId = () => {
    const value = (props.chat.live() as { sessionId?: unknown } | null)?.sessionId;
    return typeof value === "string" ? value : "";
  };
  return <div class="context-breakdown">
        <div class="context-breakdown-head"><strong>{reported() == null ? "Context unavailable" : `${Math.round(reported()!)}% used`}</strong>
</div>
        <Show when={contextTokens(usage()) != null}>
          <div class="context-breakdown-total">{compactTokens(contextTokens(usage())!)}{window() ? ` of ${compactTokens(window()!)} tokens` : " tokens"}{usage()?.model ? ` · ${usage()!.model}` : ""}{cost() ? ` · $${cost().toFixed(2)}` : ""}</div>
        </Show>
        <ContextBar chat={props.chat} />
        <Show when={cache() != null || eligible() != null}>
          <div class="context-breakdown-total" title="Share of input served from cache; of what the previous request already sent, how much was reused">
            <span>Cache</span><span>{[cache() != null ? `${Math.round(cache()!)}% of input` : "", eligible() != null ? `${Math.round(eligible()! * 100)}% of reusable` : ""].filter(Boolean).join(" · ")}</span>
          </div>
        </Show>
        <div class="context-breakdown-rows">
          <For each={categories()}>{(category, index) => {
            const row = <><span class="context-breakdown-dot" data-kind={category.kind} style={{ background: colourOf(category, index()) }} />
              <span class="context-breakdown-name">{category.label}<Show when={category.items?.length}> ({category.items!.length})</Show></span>
              <span class="context-breakdown-tokens">{compactTokens(category.tokens)}</span>
              <span class="context-breakdown-share">{category.kind === "deferred" ? "" : share(category.tokens)}</span></>;
            return <Show when={category.items?.length} fallback={<div class="context-breakdown-row">{row}</div>}>
              <details class="context-breakdown-group"><summary class="context-breakdown-row">{row}<ChevronRightIcon class="context-breakdown-chevron" /></summary>
                <For each={category.items}>{(item) => <div class="context-breakdown-row context-breakdown-item"><span /><span class="context-breakdown-name">{item.label}</span><span class="context-breakdown-tokens">{compactTokens(item.tokens)}</span><span class="context-breakdown-share" /></div>}</For>
              </details>
            </Show>;
          }}</For>
        </div>
        <Show when={sessionId()}><div class="context-breakdown-session"><span>Session</span><code>{sessionId()}</code></div></Show>
      </div>;
}
