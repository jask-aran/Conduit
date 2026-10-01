#!/usr/bin/env node
/**
 * Do off-screen blocks hold their real height? The transcript hides blocks
 * outside the viewport with content-visibility and a measured placeholder
 * height; one measured while it was still rendering (a formula drawing) is
 * short, and the page moves when it comes back. For each transcript this
 * reveals every hidden block for a moment and lists those whose real height
 * differs from their placeholder.
 *
 *   node scripts/probes/placeholder-heights.mjs [--windows] [--url <path>]
 */
import { arg, open, recentChats, visit } from "./lib.mjs";

const { page, close } = await open();
await visit(page, arg("--url") ?? `/chat/${(await recentChats(page, 1))[0]}`, 6000);
const report = await page.evaluate(() => [...document.querySelectorAll(".transcript")].map((transcript) => {
  const viewport = transcript.querySelector(".message-scroller-viewport");
  const hidden = [...transcript.querySelectorAll('[data-transcript-visibility="hidden"]')];
  const placeholder = hidden.map((element) => element.getBoundingClientRect().height);
  const scrollHeight = viewport?.scrollHeight;
  hidden.forEach((element) => element.removeAttribute("data-transcript-visibility"));
  const real = hidden.map((element) => element.getBoundingClientRect().height);
  const revealedScrollHeight = viewport?.scrollHeight;
  const wrong = hidden.map((element, index) => [element.tagName.toLowerCase() + "." + String(element.className).split(" ")[0], +(real[index] - placeholder[index]).toFixed(2)]).filter(([, delta]) => Math.abs(delta) > 0.01);
  hidden.forEach((element) => element.setAttribute("data-transcript-visibility", "hidden"));
  return { hidden: hidden.length, wrong: wrong.length, scrollHeight, revealedScrollHeight, examples: wrong.slice(0, 12) };
}));
for (const [index, transcript] of report.entries()) {
  console.log(`transcript ${index}: ${transcript.wrong}/${transcript.hidden} hidden blocks off; scrollHeight ${transcript.scrollHeight} hidden vs ${transcript.revealedScrollHeight} revealed`);
  for (const [block, delta] of transcript.examples) console.log(`   ${block} ${delta > 0 ? "+" : ""}${delta}px`);
}
await close();
