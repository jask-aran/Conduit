const COLOR_TOKENS = {
  background: "#111114",
  foreground: "#fafafa",
  card: "rgba(48,48,54,0.52)",
  cardForeground: "#fafafa",
  border: "rgba(255,255,255,0.10)",
  primary: "#f3f3f4",
  primaryForeground: "#242428",
  mutedForeground: "#b5b5be",
  destructive: "#f97161",
  input: "rgba(255,255,255,0.15)",
  ring: "#8d8d96",
};

export function renderLoginPage({ error = null, after = "/", bootstrap = false } = {}) {
  const errorTag = error
    ? `<p class="login-error" role="alert">${escapeHtml(error)}</p>`
    : "";
  const setupNotice = bootstrap
    ? `<p class="login-warning" role="alert"><strong>First-run setup.</strong> No Conduit password exists yet. The password entered below becomes the permanent password and signs this browser in immediately. Until you submit it, anyone who can reach this page could claim the instance first.</p>`
    : "";
  return `<!doctype html>
<html lang="en" class="dark">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Conduit · Sign in</title>
    <style>
      :root { color-scheme: dark; }
      html, body {
        margin: 0;
        min-height: 100vh;
        background: ${COLOR_TOKENS.background};
        color: ${COLOR_TOKENS.foreground};
        font-family: "Geist Variable", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
        -webkit-font-smoothing: antialiased;
      }
      body {
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 24px;
      }
      .login-card {
        position: relative;
        background: linear-gradient(180deg, rgba(255,255,255,0.09), rgba(255,255,255,0.02) 58%), ${COLOR_TOKENS.card};
        color: ${COLOR_TOKENS.cardForeground};
        width: 100%;
        max-width: 390px;
        border-radius: 24px;
        border: 1px solid ${COLOR_TOKENS.border};
        padding: 30px 28px 28px;
        backdrop-filter: blur(30px) saturate(168%) brightness(1.05);
        -webkit-backdrop-filter: blur(30px) saturate(168%) brightness(1.05);
        box-shadow: inset 0 1px 0 rgba(255,255,255,0.28), inset 0 -1px 1px rgba(0,0,0,0.20), 0 28px 58px -22px rgba(0,0,0,0.72);
      }
      .login-card h1 {
        font-family: Georgia, "Times New Roman", serif;
        font-size: 32px;
        font-weight: 500;
        letter-spacing: -0.035em;
        line-height: 34px;
        margin: 0 0 6px;
      }
      .login-card p.label {
        margin: 0 0 20px;
        color: ${COLOR_TOKENS.mutedForeground};
        font-size: 13px;
      }
      form { display: flex; flex-direction: column; gap: 14px; }
      label { display: flex; flex-direction: column; gap: 6px; font-size: 12px; color: ${COLOR_TOKENS.mutedForeground}; letter-spacing: 0.02em; }
      input[type="password"] {
        background: linear-gradient(180deg, rgba(255,255,255,0.07), rgba(255,255,255,0.015)), rgba(22,22,26,0.72);
        color: ${COLOR_TOKENS.foreground};
        border: 1px solid rgba(255,255,255,0.13);
        border-radius: 14px;
        padding: 12px 14px;
        font-size: 15px;
        outline: none;
        font-family: inherit;
        box-shadow: inset 0 1px 0 rgba(255,255,255,0.10), inset 0 -1px 1px rgba(0,0,0,0.24);
      }
      input[type="password"]:focus {
        border-color: rgba(255,255,255,0.36);
        box-shadow: inset 0 1px 0 rgba(255,255,255,0.16), 0 0 0 3px rgba(255,255,255,0.08);
      }
      button {
        background: ${COLOR_TOKENS.primary};
        color: ${COLOR_TOKENS.primaryForeground};
        border: none;
        border-radius: 12px;
        padding: 11px 16px;
        font-size: 14px;
        font-weight: 600;
        font-family: inherit;
        letter-spacing: 0.01em;
        cursor: pointer;
        box-shadow: inset 0 1px 0 rgba(255,255,255,0.62), 0 8px 20px -10px rgba(0,0,0,0.65);
      }
      button:hover { filter: brightness(1.08); }
      .login-error {
        margin: 0;
        padding: 10px 12px;
        background: color-mix(in oklch, ${COLOR_TOKENS.destructive}, transparent 80%);
        color: ${COLOR_TOKENS.destructive};
        border: 1px solid color-mix(in oklch, ${COLOR_TOKENS.destructive}, transparent 70%);
        border-radius: 10px;
        font-size: 13px;
      }
      .login-warning {
        margin: 0 0 18px;
        padding: 10px 12px;
        background: rgba(240, 192, 89, 0.10);
        color: #f3d88d;
        border: 1px solid rgba(240, 192, 89, 0.28);
        border-radius: 10px;
        font-size: 13px;
        line-height: 1.45;
      }
      .login-foot { margin-top: 18px; color: ${COLOR_TOKENS.mutedForeground}; font-size: 12px; }
      .login-foot code { color: ${COLOR_TOKENS.foreground}; }
      input[name="after"] { display: none; }
      @media (max-width: 520px) {
        body { padding: 18px; }
        .login-card { padding: 26px 22px 24px; }
      }
    </style>
  </head>
  <body>
    <main class="login-card">
      <h1>Conduit</h1>
      <p class="label">${bootstrap ? "Set the initial password to secure this instance." : "Sign in to continue."}</p>
      ${setupNotice}
      <form action="/v0/auth/login" method="POST" autocomplete="on">
        <label>Password
          <input name="password" type="password" autocomplete="${bootstrap ? "new-password" : "current-password"}" autofocus required />
        </label>
        <input name="after" type="hidden" value="${escapeHtml(after)}" />
        ${errorTag}
        <button type="submit">${bootstrap ? "Set password & sign in" : "Sign in"}</button>
      </form>
      <p class="login-foot">${bootstrap ? "After this first setup, change the password from the server with" : "Change the password from the server with"} <code>node scripts/conduit-auth.mjs set-password</code>.</p>
    </main>
  </body>
</html>`;
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
