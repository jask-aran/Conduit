#!/usr/bin/env node
/**
 * Read the stylesheet before instrumenting. Lists every rule the page has
 * loaded that sets something able to move or snap content -- containment,
 * will-change, transform/translate, content-visibility, contain-intrinsic-*
 * -- marking those that apply only under an interaction state (a held handle,
 * panel motion, hover, a layer switch). Those are the first suspects for text
 * that shifts on a press and back on release.
 *
 *   node scripts/probes/motion-rules.mjs [--windows] [--url <path>] [--all]
 */
import { arg, flag, open, recentChats, visit } from "./lib.mjs";

const { page, close } = await open();
await visit(page, arg("--url") ?? `/chat/${(await recentChats(page, 1))[0]}`);
const rules = await page.evaluate(() => {
  const properties = ["contain", "will-change", "transform", "translate", "content-visibility", "contain-intrinsic-block-size", "contain-intrinsic-size"];
  const states = /data-panel-motion|data-layer-switch|data-edge-instant|resiz|dragging|:hover|:active|settling|data-motion/i;
  const found = [];
  const walk = (list, media) => {
    for (const rule of list) {
      if (rule.cssRules && !rule.style) { walk(rule.cssRules, rule.conditionText ?? media); continue; }
      if (!rule.style) continue;
      const set = properties.filter((property) => rule.style.getPropertyValue(property));
      if (set.length) found.push({ selector: rule.selectorText, media, set: set.map((property) => `${property}: ${rule.style.getPropertyValue(property)}`), state: states.test(rule.selectorText ?? "") });
      if (rule.cssRules?.length) walk(rule.cssRules, media);
    }
  };
  for (const sheet of document.styleSheets) { try { walk(sheet.cssRules); } catch {} }
  return found;
});
const shown = flag("--all") ? rules : rules.filter((rule) => rule.state || /paint|strict|content|will-change/.test(rule.set.join(" ")));
for (const rule of shown) console.log(`${rule.state ? "STATE " : "      "}${rule.selector}${rule.media ? `  @${rule.media}` : ""}\n         ${rule.set.join("; ")}`);
console.log(`${shown.length} of ${rules.length} rules shown${flag("--all") ? "" : " (state-scoped, paint containment or will-change; --all for every one)"}`);
await close();
