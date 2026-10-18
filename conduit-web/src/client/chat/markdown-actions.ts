import { createSignal } from "solid-js";
import { setCodeBlockOpen } from "@/components/ui/code";
import { publishCodeBlockToggle } from "./code-block";
import { codeElementText } from "./code-highlight";

export function createExternalLinkController() {
  const [url, setUrl] = createSignal<string | null>(null);
  let returnFocus: HTMLElement | null = null;

  const request = (nextUrl: string, trigger?: HTMLElement) => {
    returnFocus = trigger || (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    setUrl(nextUrl);
  };

  return {
    url,
    request,
    close: () => setUrl(null),
    returnFocus: () => returnFocus,
    clearReturnFocus: () => { returnFocus = null; },
  };
}

const COPY_FEEDBACK_MS = 1200;

/**
 * Copy, and say so.
 *
 * Copying is frequent enough that a stacking toast would be noise, so the
 * confirmation is local: the control turns to its check for a moment and the
 * region it copied takes the copied wash. Both are attribute flips, which
 * keeps them out of every renderer's reactive graph -- a settled Incremark
 * Advanced message can show the feedback without being re-entered.
 *
 * Resolves true when the clipboard actually accepted the text, so callers can
 * drive their own state from the same result.
 */
export async function copyWithFeedback(
  text: string,
  trigger?: HTMLElement | null,
  region?: HTMLElement | null,
) {
  if (!navigator.clipboard) return false;
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    return false;
  }
  // The library's copied state, set on the button and on what it copied (CopyButton, the copied wash).
  for (const target of [trigger, region]) {
    if (!target) continue;
    // Restart the wash even if a previous one is still running.
    target.removeAttribute("data-copied");
    void target.offsetWidth;
    target.setAttribute("data-copied", "");
    window.setTimeout(() => { if (target.isConnected) target.removeAttribute("data-copied"); }, COPY_FEEDBACK_MS);
  }
  if (trigger) {
    const label = trigger.getAttribute("aria-label");
    trigger.setAttribute("aria-label", "Copied");
    window.setTimeout(() => { if (trigger.isConnected && label != null) trigger.setAttribute("aria-label", label); }, COPY_FEEDBACK_MS);
  }
  return true;
}

export async function handleMarkdownClick(
  event: MouseEvent,
  root: HTMLElement,
  requestExternalLink: (url: string, trigger?: HTMLElement) => void,
) {
  const eventTarget = event.target;
  if (!(eventTarget instanceof Element)) return;
  const target = eventTarget.closest<HTMLElement>("[data-copy-code], [data-expand-code], [data-external-url]");
  if (!target || !root.contains(target)) return;
  if (target.hasAttribute("data-copy-code")) {
    const card = target.closest<HTMLElement>(".ui-code");
    const code = card?.querySelector("pre > code");
    await copyWithFeedback(code ? codeElementText(code) : "", target, card);
    return;
  }
  // Collapse is a pure attribute flip on the card, so it costs no re-render and
  // survives a settled message being frozen by Incremark Advanced. Both the
  // pinned header toggle and the footer button carry data-expand-code, so this
  // one branch serves either.
  if (target.hasAttribute("data-expand-code")) {
    const card = target.closest<HTMLElement>(".ui-code");
    if (!card) return;
    const previousTop = card.getBoundingClientRect().top;
    const open = card.hasAttribute("data-folded");
    setCodeBlockOpen(card, open);
    card.toggleAttribute("data-user-open", open);
    publishCodeBlockToggle(card, previousTop);
    return;
  }
  const url = target.dataset.externalUrl;
  if (url) requestExternalLink(url, target);
}
