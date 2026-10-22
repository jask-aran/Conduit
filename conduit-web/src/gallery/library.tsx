import { buttonPage } from "./pages/button";
import { segmentedPage } from "./pages/segmented";
import { keycapPage } from "./pages/keycap";
import { inputPage } from "./pages/input";
import { textareaPage } from "./pages/textarea";
import { selectPage } from "./pages/select";
import { sliderPage } from "./pages/slider";
import { switchPage } from "./pages/switch";
import { spinnerPage } from "./pages/spinner";
import { statusDotPage } from "./pages/status-dot";
import { fieldPage } from "./pages/field";
import { meterPage } from "./pages/meter";
import { swatchPage } from "./pages/swatch";
import { orbPage } from "./pages/orb";
import { expandPage } from "./pages/expand";
import { filesPages } from "./files";
import { connectionPage } from "./pages/connection";
import { frostPage } from "./pages/frost";
import { fadePage } from "./pages/fade";
import { navPage } from "./pages/nav";
import { dashboardPage } from "./pages/dashboard";
import { panesPage } from "./pages/panes";
import { headerPage } from "./pages/header";
import { readingPage } from "./pages/reading";
import { popoverPage } from "./pages/popover";
import { cardPage } from "./pages/card";
import { toastPage } from "./pages/toast";
import { overlayPage } from "./pages/overlay";
import { leaderPage } from "./pages/leader";
import { desktopComposerPage } from "./pages/desktop-composer";
import { riderPage } from "./pages/rider";
import { pillPage } from "./pages/pill";
import { phoneComposerPage } from "./pages/phone-composer";
import { voicePage } from "./pages/voice";
import { tracePage } from "./pages/trace";
import { codeBlockPage } from "./pages/code-block";
import { transcriptPage } from "./pages/transcript";
import { type Page } from "./model";

const piecePages: Page[] = [
  buttonPage,
  segmentedPage,
  keycapPage,
  inputPage,
  textareaPage,
  selectPage,
  sliderPage,
  switchPage,
  spinnerPage,
  statusDotPage,
  fieldPage,
  meterPage,
  swatchPage,
  orbPage,
  expandPage,
  connectionPage,
  frostPage,
  fadePage,
  navPage,
  dashboardPage,
  panesPage,
  ...filesPages(),
  headerPage,
  readingPage,
  popoverPage,
  cardPage,
  toastPage,
  overlayPage,
  leaderPage,
  desktopComposerPage,
  riderPage,
  pillPage,
  phoneComposerPage,
  voicePage,
  tracePage,
  codeBlockPage,
  transcriptPage,
];
/* What the app composes from the pieces -- its own menus, its overlays, the phone's chrome -- has pages of its own,
   under Blocks: each named example row moves out of its piece's page into one of these. */
const IN_THE_APP: { title: string; summary: string; rows: string[] }[] = [
  { title: "Menus", summary: "The app's menus, each built from Menu, Section and Item: the composer's, the model's, a chat's, the server's, on desktop and on a phone.",
    rows: ["ModelSelector", "ComposerPlusMenu", "ContextGauge › breakdown", "ComposerPlusMenu › Profile", "Sidebar › ChatMenu", "ServerSwitcher",
      "MobileComposerOptions", "MobileComposerOptions › models", "MobileComposerOptions › profiles", "MobileComposerOptions › effort", "MobileComposerOptions › places", "ChatHeader › menu"] },
  { title: "Palette and Settings", summary: "The app's large overlays, built from Overlay's parts: the command palette, chat search and Settings, on desktop and on a phone.",
    rows: ["SettingGroup · SettingLine · every kind", "CommandMenu", "CommandMenu · chat search", "Settings", "Settings · recording a shortcut", "Settings · sections", "Settings · a section"] },
  { title: "Phone chrome", summary: "The phone's own head: the chat's pills and the sidebar's, built from Pills.", rows: ["ChatHeader · the phone's pills", "Sidebar · header"] },
];
function withAppPages(pages: Page[]): Page[] {
  const wanted = new Set(IN_THE_APP.flatMap((app) => app.rows));
  const app = IN_THE_APP.map(({ title, summary, rows }): Page => {
    const found = rows.flatMap((name) => pages.flatMap((page) => page.examples?.filter((row) => row.name === name) ?? []));
    return { title, summary, rail: "Blocks", preview: found[0]?.render, examples: found };
  });
  return [...pages.map((page) => ({ ...page, examples: page.examples?.filter((row) => !wanted.has(row.name)) })), ...app];
}
export const libraryPages = withAppPages(piecePages);
