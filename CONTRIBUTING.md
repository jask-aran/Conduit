# Contributing

Conduit tracks product and implementation work in GitHub Issues. Issues are the
source of truth; Projects and other GitHub views may organise them but should not
carry a separate planning model.

## Issue types

Every open issue should have exactly one type label:

- `type: bug` — existing intended behaviour is broken.
- `type: feature` — a bounded change that should land coherently as one
  implementation effort. A Feature may be technically substantial; size alone
  does not make it a Roadmap.
- `type: roadmap` — a durable product capability or direction that needs
  shaping or multiple independently landable Features.

A useful test is whether another competent agent can reasonably implement the
issue without first needing a product or design conversation. If yes, it is
usually a Feature. If the issue describes an outcome that still needs to be
split into implementation work, it is a Roadmap.

Roadmaps stay Roadmaps when implementation begins. Use GitHub sub-issues for the
Feature work that delivers them rather than converting the parent into a
Feature. Roadmap children should normally be Features; add another Roadmap level
only when it represents a genuinely distinct capability.

## Readiness

Readiness is separate from type. Apply at most one of these labels when it adds
useful information:

- `state: idea` — worth retaining, but not committed for implementation.
- `state: shaping` — product or architecture decisions are still being worked
  out.
- `state: ready` — implementation can begin without another product/design
  decision.
- `state: blocked` — otherwise actionable work is waiting on a dependency.

Do not add workflow labels for `in progress`, `review`, or `done`. Linked
branches and pull requests show active work, and a closed issue is done. Active
work therefore does not need a readiness label.

## Creating and maintaining issues

Before creating an issue, search for overlapping work. Prefer updating an
existing issue, or adding a Feature sub-issue under an existing Roadmap, over
creating a parallel specification.

Keep the issue at its own level of abstraction:

- Bugs record observed versus intended behaviour and useful reproduction or
  context.
- Features record the goal, bounded scope and enough acceptance criteria to
  implement safely.
- Roadmaps preserve the product outcome, durable direction and constraints and,
  when useful, an optional Implementation Sketch recording how the capability
  was imagined to work and why it appears feasible.

Roadmap `Direction and Constraints` should explicitly include `Non-goals` and
`Acceptance criteria`. Roadmap acceptance criteria describe outcome-level
completion: what must be true for the capability to count as delivered. They
should not become low-level implementation checks or per-slice tests; those
belong in the Feature issues that implement the Roadmap.

A Roadmap Implementation Sketch is non-binding design context. It may include
candidate architecture, data flow, UX, interfaces, phases, examples, and a
`Possible implementation slices` subsection when those details capture product
intent or feasibility thinking. Preserve useful specificity and visible
uncertainty rather than polishing the sketch into a premature build contract.
The whole sketch is optional.

When implementation is scheduled, create or refine bounded Feature sub-issues
against the then-current codebase. Those Features become authoritative for the
work they own. If a Feature discovers a better implementation, update the
Roadmap when the change affects the durable product intent; otherwise the
Roadmap sketch may remain as historical design context.

A Roadmap may finish with an optional `Related` section for navigation to other
Issues, Roadmaps, Features, or prior work. Treat those links as context unless a
hard dependency is stated explicitly.

Close Bugs and Features when the corresponding implementation lands or the work
is deliberately abandoned. Close a Roadmap when its intended outcome has been
delivered or deliberately abandoned, not when the first child Feature starts.

## Concurrent working-tree changes

Conduit development may involve more than one agent or user sharing a checkout.
A dirty working tree is therefore something to inspect, not by itself a reason
to stop.

- Inspect existing changes before editing so you know whether they overlap your
  task.
- Preserve unrelated changes. Do not reset, revert, discard, overwrite, or
  stash another worker's work merely to obtain a clean tree.
- Continue when existing changes are unrelated and your work can be isolated
  safely.
- Stage and commit only the files or hunks owned by your task.
- Stop and surface the conflict only when existing changes overlap the same code
  in a way that makes ownership or the intended result ambiguous.

Task-specific execution plans may deliberately require a particular recorded
working-tree state. Those stricter checks apply only to that task or handoff;
they do not establish a repository-wide clean-tree requirement for future work.

## Testing

- `npm test` — the default gate: Node unit and integration tests, about forty
  seconds. Run it for every change.
- `npm run typecheck` — for any TypeScript change.
- `npm run build` — Vite build plus bundle checks, when output size or the PWA
  artefacts could move.
- `npm run test:harness` — deterministic transport scenario emitting versioned
  JSON, for streaming, batching or reconnect work.
- `npm run test:setpieces` — optional Playwright run over a small curated set of
  browser behaviours, about two and a half minutes. Run it when navigation,
  settings, the sidebar, the workspace panel or phone chrome change.
- `npm run qa:agent-browser` — drive a real browser when a change needs to be
  seen rather than asserted.

Keep the setpieces small and green. A setpiece asserts something a reader would
notice, not a pixel constant that moves when the interface is rescaled. Fix or
delete one that fails while the app is right: a suite expected to fail is not a
gate.

## Commits and history

Keep Git history intentional and reviewable.

- Organise commits around coherent conceptual changes, not individual file
  mutations. A commit may span several related files when they jointly express
  one change; do not split it merely because each file was edited separately.
  Keep each commit narrow enough to explain and review independently, with a
  scoped, imperative subject. Conventional Commit prefixes such as `feat:` or
  `docs:` are not required; use them only when they make the subject clearer
  rather than as a taxonomy.
- For non-trivial changes, use the commit body to record the relevant failure
  mode or motivation, the important invariant or behaviour preserved, and the
  checks/evidence used to validate the change. Tiny self-explanatory commits do
  not need a body merely to satisfy a format.
- Treat sequential `main` history as the canonical implementation record. A
  natural final commit or an annotated `sprint/` tag may mark the end of a
  larger run.
- Treat pull requests as optional review bundles, not as a second source of
  project history or planning truth.

### Performance observations

When checks already run produce useful quantitative data, preserve the headline
values in the commit body. This is a recording convention, not a testing
requirement: never run extra builds or harnesses solely to populate metrics, and
omit `Metrics:` when the work produced none.

`npm run build` yields three standard bundle observations:

- `bundle.initial_js_gzip_bytes`
- `bundle.initial_css_gzip_bytes`
- `bundle.largest_lazy_js_gzip_bytes`

A harness run yields its scenario plus one to three observations relevant to the
changed boundary: first-delta latency, gap percentiles or coalescing ratio for
transport work; recovery time, socket count or duplicate characters for
reconnect work. Keep any parity observation that qualifies the result.

Use lowercase dotted names with explicit units. Record absolute observations
rather than hand-calculated deltas, and do not call a number a regression or an
improvement without a comparable baseline.

A typical non-trivial commit body may therefore end with:

```text
Checks:
- npm run typecheck
- npm test
- npm run test:harness -- --scenario streaming-burst

Metrics:
- bundle.initial_js_gzip_bytes=143281
- transport.scenario=streaming-burst
- transport.first_delta_ms=48
- transport.gap_p95_ms=18.4
```

Detailed reports remain testing evidence rather than Git-history payloads: the
commit body preserves only the observations worth comparing later.