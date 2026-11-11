import { createSignal } from "solid-js";
import { COPY_FEEDBACK_MS } from "@/components/ui/motion";

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


/** Attribute flips keep the feedback out of every renderer's reactive graph, so a settled message shows it without
 *  being re-entered. */
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
