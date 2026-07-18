---
name: git-github
description: Use git and the GitHub CLI for status, branches, commits, PRs, and issues in the current workspace. Load when the user asks about version control, remotes, pull requests, or GitHub.
---

# Git and GitHub

Work only inside the current Conduit workspace (`cwd`). Prefer non-destructive inspection first.

## Inspect

```bash
git status -sb
git remote -v
git branch -vv
git log --oneline -20
gh repo view
gh pr list
gh issue list
```

## Change safely

1. Confirm the branch and dirty state before editing or committing.
2. Prefer small, focused commits with clear messages.
3. Never force-push or rewrite shared history unless the user explicitly asks.
4. Use `gh pr create` / `gh pr view` / `gh pr checks` for pull-request workflows when `gh` is authenticated.

## Reporting

Summarize branch, dirty files, and PR/check status in plain language for the web chat. Paste only the command output that matters.
