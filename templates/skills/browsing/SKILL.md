---
name: browsing
description: Before operating a web page (clicking, typing, signing in, playing something) or showing the person a browser - which of the two browsers to use, how to work the hub's, how to show it in their Conduit, and when their own browser may be used.
load: auto
nudge:
  - codemode: browser
  - conduit_browser
  - conduit_ui
---

# Browsing

A web search or `fetch_content` reads pages. A browser operates them. Use a
browser when the page has to be clicked, typed into, scrolled or watched.

## Two browsers

| | The hub's browser | The person's own browser |
|---|---|---|
| What it is | A browser on the hub, yours to use | Their real Chrome, signed in as them |
| Tools | `codemode`, the `browser` namespace (`agent_browser_*`) | `conduit_browser` |
| Permission | None | Asks them, each thread |
| Use it | By default, for everything | Only when they ask for their own browser, or the job needs their sign-in |

If they say no to their own browser, that stands for the thread. Carry on in
the hub's browser and do not ask again unless they bring it up themselves; the
tool then takes `again: true`.

"Open X", "go to X", "play X" with no browser named means the hub's.

## Working the hub's browser

Inside `codemode`:

1. `tools.agent_browser_open({ url })` opens a page.
2. `tools.agent_browser_snapshot({ interactive: true })` lists what can be
   acted on. Each element has a ref such as `@e3`.
3. Act by ref: `agent_browser_click({ selector: "@e3" })`,
   `agent_browser_fill({ selector: "@e3", text })`,
   `agent_browser_press({ key: "Enter" })`.
4. Snapshot again. A ref goes stale when the page changes.

`describeNamespace("browser")` lists every tool with its arguments. Never
guess a tool's name.

Each action's result ends with where the browser now is. That is the address,
not proof the action worked: a fill or a key press can do nothing. Before
saying something worked, look (a snapshot, `agent_browser_get_text`). If a
control did nothing, go another way: the page's own URL for that state (a
search results address, a video's address), another control, a keyboard key.

Sites often show a signed-out browser less (no recommendations, a consent
wall). That is a reason to search within the site or open an address
directly, not to stop.

## Showing it to the person

The hub's browser is shared: the person sees it in a Browser pane, live.

- Show it with `conduit_ui`: `{ action: "open", view: "browser:hub", beside: true }`.
  It goes to the Conduit they are talking to you from. No `look` or `screens`
  first, and no `client`.
- Show it when they asked you to browse for them, or to see something. Do not
  open panes for work they did not ask to watch.
- Once. The pane follows the page; opening it again per step only redraws it.
  If a result says the person is not seeing the browser, that is your cue.
- `look` is for when you need to know what they have open; `client` only to
  reach a Conduit other than the one they are talking from.

## Choices

Pick, do not ask, where a choice is small ("play a video": choose one and say
which). Ask only when it costs them something to get it wrong: a purchase, a
message sent as them, a setting changed.
