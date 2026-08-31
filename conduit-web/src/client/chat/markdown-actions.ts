import { createSignal } from "solid-js";
import { publishCodeBlockToggle, syncCodeBlockToggleLabels } from "./code-block";
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

const COPY_FEEDBACK_MS = 1400;
const COPY_FLASH_MS = 620;

/**
 * Copy, and say so.
 *
 * Copying is frequent enough that a stacking toast would be noise, so the
 * confirmation is local: the control reports "Copied" for a moment and the
 * region it copied gets a single ring pulse. Both are attribute flips, which
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
  if (trigger) {
    trigger.dataset.copied = "true";
    const label = trigger.querySelector<HTMLElement>(".artifact-copy-label");
    const previousLabel = label?.textContent ?? null;
    const previousAria = trigger.getAttribute("aria-label");
    if (label) label.textContent = "Copied";
    trigger.setAttribute("aria-label", "Copied");
    window.setTimeout(() => {
      if (!trigger.isConnected) return;
      delete trigger.dataset.copied;
      if (label && previousLabel != null) label.textContent = previousLabel;
      if (previousAria != null) trigger.setAttribute("aria-label", previousAria);
    }, COPY_FEEDBACK_MS);
  }
  const flashTarget = region || trigger?.closest<HTMLElement>("[data-language], [data-slot='bubble-content']");
  if (flashTarget) {
    // Restart the animation even if a previous flash is still running.
    delete flashTarget.dataset.copyFlash;
    void flashTarget.offsetWidth;
    flashTarget.dataset.copyFlash = "true";
    window.setTimeout(() => {
      if (flashTarget.isConnected) delete flashTarget.dataset.copyFlash;
    }, COPY_FLASH_MS);
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
    const card = target.closest<HTMLElement>("[data-language]");
    const code = card?.querySelector("code");
    await copyWithFeedback(code ? codeElementText(code) : "", target, card);
    return;
  }
  // Collapse is a pure attribute flip on the card, so it costs no re-render and
  // survives a settled message being frozen by Incremark Advanced. Both the
  // pinned header toggle and the footer button carry data-expand-code, so this
  // one branch serves either.
  if (target.hasAttribute("data-expand-code")) {
    const card = target.closest<HTMLElement>(".artifact");
    if (!card) return;
    const previousTop = card.getBoundingClientRect().top;
    if (card.dataset.collapsed === "true") {
      delete card.dataset.collapsed;
      card.dataset.userExpanded = "true";
    } else {
      card.dataset.collapsed = "true";
      delete card.dataset.userExpanded;
    }
    syncCodeBlockToggleLabels(card);
    publishCodeBlockToggle(card, previousTop);
    return;
  }
  const url = target.dataset.externalUrl;
  if (url) requestExternalLink(url, target);
}
