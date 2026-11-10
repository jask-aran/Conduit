# Screens and device control (2026-11-10)

Any client can see and drive what any device has, through the hub; agents (a chat's, jbot) can do the same, and can put
what they are working on in front of the person on the client they are talking from. Agreed 2026-11-10. This widens
`distributed-nodes-and-execution.md`'s vision ("rather than crude screen mirroring"): agents first, screens when
watching or taking over helps.

## Names

- **Client**: one open Conduit tab or app, `connection/tab` (`UiControl`, `server/ui-control.js`).
- **Device**: a node (`nodes/`), or the hub itself.
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

## Kinds

| View | What | Engine |
| --- | --- | --- |
| `browser:hub` | the hub's Chrome | agent-browser (built) |
| `browser:<device>` | a device's browser | agent-browser on the node, or the desktop app's own webview (surfaces roadmap #33) |
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

- [ ] 1. One MCP server, scoped calls, turn origin. Fixes `browser:hub` on two clients today.
- [ ] 2. Clients name their device.
- [ ] 3. The screen contract, `browser:hub` moved onto it unchanged.
- [ ] 4. `desktop:<device>`: the voxl spike on the Windows app, then the kind.
- [ ] 5. `phone:<device>`: actions over adb, then a picture.

## Open

- May an agent drive a device's screen with no client showing it? Proposed: the hub's browser yes (as today); a
  device's desktop or phone only while a client shows it, until grants say otherwise.
