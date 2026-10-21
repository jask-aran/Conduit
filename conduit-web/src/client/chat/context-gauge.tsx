import { Button, Gauge, Item, Meter, Reading, ReadingFoot, ReadingPart, ReadingParts, ReadingStat, ReadingStats, ReadingTotal, Section } from "@/components/ui";
import { ShrinkIcon } from "lucide-solid";
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
    <PopoverContent width="lg" unfolds aria-label="Context usage"
      onOpenAutoFocus={(event) => event.preventDefault()} onCloseAutoFocus={(event) => event.preventDefault()}
      onPointerDownOutside={(event) => { if (trigger?.contains(event.target as Node)) event.preventDefault(); }}>
      <ContextBreakdown chat={props.chat} canCompact={props.canCompact} />
    </PopoverContent>
  </Popover>;
}

/** Where the window compacts, as a share of it. */
const compactShare = (usage: ReturnType<ActiveChatStore["contextUsage"]>) => {
  const at = usage?.compactAt;
  const window = contextWindow(usage);
  return at && window ? Math.min(100, (at / window) * 100) : null;
};

/** The window as one bar of its parts, in their colours, and where it compacts (named in the reading's totals). */
export function ContextBar(props: { chat: ActiveChatStore }) {
  const usage = () => props.chat.contextUsage();
  const inWindow = () => contextBreakdown(usage()).filter((category) => category.kind !== "deferred");
  const threshold = () => compactShare(usage());
  return <Show when={contextWindow(usage()) && inWindow().length}>
    <Meter parts={inWindow().map((category, index) => ({ value: category.tokens, colour: colourOf(category, index) ?? "transparent" }))}
      mark={threshold() != null ? { at: threshold()!, label: `compacts at ${Math.round(threshold()!)}%`, quiet: true } : undefined} />
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
  const threshold = () => compactShare(usage());
  // The figures beside the parts: the cache, then each of the plan's windows.
  const stats = () => {
    const out: { label: string; value: string; detail?: string }[] = [];
    if (uncached()) out.push({ label: "Cache", value: "—", detail: "no reads yet" });
    else if (cache() != null) out.push({ label: "Cache", value: `${Math.round(cache()!)}%`, detail: eligible() != null ? `${Math.round(eligible()! * 100)}% reusable` : "of input" });
    else if (eligible() != null) out.push({ label: "Cache", value: `${Math.round(eligible()! * 100)}%`, detail: "reused" });
    for (const window of plan()?.windows ?? []) out.push({ label: window.label, value: `${Math.round(window.usedPercent)}%`, detail: window.resetsAt ? `resets ${resetText(window.resetsAt)}` : undefined });
    return out;
  };
  const foot = () => [model(), plan()?.name].filter(Boolean).join(" · ");
  return <Reading>
    <Show when={!props.bare}>
      <ReadingTotal label={<strong>Context</strong>} value={reported() == null ? "Unavailable" : `${Math.round(reported()!)}% used`} />
      <ContextBar chat={props.chat} />
    </Show>
    <Show when={contextTokens(usage()) != null}>
      <ReadingTotal label={`${compactTokens(contextTokens(usage())!)}${window() ? ` of ${compactTokens(window()!)}` : ""}${threshold() != null ? ` · compacts at ${Math.round(threshold()!)}%` : ""}`}
        value={cost() ? `$${cost().toFixed(2)}` : undefined} />
    </Show>
    <Show when={categories().length || usage()?.breakdown === "loadable"}>
      <ReadingParts label="What fills the window">
        <Show when={usage()?.breakdown === "loadable" && !usage()?.categories?.length}>
          <ReadingPart {...act(load, loading())} hollow label={loading() ? "Asking Claude Code…" : failed() ? "Could not load the breakdown" : "Load breakdown"} value="starts Claude Code" />
        </Show>
        <For each={categories()}>{(category, index) => {
          const value = () => `${compactTokens(category.tokens)}${category.kind === "deferred" ? "" : ` · ${share(category.tokens)}`}`;
          const label = <>{category.label}<Show when={category.items?.length}> ({category.items!.length})</Show></>;
          return <Show when={category.items?.length} fallback={<ReadingPart colour={colourOf(category, index())} hollow={hollow(category)} label={label} value={value()} />}>
            <ReadingPart {...act(() => setOpened(opened() === category.id ? null : category.id))} opens expanded={opened() === category.id}
              colour={colourOf(category, index())} hollow={hollow(category)} label={label} value={value()} />
            <Show when={opened() === category.id}>
              <For each={category.items}>{(item) => <ReadingPart sub label={item.label} value={compactTokens(item.tokens)} />}</For>
            </Show>
          </Show>;
        }}</For>
      </ReadingParts>
    </Show>
    <Show when={stats().length}>
      <ReadingStats label="Cache and plan"><For each={stats()}>{(stat) => <ReadingStat label={stat.label} value={stat.value} detail={stat.detail} />}</For></ReadingStats>
    </Show>
    <Section>
      <Item {...act(() => void props.chat.compact(), !props.canCompact || busy())} icon={<ShrinkIcon />} disabled={!props.canCompact || busy()}
        title={props.canCompact ? "Summarise the conversation so far to free the window" : "This harness cannot be asked to compact"}
        meta={compactions() ? `${compactions()} so far` : props.canCompact ? undefined : "not supported"}>{props.chat.compacting() ? "Compacting…" : "Compact now"}</Item>
    </Section>
    <Show when={foot() || sessionId()}>
      <ReadingFoot action={<Show when={sessionId()}><Button variant="ghost" size="sm" title={`Copy session ID ${sessionId()}`} onClick={copySession}>{copied() ? "Copied" : `${sessionId().slice(0, 6)}…${sessionId().slice(-4)}`}</Button></Show>}>{foot()}</ReadingFoot>
    </Show>
  </Reading>;
}
