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
