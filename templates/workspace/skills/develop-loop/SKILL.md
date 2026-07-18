---
name: develop-loop
description: Inspect, implement, test, and report inside one Conduit workspace chat. Load for feature work, bug fixes, and refactors.
---

# Develop loop

Stay in this chat. Do not hand work off to an external agent.

## Loop

1. **Orient** — identify package manager, test command, and relevant paths (`ls`, `rg`, `read`).
2. **Inspect** — read the code paths you will change; summarize briefly.
3. **Implement** — focused edits; avoid drive-by refactors.
4. **Verify** — run the project's tests or targeted checks; fix failures you introduced.
5. **Report** — what changed, how you verified, and any follow-ups.

## Commands

Discover project scripts from `package.json`, `pyproject.toml`, `Makefile`, or README. Prefer the repository's documented test entrypoints.

## Continuity

If the browser disconnects, keep working until the task is done or blocked. Write durable progress into the transcript, not only ephemeral shell state.
