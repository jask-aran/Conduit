import { PHONE_LAYOUT_QUERY, NON_PHONE_LAYOUT_QUERY } from "@/components/ui/layout";

/** The phone query as a width alone, which an iframe's width does satisfy. */
const PHONE_AS_WIDTH = PHONE_LAYOUT_QUERY.replace(/ and \(hover: none\) and \(pointer: coarse\)/, "");
const WIDE_AS_WIDTH = NON_PHONE_LAYOUT_QUERY.split(",")[0]!.trim();

/**
 * Make this frame a phone to the app: matchMedia answers the phone queries by
 * width, and every stylesheet's phone and wide media rules are rewritten the
 * same way, again whenever a stylesheet arrives (Vite injects and replaces
 * them on every edit).
 */
export function emulatePhone() {
  const native = window.matchMedia.bind(window);
  const translate = (query: string) => query
    .replace(PHONE_LAYOUT_QUERY, PHONE_AS_WIDTH)
    .replace(NON_PHONE_LAYOUT_QUERY, WIDE_AS_WIDTH)
    .replace(/\(hover: none\)/g, "all").replace(/\(pointer: coarse\)/g, "all")
    .replace(/\(hover: hover\)/g, "not all").replace(/\(pointer: fine\)/g, "not all");
  window.matchMedia = (query: string) => native(translate(query));
  const rewrite = (rules: CSSRuleList) => {
    for (const rule of Array.from(rules)) {
      if (rule instanceof CSSMediaRule) {
        const text = rule.media.mediaText;
        const next = text.includes("pointer: coarse") || text.includes("hover: none") ? PHONE_AS_WIDTH
          : text.includes("hover: hover") || text.includes("pointer: fine") ? WIDE_AS_WIDTH : null;
        if (next && text !== next) rule.media.mediaText = next;
      }
      if ("cssRules" in rule) rewrite((rule as CSSGroupingRule).cssRules);
    }
  };
  const all = () => { for (const sheet of Array.from(document.styleSheets)) { try { rewrite(sheet.cssRules); } catch { /* cross-origin */ } } };
  new MutationObserver(all).observe(document.head, { childList: true, subtree: true, characterData: true });
  document.documentElement.dataset.galleryPhone = "";
  all();
}
