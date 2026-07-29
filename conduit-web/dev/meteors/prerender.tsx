import { render } from "solid-js/web";
import { DEFAULT_SEED, DEFAULT_SETTINGS, MeteorShower, simulateMeteors } from "@/components/meteor-shower";
import "./prerender.css";

const events = simulateMeteors({
  settings: DEFAULT_SETTINGS,
  viewport: { width: window.innerWidth, height: window.innerHeight },
  durationSeconds: 600,
  seed: DEFAULT_SEED,
});

render(() => <main class="meteor-prerender"><MeteorShower events={events} entryOffset={DEFAULT_SETTINGS.entryOffset} /></main>, document.getElementById("root")!);
