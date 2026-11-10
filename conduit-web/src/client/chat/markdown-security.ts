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
