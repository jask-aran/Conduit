import { Spotlight, TourCard, type TourTask } from "@/components/ui";
import { row, token, type Page } from "../model";
import { noop } from "../demos";

const tasks: TourTask[] = [
  { label: "Go to the sidebar", keys: ["Ctrl Shift 1"], state: "done" },
  { label: "Go to the pane", keys: ["Ctrl Shift 2"], state: "waiting" },
  { label: "Go to the dock", keys: ["Ctrl Shift 3"], state: "absent" },
];
const card = (more: Partial<Parameters<typeof TourCard>[0]> = {}) => <TourCard label="Keyboard tour" step={1} steps={8} title="Three regions, one chord each"
  tasks={tasks} note="This page has no dock. Open a chat in a folder or a workspace and its dock is there; or go on without it."
  onSkip={noop} onEnd={noop} {...more}>The app is regions: the sidebar, the pane in front of you, and the dock beside it. Press each go-to chord.</TourCard>;
// The card is fixed to the window's corner in the app; in a scene it is held in the scene's.
const tourScene = () => <div class="g-page" style={{ transform: "translateZ(0)" }}><div class="g-page-pane" /><div class="g-page-composer" />
  <Spotlight lit={{ top: "12px", left: "12px", width: "calc(100% - 24px)", height: "calc(100% - 24px)", radius: "16px" }} />{card()}</div>;

export const tourPage: Page = {
  title: "Tour", rail: "Blocks",
  summary: "TourCard: one step of the keyboard tour, the leader's small card in a corner, the region it is about lit by a Spotlight.",
  preview: tourScene,
  usage: `import { Spotlight, TourCard } from "@/components/ui";

<>
  <Spotlight class="ui-tour-spotlight" lit={regionBox()} />
  <TourCard label="Keyboard tour" step={1} steps={8} title="Three regions"
    tasks={[{ label: "Go to the sidebar", keys: ["Ctrl Shift 1"], state: "done" }]}
    onBack={back} onSkip={skip} onEnd={end}>Press each go-to chord.</TourCard>
</>`,
  anatomy: { scene: tourScene, parts: [
    { selector: ".ui-tour-count", name: "Progress", does: "says which step of how many", from: "TourCard step · steps" },
    { selector: ".ui-tour-tasks", name: "Tasks", does: "what to press, ticked when seen; faint where it cannot be done here", from: "TourCard tasks" },
    { selector: ".ui-tour-note", name: "Note", does: "what to open first when a task cannot be done here", from: "TourCard note" },
    { selector: ".ui-tour-foot", name: "Foot", does: "Back, Skip, End tour; Next once the step is done", from: "Button" },
  ] },
  examples: [
    row("waiting", "a step waiting for its keys: Skip, End tour", () => <div class="g-page" style={{ transform: "translateZ(0)" }}>{card()}</div>, { surfaces: ["ground"] }),
    row("done", "every task seen: ticked white, Next in the primary voice", () => <div class="g-page" style={{ transform: "translateZ(0)" }}>{card({ tasks: tasks.map((task) => ({ ...task, state: "done" })), note: undefined, done: true, onBack: noop, onNext: noop })}</div>, { surfaces: ["ground"] }),
    row("mentions", "keys a step names without waiting for them, under a rule", () => <div class="g-page" style={{ transform: "translateZ(0)" }}>{card({ tasks: [], note: undefined, done: true, onNext: noop, also: [{ label: "Close tab", keys: ["Ctrl G X"] }, { label: "Swap panes", keys: ["Ctrl G S"] }] })}</div>, { surfaces: ["ground"] }),
  ],
  tokens: [{ title: "Its surface", tokens: [
    token("--measure-xl", "Card width"),
    token("--dim", "Page dim"),
    token("--layer-dialog", "Over dialogs, by one"),
  ] }],
  api: ["TourCard", "Spotlight", "Overlay", "OverlayHead", "Keycap", "Button"],
};
