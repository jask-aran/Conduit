import { Button } from "@/components/ui";
import { haptic, type Haptic } from "@/components/ui/haptics";
import { FormTable, form } from "./specs";

/* Haptics: the five kinds a touch is felt as (components/ui/haptics.ts). Each is a piece's own, so a row names the
   pieces that fire it; Feel it fires the kind itself, which only a phone (a touch screen with nothing that hovers)
   feels. */
const KINDS: { kind: Haptic; what: string; pieces: string; strength: string }[] = [
  { kind: "select", what: "a side chosen", pieces: "Segmented, PillSwitch", strength: "light" },
  { kind: "press", what: "a press that acts at once", pieces: "PillButton with haptic=\"press\": the mic, Send, Stop", strength: "light" },
  { kind: "hold", what: "a long press opening a context menu", pieces: "ContextMenu on a touch screen", strength: "medium" },
  { kind: "fold", what: "what a row holds opening or shutting, just after a touch", pieces: "Expand, Disclosure", strength: "light" },
  { kind: "dismiss", what: "an overlay closing, just after a touch", pieces: "Menu, submenu, Popover, Dialog, the phone's drawer", strength: "light" },
];

export const HapticsFoundation = () => <FormTable on={["phone"]} widths={["minmax(0, 1fr)", "160px"]}
  rows={KINDS.map((k) => form(k.kind, `${k.what}; fired by ${k.pieces}`, () => <Button variant="secondary" size="sm" onClick={() => haptic(k.kind)}>Feel it</Button>, `haptic("${k.kind}")`, `impact: ${k.strength}`))} />;
