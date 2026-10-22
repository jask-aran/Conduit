import { Icons } from "@/components/ui";
import { createSignal } from "solid-js";
import { Button, PillButton, PillField, PillGroup, PillSwitch } from "@/components/ui";
import { areas, icon } from "../demos";
import { row, token, type Page } from "../model";

export function Area() { const [value, setValue] = createSignal("dashboard"); return <PillSwitch label="Sidebar section" value={value()} onChange={setValue} options={areas()} />; }

export const pillPage: Page = {
  title: "Pill",
  summary: "Resting frost floating over the page, the phone's controls. The kind sets the shape: a button is a circle, a group a capsule.",
  preview: () => <div class="g-bar-demo"><PillGroup actions={[icon("Sidebar", <Icons.Sidebar />), icon("New chat", <Icons.NewChat />)]} /><PillGroup actions={[icon("Search", <Icons.Search />), icon("Terminal", <Icons.Terminal />), icon("More", <Icons.More />)]} /></div>,
  usage: `import { Icons, PillButton } from "@/components/ui";

<PillButton label="Scroll to latest" icon={<Icons.ArrowDown />}
  button={{ onPointerDown: (event) => event.preventDefault(), onClick: scrollToLatest }} />`,
  examples: [
    row("PillButton", "PillButton: one action, a circle · haptic: a press that acts at once (the mic, Send, Stop) is felt on a phone", () => <div class="g-row"><PillButton {...icon("Sidebar", <Icons.Sidebar />)} /><PillButton {...icon("Add", <Icons.Add />)} /></div>, { surfaces: ["ground"], phone: "only" }),
    row("PillButton · stretch", "PillButton stretch: across its row", () => <div class="g-row g-fill"><PillButton stretch {...icon("Dictate", <Icons.Microphone />)} /></div>, { surfaces: ["ground"], phone: "only" }),
    row("PillGroup", "PillGroup: several actions, one capsule", () => <div class="g-row"><PillGroup actions={[icon("Sidebar", <Icons.Sidebar />), icon("New chat", <Icons.NewChat />)]} /><PillGroup actions={[icon("Search", <Icons.Search />), icon("Terminal", <Icons.Terminal />), icon("More", <Icons.More />)]} /></div>, { surfaces: ["ground"], phone: "only" }),
    row("PillSwitch", "PillSwitch: a group where one slot is chosen", () => <Area />, { surfaces: ["ground"], phone: "only" }),
    row("PillField", "PillField: text in the capsule", () => <div class="g-fill"><PillField placeholder="Send a message…" /></div>, { surfaces: ["ground"], phone: "only" }),
    row("ChatHeader · the phone's pills", "Header (components/ui/header.tsx): its lead and actions groups", () => <div class="g-bar-demo"><PillGroup actions={[icon("Sidebar", <Icons.Sidebar />), icon("New chat", <Icons.NewChat />)]} /><PillGroup actions={[icon("Search", <Icons.Search />), icon("Terminal", <Icons.Terminal />), icon("More", <Icons.More />)]} /></div>, { surfaces: ["ground"], phone: "only" }),
    row("Sidebar · header", "navigation/sidebar.tsx (the phone's drawer has no toggle: a swipe or the backdrop closes it)", () => <div class="g-bar-demo"><Area /></div>, { source: "navigation/sidebar.tsx (the phone's drawer has no toggle: a swipe or the backdrop closes it)", surfaces: ["ground"], phone: "only" }),
    row("Composer · bar layout", "chat/composer.tsx (bar)", () => <div class="g-composer-demo"><PillField placeholder="Send a message…" /><div class="g-bar-demo">
        <PillButton {...icon("Message options", <Icons.Add />)} /><PillButton {...icon("Take a photo", <Icons.Camera />)} /><PillButton {...icon("Type a message", <Icons.Keyboard />)} /><PillButton stretch {...icon("Dictate", <Icons.Microphone />)} /><PillButton {...icon("Send", <Icons.Send />)} />
      </div></div>, { source: "chat/composer.tsx (bar)", surfaces: ["ground"], phone: "only" })
  ],
  motion: [
    row("comes and goes · Empty", "unfolds beside the mic, which gives it room, and fades into it; fades, then gives the room back · the room: --duration-gentle · --ease-arrive; the fade: --duration-quick, after the room opens or before it closes", () => { const [s, setState] = createSignal<string>("Empty"); return <><Button variant="ghost" outline size="sm" onClick={() => setState(s() === "Empty" ? "Typed" : "Empty")}>Toggle Send</Button><div class="g-bar-demo"><PillButton {...icon("Message options", <Icons.Add />)} /><PillButton stretch {...icon("Dictate", <Icons.Microphone />)} />
          <PillButton folded={s() === "Empty"} {...icon("Send", <Icons.Send />)} /></div></>; }, { surfaces: ["ground"], phone: "only", code: "<PillButton folded>" }),
    row("comes and goes · Typed", "unfolds beside the mic, which gives it room, and fades into it; fades, then gives the room back · the room: --duration-gentle · --ease-arrive; the fade: --duration-quick, after the room opens or before it closes", () => { const [s, setState] = createSignal<string>("Typed"); return <><Button variant="ghost" outline size="sm" onClick={() => setState(s() === "Empty" ? "Typed" : "Empty")}>Toggle Send</Button><div class="g-bar-demo"><PillButton {...icon("Message options", <Icons.Add />)} /><PillButton stretch {...icon("Dictate", <Icons.Microphone />)} />
          <PillButton folded={s() === "Empty"} {...icon("Send", <Icons.Send />)} /></div></>; }, { surfaces: ["ground"], phone: "only", code: "<PillButton folded>" })
  ],
  tokens: [{ title: "What it reads", tokens: [
    token("--pill-size", "button size"),
    token("--pill-gap", "space between slots"),
    token("--pill-icon", "icon size"),
    token("--radius-round", "round corners")
  ] }],
  api: ["PillButton", "PillGroup", "PillSwitch", "PillField", "PillWave"]
};
