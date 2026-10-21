import { HarnessMark } from "@/components/ui";
import { ConnectionHeading } from "@/components/ui";
import { Icons } from "@/components/ui";
import { Menu as LiveMenu, MenuContent as LiveMenuContent, MenuSection as LiveMenuSection, MenuRow as LiveMenuRow, MenuRadioGroup as LiveRadioGroup, MenuRadioItem as LiveRadioItem, MenuSub as LiveSub, MenuSubTrigger as LiveSubTrigger, MenuSubContent as LiveSubContent } from "@/components/menus";
import { ConnectionScreen, PasswordSignIn, ServerControl, ConnectionRecovery, ConnectionForm, ConnectionAddress, ConnectionStatus, ConnectionPassword } from "@/components/ui/connection";
import { CardBody, CardNote } from "@/components/ui/card";
import { createSignal } from "solid-js";
import { FormTable, form, type FormRow } from "../specs";
import { ConnectionDemo } from "../demos";
import { type Family, lib } from "../model";

export function ServerMenuDemo(props: { phone?: boolean }) {
  const [route, setRoute] = createSignal("automatic");
  const [action, setAction] = createSignal("No action yet");
  const Routes = () => <LiveMenuSection title="Route to Laptop"><LiveRadioGroup value={route()} onChange={setRoute}>
    <LiveRadioItem value="automatic" detail="Tailscale · laptop.ts.net" meta="12 ms">Automatic</LiveRadioItem>
    <LiveRadioItem value="lan" detail="192.168.1.10" meta="3 ms">This network</LiveRadioItem>
    <LiveRadioItem value="internet" away detail="laptop.example.com">Internet</LiveRadioItem>
    <LiveRadioItem value="tunnel" away detailData detail="remote.example.com" meta="41 ms">Internet</LiveRadioItem>
    <LiveRadioItem value="unreachable" disabled detailData detail="10.0.0.10">Unavailable</LiveRadioItem>
  </LiveRadioGroup></LiveMenuSection>;
  return <CardBody><LiveMenu>
    <LiveMenu.Trigger as={ServerControl} name="Laptop" detail="Connected · 12 ms" connectivity="online" />
    <LiveMenuContent>
      <LiveMenuSection title="Servers"><LiveRadioGroup value="laptop"><LiveRadioItem value="laptop" meta="12 ms">Laptop</LiveRadioItem><LiveRadioItem value="office" away>Office</LiveRadioItem><LiveRadioItem value="offline" disabled>Studio</LiveRadioItem></LiveRadioGroup>
      <LiveSub phone={props.phone}><LiveSubTrigger detailData detail={route()}>Route</LiveSubTrigger><LiveSubContent><Routes /></LiveSubContent></LiveSub></LiveMenuSection>
      <LiveMenuSection title="App"><LiveMenuRow onSelect={() => setAction("Check for updates")} icon={<Icons.Refresh />}>Check for updates</LiveMenuRow></LiveMenuSection>
      <LiveMenuSection title="Account"><LiveMenuRow onSelect={() => setAction("Connect a device or server")} icon={<Icons.QrCode />}>Connect a device or server</LiveMenuRow><LiveMenuRow onSelect={() => setAction("Manage settings")} icon={<Icons.Settings />}>Manage settings</LiveMenuRow><LiveMenuRow destructive onSelect={() => setAction("Sign out")} icon={<Icons.LogOut />}>Sign out</LiveMenuRow></LiveMenuSection>
    </LiveMenuContent>
  </LiveMenu><CardNote>{action()}</CardNote></CardBody>;
}
export const CONNECTIONS: FormRow[] = [
  form("browser sign-in", "plain form POST, password-manager autocomplete and autofocus", () => <ConnectionScreen embedded><PasswordSignIn onSubmit={(event) => event.preventDefault()} after="/" /></ConnectionScreen>, "ConnectionScreen > PasswordSignIn", "the same component generates /login without JavaScript"),
  form("incorrect password", "the field identifies and describes the server error", () => <PasswordSignIn onSubmit={(event) => event.preventDefault()} after="/chat/example" error="Incorrect password." />, "PasswordSignIn error", "aria-invalid · aria-describedby · role=alert"),
  form("address · checking", "the address check is in progress", () => <ConnectionForm onSubmit={(e) => e.preventDefault()}><ConnectionAddress value="laptop.ts.net" state="checking" /><ConnectionStatus state="checking" title="Looking for laptop.ts.net…" /></ConnectionForm>, "ConnectionAddress · ConnectionStatus · ConnectionPassword"),
  form("address · found, password", "the server answered and asks for a password", () => <ConnectionForm onSubmit={(e) => e.preventDefault()}><ConnectionAddress value="laptop.ts.net" state="found" /><ConnectionStatus state="found" title="Laptop" detail="laptop.ts.net · 0.8.1" /><ConnectionPassword /></ConnectionForm>, "ConnectionAddress · ConnectionStatus · ConnectionPassword"),
  form("address · nothing answered", "the address check found no server", () => <ConnectionForm onSubmit={(e) => e.preventDefault()}><ConnectionAddress value="office.ts.net" state="missing" /><ConnectionStatus state="missing" title="Nothing answered" detail="office.ts.net" /></ConnectionForm>, "ConnectionAddress · ConnectionStatus · ConnectionPassword"),
  form("rate limited", "the server keeps the redirect and explains the wait", () => <PasswordSignIn onSubmit={(event) => event.preventDefault()} after="/" error="Too many failed attempts. Try again shortly." />, "PasswordSignIn error", "server keeps rate limiting and credential handling"),
  form("first connection / add server", "live: type an address and it looks for it; one with \"laptop\" in it is found and asks for a password (\"conduit\" signs in), anything else answers nothing", () => <ConnectionDemo />, "ConnectionForm · ConnectionChoice · ConnectionAddress · ConnectionStatus · ConnectionPassword", "uses v2 at every stage"),
  form("phone route panel", "Back returns to the parent; the opening tap cannot select a route", () => <ServerMenuDemo phone />, "Kobalte Sub > v2 MenuPanel", "same submenu behavior adapter on desktop and phone"),
  form("server selection", "keyboard choice, unavailable rows and a real route submenu", () => <ServerMenuDemo />, "Kobalte > v2 Menu · Section · Item", "no network calls or stored server changes"),
  ...["online", "connecting", "reconnecting", "offline"].map((state) => form(state, "connection state on the server control", () => <ServerControl name="Laptop" detail={state === "offline" ? "Server unavailable" : state === "online" ? "Connected · 12 ms" : state === "reconnecting" ? "Reconnecting" : "Connecting"} connectivity={state} />, "ServerControl > StatusDot · Spinner", "shared status and type tokens")),
  form("inline control", "a desktop rail's foot: the state after the name, on one line", () => <ServerControl inline name="Laptop" detail="Connected · 12 ms" connectivity="online" />, "<ServerControl inline>"),
  form("collapsed control", "same status and accessible name in a narrow rail", () => <ServerControl compact name="Laptop" detail="Reconnecting" connectivity="reconnecting" aria-label="Laptop · Reconnecting" />, "ServerControl compact", "the caller supplies layout state, never styling"),
  form("recovery", "a root error and the existing reload action", () => <ConnectionRecovery embedded title="Conduit hit a UI error" error="The interface could not load." onRetry={() => {}} retryLabel="Reload Conduit" />, "ConnectionRecovery", "shared access layout and controls"),
];

