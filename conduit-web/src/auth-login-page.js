import fs from "node:fs";
import path from "node:path";

// The normal build renders these templates from components/ui, including its
// hashed CSS. There is no independent login markup or stylesheet to drift.
export function createLoginPageRenderer(clientDist) {
  let templates;
  return function renderLoginPage({ error = null, after = "/" } = {}) {
    templates ??= JSON.parse(fs.readFileSync(path.join(clientDist, "access/templates.json"), "utf8"));
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
