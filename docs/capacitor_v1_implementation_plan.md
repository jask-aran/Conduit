## Minimal implementation slices

### 1. Capacitor skeleton

Add Capacitor 8 core, CLI, Android platform, `capacitor.config.ts`, and the
generated `android/` project.

Configure:

- `webDir: "dist"`
- Android only initially
- the default HTTPS `localhost` WebView origin
- dark status and navigation bars
- portrait and landscape support
- no native HTTP replacement
- no Ionic UI framework

Add scripts for Capacitor sync, Android debug builds, and Android open/run.
Disable service-worker registration and the PWA update action inside Capacitor;
the normal browser and PWA behavior must remain unchanged.

Acceptance criteria:

- Matching Capacitor 8 versions are pinned for core, CLI, and Android.
- `capacitor.config.ts` uses `dist`, has no production `server.url`, keeps the
  secure local WebView origin, and configures dark system bars.
- The generated `android/` project is committed as source.
- Package scripts provide sync, debug build, open, and run commands.
- Browser production builds still include the manifest and service worker.
- Capacitor builds do not register that service worker or show its update action.
- `npm run typecheck`, `npm test`, `npm run build`, and `npx cap sync android`
  pass.
- The Android Gradle debug build produces an APK.
- On a physical device, the APK installs, launches in portrait and landscape,
  respects system insets, uses dark system bars, and loads bundled assets
  without requesting the remote Conduit page.

The implementer verifies all automated criteria available in the build
environment. The product owner verifies device-only criteria after the slice.

### 2. Server selection and transport

Add a first-launch screen that requests the Conduit HTTPS origin, such as the
Tailscale MagicDNS address. Save only this non-secret origin locally. Support
one configured server in V1.

Introduce one transport helper that owns:

- API URL construction
- chat WebSocket URLs
- terminal WebSocket URLs
- dictation WebSocket URLs
- login and logout destinations
- attachment and transcript requests

The normal browser and PWA path continues to use `location.origin`.

Acceptance criteria:

- A fresh native install shows server setup before the Conduit application.
- Setup accepts only a normalized HTTPS origin with no credentials, query, or
  fragment.
- Setup checks the selected server through `/healthz` and shows a useful error
  without losing the entered value.
- The accepted origin survives an app restart and can be changed or cleared.
- The saved value contains only the non-secret origin.
- Every HTTP, EventSource, and WebSocket path uses the shared transport helper;
  no native network path derives the Conduit server from `location.host`.
- Browser and PWA requests remain same-origin and need no setup.
- Unit tests cover origin validation and HTTP, WebSocket, login, logout,
  attachment, transcript, terminal, and dictation URL construction.
- Existing browser tests, typecheck, unit tests, and production build pass.
- On a physical device with Tailscale connected, setup reaches a valid Conduit
  server; with Tailscale or the server unavailable, it shows the offline error
  and permits retry.

### 3. Native authentication boundary

The bundled app is cross-origin from Conduit. The current
`HttpOnly; SameSite=Lax` browser session cookie will not reliably authenticate
cross-site fetches and WebSockets. Keep browser authentication unchanged and add
a separate native session flow.

- Native login sends the existing Conduit password to the configured HTTPS
  server.
- The server issues a random, revocable native bearer token backed by the
  existing session store and expiry rules.
- Android stores the bearer token in Keystore-backed storage, never
  `localStorage`, logs, URLs, or repository files.
- Native HTTP requests send the token in `Authorization: Bearer`.
- Before opening a WebSocket, the app exchanges its bearer token for a
  short-lived, single-use socket ticket. Only that ticket can appear in the
  WebSocket URL.
- The server permits native requests only from the exact Capacitor local origin
  and only for the required methods and headers. Do not enable wildcard CORS or
  credentialed cross-origin cookies.
- Native logout revokes the current token and clears secure local storage.
- Existing reset-sessions behavior also revokes native sessions.
- A `401` returns the native app to its local login screen without changing the
  configured server.

Acceptance criteria:

- Browser login, cookies, logout, WebSocket upgrades, rolling expiry, and route
  protection retain their current behavior.
- Native login rejects non-HTTPS origins, wrong passwords, throttled attempts,
  expired sessions, and revoked sessions.
- Native bearer tokens are random, hashed at rest, bounded by the existing
  session cap, and never returned by status or diagnostic endpoints.
- CORS permits only the exact Capacitor origin and rejects other origins,
  unsupported methods, and unsupported headers.
- Authenticated native HTTP requests work without cookies.
- Socket tickets expire quickly, work once, and cannot authorize HTTP requests
  or a second WebSocket.
- Chat, terminal, and dictation WebSocket upgrades accept a valid ticket and
  reject missing, expired, reused, or revoked credentials.
