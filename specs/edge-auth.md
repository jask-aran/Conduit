# Spec: Edge auth (single-user password login)

Status: draft · Priority: 1 (blocks any non-loopback exposure) · Vision: S5/D2

## Goal

Every HTTP route, static asset, upload, and WebSocket upgrade served by Conduit
requires an authenticated session, except a minimal login flow. One user, one
password, provisioned once from the CLI. The perimeter model is: Tailscale (or
a Cloudflare tunnel) keeps the address quiet; this password is the lock on the
door. Deliberately boring — no OAuth, no accounts, no email.

## Non-goals

Multi-user, roles, Google identity (deferred to a public-VPS phase, S5), TOTP,
password recovery flows (recovery = SSH to the box and re-run the CLI).

## Design

### Credential storage

`data/auth.json`, mode `0600`, atomic writes (same pattern as
`sessions.json`):

```json
{
  "version": 1,
  "password": { "algo": "scrypt", "N": 32768, "r": 8, "p": 1,
                "salt": "<base64>", "hash": "<base64>" },
  "sessions": [ { "tokenHash": "<sha256-base64>", "createdAt": "…",
                  "lastSeenAt": "…", "userAgent": "…" } ]
}
```

- Hashing: Node's built-in `crypto.scrypt` — no new dependency. Verify with
  `crypto.timingSafeEqual`.
- Session tokens: 32 random bytes (`crypto.randomBytes`), sent to the browser
  raw, stored server-side only as SHA-256. Cap stored sessions at 20, evicting
  oldest by `lastSeenAt`.

### CLI provisioning

`scripts/conduit-auth.mjs` (invoked from repo root, mirroring
`conduit-pi.mjs`):

- `set-password` — hidden interactive prompt (twice), or `--stdin` for
  scripting. Writes `data/auth.json`, invalidates all sessions.
- `reset-sessions` — clears the sessions array (logs every device out).
- `status` — reports whether a password is set and active session count.

The running server picks up changes without restart: reload `auth.json` on
each login attempt and on session-validation cache miss.

### Enforcement — one choke point, deny by default

A single `requireAuth` middleware mounted in `server.js` **before every other
route and static handler**. Explicit allowlist, nothing else passes
unauthenticated:

- `GET /login` (the page), `POST /v0/auth/login`, and `GET /healthz` (probe
  endpoint; returns no session data). Logout is **not** allowlisted — it
  requires a valid session like any other route.

Route naming follows the existing `/v0/` prefix (`conduit-web/README.md`
Runtime API); auth routes are `/v0/auth/*`.

Everything else — API routes, the SPA bundle and all static assets, uploads,
transcript endpoints — returns `401` (API/XHR, by `Accept`/path prefix) or
redirects to `/login` (navigation). Unauthenticated clients never receive the
application bundle.

WebSockets: validate the session cookie in the `server.on("upgrade")` handler
before `handleUpgrade`; destroy the socket otherwise. This is the second and
only other enforcement point.

Session cookie: `conduit_session`, `HttpOnly`, `SameSite=Lax`, `Path=/`,
`Secure` when the request is HTTPS or `X-Forwarded-Proto: https` (funnel and
tunnels always are), 30-day rolling expiry (`lastSeenAt` refresh, throttled to
once per minute). CSRF posture: `SameSite=Lax` plus JSON-body content types on
all state-changing API routes; no token machinery.

### Fail-closed startup

If the listen host is non-loopback and no password is configured, the server
refuses to start with a clear message naming the CLI command.
`CONDUIT_ALLOW_INSECURE=1` overrides for development only (documented in
`.env.example`). Loopback binding without a password remains open (local dev
unchanged). `.devcontainer/start-conduit.sh` binds `0.0.0.0` and therefore
requires a password or the override. The dev container and CI must therefore
export `CONDUIT_ALLOW_INSECURE=1` (setup script and workflow env) in the same
PR, or first-run and browser tests break.

### Rate limiting

In-memory, on `POST /v0/auth/login`: after 5 failures (global — single-user
system, per-IP is meaningless behind a tunnel), exponential backoff starting
at 5 s, capped at 5 min, reset on success. Verification runs the full scrypt
compare even when throttled-rejected paths allow, so timing reveals nothing.

### Login page

Server-rendered static HTML + inline CSS, no JS framework, no SPA code —
Open-WebUI-minimal: centered card, product name, one password field, one
button, error line on failure. Dark, matching the app's neutral tokens
(hex-copied, not imported). Plain form POST; on success, redirect to `/`.

## Interface touchpoints

- Settings gains an **Auth** tab: active session count, "log out other
  devices" (calls reset-sessions semantics keeping the current token), and a
  pointer to the CLI for password changes. No password-change form in v1.
- Logout action in the sidebar footer or command palette (`POST
  /v0/auth/logout` clears the current session row and cookie).

## Verification

- Node tests: a route-coverage test that walks the Express router stack and
  asserts every registered route except the allowlist returns 401/redirect
  without a cookie; WS upgrade rejection; scrypt round-trip; session eviction;
  rate-limit backoff; fail-closed startup matrix (host × password × override).
- Browser test: unauthenticated visit lands on `/login`; wrong password shows
  the error; correct password reaches the app; reload stays authenticated;
  logout returns to `/login`.
- `npm test`, `npm run test:browser`, `npm run build` per `AGENTS.md`.
