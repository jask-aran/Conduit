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

When checks already run for a change produce useful quantitative performance
data, preserve relevant headline values in the commit body. This is a recording
convention, not a testing requirement: do not run additional builds, harnesses,
or benchmarks solely to populate commit metrics, and omit `Metrics:` entirely
when the work produced no useful measurements.

When `npm run build` has already been run, record its three standard bundle
observations:

- `bundle.initial_js_gzip_bytes`
- `bundle.initial_css_gzip_bytes`
- `bundle.largest_lazy_js_gzip_bytes`

When a performance harness has already been run, record the scenario or flow
that produced the measurement plus one to three headline observations relevant
to the changed boundary. Prefer metrics that remain useful as project history:

- transport work: first-delta latency, gap percentiles, coalescing ratio or
  throughput;
- rendering work: frame-gap percentiles, long-task count, DOM mutations or
  visible-text cadence;
- reconnect work: recovery time, socket count or duplicate characters;
- live/deployed-path work: first-visible-delta latency, gap percentiles or large
  gap counts, with target/model/scenario context;
- terminal work: the relevant headline values emitted by the terminal
  performance test when it was already run.

When a harness also emits a correctness or parity observation that materially
qualifies the performance result, retain it alongside the headline metrics—for
example final-text parity or zero duplicate characters after reconnect.

Use lowercase dotted names and explicit units where practical, for example
`browser.frame_gap_p95_ms`, `transport.coalescing_ratio` or
`reconnect.recovery_ms`. Record absolute observations rather than manually
calculated percentage deltas; a later history tool can derive comparable deltas
from Git. Do not treat a metric as evidence of a regression or improvement
without a comparable scenario or baseline.

A typical non-trivial commit body may therefore end with:

```text
Checks:
- npm run typecheck
- npm run build
- npm run test:harness:browser -- --scenario browser-burst ...

Metrics:
- bundle.initial_js_gzip_bytes=143281
- bundle.initial_css_gzip_bytes=38142
- bundle.largest_lazy_js_gzip_bytes=247901
- browser.scenario=browser-burst
- browser.frame_gap_p95_ms=18.4
- browser.long_tasks=0
```

Detailed reports remain testing evidence rather than Git-history payloads. The
commit body should preserve only the observations worth comparing later.