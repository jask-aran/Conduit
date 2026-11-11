# Idea (bonus): a release loop that runs by itself, drawn as its state machine (2026-11-11)

Nothing is started; the user filed this as a "bonus" beside the UI feedback idea
(`idea-ui-feedback-loop-2026-11-11.md`) with no words of their own, so what they want from it is not stated: ask
before building. This records what the reference shows.

## The reference

https://x.com/steveruizok/status/2111926712229372076 : Steve Ruiz (tldraw), seen as a screenshot the user pasted
(the page would not fetch). The post: "this has been working for like a month and I've had to restart it maybe
twice". The picture is a page titled "Release loop" with a "View log" button, a status line ("Landing fix ·
huppy/release-fix-... for <commit>"), and a diagram of states with the current one outlined:

- Waiting for new commits (between ticks) -> on "new commit on main" -> Gate (`pnpm check`)
- Gate green -> TestFlight build (internal build) -> "released to internal TestFlight" -> back to Waiting
- Gate red, or "build or tests failed" -> Fixer agent (opens a PR) -> Land fix (CI + runner gate) -> "merged ·
  main moved" -> back to Gate
- Land fix "needs review or red", a time-out, or "stalled or infra failure" -> Needs a person (loop paused) ->
  "clear-attention" -> back to Waiting
- Waiting -> "promote · manual" -> Production promotion (manual) -> "verified" -> back to Waiting

Under the diagram: "Active work" with a "Restart loop" button, and "Release state".

## Why it is next to the feedback idea (my reading, not the user's words)

Together the two posts are one pipeline: feedback written in the app becomes an issue, an agent lands it, and a
standing loop gates, builds, fixes its own failures and stops for a person only when it must. For Conduit the
nearest existing pieces are jbot's routines and work log, the VPS hubs (conduit-dev follows `main`; conduit-prod
only proves the release pipeline) and the release process in `docs/DEPLOYMENT.md`.
