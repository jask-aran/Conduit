# Tauri 2 desktop client plan

## Decision

Ship Conduit as a thin Tauri 2 desktop client. Start with Windows. Keep the
Conduit server remote and keep Android on Capacitor.

The desktop app bundles the existing SolidJS/Vite client. It connects to the
same HTTPS, SSE and authenticated WebSocket endpoints as the Android app. It
does not bundle Node, Pi, Python, tmux, the transcription worker or a local
Conduit server.

## Windows MVP

The first Windows release must provide:

- an NSIS installer for the current user;
- one native window with the existing Conduit interface;
- server selection, native login and secure bearer-token storage;
- a system tray with Open Conduit, New chat, Check for updates and Quit;
- close-to-tray behavior, with an explicit Quit action;
- single-instance behavior that restores and focuses the existing window;
- configurable Windows-wide shortcuts for Open Conduit and New chat;
- optional launch at sign-in, including a start-hidden mode;
- signed in-app updates from the Conduit GitHub Release;
- correct external-link, download, clipboard and file-picker behavior.

The normal in-app shortcuts remain active only while the Conduit window has
focus. Global shortcuts are a separate opt-in scope in Settings. Conduit must
report an OS registration failure instead of claiming that a shortcut works.

## Architecture

### Desktop shell

Add `conduit-web/src-tauri/` beside the existing Capacitor project. Configure
Tauri to run the existing Vite development server in development and package
`conduit-web/dist` in production. Use `com.jaskaran.conduit.desktop` as the
desktop identifier and keep the Vite client as the only application UI.

Rust owns native lifecycle work:

- create and restore the main window;
- create the tray and handle its menu;
- convert a window close request into hide-to-tray when enabled;
- perform the final process exit after Quit;
- enforce one application instance;
- register global shortcuts and dispatch typed client commands;
- initialize autostart, secure storage and updater plugins.

SolidJS owns visible settings and command behavior. Native events enter the
same client command registry used by the palette and in-app shortcuts.

### Installed-client boundary

Replace direct `Capacitor.isNativePlatform()` calls with one platform adapter.
The adapter exposes browser, Capacitor and Tauri implementations for:

- installed-client detection;
- server-origin selection;
- token read, write and removal;
- application update checks;
- external URL opening and file downloads;
- global-shortcut registration status;
- tray and autostart preferences where the UI needs them.

Do not create parallel API clients. `httpUrl`, `webSocketUrl`, socket tickets
and `authorizedFetch` remain the shared transport path.

### Authentication and origin

Store the desktop bearer token in Tauri Stronghold, never `localStorage`.
Retain the existing short-lived, single-use socket ticket for chat, terminal
and dictation WebSockets.

Determine the packaged Windows webview origin in the first spike. Add only
that exact origin to the server's native CORS, preflight and WebSocket checks.
Do not reflect arbitrary origins or add a wildcard. Fix the chosen Tauri HTTPS
scheme before release because changing it changes the webview storage origin.

### Tray and window lifecycle

Build the tray in Rust with Tauri's `TrayIconBuilder`. Use these behaviors:

- left-click restores, unminimizes and focuses the main window;
- Open Conduit does the same;
- New chat restores the window and dispatches the existing new-chat command;
- Check for updates restores the window and starts the native update flow;
- Quit unregisters global shortcuts and exits the process;
- the window close button hides the window when Keep running in tray is on;
- disabling Keep running in tray makes the close button exit normally;
- a second application launch restores and focuses the existing instance;
- launch at sign-in starts hidden when tray mode is enabled.

The tray is functional chrome, not a second navigation system. Do not add chat,
project or workspace submenus in the MVP.

### Global shortcuts

Extend the current typed shortcut definitions with an explicit `global` scope.
Do not duplicate command identifiers. The Windows MVP supports two global
commands: Open Conduit and New chat.

Registration must follow one transaction:

1. Validate and normalize the proposed accelerator.
2. Register the new accelerator with the OS.
3. If registration succeeds, unregister the old accelerator and persist the
   new value.
4. If registration fails, retain the old registration and show the failure in
   Settings.

Load persisted global shortcuts at startup. Unregister them during Quit. An
`isRegistered` result proves only that Conduit registered a shortcut; it
cannot prove that another application owns a conflicting shortcut. The actual
registration result is authoritative.

Keep global shortcuts configurable. Select defaults only after checking them
against Windows, browser, terminal and accessibility shortcuts.

### Updates

Disable service-worker registration and PWA update actions inside Tauri. Add
the Tauri updater plugin and route the existing Check for updates command to
it. A successful update must:

