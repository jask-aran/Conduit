# Screens and device control (2026-11-10)

Any client can see and drive what any device has, through the hub; agents (a chat's, jbot) can do the same, and can put
what they are working on in front of the person on the client they are talking from. Agreed 2026-11-10. This widens
`distributed-nodes-and-execution.md`'s vision ("rather than crude screen mirroring"): agents first, screens when
watching or taking over helps.

## Names

- **Client**: one open Conduit tab or app, `connection/tab` (`UiControl`, `server/ui-control.js`).
- **Device**: a machine on the network, the hub's own among them. It has one or more **environments** (Windows and a
  WSL distro are two of one machine); the code's word for an environment is a node (`nodes/`), and agents name one
  by its device's name, with its own when the device has several (`environmentName`).
- **Capability**: something an environment can do for the network (`DEVICE_CAPABILITIES`, `device-api.js`): share
  folders, run harnesses, be browsed, offer its browser, give a terminal.
- **Screen**: something on a device that has a picture, takes input and can be acted on. Its view id is
  `<kind>:<device>`, as `browser:hub` is today.
- **Origin**: the client a turn's message was sent from.

## What exists

- `UiControl` and the `conduit_ui` tool: each client reports its panes; `look`, `open`, `close`, `focus`.
- Conduit over MCP (`server/mcp-endpoint.js`): `conduit_ui` and `conduit_inbox` for other harnesses.
- `browser:hub` (`server/browser-host.js`): the hub's Chrome, its picture in a `WebScreen` pane, agents through
  agent-browser's own tools.
- `DeviceTools` (`devices`): files and shell on any device, picked per call.
- The node tunnel (`nodes/remote-tunnel.js`: `tunnelTo`, `fetchOnDevice`): the hub reaching a loopback service on a device.

## Gaps

1. A turn does not record its origin; `conduit_ui` aims at "the tab in use", a hub-wide guess from focus.
2. The MCP endpoint is stateless behind one token, so a call does not know its chat.
3. A client and a device are not linked: a client's `machine` is shown, never trusted.
4. `conduit_ui` is wired twice: an extension of Conduit's own agents and a tool of the MCP endpoint.

## Decisions

1. **One MCP server.** Conduit's tools for agents (its UI, the inbox, screens as they come) are defined once, in the
   `conduit` MCP server. Other harnesses reach it over Streamable HTTP; Conduit's own agents mount the same server
   in-process. No tool of this kind is defined anywhere else.
   What the UI can be told to do is declared once (`conduit-web/src/ui-api.js`): each action and each view says
   whether an agent may use it, and `conduit_ui` is built from those that do. The client's handlers and its view
   kinds are typed by the same declaration, so either side changing alone fails the typecheck. A screen kind is added
   there.
2. **Calls know their chat.** Each chat's harness is handed the server scoped to that chat (its own token or path); an
   in-process call carries the conversation. An unscoped call (a server added by hand) behaves as today.
3. **Turn origin.** Every send carries its client; the turn records it. `conduit_ui` aims, in order, at the origin, a
   client showing this chat, the client in use. An agent names a client only to pick another. jbot's origin is the
   client that wrote in the jbot chat; a routine has none, so it shows nothing and notifies.
4. **Clients name their device.** A desktop or Android app says which node is its own (paired at install), so the
   device a person is sitting at resolves, and so does every client on a device.
5. **One contract for a screen**, all through the hub:
   - picture: H.264 to a `WebScreen` pane on any client;
   - input: the person's, from that pane;
   - actions: an agent's, per kind (a browser's tools; pointer, keys, screenshot and wait; tree and tap).
   A device's screen reaches the hub over the node tunnel. Clients only talk to the hub.
