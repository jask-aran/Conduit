const allowedProtocols = new Set(["http:", "https:", "mailto:"]);

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

/** Only a link whose visible text is its URL is safe to shorten: a link the model gave a real label already reads as
 *  prose. */
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
