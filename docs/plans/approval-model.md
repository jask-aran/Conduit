# Approval model

Status: decided 2026-11-03, not built. A pi-durable extension published to npm (working name `pi-durable-approver`);
Conduit is its first host. It replaces most of the ask logic in `conduit-web/src/agent/policy.js`.

## The decision

The person does not approve actions as they happen. They say what the agent may do once, up front, and a cheap
classifier model approves what is held against that, escalating to the person only for what their policy keeps for
them or what is destructive and irreversible beyond it.

- **Policy up front.** Plain-language rules, written in Settings and offered when a connector is set up (Executor):
  "may email people I have emailed before", "may move calendar events, never delete them", "never pays for
  anything". Plus a short list of classes that are always the person's.
- **Who decides that something needs approval: the tool's own gate.** Executor holds an action it gates
  (`approval-required`, a mutation); device shell, `steer_chat` and `start_chat` are held by the host's own list.
  Reads and the agent's own folder are never held. The parent model is trusted for everything not held.
- **Who approves: the classifier.** It sees the policy, the person's own words, and the held action as data. Never
  tool output, email, web pages or anything else the agent read: the parent model has read those, which is why it
  cannot judge its own actions against injection, and why the judge must not.
- **The person sees only escalations**, on their phone, with the classifier's reason on the card. Everything the
  classifier allowed is in an audit list on the agent's page, so a rule can be tightened.

Rejected: first-time approvals (approval fatigue, and the person is away); the parent model as its own judge (it
has read whatever might be steering it); no approvals at all, as pi's coding agent runs (fine with a person
watching local, reversible work; not for an unattended agent acting as the person outside).

## How it fits pi-durable

pi-durable (v1.4, MIT) takes plug-ins as extensions: `defineExtension({ name, tools, sections, hooks, wraps, tasks })`,
installed in the host's registry; conversations record extensions by name.

- `hook(ToolTask, { beforeTool(call, api, context) })`: async, before every tool call, nested ones included
  (`call.parent`, so code-mode scripts are covered). Returns `{ block: reason }` (the reason reaches the model) or
  rewritten `arguments`. `api.models` reaches pi-ai models for the classifier; `api.memo` records the verdict so a
  replay after a crash does not judge again.
