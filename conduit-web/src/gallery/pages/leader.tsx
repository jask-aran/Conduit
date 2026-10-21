import { Spotlight, OverlayHead, OverlayList, Overlay } from "@/components/ui";
import { FormTable, form, Replay } from "../specs";
import { type Family, lib } from "../model";
import { LeaderPath, leaderRows, noop } from "../demos";
import { overlayViews } from "../pages/overlay";

export const leaderFamily: Family = { title: "Leader", note: "a small Overlay card above the composer that does not cover the page: the page dims all but the current region", rail: "Blocks",
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
  api: ["Leader", "Crumbs", "Section", "Item", "OverlayHints", "Spotlight", "Overlay", "OverlayHead", "OverlayList"],
  groups: [
    { atoms: [
      lib("leader-crumbs", "Crumbs", "both", "overlay", "Crumbs: the breadcrumb's places in the section label's caps; the current place white with no fill, the cursor washing the others", () => <div class="g-overlay-demo"><Overlay label="Crumbs" class="ui-leader"><OverlayHead><LeaderPath /></OverlayHead></Overlay></div>, true),
      lib("leader-rows", "Item keysFirst", "both", "overlay", "Item keysFirst: the key leads the row, in the text colour", () => <div class="g-overlay-demo"><Overlay label="Rows" class="ui-leader"><OverlayList>{leaderRows()}</OverlayList></Overlay></div>, true),
      lib("leader-spotlight", "Spotlight", "desktop", "overlay", "Spotlight: the dim is the shadow round the lit region, cut out with its corners", () => <div class="g-page"><div class="g-page-pane" /><div class="g-page-composer" /><Spotlight lit={{ top: "12px", left: "12px", width: "calc(100% - 24px)", height: "calc(100% - 24px)", radius: "16px" }} /></div>, true),
    ] },
    { title: "Assembled", note: "the app's own, at its size", layout: "desktop", atoms: [
      lib("o-leader", "LeaderPalette", "desktop", "overlay", "navigation/leader-palette.tsx · the composer region lit", () => <div class="g-page"><div class="g-page-pane" /><div class="g-page-composer" />
        {overlayViews.leader({ close: noop, lit: { top: "calc(100% - 76px)", left: "calc(50% - 230px)", width: "460px", height: "56px", radius: "17.6px" } })}</div>, "row"),
    ] },
    { title: "Motion", note: "an Overlay's moves: it rises above the composer and drops back (the app's leader: 220ms in, 150ms out)", layout: "desktop", atoms: [
      lib("leader-motion", "Leader · motion", "both", "overlay", "Leader motion", () => <FormTable rows={[form("arrives · leaves", "rises --space-md with a fade; drops back", () => <Replay leaves={["leaving"]}>{(m) => <Overlay label="Leader" class="ui-leader" motion={m()}><OverlayList>{leaderRows()}</OverlayList></Overlay>}</Replay>, "<Leader motion>", "in: --duration-gentle · --ease-arrive · out: --duration-quick · --ease-leave")]} on={["desktop"]} widths={["200px", "minmax(0, 1fr)"]} />, "row"),
    ] },
  ] };
