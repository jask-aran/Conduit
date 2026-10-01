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
  "system-prompt": "oklch(0.7 0.02 260)", tools: "oklch(0.74 0.12 230)",
  instructions: "oklch(0.78 0.14 75)", other: "oklch(0.75 0.15 30)",
};
/** When a plan window resets: the time today, else the weekday. */
const resetText = (iso: string) => {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "";
  return at.getTime() - Date.now() < 86_400_000
    ? at.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : at.toLocaleDateString([], { weekday: "short" });
};
const SPARES = ["oklch(0.72 0.16 350)", "oklch(0.8 0.12 95)", "oklch(0.7 0.13 150)", "oklch(0.7 0.1 50)"];
const colourOf = (category: ContextCategory, index: number) => category.kind === "free" ? "transparent"
  : category.kind === "buffer" ? "color-mix(in oklch, var(--muted-foreground), transparent 55%)"
  : CATEGORY_COLOURS[category.id] ?? SPARES[index % SPARES.length];

/* A live readout of how much room the next message has, so it sits with the
   composer's other "what will this send cost" controls rather than in the
   header, which holds identity and one-shot verbs.

   Hovering previews it; a click holds it open, so the session ID can be
   selected and copied, and a tap is how touch opens it at all. */
export function ContextGauge(props: { chat: ActiveChatStore; compact?: boolean; canCompact?: boolean }) {
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

  const [held, setHeld] = createSignal(false);
  let trigger: HTMLButtonElement | undefined;
  const close = () => setHeld(false);

  createEffect(on(held, (open) => { if (open) props.chat.refreshContext(); }, { defer: true }));
  return <Popover open={held()} onOpenChange={(open) => { if (!open) close(); }} anchorRef={() => trigger} placement="top-end">
    <button ref={trigger} type="button" class="chat-context-trigger" data-state={tone()} aria-label={`Context usage: ${Math.round(percent())}%`}
      aria-expanded={held()} onClick={() => { if (held()) close(); else setHeld(true); }}>
      <svg class="chat-context-gauge" viewBox="0 0 24 24" aria-hidden="true">
        <circle class="chat-context-gauge-track" cx="12" cy="12" r="9" pathLength="100" />
        <circle class="chat-context-gauge-value" cx="12" cy="12" r="9" pathLength="100" style={`stroke-dasharray: ${percent() || 0} 100`} />
      </svg>
      <Show when={!props.compact}><span class="chat-context-percent">{Math.round(percent())}%</span></Show>
    </button>
    <PopoverContent class="chat-context-menu" aria-label="Context usage"
      onOpenAutoFocus={(event) => event.preventDefault()} onCloseAutoFocus={(event) => event.preventDefault()}
      onPointerDownOutside={(event) => { if (trigger?.contains(event.target as Node)) event.preventDefault(); }}>
      <ContextBreakdown chat={props.chat} canCompact={props.canCompact} />
    </PopoverContent>
  </Popover>;
}

/** The window as one bar of its parts, in their colours, and where it compacts. */
export function ContextBar(props: { chat: ActiveChatStore }) {
  const usage = () => props.chat.contextUsage();
  const inWindow = () => contextBreakdown(usage()).filter((category) => category.kind !== "deferred");
  const threshold = () => {
    const at = usage()?.compactAt;
    const window = contextWindow(usage());
    return at && window ? Math.min(100, (at / window) * 100) : null;
  };
  return <Show when={contextWindow(usage()) && inWindow().length}>
    <div class="context-breakdown-meter" data-threshold={threshold() != null || undefined}>
      <div class="context-breakdown-bar" aria-hidden="true">
        <For each={inWindow()}>{(category, index) => <span style={{ "flex-grow": category.tokens, background: colourOf(category, index()) }} />}</For>
      </div>
      <Show when={threshold()}>{(at) => <>
        <i class="context-breakdown-threshold" style={{ left: `${at()}%` }} />
        <small class="context-breakdown-threshold-label" style={{ left: `${at()}%` }}>compacts at {Math.round(at())}%</small>
      </>}</Show>
    </div>
  </Show>;
}

