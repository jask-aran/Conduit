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

export function renderMarkdownLink(options: {
  href: unknown;
  title?: unknown;
  label: string;
  labelText?: string;
}) {
  const target = resolveMarkdownUrl(options.href);
  if (!target) return options.label;
  if (!target.external) {
    return `<a href="${escapeHtml(String(options.href ?? ""))}"${options.title ? ` title="${escapeHtml(String(options.title))}"` : ""}>${options.label}</a>`;
  }
  return `<button type="button" class="external-markdown-link" data-external-url="${escapeHtml(target.href)}" aria-label="${escapeHtml(options.labelText || target.href)}">${options.label}</button>`;
}

const baseAttributes = ["aria-label", "data-copy-code", "data-external-url", "data-language", "data-markdown", "class"];
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
