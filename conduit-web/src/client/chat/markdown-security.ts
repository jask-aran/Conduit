import DOMPurify from "dompurify";

const allowedProtocols = new Set(["http:", "https:", "mailto:"]);

export const escapeHtml = (value: string) => value
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;");

export function resolveMarkdownUrl(value: unknown): { href: string; external: boolean } | null {
  try {
    const target = new URL(String(value || ""), location.href);
    if (!allowedProtocols.has(target.protocol)) return null;
    return {
      href: target.href,
      external: target.protocol !== "mailto:" && target.origin !== location.origin,
    };
  } catch {
    return null;
  }
}

/**
 * A short, stable name for a source.
 *
 * Answers that cite the web are written by the model, and the one shape they
 * all share is a link whose visible text is the URL itself -- either an
 * explicit [url](url) or a bare autolink. Those are the ones that swamp a
 * paragraph, and they are also the only ones safe to shorten: a link the model
 * gave a real label already reads as prose and is left exactly as written.
 *
 * Returns the host to show, or null when this is not a bare-URL link.
 */
export function citationHost(href: string, labelText: string): string | null {
  const bare = (value: string) => value.trim().replace(/^https?:\/\//i, "").replace(/\/+$/, "");
  const label = bare(labelText);
  if (!label || label !== bare(href)) return null;
  try {
    const host = new URL(href).hostname.replace(/^www\./i, "");
    return host || null;
  } catch {
    return null;
  }
}

export function renderMarkdownLink(options: {
  href: unknown;
  title?: unknown;
  label: string;
  labelText?: string;
}) {
  const target = resolveMarkdownUrl(options.href);
  if (!target) return options.label;
  // A bare-URL link becomes a chip: the host is what a reader actually scans
  // for, and the full URL stays reachable through the label and the dialog.
  const host = citationHost(target.href, options.labelText || "");
  const label = host ? escapeHtml(host) : options.label;
  const citation = host ? ' data-citation="true"' : "";
  const title = host || options.title ? ` title="${escapeHtml(host ? target.href : String(options.title))}"` : "";
  if (!target.external) {
    return `<a href="${escapeHtml(String(options.href ?? ""))}"${citation}${title}>${label}</a>`;
  }
  return `<button type="button" class="external-markdown-link"${citation}${title} data-external-url="${escapeHtml(target.href)}" aria-label="${escapeHtml(options.labelText || target.href)}">${label}</button>`;
}

const baseAttributes = [
  "aria-label", "data-copy-code", "data-external-url", "data-language", "data-markdown", "class",
  "data-citation",
  // Code-block card contract: collapse state and the expander are driven by
  // attributes so delegated listeners can toggle them without re-rendering.
  "data-lines", "data-collapsible", "data-collapsed", "data-user-expanded",
  "data-expand-code", "data-expand-label",
];
const forbiddenTags = ["img", "script", "style", "iframe", "object", "embed"];

export function sanitizeMarkdownFragment(
  html: string,
  options: { inline?: boolean; additionalAttributes?: string[] } = {},
) {
  const additionalAttributes = options.additionalAttributes || [];
  return DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    ADD_ATTR: [...new Set([...baseAttributes, ...additionalAttributes])],
    FORBID_TAGS: [...forbiddenTags, ...(options.inline ? ["a", "button"] : [])],
    RETURN_DOM_FRAGMENT: true,
  }) as DocumentFragment;
}
