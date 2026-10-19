import fs from "node:fs";
import path from "node:path";

// The normal build renders these templates from components/ui, including its
// hashed CSS. There is no independent login markup or stylesheet to drift.
export function createLoginPageRenderer(clientDist) {
  const file = path.join(clientDist, "access/templates.json");
  let cached = null;
  // Read again when a rebuild replaces it: its stylesheet names change with the build.
  const load = () => {
    let stat;
    try { stat = fs.statSync(file); } catch { throw new Error(`The sign-in page is not built: ${file} is missing (npm run build)`); }
    if (cached?.mtimeMs !== stat.mtimeMs) cached = { mtimeMs: stat.mtimeMs, templates: JSON.parse(fs.readFileSync(file, "utf8")) };
    return cached.templates;
  };
  return function renderLoginPage({ error = null, after = "/" } = {}) {
    const templates = load();
    const content = (error ? templates.error : templates.normal)
      .replace(/__CONDUIT_ACCESS_(AFTER|ERROR)__/g, (_match, key) => escapeHtml(key === "AFTER" ? after : error));
    return `<!doctype html>
<html lang="en" class="dark">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
    <title>Conduit · Sign in</title>
    ${templates.css.map((href) => `<link rel="stylesheet" href="${escapeHtml(href)}" />`).join("\n    ")}
  </head>
  <body>${content}</body>
</html>`;
  };
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
