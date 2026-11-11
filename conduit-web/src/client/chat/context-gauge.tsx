import { createFlash } from "@/components/ui/motion";
import { Button, Gauge, Meter, Reading, ReadingFoot, ReadingPart, ReadingParts, ReadingStat, ReadingStats, ReadingTotal } from "@/components/ui";
import { ShrinkIcon } from "lucide-solid";
import { Popover, PopoverContent } from "@/components/ui/menus";
import { createEffect, createMemo, createSignal, For, on, Show } from "solid-js";
import type { ActiveChatStore } from "../state/active-chat";
import type { ContextCategory } from "../api/contracts";
import { cacheHitPercent, compactTokens, contextBreakdown, contextTokens, contextUsagePercent, contextWindow } from "./context-metrics";

const CATEGORY_COLOURS: Record<string, string> = {
  messages: "var(--category-1)", used: "var(--category-1)",
  "system-prompt": "var(--category-2)", tools: "var(--category-3)",
  instructions: "var(--category-4)", other: "var(--category-5)",
};
const resetText = (iso: string) => {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "";
  return at.getTime() - Date.now() < 86_400_000
    ? at.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : at.toLocaleDateString([], { weekday: "short" });
};
const SPARES = ["var(--category-6)", "var(--category-7)", "var(--category-8)", "var(--category-9)"];
const hollow = (category: ContextCategory) => category.kind === "free" || category.kind === "deferred";
const colourOf = (category: ContextCategory, index: number) => category.kind === "free" ? "transparent"
  : category.kind === "buffer" ? "color-mix(in oklch, var(--muted-foreground), transparent 55%)"
  : CATEGORY_COLOURS[category.id] ?? SPARES[index % SPARES.length];

export function ContextGauge(props: { chat: ActiveChatStore; compact?: boolean; canCompact?: boolean }) {
  /* An adaptor that reports no context usage still gets a gauge at 0%, greyed, rather than a hole in the row that
     moves the controls beside it. */
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

const compactShare = (usage: ReturnType<ActiveChatStore["contextUsage"]>) => {
  const at = usage?.compactAt;
  const window = contextWindow(usage);
  return at && window ? Math.min(100, (at / window) * 100) : null;
};

export function ContextBar(props: { chat: ActiveChatStore }) {
  const usage = () => props.chat.contextUsage();
  const inWindow = () => contextBreakdown(usage()).filter((category) => category.kind !== "deferred");
  const threshold = () => compactShare(usage());
  return <Show when={contextWindow(usage()) && inWindow().length}>
    <Meter parts={inWindow().map((category, index) => ({ value: category.tokens, colour: colourOf(category, index) ?? "transparent" }))}
      mark={threshold() != null ? { at: threshold()!, label: `compacts at ${Math.round(threshold()!)}%`, quiet: true } : undefined} />
  </Show>;
}

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
  const { on: copied, flash: flashCopied } = createFlash();
  const copySession = () => void navigator.clipboard?.writeText(sessionId()).then(flashCopied);
  const act = (run: () => void, disabled?: boolean) => ({ role: "button" as const, tabIndex: disabled ? -1 : 0, onClick: () => { if (!disabled) run(); },
    onKeyDown: (event: KeyboardEvent) => { if (!disabled && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); run(); } } });
  const [opened, setOpened] = createSignal<string | null>(null);
  const threshold = () => compactShare(usage());
  const cacheLine = () => uncached() ? null
    : cache() != null ? { label: eligible() != null ? `Cache hits · ${Math.round(eligible()! * 100)}% of what could be reused` : "Cache hits, of input", value: `${Math.round(cache()!)}%` }
    : eligible() != null ? { label: "Cache, of what could be reused", value: `${Math.round(eligible()! * 100)}%` } : null;
  const foot = () => model();
  return <Reading>
    <Show when={!props.bare}>
      <ReadingTotal label={<strong>Context</strong>} value={reported() == null ? "Unavailable" : `${Math.round(reported()!)}% used`} />
      <ContextBar chat={props.chat} />
    </Show>
    <Show when={contextTokens(usage()) != null}>
      <ReadingTotal label={`${compactTokens(contextTokens(usage())!)}${window() ? ` of ${compactTokens(window()!)}` : ""} tokens`}
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
    <Show when={cacheLine()}>{(line) => <ReadingTotal label={line().label} value={line().value} />}</Show>
    <ReadingFoot action={<Button variant="ghost" outline size="sm" disabled={!props.canCompact || busy()} onClick={() => void props.chat.compact()}
      title={props.canCompact ? "Summarise the conversation so far to free the window" : "This harness cannot be asked to compact"}>
      <ShrinkIcon />{props.chat.compacting() ? "Compacting…" : "Compact now"}</Button>}>
      {[threshold() != null ? `Compacts at ${Math.round(threshold()!)}%` : null, compactions() ? `${compactions()} so far` : null, props.canCompact ? null : "not supported here"].filter(Boolean).join(" · ")}
    </ReadingFoot>
    {/* The gauge has no Details beside it: the model and session are named here. */}
    <Show when={!props.bare && (foot() || sessionId())}>
      <ReadingFoot action={<Show when={sessionId()}><Button variant="ghost" size="sm" title={`Copy session ID ${sessionId()}`} onClick={copySession}>{copied() ? "Copied" : `${sessionId().slice(0, 6)}…${sessionId().slice(-4)}`}</Button></Show>}>{foot()}</ReadingFoot>
    </Show>
    <Show when={plan()}>{(current) =>
      <ReadingStats title={`Plan${current().name ? ` · ${current().name}` : ""}`}>
        <For each={current().windows}>{(window) => <ReadingStat label={window.label} value={`${Math.round(window.usedPercent)}%`} detail={window.resetsAt ? `resets ${resetText(window.resetsAt)}` : undefined} />}</For>
      </ReadingStats>}
    </Show>
  </Reading>;
}
