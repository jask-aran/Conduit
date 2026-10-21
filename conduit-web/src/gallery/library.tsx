import { buttonFamily } from "./pages/button";
import { segmentedFamily } from "./pages/segmented";
import { keycapFamily } from "./pages/keycap";
import { inputFamily } from "./pages/input";
import { textareaFamily } from "./pages/textarea";
import { selectFamily } from "./pages/select";
import { sliderFamily } from "./pages/slider";
import { switchFamily } from "./pages/switch";
import { spinnerFamily } from "./pages/spinner";
import { statusDotFamily } from "./pages/status-dot";
import { fieldFamily } from "./pages/field";
import { progressFamily } from "./pages/progress";
import { gaugeFamily } from "./pages/gauge";
import { meterFamily } from "./pages/meter";
import { swatchFamily } from "./pages/swatch";
import { orbFamily } from "./pages/orb";
import { expandFamily } from "./pages/expand";
import { filesFamilies } from "./files";
import { connectionFamily } from "./pages/connection";
import { frostFamily } from "./pages/frost";
import { fadeFamily } from "./pages/fade";
import { navFamily } from "./pages/nav";
import { dashboardFamily } from "./pages/dashboard";
import { panesFamily } from "./pages/panes";
import { headerFamily } from "./pages/header";
import { readingFamily } from "./pages/reading";
import { popoverFamily } from "./pages/popover";
import { cardFamily } from "./pages/card";
import { toastFamily } from "./pages/toast";
import { overlayFamily } from "./pages/overlay";
import { leaderFamily } from "./pages/leader";
import { desktopComposerFamily } from "./pages/desktop-composer";
import { riderFamily } from "./pages/rider";
import { pillFamily } from "./pages/pill";
import { phoneComposerFamily } from "./pages/phone-composer";
import { voiceFamily } from "./pages/voice";
import { traceFamily } from "./pages/trace";
import { codeBlockFamily } from "./pages/code-block";
import { transcriptFamily } from "./pages/transcript";
import { type Family, type Atom, type Group } from "./model";

const pieceFamilies: Family[] = [
  buttonFamily,
  segmentedFamily,
  keycapFamily,
  inputFamily,
  textareaFamily,
  selectFamily,
  sliderFamily,
  switchFamily,
  spinnerFamily,
  statusDotFamily,
  fieldFamily,
  progressFamily,
  gaugeFamily,
  meterFamily,
  swatchFamily,
  orbFamily,
  expandFamily,
  connectionFamily,
  frostFamily,
  fadeFamily,
  navFamily,
  dashboardFamily,
  panesFamily,
  ...filesFamilies(),
  headerFamily,
  readingFamily,
  popoverFamily,
  cardFamily,
  toastFamily,
  overlayFamily,
  leaderFamily,
  desktopComposerFamily,
  riderFamily,
  pillFamily,
  phoneComposerFamily,
  voiceFamily,
  traceFamily,
  codeBlockFamily,
  transcriptFamily,
];
/* What the app composes from the pieces -- its own menus, its overlays, the phone's chrome -- is shown apart from the
   pieces: each named atom moves out of its piece's family into one of these, kept in its group's layout. */
const IN_THE_APP: { title: string; note: string; atoms: string[] }[] = [
  { title: "Menus", note: "the app's menus, each built from Menu, Section and Item: the composer's, the model's, a chat's, the server's", atoms: ["d-model", "d-plus", "d-context", "d-profile", "d-sidebar", "d-server", "p-plus", "p-models", "p-profiles", "p-effort", "p-projects", "p-chat"] },
  { title: "Palette and Settings", note: "the app's large overlays, built from Overlay's parts: the command palette, chat search and Settings", atoms: ["overlay-settings", "o-palette", "o-search", "o-settings", "o-settings-record", "o-palette-phone", "o-search-phone", "o-settings-phone", "o-settings-page-phone"] },
  { title: "Phone chrome", note: "the phone's own head: the chat's pills and the sidebar's, built from Pills", atoms: ["pill-header", "pill-sidebar"] },
];
function withAppFamilies(families: Family[]): Family[] {
  const moved = new Map<string, { atom: Atom; layout?: Group["layout"] }>();
  const pieces = families.map((family) => ({ ...family, groups: family.groups.map((group) => ({ ...group, atoms: group.atoms.filter((atom) => {
    const wanted = IN_THE_APP.some((app) => app.atoms.includes(atom.id.replace(/^ui-/, "")));
    if (wanted) moved.set(atom.id.replace(/^ui-/, ""), { atom, layout: group.layout });
    return !wanted;
  }) })).filter((group) => group.atoms.length) }));
  const app = IN_THE_APP.map(({ title, note, atoms }): Family => {
    const found = atoms.map((id) => moved.get(id)).filter((entry) => entry !== undefined);
    const layouts = [...new Set(found.map((entry) => entry.layout))];
    return { title, note, rail: "Blocks", groups: layouts.map((layout) => ({ title: layout === "phone" ? "Phone" : layout === "desktop" ? "Desktop" : undefined, layout, atoms: found.filter((entry) => entry.layout === layout).map((entry) => entry.atom) })) };
  });
  return [...pieces, ...app];
}
export const libraryFamilies = withAppFamilies(pieceFamilies);
