export type MarkdownRendererId = "marked" | "marked-stable" | "incremark" | "incremark-typewriter" | "incremark-synthetic";

export const MARKDOWN_RENDERER_STORAGE_KEY = "conduit:markdown-renderer";

export const MARKDOWN_RENDERER_OPTIONS: ReadonlyArray<{ value: MarkdownRendererId; label: string }> = [
  { value: "marked-stable", label: "Marked (Stable)" },
  { value: "marked", label: "Marked (Experimental)" },
  { value: "incremark", label: "Immediate (Stable)" },
  { value: "incremark-typewriter", label: "Typewriter (Stable)" },
  { value: "incremark-synthetic", label: "Synthetic (Experimental)" },
];

function urlBoolean(name: string): boolean | null {
  const value = new URLSearchParams(location.search).get(name);
  if (value == null) return null;
  if (value === "1" || value === "true") return true;
  if (value === "0" || value === "false") return false;
  return null;
}

export function selectedMarkdownRenderer(): MarkdownRendererId {
  const params = new URLSearchParams(location.search);
  const value = params.get("markdownRenderer") || localStorage.getItem(MARKDOWN_RENDERER_STORAGE_KEY);
  if (value === "marked" || value === "marked-stable" || value === "incremark" || value === "incremark-typewriter" || value === "incremark-synthetic") return value;
  const typewriterOverride = urlBoolean("markdownTypewriter");
  if (typewriterOverride === false) return "incremark";
  if (typewriterOverride === true) return "incremark-typewriter";
  return "incremark-synthetic";
}

export function markdownRendererSwitchEnabled() {
  // Keep development controls available through LAN, Tailscale, and Cloudflare
  // origins while the managed application is still a development build.
  return true;
}

export function selectedMarkdownTypewriter() {
  const renderer = selectedMarkdownRenderer();
  return renderer === "incremark-typewriter" || renderer === "incremark-synthetic";
}
