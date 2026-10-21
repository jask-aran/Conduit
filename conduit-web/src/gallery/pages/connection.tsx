import { HarnessMark } from "@/components/ui";
import { ConnectionHeading } from "@/components/ui";
import { Icons } from "@/components/ui";
import { DropdownMenu as LiveMenu, MenuContent as LiveMenuContent, MenuSection as LiveMenuSection, MenuRow as LiveMenuRow, MenuRadioGroup as LiveRadioGroup, MenuRadioItem as LiveRadioItem, MenuSub as LiveSub, MenuSubTrigger as LiveSubTrigger, MenuSubContent as LiveSubContent } from "@/components/menus";
import { ConnectionScreen, PasswordSignIn, ServerControl, ConnectionRecovery, ConnectionForm, ConnectionAddress, ConnectionStatus, ConnectionPassword } from "@/components/ui/connection";
import { CardBody, CardNote } from "@/components/ui/card";
import { createSignal } from "solid-js";
import { ConnectionDemo } from "../demos";
import { row, token, type Page } from "../model";

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
const CONNECTIONS = [
  row("browser sign-in", "plain form POST, password-manager autocomplete and autofocus; the same component generates /login without JavaScript", () => <ConnectionScreen embedded><PasswordSignIn onSubmit={(event) => event.preventDefault()} after="/" /></ConnectionScreen>, { source: "components/ui/connection.tsx · components/menus.tsx", code: "ConnectionScreen > PasswordSignIn", surfaces: ["ground"], phone: true }),
  row("incorrect password", "the field identifies and describes the server error; aria-invalid · aria-describedby · role=alert", () => <PasswordSignIn onSubmit={(event) => event.preventDefault()} after="/chat/example" error="Incorrect password." />, { source: "components/ui/connection.tsx · components/menus.tsx", code: "PasswordSignIn error", phone: true }),
  row("address · checking", "the address check is in progress", () => <ConnectionForm onSubmit={(e) => e.preventDefault()}><ConnectionAddress value="laptop.ts.net" state="checking" /><ConnectionStatus state="checking" title="Looking for laptop.ts.net…" /></ConnectionForm>, { source: "components/ui/connection.tsx · components/menus.tsx", code: "ConnectionAddress · ConnectionStatus · ConnectionPassword", phone: true }),
  row("address · found, password", "the server answered and asks for a password", () => <ConnectionForm onSubmit={(e) => e.preventDefault()}><ConnectionAddress value="laptop.ts.net" state="found" /><ConnectionStatus state="found" title="Laptop" detail="laptop.ts.net · 0.8.1" /><ConnectionPassword /></ConnectionForm>, { source: "components/ui/connection.tsx · components/menus.tsx", code: "ConnectionAddress · ConnectionStatus · ConnectionPassword", phone: true }),
  row("address · nothing answered", "the address check found no server", () => <ConnectionForm onSubmit={(e) => e.preventDefault()}><ConnectionAddress value="office.ts.net" state="missing" /><ConnectionStatus state="missing" title="Nothing answered" detail="office.ts.net" /></ConnectionForm>, { source: "components/ui/connection.tsx · components/menus.tsx", code: "ConnectionAddress · ConnectionStatus · ConnectionPassword", phone: true }),
  row("rate limited", "the server keeps the redirect and explains the wait; server keeps rate limiting and credential handling", () => <PasswordSignIn onSubmit={(event) => event.preventDefault()} after="/" error="Too many failed attempts. Try again shortly." />, { source: "components/ui/connection.tsx · components/menus.tsx", code: "PasswordSignIn error", phone: true }),
  row("first connection / add server", "live: type an address and it looks for it; one with \"laptop\" in it is found and asks for a password (\"conduit\" signs in), anything else answers nothing; uses v2 at every stage", () => <ConnectionDemo />, { source: "components/ui/connection.tsx · components/menus.tsx", code: "ConnectionForm · ConnectionChoice · ConnectionAddress · ConnectionStatus · ConnectionPassword", phone: true }),
  row("phone route panel", "Back returns to the parent; the opening tap cannot select a route; same submenu behavior adapter on desktop and phone", () => <ServerMenuDemo phone />, { source: "components/ui/connection.tsx · components/menus.tsx", code: "Kobalte Sub > v2 MenuPanel", phone: "only" }),
  row("server selection", "keyboard choice, unavailable rows and a real route submenu; no network calls or stored server changes", () => <ServerMenuDemo />, { source: "components/ui/connection.tsx · components/menus.tsx", code: "Kobalte > v2 Menu · Section · Item", phone: true }),
  ...["online", "connecting", "reconnecting", "offline"].map((state) => row(state, "connection state on the server control; shared status and type tokens", () => <ServerControl name="Laptop" detail={state === "offline" ? "Server unavailable" : state === "online" ? "Connected · 12 ms" : state === "reconnecting" ? "Reconnecting" : "Connecting"} connectivity={state} />, { source: "components/ui/connection.tsx · components/menus.tsx", code: "ServerControl > StatusDot · Spinner", phone: true })),
  row("inline control", "a desktop rail's foot: the state after the name, on one line", () => <ServerControl inline name="Laptop" detail="Connected · 12 ms" connectivity="online" />, { source: "components/ui/connection.tsx · components/menus.tsx", code: "<ServerControl inline>", phone: true }),
  row("collapsed control", "same status and accessible name in a narrow rail; the caller supplies layout state, never styling", () => <ServerControl compact name="Laptop" detail="Reconnecting" connectivity="reconnecting" aria-label="Laptop · Reconnecting" />, { source: "components/ui/connection.tsx · components/menus.tsx", code: "ServerControl compact", phone: true }),
  row("recovery", "a root error and the existing reload action; shared access layout and controls", () => <ConnectionRecovery embedded title="Conduit hit a UI error" error="The interface could not load." onRetry={() => {}} retryLabel="Reload Conduit" />, { source: "components/ui/connection.tsx · components/menus.tsx", code: "ConnectionRecovery", surfaces: ["ground"], phone: true }),
];

