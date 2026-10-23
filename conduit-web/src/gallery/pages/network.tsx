// Props: devices (NetworkDevice: id, name, parts of NetworkPart: id, name, head, headed desktop | phone | browser, meta, online), label, current, onPick.
import { NetworkMap, type NetworkDevice } from "@/components/ui";
import { row, token, type Page } from "../model";

const desk = (serving: boolean): NetworkDevice => ({ id: "desk", name: "Desktop-Dev", parts: [
  { id: "ubuntu", name: "Ubuntu", head: true, online: true },
  { id: "windows", name: "Windows", headed: "desktop", meta: serving ? "Conduit Dev · this app" : "Conduit Dev · this app · not serving", online: true },
] });
const phone: NetworkDevice = { id: "phone", name: "Phone", parts: [{ id: "android", name: "Conduit", headed: "phone", online: true }] };
const browser: NetworkDevice = { id: "web", name: "macOS browser", parts: [{ id: "chrome", name: "Chrome", headed: "browser", online: true }] };
const laptop: NetworkDevice = { id: "laptop", name: "Laptop", parts: [
  { id: "lw", name: "Windows", online: false },
  { id: "lwsl", name: "Ubuntu", meta: "relayed by Windows", online: false },
] };

export const networkPage: Page = {
  title: "NetworkMap",
  summary: "The devices of a network: the head's device, its environments and clients, and every other device hung from it by a line.",
  preview: () => <NetworkMap devices={[desk(false), phone, browser]} current="windows" />,
  usage: `import { NetworkMap } from "@/components/ui";

<NetworkMap devices={[{ id: "desk", name: "Desktop-Dev", parts: [
  { id: "ubuntu", name: "Ubuntu", head: true, online: true },
  { id: "windows", name: "Windows", headed: "desktop", meta: "Conduit Dev · this app", online: true },
] }]} />`,
  examples: [
    row("picked", "The part picked is current, as in the sidebar; the page shows what it holds under the map.", () => <NetworkMap devices={[desk(false)]} current="ubuntu" />, { surfaces: ["frost"] }),
    row("head alone", "Only the head's device: the head headless, Windows headed by this app but not serving.", () => <NetworkMap devices={[desk(false)]} />, { surfaces: ["frost"] }),
    row("spokes", "A phone and a browser, each a device of one headed environment, hung from the head.", () => <NetworkMap devices={[desk(true), phone, browser]} />, { surfaces: ["frost"] }),
    row("offline device", "A device with nothing connected hangs by a dashed line; headless environments, one relayed by the other.", () => <NetworkMap devices={[desk(true), laptop, phone]} />, { surfaces: ["frost"] }),
  ],
  tokens: [{ title: "NetworkMap", tokens: [
    token("--tint", "Outlines and lines"),
    token("--radius-surface", "A device's corners"),
    token("--space-md", "Stem down to the bus"),
    token("--space-xl", "Head to a spoke's top"),
    token("--space-lg", "Between spokes"),
    token("--measure-xs", "A device's least width"),
    token("--row-min", "A part's row"),
  ] }],
  api: ["NetworkMap"],
};
