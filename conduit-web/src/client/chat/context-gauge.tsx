import { Button, Gauge, Item, Meter, Readout, Section, Swatch } from "@/components/ui";
import { Popover, PopoverContent } from "@/components/menus";
import { createEffect, createMemo, createSignal, For, on, Show } from "solid-js";
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
const hollow = (category: ContextCategory) => category.kind === "free" || category.kind === "deferred";
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

  const [held, setHeld] = createSignal(false);
  let trigger: HTMLButtonElement | undefined;
  const close = () => setHeld(false);

  createEffect(on(held, (open) => { if (open) props.chat.refreshContext(); }, { defer: true }));
  return <Popover open={held()} onOpenChange={(open) => { if (!open) close(); }} anchorRef={() => trigger} placement="top-end">
    <Button ref={trigger} variant="ghost" size={props.compact ? "icon-sm" : "sm"} aria-label={`Context usage: ${Math.round(percent())}%`}
      aria-expanded={held()} onClick={() => { if (held()) close(); else setHeld(true); }}>
      <Gauge value={percent()} tone={tone()} />
      <Show when={!props.compact}>{Math.round(percent())}%</Show>
    </Button>
    <PopoverContent wide aria-label="Context usage"
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
    <Meter parts={inWindow().map((category, index) => ({ value: category.tokens, colour: colourOf(category, index) ?? "transparent" }))}
      mark={threshold() != null ? { at: threshold()!, label: `compacts at ${Math.round(threshold()!)}%` } : undefined} />
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
  // A row that does something: a keyboard reaches it and Enter or Space runs it, as a button.
  const act = (run: () => void, disabled?: boolean) => ({ role: "button" as const, tabIndex: disabled ? -1 : 0, onClick: () => { if (!disabled) run(); },
    onKeyDown: (event: KeyboardEvent) => { if (!disabled && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); run(); } } });
  const [opened, setOpened] = createSignal<string | null>(null);
  return <div>
    <Section title={props.bare ? undefined : "Context"} note={props.bare ? undefined : reported() == null ? "Unavailable" : `${Math.round(reported()!)}% used`}>
      <ContextBar chat={props.chat} />
      <Show when={contextTokens(usage()) != null}>
        <Readout label={`${compactTokens(contextTokens(usage())!)}${window() ? ` of ${compactTokens(window()!)}` : ""} tokens`} value={cost() ? `$${cost().toFixed(2)}` : undefined} />
      </Show>
    </Section>
    <Show when={categories().length}>
      <Section>
        <Show when={usage()?.breakdown === "loadable" && !usage()?.categories?.length}>
          <Item {...act(load, loading())} disabled={loading()} meta="starts Claude Code">{loading() ? "Asking Claude Code…" : failed() ? "Could not load the breakdown" : "Load breakdown"}</Item>
        </Show>
        <For each={categories()}>{(category, index) => {
          const value = () => `${compactTokens(category.tokens)}${category.kind === "deferred" ? "" : ` · ${share(category.tokens)}`}`;
          const label = <>{category.label}<Show when={category.items?.length}> ({category.items!.length})</Show></>;
          const swatch = <Swatch colour={colourOf(category, index())} hollow={hollow(category)} />;
          return <Show when={category.items?.length} fallback={<Item icon={swatch} meta={value()}>{label}</Item>}>
            <Item {...act(() => setOpened(opened() === category.id ? null : category.id))} aria-expanded={opened() === category.id} icon={swatch} meta={value()} opens>{label}</Item>
            <Show when={opened() === category.id}>
              <For each={category.items}>{(item) => <Item icon={<Swatch hollow />} meta={compactTokens(item.tokens)}>{item.label}</Item>}</For>
            </Show>
          </Show>;
        }}</For>
      </Section>
    </Show>
    <Show when={cache() != null || eligible() != null}>
      <Section title="Cache" note={uncached() ? "No reads yet" : cache() != null ? `${Math.round(cache()!)}% of input` : `${Math.round(eligible()! * 100)}% reused`}>
        <Show when={!uncached() && cache() != null && eligible() != null}><Readout label="Of what could be reused" value={`${Math.round(eligible()! * 100)}%`} /></Show>
      </Section>
    </Show>
    <Show when={plan()}>{(current) => <Section title={`Plan${current().name ? ` · ${current().name}` : ""}`} note={`${Math.round(Math.max(...current().windows.map((window) => window.usedPercent)))}% used`}>
      <For each={current().windows}>{(window) => <Readout label={window.label} value={<>{Math.round(window.usedPercent)}%<Show when={window.resetsAt}> · resets {resetText(window.resetsAt!)}</Show></>} />}</For>
    </Section>}</Show>
    <Section>
      <Item {...act(() => void props.chat.compact(), !props.canCompact || busy())} disabled={!props.canCompact || busy()} title={props.canCompact ? "Summarise the conversation so far to free the window" : "This harness cannot be asked to compact"}
        meta={compactions() ? `${compactions()} so far` : props.canCompact ? undefined : "not supported"}>{props.chat.compacting() ? "Compacting…" : "Compact now"}</Item>
    </Section>
    <Show when={model() || sessionId()}>
      <Section>
        <Item meta={<Show when={sessionId()}><Button variant="ghost" size="sm" title={`Copy session ID ${sessionId()}`} onClick={copySession}>{copied() ? "Copied" : `${sessionId().slice(0, 6)}…${sessionId().slice(-4)}`}</Button></Show>}>{model()}</Item>
      </Section>
    </Show>
  </div>;
}
