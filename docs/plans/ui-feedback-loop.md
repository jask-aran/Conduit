# Idea: mark up the live UI and send it to the coding agent (2026-11-11)

Priority: very high (the user's words: "super high priority"). Nothing is started. This file is the whole brief.

## What the user wants

A tool inside Conduit's own interface for giving feedback on that interface, sent straight to a coding agent
(a Claude Code session working on Conduit). It replaces the loop the user liked on 2026-11-10: a claude.ai design
canvas built from Conduit's real v2 markup, where they left comments on elements and the agent revised them. They
want the same loop "with actually just the ui directly, its all a webview anyway".

In their words, it should have:

- "a super slick component select tool which locks onto individual components or groups or whatever"
- "drawing tools and selection tools"
- "package screenshots"
- "tell the server to mark when it happened to record server side info" (so the hub can attach what it knew at
  that moment)
- "attach my comments"
- It "would permanently live in the tool rail + shortcut on desktop dev clients".

## Open design question (the user has not decided)

How the feedback reaches the agent. Their options: "a feedback file placed into the server folder (and so on dev
you can see it immediately)", "an MCP that a claude code session can listen to", "hooks", or "a combination of
both". Propose one and say why; do not ask them to choose between unexplained options.

## References

- https://x.com/steveruizok/status/2112279637342749133 : Steve Ruiz (tldraw), seen as a screenshot the user pasted
  (the page itself would not fetch). The post: "This dialog creates issues. If the issue is from me personally, an
  agent picks up the issue automatically and lands the code. My goal is to spend more time submitting issues and
  approving issues from users." The picture: inside the running app (tldraw notes, a staging build), a small "Send
  feedback" dialog: one text area holding an instruction written as a change request ("Add a 'Create another'
  tickbox to the footer of the Send feedback component..."), an "Include screenshot" switch (on), Cancel and Send.
  So the reference is: feedback written in the product, about the product, becomes an issue; the owner's own
  issues are picked up by an agent without another step. The user wants that loop plus element selection and
  drawing, which the dialog in the picture does not show.
- https://ampcode.com/news/close-the-loop (6 Nov 2026, read): Amp's feedback widget. One script on the site; the
  widget appears with `?amp`; click any part of the page, write an instruction, "New Comment" adds more, "Send"
  sends all; Amp starts a new thread in the project with the comments and makes the change. The page says nothing
  about a file, MCP server, extension or hook, and makes no open-source statement (the user asked whether it is
  OSS: not as far as that page says; docs at https://ampcode.com/docs/feedback-widget were not read).

## What exists in Conduit to build on (verify each before relying on it)

- Every v2 library piece draws a `ui-*` class (`conduit-web/src/components/ui/`), so an element under the pointer
  can be resolved to a named component by walking up to the nearest `ui-*` root.
- The hub already serves an MCP endpoint (`/v0/mcp`, `server/mcp-endpoint.js`) with `conduit_ui`,
  `conduit_inbox`, `conduit_browser`; Settings › Integrations shows its entry for other harnesses. A Claude Code
  session can already be connected to it.
- New global shortcuts go in the command registry / Settings › Shortcuts, not the Ctrl+G leader.
- The tool rail is in `components/ui/pane.tsx` and `client/workspace/workspace-rail.tsx`.
- Dev clients only: `installedClientKind` and the `-dev` build string tell a dev client apart.

## Rules that apply

Read `AGENTS.md`, `DESIGN.md`, `CONTRIBUTING.md` and `docs/TESTING.md` first. UI is built only from v2 library
pieces and tokens; a missing piece is added to the library first. Change and test on conduit-local only; do not
push (pushing `main` deploys conduit-dev). Commit each finished piece with explicit paths; another session may be
committing in the same checkout.