/** What fills the window: the total, the bar, and each part with its share. */
export function ContextBreakdown(props: { chat: ActiveChatStore; bare?: boolean; canCompact?: boolean }) {
  const reported = () => contextUsagePercent(props.chat.contextUsage());
  const usage = () => props.chat.contextUsage();
  const categories = createMemo(() => contextBreakdown(usage()));
  const window = () => contextWindow(usage());
  const share = (tokens: number) => window() ? `${(tokens / window()! * 100).toFixed(1)}%` : "";
  const cache = () => cacheHitPercent(props.chat.sessionStats()?.tokens) ?? cacheHitPercent(usage()?.lastRequestUsage);
  // A session that has never read or written the cache is not a run of misses:
  // the provider (or a router switching models per request) never cached.
  const uncached = () => {
    const totals = props.chat.sessionStats()?.tokens ?? usage()?.lastRequestUsage;
    return totals != null && !totals.cacheRead && !totals.cacheWrite;
  };
  const eligible = () => props.chat.cacheStats()?.eligibleHitRate ?? null;
  const cost = () => props.chat.sessionStats()?.cost || 0;
  const sessionId = () => {
    const value = (props.chat.live() as { sessionId?: unknown } | null)?.sessionId;
    return typeof value === "string" ? value : "";
  };
  const model = () => usage()?.model?.split("/").pop() || "";
  // A window whose reset has passed is a stale reading (history's last word), not today's.
  const plan = () => {
    const windows = usage()?.plan?.windows?.filter((window) => !window.resetsAt || Date.parse(window.resetsAt) > Date.now()) || [];
    return windows.length ? { ...usage()!.plan!, windows } : null;
  };
  const compactions = () => usage()?.compactions || 0;
  const busy = () => props.chat.compacting() || props.chat.generation() === "active";
  const [loading, setLoading] = createSignal(false);
  const [failed, setFailed] = createSignal(false);
  const load = () => {
    setLoading(true); setFailed(false);
    props.chat.loadBreakdown().catch(() => setFailed(true)).finally(() => setLoading(false));
  };
  const [copied, setCopied] = createSignal(false);
  const copySession = () => void navigator.clipboard?.writeText(sessionId()).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1200); });
  /* Built from the model menu's parts: the slider's header for each section,
     its track for the bar, the model rows for the categories. */
  return <div class="context-breakdown">
    <div class="step-slider context-breakdown-section">
      <Show when={!props.bare}><div class="step-slider-header"><label>Context</label>
        <span class="step-slider-value">{reported() == null ? "Unavailable" : `${Math.round(reported()!)}% used`}</span></div></Show>
      <ContextBar chat={props.chat} />
      <Show when={contextTokens(usage()) != null}>
        <div class="context-breakdown-total"><span>{compactTokens(contextTokens(usage())!)}{window() ? ` of ${compactTokens(window()!)}` : ""} tokens</span>
          <Show when={cost()}><span>${cost().toFixed(2)}</span></Show></div>
      </Show>
    </div>
    <Show when={categories().length}>
      <div class="context-breakdown-separator" />
      <Show when={usage()?.breakdown === "loadable" && !usage()?.categories?.length}>
        <button type="button" class="menu-row context-breakdown-load" disabled={loading()} onClick={load}>
          <span>{loading() ? "Asking Claude Code…" : failed() ? "Could not load the breakdown" : "Load breakdown"}</span>
          <small>starts Claude Code</small>
        </button>
      </Show>
      <div class="context-breakdown-rows">
        <For each={categories()}>{(category, index) => {
          const cells = <><i class="context-breakdown-dot" data-kind={category.kind} style={{ background: colourOf(category, index()) }} />
            <span>{category.label}<Show when={category.items?.length}> ({category.items!.length})</Show></span>
            <small>{compactTokens(category.tokens)}</small>
            <small class="context-breakdown-share">{category.kind === "deferred" ? "" : share(category.tokens)}</small></>;
          return <Show when={category.items?.length} fallback={<div class="menu-row composer-model-option context-breakdown-row">{cells}</div>}>
            <details class="context-breakdown-group"><summary class="menu-row composer-model-option context-breakdown-row">{cells}<ChevronRightIcon class="context-breakdown-chevron" /></summary>
              <For each={category.items}>{(item) => <div class="menu-row composer-model-option context-breakdown-row context-breakdown-item"><i class="context-breakdown-dot" /><span>{item.label}</span><small>{compactTokens(item.tokens)}</small><small class="context-breakdown-share" /></div>}</For>
            </details>
          </Show>;
        }}</For>
      </div>
    </Show>
    <Show when={cache() != null || eligible() != null}>
      <div class="context-breakdown-separator" />
      <div class="step-slider context-breakdown-section" title="Share of input served from cache; of what the previous request already sent, how much was reused">
        <div class="step-slider-header"><label>Cache</label>
          <span class="step-slider-value">{uncached() ? "No reads yet" : cache() != null ? `${Math.round(cache()!)}% of input` : `${Math.round(eligible()! * 100)}% reused`}</span></div>
        <Show when={!uncached() && cache() != null && eligible() != null}>
          <div class="context-breakdown-total"><span>Of what could be reused</span><span>{Math.round(eligible()! * 100)}%</span></div>
        </Show>
      </div>
    </Show>
    <Show when={plan()}>{(current) => <>
      <div class="context-breakdown-separator" />
      <div class="step-slider context-breakdown-section">
        <div class="step-slider-header"><label>Plan{current().name ? ` · ${current().name}` : ""}</label>
          <span class="step-slider-value">{Math.round(Math.max(...current().windows.map((window) => window.usedPercent)))}% used</span></div>
        <For each={current().windows}>{(window) => <div class="context-breakdown-total">
          <span>{window.label}</span><span>{Math.round(window.usedPercent)}%<Show when={window.resetsAt}> · resets {resetText(window.resetsAt!)}</Show></span>
        </div>}</For>
      </div>
    </>}</Show>
    <div class="context-breakdown-separator" />
    <button type="button" class="menu-row context-breakdown-load" disabled={!props.canCompact || busy()} onClick={() => void props.chat.compact()}
      title={props.canCompact ? "Summarise the conversation so far to free the window" : "This harness cannot be asked to compact"}>
      <span>{props.chat.compacting() ? "Compacting…" : "Compact now"}</span>
      <small>{compactions() ? `${compactions()} so far` : props.canCompact ? "" : "not supported"}</small>
    </button>
    <Show when={model() || sessionId()}>
      <div class="context-breakdown-separator" />
      <div class="context-breakdown-footer">
        <span>{model()}</span>
        <Show when={sessionId()}><button type="button" class="composer-menu-shortcut context-breakdown-session" title={`Copy session ID ${sessionId()}`} onClick={copySession}>
          {copied() ? "Copied" : `${sessionId().slice(0, 6)}…${sessionId().slice(-4)}`}</button></Show>
      </div>
    </Show>
  </div>;
}
