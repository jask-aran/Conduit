import { createMemo, createSignal, For, onMount, Show } from "solid-js";
import { Button } from "@/components/ui/controls";
import { SettingDetails, SettingGroup, SettingLine, SettingLoading, SettingNote, SettingValue } from "@/components/ui/overlay";
import { Select } from "@/components/menus";
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

/** System › Usage, read-only: tokens, dollars and tool calls per day, from the usage ledger. */
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
  const active = createMemo(() => days().filter((item) => item.replies || item.tokens).reverse());
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

  return <Show when={usage()} fallback={<Show when={error()} fallback={<SettingLoading>Loading usage…</SettingLoading>}>
    <SettingNote tone="error"><span>{error() || "Usage could not be loaded."}</span><Button variant="secondary" size="sm" onClick={() => void load()}>Retry</Button></SettingNote>
  </Show>}>
    <SettingGroup title="Total">
      <SettingLine label="Period">
        <Select id="usage-range" aria-label="Period" value={String(range())} onChange={(event) => { setRange(Number(event.currentTarget.value)); void load(); }}>
          <For each={RANGES}>{(days) => <option value={String(days)}>Last {days} days</option>}</For>
        </Select>
      </SettingLine>
      <SettingLine plain label="Spent" state={<>API-equivalent</>}><SettingValue>{money(total().cost)}</SettingValue></SettingLine>
      <SettingLine plain label="Tokens"><SettingValue>{count(total().tokens)}</SettingValue></SettingLine>
      <SettingLine plain label="Replies"><SettingValue>{count(total().replies)}</SettingValue></SettingLine>
    </SettingGroup>
    <Show when={active().length} fallback={<SettingGroup title="By day"><SettingNote>Nothing spent in this period{since() ? ` (counted since ${since()})` : ""}.</SettingNote></SettingGroup>}>
      <SettingGroup title="By day">
        <For each={active()}>{(item) =>
          <SettingLine plain label={dateLabel(item.date)} state={<>{count(item.tokens)} tokens · {item.replies} {item.replies === 1 ? "reply" : "replies"}</>}
            title={item.models.map((row) => `${modelLabel(row.key)}: ${money(row.cost)}, ${count(row.input + row.output + row.cacheRead + row.cacheWrite)} tokens`).join("\n")}>
            <SettingValue>{money(item.cost)}</SettingValue>
          </SettingLine>}
        </For>
      </SettingGroup>
      <Show when={models().length}><SettingGroup title="By model">
        <For each={models()}>{(row) =>
          <SettingLine plain label={<code>{modelLabel(row.key)}</code>} state={<>{count(row.tokens)} tokens</>}><SettingValue>{money(row.cost)}</SettingValue></SettingLine>}
        </For>
      </SettingGroup></Show>
      <Show when={tools().length}><SettingGroup title="Tool calls">
        <For each={tools()}>{([name, calls]) => <SettingLine plain label={<code>{name}</code>}><SettingValue>{count(calls)}</SettingValue></SettingLine>}</For>
      </SettingGroup></Show>
    </Show>
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
