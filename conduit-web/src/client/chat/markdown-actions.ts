import { createSignal } from "solid-js";

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

export async function handleMarkdownClick(
  event: MouseEvent,
  root: HTMLElement,
  requestExternalLink: (url: string, trigger?: HTMLElement) => void,
) {
  const eventTarget = event.target;
  if (!(eventTarget instanceof Element)) return;
  const target = eventTarget.closest<HTMLElement>("[data-copy-code], [data-external-url]");
  if (!target || !root.contains(target)) return;
  if (target.hasAttribute("data-copy-code")) {
    await navigator.clipboard.writeText(target.closest("[data-language]")?.querySelector("code")?.textContent || "");
    return;
  }
  const url = target.dataset.externalUrl;
  if (url) requestExternalLink(url, target);
}
