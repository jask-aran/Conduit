# pi-durable-approver

An approval model for pi-durable. Holders decide what is held. A classifier
that cannot see the agent's reasoning judges each held action against the
person's standing policy. The host escalates the rest to the person.

Plain ESM JavaScript with hand-written types (`index.d.ts`); no build step.

## Install

```sh
npm install pi-durable-approver @earendil-works/pi-durable@^1.4.0 @earendil-works/pi-ai
```

## Host integration

```js
import { createRegistry } from "@earendil-works/pi-durable";
import { createApprover, executorHolder, namedHolder, jsonlAudit } from "pi-durable-approver";

const registry = createRegistry();
const approver = createApprover({
  model: () => helperModel,          // a pi-ai Model
  policy: () => personPolicy,        // { version, may: string[], always: string[], limits?: string[] }
  words: () => personWords,          // { messages: [{ text }], answers?: [...], task?: string }
  holders: [executorHolder(), namedHolder(["bash"])],
  tool: (name) => tools.find((entry) => entry.name === name),
  escalate: (held, verdict, api, context) => requestApproval(held, verdict, api, context),
  audit: jsonlAudit(dir),
});
registry.install(approver.extension(tools));
```

What the host must do:

- Keep the policy in storage the agent cannot write, and pass only words the person wrote, never a task the agent wrote.
- Install the extension for every tool a holder can hold, including Executor's `resume`.
- `escalate` returns `{ status: "allowed" }`, `{ status: "denied", message }` or `{ status: "pending", message }`;
  pending tells the agent to wait, and the host keeps the hold until the person answers.
- `actionKey(held)` hashes only the action; a cache key also needs the policy and model identity.
- Audit records can hold private action inputs; the host controls access to the audit directory.

A failed, malformed or timed-out classifier answer escalates: failure is never an allow.

## Not a security boundary

The classifier can misjudge an action. Tool gates, host permissions, sandboxing
and the choice of what holders hold remain essential; tools outside the
installed wraps are not judged.
