# Contributing

## Open work

Open work lives in `docs/plans/surfaces-roadmap.md`, not GitHub issues.

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

How to choose and run a check is in `docs/TESTING.md`.

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
- Treat sequential `main` history as the canonical implementation record.
- Treat pull requests as optional review bundles, not as a second source of
  project history or planning truth.
- Run `npm test` in `conduit-web/` before tagging a commit as a release. A
  release is the one point where the whole suite has to have passed, because
  the surgical seam chosen for a change is sometimes the wrong one, and a tag
  is what publishes that mistake.

### Performance observations

When checks already run produce useful quantitative data, preserve the headline
values in the commit body. This is a recording convention, not a testing
requirement: never run extra builds or probes solely to populate metrics, and
omit `Metrics:` when the work produced none.

`npm run build` yields three standard bundle observations:

- `bundle.initial_js_gzip_bytes`
- `bundle.initial_css_gzip_bytes`
- `bundle.largest_lazy_js_gzip_bytes`

Use lowercase dotted names with explicit units. Record absolute observations
rather than hand-calculated deltas, and do not call a number a regression or an
improvement without a comparable baseline.

A typical non-trivial commit body may therefore end with:

```text
Checks:
- npm run typecheck
- node --test test/live-session-stream.test.js

Metrics:
- bundle.initial_js_gzip_bytes=143281
```

Detailed reports remain testing evidence rather than Git-history payloads: the
commit body preserves only the observations worth comparing later.