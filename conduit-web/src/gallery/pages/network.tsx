// Props: hub (NetworkHub: name, device, meta), devices (NetworkDevice: id, name, clients of NetworkClient: id, name, headed desktop | phone | browser, meta, online), label.
import { Button, ChainBreak, ChainGap, ChainHead, ChainLink, ChainMap, Icons, NetworkMap, type NetworkDevice, type NetworkHub } from "@/components/ui";
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

const linkActions = () => <><Button variant="ghost" size="icon-sm" aria-label="Move up"><Icons.ArrowUp /></Button><Button variant="ghost" size="icon-sm" aria-label="Move down"><Icons.ArrowDown /></Button><Button variant="ghost" size="icon-sm" aria-label="Remove"><Icons.Close /></Button></>;
const add = () => <Button variant="ghost" size="sm">Add a block</Button>;
/* A document's stack under the role it starts (Settings › Prompts). */
const chain = (run = false) => <ChainMap label="A document">
  <ChainHead kind={run ? "Run" : "Profile"} name={run ? "Heartbeat" : "Assistant"} meta={run ? "starts each run of it" : "starts each of its chats"} icon={run ? <Icons.Clock /> : <Icons.Profile />} />
  <ChainGap>{add()}</ChainGap>
  <ChainLink index={1} name={run ? "Run rules" : "Assistant"} meta={run ? "jbot's file · in 3 documents" : "shipped · only here"} size={run ? "640 tok" : "40 tok"} onOpen={() => {}} actions={linkActions()} />
  <ChainGap>{add()}</ChainGap>
  <ChainLink index={2} name={run ? "Heartbeat instructions" : "Shared base"} modified meta={run ? "jbot's file · only here" : "shipped · in 3 documents"} size={run ? "1.1k tok" : "1.6k tok"} onOpen={() => {}} actions={linkActions()} />
  <ChainGap>{add()}</ChainGap>
  <ChainBreak label="Conduit adds" />
  <ChainLink live name="Working folder" meta="The chat's working folder" />
  <ChainGap />
  <ChainLink live name="Web tools" meta="How to use the web tools" />
  {run ? <><ChainBreak label="First message" /><ChainLink live name="Run message" meta="When and why it was woken, and what its tasks gathered" /></> : null}
</ChainMap>;

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
    row("chain", "ChainMap: a document's blocks stacked under the role it starts; a link opens to edit, its actions show on hover, a gap adds a block there; live links (filled in by Conduit) dashed", () => chain(), { surfaces: ["ground"], phone: true, code: "<ChainMap><ChainHead/><ChainGap/><ChainLink/><ChainBreak/></ChainMap>" }),
    row("chain with a first message", "A run's document: its system prompt, what Conduit adds, then the first message it is woken with", () => chain(true), { surfaces: ["ground"] }),
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
  api: ["NetworkMap", "ChainMap", "ChainHead", "ChainLink", "ChainGap", "ChainBreak"],
};