- `afterTool(call, result, api, context)`: replaces a result before it is committed. Where a held action is caught
  (Executor's `approval-required`), judged, and either resumed or answered with the reason.
- A hook cannot wait for a person. The host does: the extension calls the host's `escalate`, which returns a
  pending answer the host resolves later (Conduit: an ask, a push, Allow resumes the call, as now).

## The package

```ts
createApprover({
  model: "provider/id" | ((api) => Model),        // cheap; the host's choice
  policy: () => Policy,                             // { rules: string[], always: string[], version }
  held: [executorHeld(), named(["bash", "steer_chat"])],   // what is held, beyond tools' own gates
  context: (api) => PersonWords,                    // the person's own messages and past answers, newest first
  escalate: (action, verdict) => Escalation,       // the host's ask; resolves allow | deny(reason) | pending
  audit?: (record) => void,
})
```

- **Held action** is one shape, whatever held it: `{ source, tool, action, input, reversible?, recipients? }`. An
  adapter per gate: `executorHeld()` reads `approval-required` (`invocation.tool`, `kind`, `input`) and resumes
  with its `requestId`; `named()` holds by tool name.
- **Verdict**: risk and authorisation scored apart (Codex's guardian): `{ outcome: allow | deny | escalate, risk:
  low | medium | high | critical, authorization: none | low | medium | high, reason }`, the reason one sentence. The
  outcome follows a fixed table the host can tune; critical is always escalated, whatever the authorisation.
- **Two passes** (Claude Code auto mode): a one-token pass tuned to flag, and a reasoned pass only on what it flags,
  sharing the prompt prefix so the second is mostly cache. pi-ai `complete`, temperature 0, per-attempt timeout,
  jittered retry, abort with the turn.
- **Reasoning-blind**: the judge never sees the agent's prose or tool results, only trusted intent (the person's
  messages, their saved rules and limits, their past approvals) and the exact action. A limit the person states
  ("don't email Sam") is saved as policy, not left in a transcript compaction will drop.
- **Canonical actions**: chained shell commands split, env-var prefixes stripped, before any rule matches; where it
  helps, the target's state is read first (what an `rm` would remove, who a send reaches).
- **Order**: fixed checks first (an exact-action rule the person saved; an `always` class: escalate), then the
  model. No regex shortcuts over shell text: shell goes to the model or the person.
- **Failure is never an allow**: the classifier down, malformed or timed out escalates.
- **Deny goes back to the agent** with the reason and "do not work around it; ask the person or find a safer way".
  A circuit breaker (3 in a row, or 10 of the last 50) parks the agent's work and escalates, rather than ending it.
- **A person's approval is exact and one-shot**: it allows that action once and is recorded as their authorisation,
  so the same action later scores high. "Always" saves a narrow rule the person reads, never one made broad from a
  single answer.
- **Rule of Two as a trigger** (Conduit wires it from the first build, not later): an action in a turn that has read untrusted input, touches private data and acts
  outside is escalated whatever the model says.
- **Cache allows only**, keyed on a fingerprint of the policy and model and the action's canonical form, with a TTL.
  Never denials, never escalations.
- **Policy lives where the agent cannot write it** (host storage, not the workspace); a rule change clears the cache.

## Conduit as host

- `policy`: Settings › Agent › Approvals, a rules editor and the always-mine list; Executor's setup offers starter
  rules. Stored in the agent's doc, not its folder.
- `context`: the home thread's user messages, the person's approval answers and their replies on push cards.
- `escalate`: today's ask (`agent/asks.js`), push with the verdict and reason, reminder, Allow resumes.
- `audit`: an "Allowed for you" group on the agent's page and a JSONL log under the agent's data.
- Removed from `policy.js`: the read-word lists, `connectorRead`, rule targets by tool name. Kept: the sandbox for
  the agent's own folder, private-read tainting.

## Prior art (surveyed 2026-11-03)

| Harness | Decides by | Judge sees | On deny | Escalation, failure |
|---|---|---|---|---|
| Claude Code auto mode | read-only list and rules, in-project edits, then a two-pass classifier | the person's messages and the tool payload; assistant text and tool results stripped | reason as the tool result, naming the rule | 3 in a row / 20 total fall back to a person; fails closed |
| Codex auto-review (guardian) | sandbox first; a reviewer agent for what crosses it; risk × user authorisation table | compact transcript, tool output marked untrusted evidence | rationale, "don't work around it" | 3 in a row / 10 of 50 abort the turn; `/approve` overrides one exact action; fails closed |
| Cursor auto-review | allowlist, sandbox, classifier for what cannot be sandboxed | not documented | the agent tries another way, then asks | "not a security boundary" |
| Gemini CLI | TOML policy engine; optional Conseca: a per-prompt least-privilege policy from the user's prompt, checked per call | enforcer: the policy and the call only | deny message to the model | headless ask = deny; Conseca fails open |
| Factory Droid | rules, safety checks, per-command risk against an autonomy level | the command's risk rating | block | asks above the level |
| Amp | ordered rules; `delegate` to an external program (exit code decides) | tool params | stderr to the model | leans on undo |
| Goose | rules, read-only annotation, an LLM judge on the tool's description | the description | — | cached verdicts |
| Cline / Roo / Kilo | the model labels its own commands | — | — | trusts the self-label |
| OpenCode, Copilot CLI, Windsurf, Warp, Zed | static allow / ask / deny rules | — | — | Warp CVE-2026-48721: a denylist bypassed by an env-var prefix |

Taken from it: the reasoning-blind judge (Claude Code), risk and authorisation scored apart with a circuit breaker
and exact one-shot overrides (Codex), two passes (Claude Code: false positives 8.5% → 0.4%), failing closed
everywhere (Claude Code hooks and Conseca fail open: the hole to avoid), canonicalising before matching (Zed, the
Warp CVE), never trusting the agent's own risk label (Cline), and Meta's Rule of Two as a trigger for a person.
Every vendor says its classifier is not a security boundary; here the boundary is still Executor's own gate and
what is held at all.

Sources: anthropic.com/engineering/claude-code-auto-mode; code.claude.com/docs/en/permission-modes and /hooks;
learn.chatgpt.com/docs/sandboxing/auto-review.md and /agent-approvals-security.md; github.com/openai/codex
(codex-rs/prompts/templates/guardian); cursor.com/docs/agent/security/run-modes; geminicli.com/docs/reference/
policy-engine and google-gemini/gemini-cli (packages/core/src/safety); docs.factory.com/cli/user-guides/auto-run;
ampcode.com/notes/permissions; block.github.io/goose/docs/guides/goose-permissions; docs.cline.bot/features/
auto-approve; opencode.ai/docs/permissions; docs.github.com (copilot-cli allowing-tools); zed.dev/docs/ai/
tool-permissions; nvd.nist.gov CVE-2026-48721; arXiv 2503.18813 (CaMeL), 2506.08837 (injection design patterns).

## Decided after review (2026-11-03)

- **Model**: the host's choice. Conduit passes its helper model (Settings › AI, the helper model); a cheaper default
  is a later question. (Codex runs its reviewer on its small model under its own approval-model slug.)
- **A run's task as the person's words**, by who wrote it:
  - a task the person started (Run a task, a message asking for it): trusted, as their words;
  - a routine (heartbeat, brief, a feed's run): its file is trusted only as saved, since saving a routine is itself
    approved; what it gathered (mail, feeds) never is;
  - a task the agent wrote itself (a check-back, a subagent's brief): not trusted. It is the agent's own prose, and
    an injected instruction would arrive exactly that way. Its actions are judged on the person's words alone.
- **Starter policy at Executor setup**, shown as rules the person edits before saving:
  - may: reply in a thread the person started or has replied in themselves (not one a stranger opened: any email
    puts the person "in" a thread); label, archive and mark mail; create and move events on the person's own
    calendars; draft anything;
  - always the person's: send to someone new; delete anything; pay or transfer; share a file or calendar outside;
    change account, security or forwarding settings.

## Open

Nothing blocking the build.