export const connectionFamily: Family = { title: "Connection", note: "Sign-in, first connection, server selection and recovery. Shared v2 markup and tokens in the app and the server-rendered login page.", rail: "Blocks",
  usage: `import { ConnectionScreen, ConnectionForm, ConnectionHeading, ConnectionAddress, ConnectionStatus, ConnectionPassword } from "@/components/ui/connection";
import { HarnessMark } from "@/components/ui";

<ConnectionScreen>
  <ConnectionForm onSubmit={connect}>
    <ConnectionHeading mark={<HarnessMark id="conduit" />}>Connect to your server</ConnectionHeading>
    <ConnectionAddress value={address()} onInput={(event) => setAddress(event.currentTarget.value)} state="found" />
    <ConnectionStatus state="found" title="Laptop" detail="laptop.ts.net" />
    <ConnectionPassword value={password()} onInput={(event) => setPassword(event.currentTarget.value)} />
  </ConnectionForm>
</ConnectionScreen>`,
  api: ["ConnectionScreen", "ConnectionHeading", "HarnessMark", "PasswordSignIn", "ConnectionForm", "ConnectionChoices", "ConnectionChoice", "ConnectionGroup", "ConnectionAddress", "ConnectionStatus", "ConnectionPassword", "ConnectionRecovery", "ServerControl", "StatusDot", "Spinner", "Input", "Button", "CardBody", "CardNote", "Menu", "Section", "Item", "MenuPanel", "MenuParent"],
  groups: [
    { title: "Heading", note: "ConnectionHeading: the mark and the screen's title at the top of the first connection", atoms: [
      lib("connection-heading", "ConnectionHeading", "both", "connection", "components/ui/connection.tsx · client/main.tsx", () => <FormTable rows={[
        form("ConnectionHeading", "Conduit's mark, then what the screen asks", () => <ConnectionHeading mark={<HarnessMark id="conduit" />}>Connect to your server</ConnectionHeading>, "<ConnectionHeading mark>title</ConnectionHeading>"),
      ]} on={["desktop", "phone"]} stacked />, "row"),
    ] },
    { title: "Forms and states", note: "Desktop and phone; live menu behavior uses Kobalte, while sign-in remains a plain HTML form.", layout: "desktop", atoms: [
      lib("connection-forms", "Connection · forms × densities", "both", "connection", "components/ui/connection.tsx · components/menus.tsx", () => <FormTable rows={CONNECTIONS} on={["desktop", "phone"]} widths={["200px", "minmax(0, 1fr)", "360px"]} />, "row"),
    ] },
  ] };
