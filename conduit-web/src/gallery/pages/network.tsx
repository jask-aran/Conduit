// Props: hub (NetworkHub: name, device, meta), devices (NetworkDevice: id, name, clients of NetworkClient: id, name, headed desktop | phone | browser, meta, online), label.
import { Button, ChainBreak, ChainDetailHead, ChainGap, ChainHead, ChainLayout, ChainLink, ChainMap, Icons, PromptSection, PromptText, NetworkMap, type NetworkDevice, type NetworkHub } from "@/components/ui";
import { row, token, type Page } from "../model";

const hub: NetworkHub = { name: "Desktop-Dev", device: "Desktop", meta: "on Ubuntu" };
const desktop = (sharing: boolean): NetworkDevice => ({ id: "desk", name: "Desktop", clients: [
  { id: "ubuntu", name: "Ubuntu", meta: "11 workspaces", online: true },
  { id: "windows", name: "Windows", headed: "desktop", meta: sharing ? "Conduit Dev · this app · 1 folder" : "Conduit Dev · this app · not sharing", online: true },
] });
const browsers: NetworkDevice = { id: "browsers", name: "Browsers", clients: [{ id: "chrome", name: "Chrome", headed: "browser", meta: "Windows", online: true }] };
const phone: NetworkDevice = { id: "phone", name: "Phone", clients: [{ id: "android", name: "Conduit", headed: "phone", meta: "Android", online: true }] };
const laptop: NetworkDevice = { id: "laptop", name: "Laptop", clients: [
  { id: "lw", name: "Windows", meta: "1 folder", online: false },
  { id: "lwsl", name: "Ubuntu", meta: "relayed by Windows", online: false },
] };

const detailActions = () => <><Button variant="ghost" size="sm"><Icons.Edit />Edit</Button><Button variant="ghost" size="icon-sm" aria-label="Move up"><Icons.ArrowUp /></Button><Button variant="ghost" size="icon-sm" aria-label="Move down"><Icons.ArrowDown /></Button><Button variant="ghost" size="icon-sm" aria-label="Remove"><Icons.Close /></Button></>;
/* A document's stack under the role it starts (Settings › Prompts). */
const chain = (run = false) => <ChainMap label="A document">
  <ChainHead kind={run ? "Run" : "Profile"} name={run ? "Heartbeat" : "Assistant"} meta={run ? "starts each run of it" : "starts each of its chats"} icon={run ? <Icons.Clock /> : <Icons.Profile />} />
  <ChainGap />
  <ChainLink index={1} name={run ? "Run rules" : "Assistant"} meta={run ? "jbot's file" : "shipped"} size={run ? "640 tok" : "40 tok"} current onSelect={() => {}} />
  <ChainGap />
  <ChainLink index={2} name={run ? "Heartbeat instructions" : "Shared base"} modified meta={run ? "jbot's file" : "shipped"} size={run ? "1.1k tok" : "1.6k tok"} onSelect={() => {}} />
  <ChainBreak label="Conduit adds" />
  <ChainLink live name="Working folder" meta="<cwd>" size="20 tok" onSelect={() => {}} />
  <ChainGap />
  <ChainLink name="Web tools" meta="placed" size="0.2k tok" onSelect={() => {}} />
  {run ? <><ChainBreak label="First message" /><ChainLink live name="Run message" size="22 tok" onSelect={() => {}} /></> : null}
</ChainMap>;
const detail = () => <>
  <ChainDetailHead name="Assistant" meta="shipped · only in this document" size="40 tok" actions={detailActions()} />
  <PromptText text={"# {{assistant.name}}\n\nYou are Conduit's Assistant, working for {{person.name}}.\n\n<cwd>\n{{working folder}}\n</cwd>"} />
</>;

export const networkPage: Page = {
  title: "NetworkMap",
  summary: "The network: the hub at the top, every device hung from it by a line, each device's clients inside it. ChainMap stacks the same boxes down one line: a document's blocks under its role.",
  preview: () => <NetworkMap hub={hub} devices={[desktop(false), browsers]} />,
  usage: `import { NetworkMap } from "@/components/ui";

<NetworkMap hub={{ name: "Desktop-Dev", device: "Desktop", meta: "on Ubuntu" }} devices={[{ id: "desk", name: "Desktop", clients: [
  { id: "ubuntu", name: "Ubuntu", meta: "11 workspaces", online: true },
  { id: "windows", name: "Windows", headed: "desktop", meta: "Conduit Dev · this app", online: true },
] }]} />`,
  examples: [
    row("one device", "The hub and the device it runs on: Ubuntu headless, Windows headed by this app.", () => <NetworkMap hub={hub} devices={[desktop(true)]} />, { surfaces: ["frost"] }),
    row("spokes", "Browsers and a phone, hung from the hub beside the desktop.", () => <NetworkMap hub={hub} devices={[desktop(true), browsers, phone]} />, { surfaces: ["frost"] }),
    row("chain", "ChainMap beside its detail (ChainLayout): a document's blocks stacked under the role it starts; a click chooses a link and its actions are buttons in the detail, never behind hover; dashed links are filled in by Conduit; the detail wraps under the chain when both do not fit", () => <ChainLayout map={chain()} detail={detail()} />, { surfaces: ["ground"], phone: true, code: "<ChainLayout map={<ChainMap>…</ChainMap>} detail={<ChainDetailHead/>…} />" }),
    row("chain with a first message", "A run's document: its system prompt, what Conduit adds, then the first message it is woken with", () => chain(true), { surfaces: ["ground"] }),
    row("prompt text", "PromptText: prompt text as the model reads it, tags quiet and {{slots}} marked; PromptSection one block of a document read whole", () => <><PromptSection name="Waiting inbox" live meta="filled in by Conduit" size="60 tok" text={"<agent-inbox>\nHow often the person wants to be interrupted: {{dial}} ({{what the dial means}}).\n{{each unhandled entry, twelve at most}}\n</agent-inbox>"} /><PromptSection name="Run rules" size="0.6k tok" text={"You are {{assistant.name}}'s run. Report to {{assistant.name}}, never to {{person.name}} directly."} /></>, { surfaces: ["ground"] }),
    row("offline device", "A device with nothing connected hangs by a dashed line; one client relayed by the other.", () => <NetworkMap hub={hub} devices={[desktop(true), laptop]} />, { surfaces: ["frost"] }),
  ],
  tokens: [{ title: "NetworkMap", tokens: [
    token("--tint", "Outlines and lines"),
    token("--radius-surface", "A box's corners"),
    token("--space-md", "Stem down to the bus"),
    token("--space-xl", "Head to a spoke's top"),
    token("--space-lg", "Between spokes"),
    token("--measure-xs", "A box's least width"),
    token("--row-min", "A client's line"),
  ] }],
  api: ["NetworkMap", "ChainMap", "ChainHead", "ChainLink", "ChainGap", "ChainBreak", "ChainLayout", "ChainDetailHead", "PromptText", "PromptSection"],
};
