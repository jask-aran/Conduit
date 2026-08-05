export type MarkdownRendererId = "marked" | "incremark" | "incremark-typewriter" | "incremark-synthetic";

export const MARKDOWN_RENDERER_STORAGE_KEY = "conduit:markdown-renderer";
export const MARKDOWN_TYPEWRITER_STORAGE_KEY = "conduit:incremark-typewriter";

function urlBoolean(name: string): boolean | null {
  const value = new URLSearchParams(location.search).get(name);
  if (value == null) return null;
  if (value === "1" || value === "true") return true;
  if (value === "0" || value === "false") return false;
  return null;
}

export function selectedMarkdownRenderer(): MarkdownRendererId {
  const value = new URLSearchParams(location.search).get("markdownRenderer") || localStorage.getItem(MARKDOWN_RENDERER_STORAGE_KEY);
  if (value === "marked" || value === "incremark-typewriter" || value === "incremark-synthetic") return value;
  if (value === "incremark") return legacyTypewriterPreference() ? "incremark-typewriter" : "incremark";
  return "incremark-typewriter";
}

export function markdownRendererSwitchEnabled() {
  // Keep development controls available through LAN, Tailscale, and Cloudflare
  // origins while the managed application is still a development build.
  return true;
}

export function selectedMarkdownTypewriter() {
  const renderer = new URLSearchParams(location.search).get("markdownRenderer") || localStorage.getItem(MARKDOWN_RENDERER_STORAGE_KEY);
  if (renderer === "incremark-typewriter") return true;
  if (renderer === "marked" || renderer === "incremark-synthetic") return false;
  if (renderer === "incremark") return legacyTypewriterPreference();
  return true;
}

function legacyTypewriterPreference() {
  const override = urlBoolean("markdownTypewriter");
  if (override != null) return override;
  const stored = localStorage.getItem(MARKDOWN_TYPEWRITER_STORAGE_KEY);
  return stored == null ? true : ["1", "true"].includes(stored);
}
