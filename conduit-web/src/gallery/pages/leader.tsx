import { Spotlight, OverlayHead, OverlayList, Overlay } from "@/components/ui";
import { Replay } from "../specs";
import { row, token, type Page } from "../model";
import { LeaderPath, leaderRows, noop } from "../demos";
import { overlayViews } from "../pages/overlay";

const leaderScene = () => <div class="g-page"><div class="g-page-pane" /><div class="g-page-composer" />
        {overlayViews.leader({ close: noop, lit: { top: "calc(100% - 76px)", left: "calc(50% - 230px)", width: "460px", height: "56px", radius: "17.6px" } })}</div>;

export const leaderPage: Page = {
  title: "Leader", rail: "Blocks",
  summary: "A small Overlay card above the composer that does not cover the page: the page dims all but the current region.",
  preview: leaderScene,
  usage: `import { Leader, Crumbs, Spotlight } from "@/components/ui/leader";
import { Section } from "@/components/ui";
import { Item } from "@/components/ui/popover";
import { OverlayHints } from "@/components/ui/overlay";

<>
  <Spotlight lit={composerRegion()} />
  <Leader path={<Crumbs label="Where you are" items={[{ label: "Chat" }, { label: "Composer", current: true }]} />}
    hints={<OverlayHints start={[[["Esc"], "Close"]]} />}>
    <Section><Item keysFirst keys={["A"]} onClick={attachFiles}>Attach files</Item></Section>
  </Leader>
</>`,
  anatomy: { scene: leaderScene, parts: [
    {selector: ".ui-crumbs",name: "Path",does: "names the current region",from: "Crumbs"},
    {selector: ".ui-overlay-list",name: "Commands",does: "lists actions with their leading keys",from: "OverlayList · Item keysFirst"},
    {selector: ".ui-overlay-hints",name: "Hints",does: "lists navigation and close keys",from: "OverlayHints"},
    {selector: ".ui-spotlight-lit",name: "Spotlight",does: "keeps the current region clear of the dim",from: "Spotlight"},
  ] },
  examples: [
    row("Crumbs", "Crumbs: the breadcrumb's places in the section label's caps; the current place white with no fill, the cursor washing the others", () => <div class="g-overlay-demo"><Overlay label="Crumbs" class="ui-leader"><OverlayHead><LeaderPath /></OverlayHead></Overlay></div>, { surfaces: ["ground"] }),
    row("Item keysFirst", "Item keysFirst: the key leads the row, in the text colour", () => <div class="g-overlay-demo"><Overlay label="Rows" class="ui-leader"><OverlayList>{leaderRows()}</OverlayList></Overlay></div>, { surfaces: ["ground"] }),
    row("Spotlight", "Spotlight: the dim is the shadow round the lit region, cut out with its corners", () => <div class="g-page"><div class="g-page-pane" /><div class="g-page-composer" /><Spotlight lit={{ top: "12px", left: "12px", width: "calc(100% - 24px)", height: "calc(100% - 24px)", radius: "16px" }} /></div>, { surfaces: ["ground"] }),
    row("LeaderPalette", "navigation/leader-palette.tsx · the composer region lit", leaderScene, { surfaces: ["ground"] }),
  ],
  motion: [
    row("arrives · leaves", "rises --space-md with a fade; drops back; in: --duration-gentle · --ease-arrive · out: --duration-quick · --ease-leave", () => <Replay leaves={["leaving"]}>{(m) => <Overlay label="Leader" class="ui-leader" motion={m()}><OverlayList>{leaderRows()}</OverlayList></Overlay>}</Replay>, { surfaces: ["ground"], code: "<Leader motion>" }),
  ],
  tokens: [{ title: "Its surface", tokens: [
    token("--dim", "Page dim"),
    token("--duration-gentle", "Arrival duration"),
    token("--duration-quick", "Leave duration"),
    token("--ease-arrive", "Arrival curve")
  ] }],
  api: ["Leader", "Crumbs", "Section", "Item", "OverlayHints", "Spotlight", "Overlay", "OverlayHead", "OverlayList"],
};