export const connectionPage: Page = {
  title: "Connection", rail: "Blocks",
  summary: "Sign-in, first connection, server selection and recovery. Shared v2 markup and tokens in the app and the server-rendered login page.",
  preview: CONNECTIONS[0]!.render,
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
  anatomy: { scene: CONNECTIONS[3]!.render, parts: [
    {selector: ".ui-connection-address",name: "Address",does: "checks the server address",from: "ConnectionAddress"},
    {selector: ".ui-connection-status",name: "Status",does: "shows what the address check found",from: "ConnectionStatus"},
    {selector: ".ui-connection-password",name: "Password",does: "accepts the password and submits the form",from: "ConnectionPassword"},
  ] },
  examples: [
    row("ConnectionHeading", "Conduit's mark, then what the screen asks", () => <ConnectionHeading mark={<HarnessMark id="conduit" />}>Connect to your server</ConnectionHeading>, { source: "components/ui/connection.tsx · client/main.tsx", phone: true, code: "<ConnectionHeading mark>title</ConnectionHeading>" }),
    ...CONNECTIONS,
  ],
  tokens: [{ title: "Its surface", tokens: [
    token("--control", "Control height"),
    token("--muted-foreground", "Secondary text"),
    token("--text-caption", "Status and detail text"),
    token("--space-sm", "Space between fields")
  ] }],
  api: ["ConnectionScreen", "ConnectionHeading", "HarnessMark", "PasswordSignIn", "ConnectionForm", "ConnectionChoices", "ConnectionChoice", "ConnectionGroup", "ConnectionAddress", "ConnectionStatus", "ConnectionPassword", "ConnectionRecovery", "ServerControl", "StatusDot", "Spinner", "Input", "Button", "CardBody", "CardNote", "Menu", "Section", "Item", "MenuPanel", "MenuParent", "CameraPreview"],
};
