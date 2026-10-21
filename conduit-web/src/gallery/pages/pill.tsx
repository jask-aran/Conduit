import { Icons } from "@/components/ui";
import { createSignal } from "solid-js";
import { PillButton, PillField, PillGroup, PillSwitch } from "@/components/ui";
import { FormTable, form, States } from "../specs";
import { areas, icon } from "../demos";
import { type Family, lib } from "../model";

export function Area() { const [value, setValue] = createSignal("dashboard"); return <PillSwitch label="Sidebar section" value={value()} onChange={setValue} options={areas()} />; }

export const pillFamily: Family = { title: "Pill", note: "resting frost floating over the page, the phone's controls. The kind sets the shape: a button is a circle, a group a capsule", usage: `import { Icons, PillButton } from "@/components/ui";

<PillButton label="Scroll to latest" icon={<Icons.ArrowDown />}
  button={{ onPointerDown: (event) => event.preventDefault(), onClick: scrollToLatest }} />`,
  api: ["PillButton", "PillGroup", "PillSwitch", "PillField", "PillWave"],
  groups: [
    { layout: "phone", atoms: [
      lib("pill-button", "PillButton", "phone", "pill", "PillButton: one action, a circle · haptic: a press that acts at once (the mic, Send, Stop) is felt on a phone", () => <div class="g-row"><PillButton {...icon("Sidebar", <Icons.Sidebar />)} /><PillButton {...icon("Add", <Icons.Add />)} /></div>),
      lib("pill-stretch", "PillButton · stretch", "phone", "pill", "PillButton stretch: across its row", () => <div class="g-row g-fill"><PillButton stretch {...icon("Dictate", <Icons.Microphone />)} /></div>),
      lib("pill-group", "PillGroup", "phone", "pill", "PillGroup: several actions, one capsule", () => <div class="g-row"><PillGroup actions={[icon("Sidebar", <Icons.Sidebar />), icon("New chat", <Icons.NewChat />)]} /><PillGroup actions={[icon("Search", <Icons.Search />), icon("Terminal", <Icons.Terminal />), icon("More", <Icons.More />)]} /></div>),
      lib("pill-switch", "PillSwitch", "phone", "pill", "PillSwitch: a group where one slot is chosen", () => <Area />),
      lib("pill-field", "PillField", "phone", "pill", "PillField: text in the capsule", () => <div class="g-fill"><PillField placeholder="Send a message…" /></div>),
    ] },
    { title: "Assembled", layout: "phone", atoms: [
      lib("pill-header", "ChatHeader · the phone's pills", "phone", "pill", "Header (components/ui/header.tsx): its lead and actions groups", () => <div class="g-bar-demo"><PillGroup actions={[icon("Sidebar", <Icons.Sidebar />), icon("New chat", <Icons.NewChat />)]} /><PillGroup actions={[icon("Search", <Icons.Search />), icon("Terminal", <Icons.Terminal />), icon("More", <Icons.More />)]} /></div>, true),
      lib("pill-sidebar", "Sidebar · header", "phone", "pill", "navigation/sidebar.tsx (the phone's drawer has no toggle: a swipe or the backdrop closes it)", () => <div class="g-bar-demo"><Area /></div>, true),
      lib("pill-composer", "Composer · bar layout", "phone", "pill", "chat/composer.tsx (bar)", () => <div class="g-composer-demo"><PillField placeholder="Send a message…" /><div class="g-bar-demo">
        <PillButton {...icon("Message options", <Icons.Add />)} /><PillButton {...icon("Take a photo", <Icons.Camera />)} /><PillButton {...icon("Type a message", <Icons.Keyboard />)} /><PillButton stretch {...icon("Dictate", <Icons.Microphone />)} /><PillButton {...icon("Send", <Icons.Send />)} />
      </div></div>, true),
    ] },
    { title: "Motion", note: "its own moves: a circle that comes and goes in a row grows from nothing and shrinks back, its gap with it, so a stretched neighbour gives and takes the room -- Send beside the mic, once there is something to send", layout: "phone", atoms: [
      lib("pill-motion", "Pill · motion", "phone", "pill", "PillButton folded", () => <FormTable rows={[
        form("comes and goes", "unfolds beside the mic, which gives it room, and fades into it; fades, then gives the room back", () => <States states={["Empty", "Typed"] as const}>{(s) => <div class="g-bar-demo"><PillButton {...icon("Message options", <Icons.Add />)} /><PillButton stretch {...icon("Dictate", <Icons.Microphone />)} />
          <PillButton folded={s() === "Empty"} {...icon("Send", <Icons.Send />)} /></div>}</States>, "<PillButton folded>", "the room: --duration-gentle · --ease-arrive; the fade: --duration-quick, after the room opens or before it closes"),
      ]} on={["phone"]} widths={["200px", "minmax(0, 1fr)"]} />, "row"),
    ] },
  ] };
