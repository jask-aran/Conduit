---
name: web-research
description: Fetch public web pages and API docs with curl for research. Load when the user needs documentation, changelogs, or public HTTP resources.
---

# Web research

Use the shell for careful, read-only HTTP access. Do not send secrets in URLs or logs.

## Fetch text

```bash
curl -fsSL --max-time 30 -A "ConduitWorkspace/1.0" "$URL" | head -c 200000
```

## Fetch JSON APIs

```bash
curl -fsSL --max-time 30 -H "Accept: application/json" "$URL"
```

## GitHub raw / docs

Prefer permalinks into specific commits or tags when citing code. For GitHub content, `gh api` is often better than scraping HTML.

## Ground rules

- Prefer official docs and repository sources over random blogs.
- Quote short excerpts; summarize the rest.
- If a host blocks bots or requires auth, stop and explain rather than inventing content.
