# Contributing

## Issues

Open items live in `docs/plans/surfaces-roadmap.md`, not GitHub issues. For the issues still open:

- Each has exactly one type label: `type: bug` (intended behaviour is broken), `type: feature` (a bounded change
  another agent could implement without a product or design conversation) or `type: roadmap` (a capability that needs
  shaping or several Features; it stays a Roadmap once work begins, its Features as sub-issues).
- At most one readiness label when it adds information: `state: idea`, `state: shaping`, `state: ready`,
  `state: blocked`. No `in progress`, `review` or `done` labels.
- Close Bugs and Features when the implementation lands or the work is abandoned; a Roadmap when its outcome is
  delivered or abandoned, not when its first Feature starts.

## Concurrent working-tree changes

More than one agent or user may share a checkout. A dirty working tree is something to inspect, not a reason to stop.

- Inspect existing changes before editing so you know whether they overlap your task.
- Preserve unrelated changes. Do not reset, revert, discard, overwrite, or stash another worker's work to obtain a
  clean tree.
- Stage and commit only the files or hunks your task owns.
- Stop and surface the conflict only when existing changes overlap the same code so that ownership or the intended
  result is ambiguous.

A task's own plan may require a particular working-tree state; that applies only to that task.

## Commits and history

- Organise commits around one coherent change, not individual files. Keep each narrow enough to explain and review
  on its own, with a scoped, imperative subject. Conventional Commit prefixes are not required.
- For non-trivial changes, the body records the failure mode or motivation, the invariant or behaviour preserved, and
  the checks used to validate it. Tiny self-explanatory commits need no body.
- `main` history is the record; pull requests are optional review bundles, not a second source of history or
  planning.
- Run `npm test` in `conduit-web/` before tagging a release: it is the one point where the whole suite must pass.
