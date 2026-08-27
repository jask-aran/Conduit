export function renderLoginPage({ error = null, after = "/" } = {}) {
  const errorTag = error
    ? `<p id="login-error" class="login-error" role="alert">${escapeHtml(error)}</p>`
    : "";
  const errorAttributes = error ? ` aria-invalid="true" aria-describedby="login-error"` : "";
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
        background: #000;
        color: #f5f5f5;
        font-family: "Geist Variable", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
        -webkit-font-smoothing: antialiased;
      }
      body {
        display: grid;
        place-items: center;
        padding: 24px;
      }
      .login-shell { width: min(300px, 100%); }
      form { display: grid; gap: 9px; }
      .login-field {
        display: grid;
        grid-template-columns: minmax(0, 1fr) 42px;
        align-items: center;
      }
      .visually-hidden {
        position: absolute;
        width: 1px;
        height: 1px;
        overflow: hidden;
        clip: rect(0 0 0 0);
        clip-path: inset(50%);
        white-space: nowrap;
      }
      input[type="password"] {
        min-width: 0;
        height: 42px;
        border: 0;
        background: transparent;
        color: #f5f5f5;
        padding: 0 0 0 13px;
        font-size: 14px;
        outline: none;
        font-family: inherit;
      }
      input::placeholder { color: #686868; }
      button {
        display: grid;
        width: 42px;
        height: 42px;
        place-items: center;
        border: 0;
        border-radius: 6px;
        background: transparent;
        color: #747474;
        padding: 0;
        font-size: 18px;
        font-family: inherit;
        cursor: pointer;
      }
      button:hover { color: #f5f5f5; }
      button:focus-visible { outline: 1px solid #686868; outline-offset: -4px; }
      .login-error {
        margin: 0;
        color: #e06c64;
        font-size: 12px;
        line-height: 1.4;
      }
      input[name="after"] { display: none; }
    </style>
  </head>
  <body>
    <main class="login-shell">
      <form action="/v0/auth/login" method="POST" autocomplete="on">
        <label class="visually-hidden" for="password">Password</label>
        <div class="login-field">
          <input id="password" name="password" type="password" autocomplete="current-password" placeholder="Password" autofocus required${errorAttributes} />
          <button type="submit" aria-label="Sign in" title="Sign in">&rarr;</button>
        </div>
        <input name="after" type="hidden" value="${escapeHtml(after)}" />
        ${errorTag}
      </form>
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
