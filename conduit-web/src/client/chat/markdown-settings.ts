export type MarkdownRendererId = "marked" | "incremark";

export const MARKDOWN_TYPEWRITER_STORAGE_KEY = "conduit:incremark-typewriter";

function urlBoolean(name: string): boolean | null {
  const value = new URLSearchParams(location.search).get(name);
  if (value == null) return null;
  if (value === "1" || value === "true") return true;
  if (value === "0" || value === "false") return false;
  return null;
}

export function selectedMarkdownRenderer(): MarkdownRendererId {
  const value = new URLSearchParams(location.search).get("markdownRenderer") || localStorage.getItem("conduit:markdown-renderer");
  return value === "incremark" ? "incremark" : "marked";
}

export function markdownRendererSwitchEnabled() {
  return import.meta.env.DEV || ["127.0.0.1", "localhost", "::1"].includes(location.hostname)
    || new URLSearchParams(location.search).has("markdownRenderer");
}

export function selectedMarkdownTypewriter() {
  const override = urlBoolean("markdownTypewriter");
  if (override != null) return override;
  return ["1", "true"].includes(localStorage.getItem(MARKDOWN_TYPEWRITER_STORAGE_KEY) || "");
}
