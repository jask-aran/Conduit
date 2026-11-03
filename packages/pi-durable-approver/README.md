# pi-durable-approver

An approval model for pi-durable. Holders decide what is held. A classifier
that cannot see the agent's reasoning judges each held action against the
person's standing policy. The host escalates the rest to the person.

Plain ESM JavaScript, with hand-written types and no build step. Requires
Node.js 22 or later.

## Install

```sh
npm install pi-durable-approver @earendil-works/pi-durable@^1.4.0 @earendil-works/pi-ai
```

## Host integration

```js
import { createRegistry } from "@earendil-works/pi-durable";
import { createApprover, executorHolder, namedHolder } from "pi-durable-approver";
import { jsonlAudit } from "./node_modules/pi-durable-approver/src/audit.js";

// Host-provided values:
// tools: installed ToolRegistration objects, including Executor resume.
// helperModel: a pi-ai Model; dir: the host's audit directory.
// personPolicy: { version, may: string[], always: string[], limits?: string[] }.
// personWords: { messages: [{ text }], answers?: [...], task?: string }.
// requestApproval: async host UI handler, returning an Escalation.
const registry = createRegistry();
const model = () => helperModel;
const policy = () => personPolicy;
const words = () => personWords;
const tool = (name) => tools.find((entry) => entry.name === name);
const escalate = (held, verdict, api, context) =>
  requestApproval(held, verdict, api, context);

const approver = createApprover({
  model, policy, words,
  holders: [executorHolder(), namedHolder(["bash"])],
  tool, escalate, audit: jsonlAudit(dir),
});
registry.install(approver.extension(tools));
```

The package exports only its root entry point. `jsonlAudit` is an internal
helper; the relative import above assumes this file is at the project root
and a physical `node_modules` installation. A host can instead supply its own
`audit(record)` callback. It must return void.

`model`, `policy`, and `words` are callbacks. Keep policy in host storage that
the agent cannot write. Supply only words the person wrote; exclude tasks the
agent wrote. `tool(name)` returns the installed tool registration used to
resume an allowed action. `escalate` returns `{ status: "allowed" }`,
`{ status: "denied", message }`, or `{ status: "pending", message }`.
A pending answer tells the agent to wait; the host handles the later answer.

Executor's holder reads `approval-required` results from its `call` and
`execute` tools. It resumes an allowed request with the exact request id.
It also holds agent-originated `resume` calls. The named holder holds a
listed tool before execution, optionally narrowed with `when(call)`.
Install the extension for every tool a holder can hold, including resume.

## Verdict and default table

A verdict contains `outcome` (`allow`, `deny`, or `escalate`), `risk`
(`low`, `medium`, `high`, or `critical`), `authorization` (`none`, `low`,
`medium`, or `high`), a one-sentence `reason`, and `source`.
Risk and authorization are separate judgments.

The default table allows low risk at any authorization, medium risk at
medium or high authorization, and high risk only at high authorization.
Critical risk always escalates, including with a custom table. Import
`DEFAULT_TABLE` for the full outcome mapping; pass `table` to customize it.

The judge receives the standing policy, the person's own messages, their
past approval answers, their task, and the canonical held action as data.
It never receives the agent's reasoning or prose, raw tool results, mail,
or web pages. Action arguments remain untrusted data, never instructions.

Failure is never an allow. A failed, malformed, or timed-out classifier
answer escalates. Each classifier attempt has a 20-second timeout by
default, with two retries and full-jitter exponential backoff. Turn aborts
stop retries. The host must preserve the hold until approval is resolved.

## Breaker, cache, and audit

The in-memory breaker tracks each conversation separately. Three denials in
a row, or ten of the last fifty records, trip it. The host must ask the
person rather than let the agent keep trying to bypass a denial.

The allow-only cache has a 30-minute TTL and a 500-entry LRU limit by default.
Only low- and medium-risk allows qualify. Denials, escalations, and high- or
critical-risk allows are never cached. Cache keys must include policy and
model identity as well as the canonical action; policy changes invalidate
cached approval. `actionKey(held)` hashes only tool, action, and input with
SHA-256, so it is not a complete policy-aware cache key by itself.

`jsonlAudit(dir)` queues one JSON record per line in UTC daily files named
`approvals-YYYY-MM-DD.jsonl`. On first use it prunes matching files older
than 30 days by default. Audit errors produce warnings and never throw.
The internal `readAudit(dir, { limit: 50 })` reads newest files and lines
first and skips malformed lines. Audit records can contain private action
inputs; the host controls access to the directory.

## Not a security boundary

This classifier is not a security boundary. It can misjudge an action.
Tool gates, host permissions, sandboxing, and the choice of what holders
hold remain essential. Tools outside the installed wraps are not judged.
The optional host `untrusted` callback supports the Rule of Two trigger:
untrusted input plus private data plus an outside action requires escalation.
