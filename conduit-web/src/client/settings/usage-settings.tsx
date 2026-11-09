import { createMemo, createSignal, For, onMount, Show } from "solid-js";
import { Button, Segmented, Series, SettingDetails, SettingLine, SettingValue, SettingWide, Group, Loading, Note } from "@/components/ui";
import { api } from "../api/client";
import { agentName } from "../state/agent";
/** The persistent agent's name, as the person called it. */
const agent = agentName;

/** A day of GET /v0/usage: Conduit's agents' spend, in API-equivalent dollars fixed when spent (usage-ledger.js). */
type ModelSpend = { key: string; input: number; output: number; cacheRead: number; cacheWrite: number; cost: number };
type UsageDay = { date: string; replies: number; tools: Record<string, number>; models: ModelSpend[]; cost: number; tokens: number };
type Usage = { since: string | null; days: UsageDay[] };
/** GET /v0/diagnostics/usage: how the hub manages context and approvals, content-free (diagnostics/usage-report.js). */
type Diagnostics = {
  window: { hours: number };
  requests: { total: number; byModel: { model: string; requests: number; cachedShare: number; misses: number; survivedMinutes?: number | null; lapsedMinutes?: number | null }[];
    afterGap: { fromMinutes: number; toMinutes: number | null; requests: number; misses: number }[];
    misses: { at: string; role: string; model: string; gapMinutes: number | null; why: string }[];
    causes?: Record<string, { misses: number; tokens: number }> };
  changes?: { toolSets: { added: number; addedTokens: number; addedTools: number; full: number; fullTokens: number; fullTools: number };
    system: { count: number; tokens: number } };
  keepWarm?: { policy: { model: string; pings: number; ttlMs: number | null; intervalMs: number | null; ttlSource: "declared" | "observed" | "assumed" | null;
      gaps: number; reason: string | null } | null;
    pings: number; pingHits: number; pingCost: number; lapses: number; keptHits: number; keptMisses: number; coldHits: number; coldMisses: number; saved: number; net: number };
  context?: { at: string; instructions: number; tools: number; toolSets: number; toolSetTokens: number; conversation: number; byTool: { name: string; tokens: number }[] } | null;
  skills?: { skill: string; loads: number; began: number; beganLoaded: number }[];
  approvals: { judged: number; outcomes: { allow?: number; deny?: number; escalate?: number }; sources: Record<string, number>;
    askedYou: number; fromRuns: number; waiting: number; judgeMs: { median: number; max: number } | null;
    judgeCost: number; perDecision: number | null; jbotCost: number; jbotRequests: number; share: number | null;
    byAction: { action: string; allow?: number; deny?: number; escalate?: number }[] };
};
// Conduit's own test providers (fixtures for probes) are not usage worth reading.
const real = (report: Diagnostics) => report.requests.byModel.filter((row) => !row.model.startsWith("conduit-test/"));
const percent = (value: number | null | undefined) => value == null ? "—" : `${(value * 100).toFixed(value < 0.1 ? 1 : 0)}%`;
const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`;
const lifetime = (row: { survivedMinutes?: number | null; lapsedMinutes?: number | null }) =>
  `${row.survivedMinutes != null ? ` · lived ${Math.round(row.survivedMinutes)} min` : ""}${row.lapsedMinutes != null ? ` · lost by ${Math.round(row.lapsedMinutes)} min` : ""}`;
const minutes = (ms: number | null) => ms == null ? "—" : `${Math.round(ms / 60_000)} min`;
const roleOf = (role: string) => ({ "jbot-home": `${agent()}'s thread`, "jbot-run": `a ${agent()} run`, chat: "a chat" } as Record<string, string>)[role];
const WHY = { provider: "provider dropped it", changed: "Conduit changed the prompt", head: "Conduit changed the instructions",
  tools: "Conduit changed a tool declaration", system: "Conduit changed a system message", history: "the history was rewritten",
  unlogged: "not logged", "before-log": "before the prefix log began" } as Record<string, string>;

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
  // How context and approvals went over the same period (at most 30 days: the report reads the runtime's own records).
  const [diagnostics, setDiagnostics] = createSignal<Diagnostics | null>(null);
  const loadDiagnostics = () => api<Diagnostics>(`/v0/diagnostics/usage?hours=${Math.min(720, range() * 24)}`).then(setDiagnostics).catch(() => setDiagnostics(null));
  onMount(() => { void load(); void loadDiagnostics(); });
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

  return <Show when={usage()} fallback={<Show when={error()} fallback={<Loading>Loading usage…</Loading>}>
    <Note tone="error"><span>{error() || "Usage could not be loaded."}</span><Button variant="secondary" size="sm" onClick={() => void load()}>Retry</Button></Note>
  </Show>}>
    <Group title="Spend">
      <SettingLine plain label="Period">
        <Segmented label="Period" size="sm" value={String(range())} options={RANGES.map((days) => ({ value: String(days), label: `${days} days` }))}
          onChange={(value) => { setRange(Number(value)); void load(); void loadDiagnostics(); }} />
      </SettingLine>
      <SettingLine plain label="Spent" state="API-equivalent" title="Each call priced when it was made, at its model's API list price; kept as dollars, so later price changes never move a past day.">
        <SettingValue mono>{money(total().cost)}</SettingValue>
      </SettingLine>
      <SettingWide><Series label={`Spend per day, last ${range()} days: ${money(total().cost)}`} points={series()} ends={[series()[0]?.label || "", "Today"]} /></SettingWide>
      <SettingLine plain label="Tokens"><SettingValue mono>{count(total().tokens)}</SettingValue></SettingLine>
      <SettingLine plain label="Replies"><SettingValue mono>{count(total().replies)}</SettingValue></SettingLine>
      <Show when={!total().replies && !total().tokens}><Note>Nothing spent in this period{since() ? `; counting began ${since()}` : ""}.</Note></Show>
    </Group>
    <Show when={models().length}><Group title="By model">
      <For each={models()}>{(row) =>
        <SettingLine plain mono label={modelLabel(row.key)} state={`${count(row.tokens)} tokens`}><SettingValue mono>{money(row.cost)}</SettingValue></SettingLine>}
      </For>
    </Group></Show>
    <Show when={tools().length}><Group title="Tool calls">
      <For each={tools()}>{([name, calls]) => <SettingLine plain mono label={name}><SettingValue mono>{count(calls)}</SettingValue></SettingLine>}</For>
    </Group></Show>
    <Show when={diagnostics()}>{(report) => <>
      <Group title="Prompt cache">
        <SettingLine plain label="Requests" state={report().window.hours < range() * 24 ? `last ${Math.round(report().window.hours / 24)} days` : undefined}>
          <SettingValue mono>{count(real(report()).reduce((sum, row) => sum + row.requests, 0))}</SettingValue>
        </SettingLine>
        <For each={real(report())}>{(row) =>
          <SettingLine plain mono label={row.model} state={`${count(row.requests)} ${row.requests === 1 ? "request" : "requests"} · ${row.misses} ${row.misses === 1 ? "miss" : "misses"}${lifetime(row)}`}
            title="Cached: the share of each request's input read from the provider's cache. A miss re-sent most of a prefix the last request had cached. Lived: the longest pause the provider's cache survived; lost: the shortest it did not.">
            <SettingValue mono>{percent(row.cachedShare)} cached</SettingValue>
          </SettingLine>}
        </For>
        <Show when={Object.keys(report().requests.causes || {}).length}>
          <SettingDetails summary="Misses by cause">
            <For each={Object.entries(report().requests.causes || {}).sort((a, b) => b[1].tokens - a[1].tokens)}>{([why, row]) =>
              <SettingLine plain label={WHY[why] || why} state={`${row.misses} ${row.misses === 1 ? "miss" : "misses"}`}
                title="Prompt tokens these misses sent again without the cache.">
                <SettingValue mono>{count(row.tokens)} tokens</SettingValue>
              </SettingLine>}
            </For>
          </SettingDetails>
        </Show>
        <Show when={report().changes}>{(changes) =>
          <SettingDetails summary="Mid-conversation changes">
            <SettingLine plain label="Tools added" state={`${changes().toolSets.addedTools} tools`}
              title="Tool declarations pi-durable appended with only what was new: the cache before them holds.">
              <SettingValue mono>{changes().toolSets.added} · {count(changes().toolSets.addedTokens)} tokens</SettingValue>
            </SettingLine>
            <SettingLine plain label="Whole tool set again" state={`${changes().toolSets.fullTools} tools`}
              title="pi-durable declared every tool again: the tool order changed or a tool's definition did. Conduit keeps one append-only order so this stays rare.">
              <SettingValue mono>{changes().toolSets.full} · {count(changes().toolSets.fullTokens)} tokens</SettingValue>
            </SettingLine>
            <SettingLine plain label="System messages" title="Section updates and notices appended as system messages.">
              <SettingValue mono>{changes().system.count} · {count(changes().system.tokens)} tokens</SettingValue>
            </SettingLine>
          </SettingDetails>}
        </Show>
        <Show when={report().requests.afterGap.length}>
          <SettingDetails summary="Misses after a pause">
            <For each={report().requests.afterGap}>{(gap) =>
              <SettingLine plain label={`${gap.fromMinutes}–${gap.toMinutes ?? "∞"} min`}><SettingValue mono>{gap.misses} of {gap.requests}</SettingValue></SettingLine>}
            </For>
          </SettingDetails>
        </Show>
        <Show when={report().requests.misses.length}>
          <SettingDetails summary={`Each miss (${report().requests.misses.length})`}>
            <For each={report().requests.misses.slice(-20).reverse()}>{(miss) =>
              <SettingLine plain label={new Date(miss.at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                state={`${roleOf(miss.role) || miss.role} · ${miss.model}${miss.gapMinutes != null ? ` · after ${Math.round(miss.gapMinutes)} min` : ""}`}>
                <SettingValue>{WHY[miss.why] || miss.why}</SettingValue>
              </SettingLine>}
            </For>
          </SettingDetails>
        </Show>
      </Group>
      <Show when={report().context}>{(context) =>
        <Group title={`${agent()}'s context`}>
          <SettingLine plain label="Instructions" state="the system prompt, about 4 characters a token"
            title={`What ${agent()}'s home thread sent with its last request, measured from the copy kept for keep-warm.`}>
            <SettingValue mono>{count(context().instructions)} tokens</SettingValue>
          </SettingLine>
          <SettingLine plain label="Tool definitions" state={`${context().byTool.length} tools${context().toolSets > 1 ? ` · sent ${context().toolSets} times in the thread, ${count(context().toolSetTokens)} tokens` : ""}`}
            title="A change to the tool list sends the whole set again into the conversation.">
            <SettingValue mono>{count(context().tools)} tokens</SettingValue>
          </SettingLine>
          <SettingLine plain label="Conversation"><SettingValue mono>{count(context().conversation)} tokens</SettingValue></SettingLine>
          <SettingDetails summary="Each tool">
            <For each={context().byTool}>{(tool) => <SettingLine plain mono label={tool.name}><SettingValue mono>{count(tool.tokens)}</SettingValue></SettingLine>}</For>
          </SettingDetails>
        </Group>}
      </Show>
      <Show when={report().skills?.length}>
        <Group title="Skills">
          <For each={report().skills}>{(row) =>
            <SettingLine plain mono label={row.skill} state={`loaded ${row.loads} ${row.loads === 1 ? "time" : "times"}`}
              title="Of the conversations that began this skill's kind of work (its nudge calls), how many had loaded the skill first; the others were nudged.">
              <SettingValue mono>{row.began ? `${row.beganLoaded} of ${row.began} loaded first` : "—"}</SettingValue>
            </SettingLine>}
          </For>
        </Group>
      </Show>
      <Show when={report().keepWarm}>{(warm) =>
        <Group title="Keep warm">
          <Show when={warm().policy}>{(policy) =>
            <SettingLine plain label="Policy" state={`${policy().model} · cache ${minutes(policy().ttlMs)} (${policy().ttlSource || "unknown"}) · from ${policy().gaps} past gaps`}
              title={`After each request on ${agent()}'s home thread, its last request is sent again at 90% of the cache's lifetime, read from cache, up to this many times: the count that would have cost least over the thread's past gaps.`}>
              <SettingValue mono>{policy().pings ? `${policy().pings} × ${minutes(policy().intervalMs)}` : policy().reason || "off"}</SettingValue>
            </SettingLine>}
          </Show>
          <SettingLine plain label="Pings" state={`${warm().pingHits} found the cache`}><SettingValue mono>{count(warm().pings)}</SettingValue></SettingLine>
          <SettingLine plain label="Wakes after a lapse" state={`kept warm: ${warm().keptHits} hit, ${warm().keptMisses} missed · not: ${warm().coldHits} hit, ${warm().coldMisses} missed`}
            title="Requests on the home thread after a gap longer than the cache's lifetime: whether a ping came in between, and whether the cache was there.">
            <SettingValue mono>{count(warm().lapses)}</SettingValue>
          </SettingLine>
          <SettingLine plain label="Cost" state={`saved ${money(warm().saved)}`} title={`What the pings cost (also in ${agent()}'s spend), and what the wakes they kept warm did not pay for a full read.`}>
            <SettingValue mono>{money(warm().pingCost)}</SettingValue>
          </SettingLine>
          <SettingLine plain label="Net"><SettingValue mono>{warm().net < 0 ? `−${money(-warm().net)}` : money(warm().net)}</SettingValue></SettingLine>
        </Group>}
      </Show>
      <Group title="Approvals">
        <SettingLine plain label="Held for approval" title="Actions a tool's own gate held (an Executor send or change) and the approval model judged.">
          <SettingValue mono>{count(report().approvals.judged)}</SettingValue>
        </SettingLine>
        <SettingLine plain label="Decided for you" state={`${report().approvals.outcomes.allow || 0} allowed · ${report().approvals.outcomes.deny || 0} refused`}>
          <SettingValue mono>{count((report().approvals.outcomes.allow || 0) + (report().approvals.outcomes.deny || 0))}</SettingValue>
        </SettingLine>
        <SettingLine plain label="Asked you" state={`${report().approvals.fromRuns} from runs${report().approvals.waiting ? ` · ${report().approvals.waiting} waiting` : ""}`}
          title="Approvals put to you: what the approval model could not allow, and anything held without it.">
          <SettingValue mono>{count(report().approvals.askedYou)}</SettingValue>
        </SettingLine>
        <Show when={report().approvals.judgeMs}>{(ms) =>
          <SettingLine plain label="Time to decide" state={`slowest ${seconds(ms().max)}`}><SettingValue mono>{seconds(ms().median)}</SettingValue></SettingLine>}
        </Show>
        <SettingLine plain label="Cost" state={report().approvals.perDecision != null ? `${money(report().approvals.perDecision!)} a decision` : undefined}
          title={`What the approval model spent, priced as ${agent()}'s own requests are. It is also inside ${agent()}'s spend.`}>
          <SettingValue mono>{money(report().approvals.judgeCost)}</SettingValue>
        </SettingLine>
        <SettingLine plain label={`Next to ${agent()}`} state={`${agent()}: ${money(report().approvals.jbotCost)} over ${count(report().approvals.jbotRequests)} requests`}>
          <SettingValue mono>{report().approvals.share == null || !report().approvals.judged ? "—" : `+${percent(report().approvals.share)}`}</SettingValue>
        </SettingLine>
        <Show when={report().approvals.byAction.length}>
          <SettingDetails summary="By action">
            <For each={report().approvals.byAction}>{(row) =>
              <SettingLine plain mono label={row.action}><SettingValue>{[row.allow && `${row.allow} allowed`, row.deny && `${row.deny} refused`, row.escalate && `${row.escalate} asked`].filter(Boolean).join(" · ")}</SettingValue></SettingLine>}
            </For>
          </SettingDetails>
        </Show>
      </Group>
    </>}</Show>
    <Group title="About these numbers">
      <SettingDetails summary="How spend is counted">
        <Note>Each call is priced when it is made, at its model's API list price (subscriptions such as ChatGPT or Copilot at
          the API's price for the same model), and that dollar amount is kept: later price changes do not move past days.
          Free tiers and flat token plans count as $0.</Note>
        <Note>Counted: Conduit's own agents, their subagents, compaction summaries and failed attempts. Not counted: chats in other
          harnesses (Codex, Claude Code, ChatGPT Web).{since() ? ` Counting began ${since()}.` : ""}</Note>
      </SettingDetails>
    </Group>
  </Show>;
}