1. fetch the release manifest over HTTPS;
2. verify the signed Windows update artifact;
3. download and install it once;
4. restart Conduit into the new version;
5. report Already up to date without delay or error.

Generate updater artifacts during the Windows build. Publish `latest.json`,
the NSIS installer, updater bundle and signatures to the same GitHub Release.
Keep the updater private key only in GitHub Actions. Commit only its public
key.

## Capabilities and security

Generate the Tauri capability schema before selecting exact permission names.
Grant the main window only the plugin operations it uses:

- Stronghold record access for the bearer token;
- updater check, download and install;
- opening validated external URLs;
- global-shortcut register, query and unregister;
- autostart query, enable and disable;
- the minimum window operations needed by visible client controls.

Keep tray, close interception, single-instance handling and native command
dispatch in Rust where possible. Do not enable general shell execution,
arbitrary filesystem access or remote-page access to Tauri IPC.

## Delivery phases

### Phase 1: Windows shell spike

- Scaffold `src-tauri` and package the current Vite build.
- Prove routing, refresh, fonts, CodeMirror, xterm, SSE and all WebSocket paths.
- Record the packaged webview origin and WebView2 version.
- Produce an unsigned local NSIS installer.

Exit condition: the installed app can select a server, authenticate, open a
chat, send a message and use a terminal after restart.

### Phase 2: shared installed-client adapter

- Remove direct Capacitor checks from client features.
- Add Capacitor and Tauri secure-storage implementations.
- Extend the exact-origin server boundary and native-auth tests.
- Disable PWA-only behavior in both installed clients where applicable.

Exit condition: browser, Android and Windows use one transport contract, and
their platform-specific behavior remains explicit.

### Phase 3: desktop lifecycle

- Add the tray, close-to-tray and explicit Quit.
- Add single-instance restore and focus.
- Add launch-at-sign-in and start-hidden behavior.
- Add configurable Open Conduit and New chat global shortcuts.
- Add a Desktop section to Settings using the existing tiled settings pattern.

Exit condition: every launch, close, tray and shortcut path reaches one
deterministic window state and never creates a second Conduit process.

### Phase 4: signed update and publication

- Add the Tauri updater and public verification key.
- Obtain Windows code-signing credentials and configure timestamped signing.
- Add a Windows build job to the release workflow.
- Upload installer, updater, signature and manifest artifacts.
- Make the final GitHub Release job wait for Android, container and Windows.

Exit condition: an installed prior build updates to a candidate release in one
action, restarts, retains its server and token, and reports the new version.

### Phase 5: Windows release hardening

- Test install, upgrade, uninstall and rollback failure on a clean Windows VM.
- Test unavailable server, expired token, occupied shortcut and corrupt update.
- Check SmartScreen and WebView2 bootstrap behavior.
- Verify tray and window behavior across sign-out, sleep and display changes.
- Add one bounded native smoke workflow; do not copy the full browser suite.

Exit condition: the signed candidate passes the Windows VM checklist and the
release workflow preserves exact commit identity.

## Verification matrix

| Area | Required proof |
| --- | --- |
| Package | Clean Windows VM installs and uninstalls the NSIS package. |
| Identity | App, updater manifest and GitHub Release name the same commit and version. |
| Auth | Token survives restart, never enters web storage and clears on sign-out. |
| Transport | HTTPS, SSE and each WebSocket type work against a real server. |
| Lifecycle | Close, tray, second launch, autostart and Quit produce the specified state. |
| Shortcuts | Registration, replacement, conflict and restart restoration work. |
| Update | Older signed build installs the candidate once and restarts successfully. |
| Regression | Typecheck, build and Node suite pass; focused Windows smoke passes. |

## Deferred work

- macOS and Linux packaging;
- a bundled local Conduit server;
- Tauri mobile migration;
- tray navigation beyond the four MVP actions;
- desktop notifications and unread badges;
- deep links and protocol registration;
- multiple windows and detachable panes.

The platform adapter and Rust lifecycle layer must remain portable enough for
later macOS and Linux implementations. Do not delay the Windows release for
untested cross-platform abstractions.

## References

- [Tauri system tray](https://v2.tauri.app/learn/system-tray/)
- [Tauri global shortcuts](https://v2.tauri.app/plugin/global-shortcut/)
- [Tauri single instance](https://v2.tauri.app/plugin/single-instance/)
- [Tauri autostart API](https://v2.tauri.app/reference/javascript/autostart/)
- [Tauri Stronghold](https://v2.tauri.app/plugin/stronghold/)
- [Tauri updater](https://v2.tauri.app/plugin/updater/)
- [Tauri capabilities](https://v2.tauri.app/security/capabilities/)
- [Tauri Windows distribution](https://v2.tauri.app/distribute/)