- Logout and reset-sessions close or reject later authenticated work.
- Automated auth, HTTP, WebSocket, browser, typecheck, and build checks pass.
- On a physical device, login survives app restart, logout removes access, and
  chat, terminal, dictation, attachment, and transcript operations authenticate
  against the configured server.


 ## What is a bundled Capacitor shell?

  It is a normal Android app that contains the Conduit web interface.

  Today, your phone downloads the interface from the Conduit server each time the PWA loads. With
  Capacitor:

  - The APK contains the HTML, CSS, JavaScript, fonts, and icons.
  - Android displays those files in an embedded browser called a WebView.
  - The app connects to your existing Conduit server for chats, models, files, voice, and live WebSocket
    events.

  - Pi and the Conduit server continue to run on your computer or VPS.
  - Nothing computational moves onto the phone.

  “Shell” means the Android part stays small. It provides the window, app lifecycle, permissions,
  keyboard handling, back button, and later native features. The existing Solid application remains the
  interface.

  This is the production approach that Capacitor recommends. Its external server.url option is for
  development and live reload, not production. Capacitor configuration
  (https://capacitorjs.com/docs/config)

  ## What will setup feel like?

  The first Android version should use this flow:

  1. Download and install Conduit.apk.
  2. Open Conduit.
  3. Enter the server address, for example:
     https://conduit.your-tailnet.ts.net

  4. Conduit checks /healthz.
  5. Enter your existing Conduit password.
  6. The app stores the server address and keeps the authenticated session.
  7. The normal Conduit interface opens.
  8. Future launches reconnect to that server automatically.

  If Tailscale protects the server, the Tailscale Android app must be connected. Conduit should show a
  clear “Server unavailable” screen if Tailscale or the server is offline.

  The server picker can later support several Conduit servers, but the first release needs only one
  saved address.

  ## How will users download it?

  Not GHCR. GHCR stores container images.

  The simplest initial distribution is a GitHub Release containing:

  - Conduit-android-v0.x.y.apk
  - A SHA-256 checksum
  - Short installation instructions

  Android users download the APK and approve installation from that source. Android displays a sideload
  warning because Google Play did not install it.

  For Google Play, we would build an .aab Android App Bundle instead. Google Play signs and distributes
  generated APKs. We do not need this for the first working release.

  A practical release can contain both:

  - APK for GitHub installation and testing.
  - AAB for future Play Store submission.

  ## How will updates work?

  There are two separate products:

  - The Conduit server
  - The Android app

  Server changes can deploy normally. Native app changes require a new APK.

  Because the interface is bundled inside the APK, web-interface changes also require a new APK unless
  we add an over-the-air web bundle updater. I recommend that we do not add one initially. It adds
  signing, rollback, compatibility, and security work.

  The first version can use one of these update methods:

  - User downloads the new APK from GitHub Releases.
  - The app checks the latest GitHub Release and shows “Update available”.
  - Later, Google Play performs automatic updates.

  The existing PWA service-worker updater should be disabled inside Capacitor. The APK owns its bundled
  interface version.

  ## What needs to change in Conduit?

  The main engineering boundary is not the UI. It is network identity.

  The bundled app runs from an internal origin such as https://localhost. The Conduit API runs at the
  saved remote address. Current client code assumes both are the same origin:

  - API calls use /v0/....
  - WebSockets use location.host.
  - Authentication uses an HttpOnly, SameSite=Lax cookie.
  - A 401 redirects to the server-hosted /login page.

  The native app therefore needs:

  1. One saved Conduit server address.
  2. One helper that creates every API and WebSocket URL.
  3. A login screen inside the bundled application.
  4. Server permission for the Capacitor origin.
  5. Authentication that works safely across those origins.
  6. Native lifecycle signals to reconnect immediately after resume.

  Authentication is the important design task. We should not weaken the normal browser cookie or enable
  broad CORS. The clean design is a separate mobile-session flow:

  - The app sends the password over HTTPS.
  - The server issues a revocable mobile token.
  - Android stores it in secure native storage.
  - HTTP and WebSocket requests present that token.
  - “Reset sessions” can revoke it like current browser sessions.

  ## Recommended first release

  Make Android the only native target initially.

  Include:

  - One-server setup screen.
  - Existing password authentication.
  - Secure token storage.
  - Existing Conduit interface.
  - Immediate foreground reconnection.
  - Android back-button behavior.
  - Microphone permission and voice verification.
  - File attachment picker.
  - External links opened in the system browser.
  - GitHub Release APK.
  - No push notifications.
  - No offline chats.
  - No background agent execution on the phone.
  - No automatic over-the-air web bundle updates.
  - No iOS project yet.

  This gives us a real semi-native application without rewriting Conduit or creating a second UI.
