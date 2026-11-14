const STEP_MS = 200, BREATH_MS = 1600, REST_MS = 600, FADE = 85;

/**
 * The caret breathes in an editable region as it does in a field (styles/foundations.css), but from here, a few steps a second: its colour is
 * inherited, so a CSS animation would restyle everything under the region every frame. It stands solid while it is typed with.
 */
export function breatheCarets() {
  if (!CSS.supports("caret-animation", "manual") || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  let region: HTMLElement | null = null, timer = 0, typed = 0, last = "";
  const stop = () => { clearInterval(timer); region?.style.removeProperty("caret-color"); region = null; last = ""; };
  const tick = () => {
    if (!region?.isConnected) return stop();
    const since = performance.now() - typed - REST_MS, fade = since < 0 ? 0 : Math.round(FADE * (1 - Math.cos(2 * Math.PI * since / BREATH_MS)) / 2);
    const next = fade ? `color-mix(in oklch, var(--caret, var(--foreground)), transparent ${fade}%)` : "";
    if (next === last) return;
    last = next;
    if (next) region.style.caretColor = next; else region.style.removeProperty("caret-color");
  };
  const touched = () => { typed = performance.now(); };
  document.addEventListener("focusin", (event) => {
    stop();
    if (!(event.target instanceof HTMLElement) || !event.target.isContentEditable) return;
    region = event.target; touched(); timer = window.setInterval(tick, STEP_MS);
  });
  document.addEventListener("focusout", stop);
  document.addEventListener("keydown", touched, { capture: true });
  document.addEventListener("pointerdown", touched, { capture: true });
}
