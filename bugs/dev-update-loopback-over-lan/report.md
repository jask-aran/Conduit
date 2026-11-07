# Dev client update check uses loopback while connected over LAN — bug report handoff

Date (UTC): 2026-10-08
Status: investigated, NOT fixed (read-only investigation).

## Symptom (user wording + screenshot)

> A dev build client (this is windows on my laptop) should still be able to grab the dev artifact over whatever route the server is connected to the client, in this case over local network.

Screenshot (inline in report chat, no file — see note at bottom): Windows `Conduit Dev` app, chat `1500T Thinking Session`, footer `localconduit.jask-aran.com / Connected · 35 ms`. Two stacked toasts bottom-right:

1. `Checking for updates...` (spinner)
2. Red error card: `error sending request for url (http://127.0.0.1:4310/desktop-updates/latest.json)` + `[Ask Runtime]` button

So: the client is demonstrably reaching the server over the LAN route (`localconduit.jask-aran.com`, 35 ms), but the update check requests `latest.json` from `http://127.0.0.1:4310` — the laptop's own loopback, where no server listens (server is on another machine). Request fails, error surfaces via the generic diagnostic toast (`main.tsx` `showError` → `Ask Runtime`).

## Code paths (all read-only)

* `conduit-web/src/client/platform/installed-client.ts:214-231` — dev-client update path:
  ```ts
  if (await getIdentifier() === "com.jaskaran.conduit.desktop.dev") {
    const { activePath } = await import("./servers.ts");
    const route = activePath();
    if (route) {
      try {
        const metadata = await invoke("check_dev_update", {
          endpoint: new URL("/desktop-updates/latest.json", route).href,
        });
        ...
      } catch { /* fallback to baked endpoint */ }
    }
  }
  pending ??= await check();
  ```
  Intent is right: build the manifest URL from the live route. The observed `http://127.0.0.1:4310` URL is exactly this shape — so at check time `activePath()` returned the loopback origin, not the LAN origin shown in the footer.
* `conduit-web/src/client/platform/servers.ts:268-286` — `activePath() = pathOverride() ?? active()`, with the comment that multi-path is unexercised: "a server has exactly one path: its own origin. `activePath` therefore reads as `activeOrigin` today". So the loopback came from the *server entry's stored origin*, not from a path override.
* `conduit-web/src-tauri/src/dev_update.rs` — `check_dev_update` validates the endpoint is `/desktop-updates/latest.json` over http/https, checks the manifest, then rewrites the archive `download_url` to `endpoint.join(archive)` so the `.nsis.zip` downloads from the same route that served the manifest. Same-route logic is already there — it just inherits a wrong route.
* `conduit-web/src/server.js:480-496` — serves `CONDUIT_DESKTOP_UPDATE_DIR` at `/desktop-updates` (unauthenticated, signature-checked client-side). The serving side is route-agnostic; any route to the server works if the client asks on it.
* `conduit-web/scripts/build-desktop-windows.sh:127` — dev builds bake fallback endpoint `https://localconduit.jask-aran.com/desktop-updates` (else-branch loopback default is for non-dev). The observed failing URL is `http://127.0.0.1:4310`, i.e. the *runtime route-based* URL, not the baked fallback — `check_dev_update` was attempted with a stale/loopback `active()` and either it or the subsequent `check()` surfaced the error through `prepareDesktopUpdate`'s catch (`main.tsx:943+` → `showError`, hence the `Ask Runtime` card).
* `conduit-web/scripts/agent-browser-target.mjs:1` and probes default to `http://127.0.0.1:4310` — loopback-by-default culture; consistent with a server entry created as loopback and never updated when the client actually connected over LAN.

## Why the route is wrong (hypothesis, NOT confirmed — needs live state)

`active()` is the stored origin of the selected server entry. Likely sequence: the Windows dev client's server entry was added as `http://127.0.0.1:4310` (the documented default), and connecting over `localconduit.jask-aran.com` did not rewrite the entry's origin — the footer proves connectivity on the LAN name while `active()` still reads loopback. `servers.ts` explicitly punts on this: "two addresses that happen to reach the same machine are two servers here". The updater is the first consumer that needs them to be *one server with two paths*.

Confirm live on the laptop: read `localStorage conduit.servers` / `conduit.servers.active` (or the secure-store equivalent) and compare `active()` vs the origin actually serving the webview vs the footer label. Also check whether `CONDUIT_LOCAL_UPDATE_URL` was set at build time (baked fallback), to rule out the fallback-`check()` as the error source.

## Repro

1. On a second machine (Windows laptop), install the dev client (`com.jaskaran.conduit.desktop.dev`).
2. Add/connect to the dev server over the LAN route (`https://localconduit.jask-aran.com` or `http://<lan-ip>:4310`) while the stored server origin remains `http://127.0.0.1:4310`. Footer shows Connected with LAN latency.
3. Trigger Check for updates. Toast `Checking for updates…` → red `error sending request for url (http://127.0.0.1:4310/desktop-updates/latest.json)`.
4. Same check on the server machine itself (where loopback listens) succeeds — proving it is a route problem, not a missing artifact.

## Smallest fix directions (NOT applied — for implementation agent)

1. Source the endpoint from the route actually in use, not the stored origin: the webview's own serving origin (`window.location.origin` equivalent in the Tauri webview) is the address that provably reaches this server from this machine right now. Prefer it over `activePath()` for `check_dev_update`; keep `activePath()` as fallback.
2. If keeping `activePath()`: when a connection succeeds over an address that is not the entry's origin, record it as a known path (`ServerPath` / `paths[]` already modelled in `servers.ts`) instead of leaving `active()` stale — the updater then has a correct route without any updater-specific code. This is the bigger fix the `servers.ts` comments defer ("worth having working before anything starts choosing paths automatically").
3. On failure, try remaining known paths before surfacing: loopback → LAN → baked fallback, and include *which route was tried* in the surfaced error (today the toast shows only the URL; the footer shows a different host, which is how this reads as contradictory).
4. Do not "fix" by hardcoding the LAN host — the point of the report is route-independence: dorm/office/VPN addresses all need to work, and the next network will have a new name.
5. Verify: dev client on LAN with loopback-stale entry checks updates via the LAN route (manifest + `.nsis.zip` both — `dev_update.rs` rewrite covers the archive once the manifest route is right); loopback-only setup unchanged; release channel (`check()`) untouched; artifact still served unauthenticated with signature verification intact.

## User recovery (no state change)

Nothing changed. Workaround: on the laptop, re-add/switch the server entry to the LAN origin actually in use (or run the check from a client on the server machine). Do not delete chats or reinstall — the error is update-transport only; chat state is unaffected.

## Files in this handoff

* This file only — source was the inline screenshot in this reporting chat on 2026-10-08 (footer `localconduit.jask-aran.com Connected · 35 ms`, error `error sending request for url (http://127.0.0.1:4310/desktop-updates/latest.json)` transcribed above). No attachment file to copy.
* Key source paths: `conduit-web/src/client/platform/installed-client.ts:214-231`, `conduit-web/src/client/platform/servers.ts:60-130,260-330`, `conduit-web/src-tauri/src/dev_update.rs`, `conduit-web/src/server.js:480-496`, `conduit-web/src/client/main.tsx:943+` (update toast/error), `conduit-web/scripts/build-desktop-windows.sh:100-160` (dev baked endpoint)