6. **Showing is `conduit_ui open`** with a screen's view id, on the origin by default. No new verb.
7. **The hub arbitrates.** One holder of a screen's input at a time, the person or an agent; the person takes it by
   touching the pane. Each kind is a typed capability granted per device (the distributed plan's decision 7).

8. **A device's screen moves only in sight.** An agent acts on the hub's browser whenever (it is the agents' own); on
   a device's desktop or phone only while some client shows that screen, so a person can see it and take the input
   back. Acting unseen is a grant, later: the per-device grants that workspaces have, widened to say which actions may
   run headless, with the approval model scaled up to decide them.

## Kinds

| View | What | Engine |
| --- | --- | --- |
| `browser:hub` | the hub's Chrome | agent-browser (built) |
| `browser:<device>` | a device's browser | agent-browser on the node (built: the person's to see and use); the desktop app's own webview later (surfaces roadmap #33) |
| (no view yet) | the person's own browser on a device | OpenCode Browse on the environment: an extension in their Chromium paired to a relay there (built 2026-11-10: `conduit_browser`, Settings › Devices › Your browsers). The way device browsers go from here |
| `desktop:<device>` | a device's display | voxl, to be proven by a spike |
| `phone:<device>` | an Android over adb | adb for actions; a picture is unsolved |

Findings behind the last two (source read 2026-11-10):

- voxl (MIT; its binary is GPL through x264, so it ships as a separate program): one process, plain HTTP and one
  WebSocket, so it fits the tunnel. Its client is a whole page: the pane is an iframe under a hub path, the hub's proxy
  adding the bearer. One shared password, no arbitration, read-only for the whole server: the hub's proxy filters a
  viewer's commands. Agents get `/screenshot`, `/wait` and pointer and key commands on the WebSocket; no accessibility
  tree, no window capture. Windows needs the signed-in session; no prebuilt binaries. Unknown: video through the
  tunnel, the Windows build.
- phone-harness (MIT): its Android backend is one adb command per action and reads the accessibility tree. Not
  adopted as shipped (telemetry on by default sends scripts and screen text; scripts run unsandboxed). Conduit writes
  its own adb tool from the same commands. Its approval rule is kept: show the whole script, refuse what is too long
  to show.

## Order

- [x] 1. One MCP server, scoped calls, turn origin (`server/conduit-mcp.js`; `/v0/mcp/chat/<id>`; `UiControl.sentFrom`
  and `targetFor`). Left: an origin lasts until the chat's next send, so a routine's turn in a thread a person wrote in
  still has one; Codex's endpoint is the one added by hand, unscoped.
- [x] 2. Clients name their device. The desktop app already told the hub its companion's environments
  (`RuntimeHub.locate`); `conduit_ui look` now says each client's device and `devices` marks the person's
  (`person: true`). The name is the client's own word: it aims, it never grants. Left: the Android app has no node, so
  a phone names none until `phone:<device>` gives it one; a browser tab names none.
- [x] 3. Screens as one list across kinds (`server/screens.js`): `conduit_ui screens` gives each one's view, device
  and the clients showing it, and `mayAct` is decision 8's rule. `browser:<device>` was already built (`RemoteBrowser`,
  a device's browser through its node's tunnel) and is now a view agents may open. Left for the first new kind:
  the browsers' routes (`/v0/browsers`) and pane stay the browser kind's own until a second kind shows what is
  common; one holder of input; an agent's actions on a device's browser (its tools work the hub's).
- [x] 3a. The device API is declared once (`conduit-web/src/device-api.js`), as the UI API is. `DEVICE_CAPABILITIES`:
  each capability's type, whether the environment says it in its hello or the hub works it out, whether it is kept
  while the environment is away, the kind of screen it offers and the tool agents use it through. `NODE_TARGETS`:
  every call the hub makes into a node, with its methods and the capabilities it serves. A node's hello is built
  and read by it, the hub's view of a node is computed from it, the hub asks and a node serves only what is listed,
  and the client's `Environment` and `Device` are typed from it (`client/platform/devices.ts`). A new kind of
  screen starts as a capability with a `screen` and a target with its methods. Left: the hub's own environment is
  listed by hand (its browser is `browser:hub`, not a capability); a client still names its environments by name
  (`peer.nodes`), not id; the server's JavaScript is not typechecked, so there the declaration is enforced when a
  call is made, not when it is written.
- [ ] 4. `desktop:<device>`: the voxl spike on the Windows app, then the kind.
- [ ] 5. `phone:<device>`: actions over adb, then a picture.
- [x] 3b. The person's own browser (2026-11-10). OpenCode Browse (MIT, vendored) on an environment
  (`nodes/person-browser.js`): the `personBrowser` capability and target, the hub's one way to each
  (`server/person-browsers.js`), `conduit_browser` in the conduit MCP server (behind codemode in a chat, by name over
  HTTP), and pairing from Settings › Devices (`/v0/person-browsers`). Proven on the hub's own environment with a
  Windows Chrome. Left: the hop through a device's node has not run (no companion restarted on it); it has no pane or
  picture: instead of decision 8 (moves only in sight) the person is asked (`agent/policy.js` `browserWraps`: Allow covers
  the thread for a day; its permission is declared with no Always, `approval-api.js`; watching their own window is
  theirs); another harness over MCP has no thread to ask from, so it cannot drive one yet; the relay is the
  hub's or node's child and stops with it; whether it replaces agent-browser for `browser:<device>` or sits beside it.
