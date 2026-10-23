// Props: head (NetworkHead: name, device, meta), devices (NetworkDevice: id, name, clients of NetworkClient: id, name, headed desktop | phone | browser, meta, online), label.
import { NetworkMap, type NetworkDevice, type NetworkHead } from "@/components/ui";
import { row, token, type Page } from "../model";

const head: NetworkHead = { name: "Desktop-Dev", device: "Desktop", meta: "on Ubuntu" };
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

export const networkPage: Page = {
  title: "NetworkMap",
  summary: "The network: the head at the top, every device hung from it by a line, each device's clients inside it.",
  preview: () => <NetworkMap head={head} devices={[desktop(false), browsers]} />,
  usage: `import { NetworkMap } from "@/components/ui";

<NetworkMap head={{ name: "Desktop-Dev", device: "Desktop", meta: "on Ubuntu" }} devices={[{ id: "desk", name: "Desktop", clients: [
  { id: "ubuntu", name: "Ubuntu", meta: "11 workspaces", online: true },
  { id: "windows", name: "Windows", headed: "desktop", meta: "Conduit Dev · this app", online: true },
] }]} />`,
  examples: [
    row("one device", "The head and the device it runs on: Ubuntu headless, Windows headed by this app.", () => <NetworkMap head={head} devices={[desktop(true)]} />, { surfaces: ["frost"] }),
    row("spokes", "Browsers and a phone, hung from the head beside the desktop.", () => <NetworkMap head={head} devices={[desktop(true), browsers, phone]} />, { surfaces: ["frost"] }),
    row("offline device", "A device with nothing connected hangs by a dashed line; one client relayed by the other.", () => <NetworkMap head={head} devices={[desktop(true), laptop]} />, { surfaces: ["frost"] }),
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
  api: ["NetworkMap"],
};
