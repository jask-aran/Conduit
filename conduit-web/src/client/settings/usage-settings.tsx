import { createMemo, createSignal, For, onMount, Show } from "solid-js";
import { Button, Segmented, Series, SettingDetails, SettingGroup, SettingLine, SettingLoading, SettingNote, SettingValue, SettingWide } from "@/components/ui";
import { api } from "../api/client";

/** A day of GET /v0/usage: Conduit's agents' spend, in API-equivalent dollars fixed when spent (usage-ledger.js). */
type ModelSpend = { key: string; input: number; output: number; cacheRead: number; cacheWrite: number; cost: number };
type UsageDay = { date: string; replies: number; tools: Record<string, number>; models: ModelSpend[]; cost: number; tokens: number };
type Usage = { since: string | null; days: UsageDay[] };

const RANGES = [7, 30, 90] as const;
const money = (value: number) => value === 0 ? "$0" : value < 0.01 ? "<$0.01" : `$${value.toFixed(2)}`;
const count = (value: number) => value >= 1e6 ? `${(value / 1e6).toFixed(1)}M` : value >= 1e3 ? `${(value / 1e3).toFixed(1)}k` : String(value);
const dateLabel = (date: string) => new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
const modelLabel = (key: string) => key.startsWith("tool:") ? `${key.slice(5)} (tool)` : key;

/** System › Usage, read-only: dollars per day as a Series, then tokens, replies, by model and tool calls, from the usage ledger. */
export function UsageSettings() {
  const [range, setRange] = createSignal<number>(30);
  const [usage, setUsage] = createSignal<Usage | null>(null);
  const [error, setError] = createSignal("");
  const load = () => {
    setError("");
    return api<Usage>(`/v0/usage?days=${range()}`).then(setUsage).catch((failure) => setError(failure instanceof Error ? failure.message : String(failure)));
  };
  onMount(() => void load());
  const days = createMemo(() => usage()?.days || []);
  const total = createMemo(() => days().reduce((sum, item) => ({ cost: sum.cost + item.cost, tokens: sum.tokens + item.tokens, replies: sum.replies + item.replies }), { cost: 0, tokens: 0, replies: 0 }));
  const models = createMemo(() => {
    const byKey = new Map<string, { cost: number; tokens: number }>();
    for (const item of days()) for (const row of item.models) {
      const was = byKey.get(row.key) || { cost: 0, tokens: 0 };
      byKey.set(row.key, { cost: was.cost + row.cost, tokens: was.tokens + row.input + row.output + row.cacheRead + row.cacheWrite });
    }
    return [...byKey].map(([key, value]) => ({ key, ...value })).sort((a, b) => b.cost - a.cost || b.tokens - a.tokens);
  });
  const tools = createMemo(() => {
    const byName = new Map<string, number>();
    for (const item of days()) for (const [name, calls] of Object.entries(item.tools)) byName.set(name, (byName.get(name) || 0) + calls);
    return [...byName].sort((a, b) => b[1] - a[1]);
  });
  const since = () => usage()?.since ? new Date(usage()!.since!).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : null;

  const series = createMemo(() => days().map((item, index) => ({ label: dateLabel(item.date), value: item.cost, current: index === days().length - 1,
    title: `${dateLabel(item.date)}: ${money(item.cost)} · ${count(item.tokens)} tokens · ${item.replies} ${item.replies === 1 ? "reply" : "replies"}` })));

  return <Show when={usage()} fallback={<Show when={error()} fallback={<SettingLoading>Loading usage…</SettingLoading>}>
    <SettingNote tone="error"><span>{error() || "Usage could not be loaded."}</span><Button variant="secondary" size="sm" onClick={() => void load()}>Retry</Button></SettingNote>
  </Show>}>
    <SettingGroup title="Spend">
      <SettingLine plain label="Period">
        <Segmented label="Period" size="sm" value={String(range())} options={RANGES.map((days) => ({ value: String(days), label: `${days} days` }))}
          onChange={(value) => { setRange(Number(value)); void load(); }} />
      </SettingLine>
      <SettingLine plain label="Spent" state="API-equivalent" title="Each call priced when it was made, at its model's API list price; kept as dollars, so later price changes never move a past day.">
        <SettingValue mono>{money(total().cost)}</SettingValue>
      </SettingLine>
      <SettingWide><Series label={`Spend per day, last ${range()} days: ${money(total().cost)}`} points={series()} ends={[series()[0]?.label || "", "Today"]} /></SettingWide>
      <SettingLine plain label="Tokens"><SettingValue mono>{count(total().tokens)}</SettingValue></SettingLine>
      <SettingLine plain label="Replies"><SettingValue mono>{count(total().replies)}</SettingValue></SettingLine>
      <Show when={!total().replies && !total().tokens}><SettingNote>Nothing spent in this period{since() ? `; counting began ${since()}` : ""}.</SettingNote></Show>
    </SettingGroup>
    <Show when={models().length}><SettingGroup title="By model">
      <For each={models()}>{(row) =>
        <SettingLine plain mono label={modelLabel(row.key)} state={`${count(row.tokens)} tokens`}><SettingValue mono>{money(row.cost)}</SettingValue></SettingLine>}
      </For>
    </SettingGroup></Show>
    <Show when={tools().length}><SettingGroup title="Tool calls">
      <For each={tools()}>{([name, calls]) => <SettingLine plain mono label={name}><SettingValue mono>{count(calls)}</SettingValue></SettingLine>}</For>
    </SettingGroup></Show>
    <SettingGroup title="About these numbers">
      <SettingDetails summary="How spend is counted">
        <SettingNote>Each call is priced when it is made, at its model's API list price (subscriptions such as ChatGPT or Copilot at
          the API's price for the same model), and that dollar amount is kept: later price changes do not move past days.
          Free tiers and flat token plans count as $0.</SettingNote>
        <SettingNote>Counted: Conduit's own agents, their subagents, compaction summaries and failed attempts. Not counted: chats in other
          harnesses (Codex, Claude Code, ChatGPT Web).{since() ? ` Counting began ${since()}.` : ""}</SettingNote>
      </SettingDetails>
    </SettingGroup>
  </Show>;
}
