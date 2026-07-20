const COLOR_TOKENS = {
  background: "#161618",
  foreground: "#fafafa",
  card: "#1f1f23",
  cardForeground: "#fafafa",
  border: "rgba(255,255,255,0.10)",
  primary: "oklch(0.488 0.243 264.376)",
  primaryForeground: "#fbfbfd",
  mutedForeground: "#b5b5be",
  destructive: "#f97161",
  input: "rgba(255,255,255,0.15)",
  ring: "#8d8d96",
};

export function renderLoginPage({ error = null, after = "/" } = {}) {
  const errorTag = error
    ? `<p class="login-error" role="alert">${escapeHtml(error)}</p>`
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
        background: ${COLOR_TOKENS.card};
        color: ${COLOR_TOKENS.cardForeground};
        width: 100%;
        max-width: 360px;
        border-radius: 14px;
        border: 1px solid ${COLOR_TOKENS.border};
        padding: 28px 26px;
        box-shadow: 0 24px 60px rgba(0,0,0,0.45);
      }
      .login-card h1 {
        font-size: 22px;
        font-weight: 600;
        letter-spacing: -0.01em;
        margin: 0 0 4px;
      }
      .login-card p.label {
        margin: 0 0 20px;
        color: ${COLOR_TOKENS.mutedForeground};
        font-size: 13px;
      }
      form { display: flex; flex-direction: column; gap: 14px; }
      label { display: flex; flex-direction: column; gap: 6px; font-size: 12px; color: ${COLOR_TOKENS.mutedForeground}; letter-spacing: 0.02em; }
      input[type="password"] {
        background: ${COLOR_TOKENS.background};
        color: ${COLOR_TOKENS.foreground};
        border: 1px solid ${COLOR_TOKENS.input};
        border-radius: 10px;
        padding: 10px 12px;
        font-size: 15px;
        outline: none;
        font-family: inherit;
      }
      input[type="password"]:focus {
        border-color: ${COLOR_TOKENS.primary};
        box-shadow: 0 0 0 4px color-mix(in oklch, ${COLOR_TOKENS.primary}, transparent 75%);
      }
      button {
        background: ${COLOR_TOKENS.primary};
        color: ${COLOR_TOKENS.primaryForeground};
        border: none;
        border-radius: 10px;
        padding: 10px 16px;
        font-size: 14px;
        font-weight: 600;
        font-family: inherit;
        letter-spacing: 0.01em;
        cursor: pointer;
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
      .login-foot { margin-top: 18px; color: ${COLOR_TOKENS.mutedForeground}; font-size: 12px; }
      .login-foot code { color: ${COLOR_TOKENS.foreground}; }
      input[name="after"] { display: none; }
    </style>
  </head>
  <body>
    <main class="login-card">
      <h1>Conduit</h1>
      <p class="label">Sign in to continue.</p>
      <form action="/v0/auth/login" method="POST" autocomplete="on">
        <label>Password
          <input name="password" type="password" autocomplete="current-password" autofocus required />
        </label>
        <input name="after" type="hidden" value="${escapeHtml(after)}" />
        ${errorTag}
        <button type="submit">Sign in</button>
      </form>
      <p class="login-foot">Change the password from the server with <code>node scripts/conduit-auth.mjs set-password</code>.</p>
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