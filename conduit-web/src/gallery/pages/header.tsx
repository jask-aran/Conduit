import { Icons } from "@/components/ui";
import { FormTable, form } from "../specs";
import { Header, HeaderButton, HeaderCrumb, HeaderNote } from "@/components/ui";
import { type Family, lib } from "../model";

export const headerFamily: Family = { title: "Header", note: "a pane's top line: the name (a place's caps crumb, then the title) or the tab row at the left, what the page is beside it, quiet ghost controls at the right, the pane's swap and close last. It fades into what scrolls under it; a tab row's strip may be frost. On a phone the title gives way and the leading controls, the name (HeaderPill: its place's mark, a folder, a workspace's glyph or Conduit's for a chat in no folder, then the title wrapping to two lines; the chat menu's trigger) and the actions float as frost pills -- see the Phone preview, which draws the app's own ChatHeader", rail: "Blocks",
  usage: `import { Header, HeaderCrumb, HeaderNote, HeaderButton, Icons } from "@/components/ui";

<Header
  after={<HeaderNote label="Not in Conduit" action={{ label: "Track", onClick: trackChat }} />}
  actions={<HeaderButton label="Copy chat link" icon={<Icons.Share />} onClick={copyLink} />}
>
  <HeaderCrumb place="Conduit" onPlace={openProject} title="Fix the build" />
</Header>`,
  api: ["Header", "HeaderCrumb", "HeaderNote", "HeaderButton"],
  groups: [
    { title: "Forms", layout: "desktop", atoms: [
      lib("header-forms", "Header · forms", "desktop", "header", "components/ui/header.tsx", () => <FormTable rows={[
        form("HeaderCrumb", "under a place (a link to it); a place itself", () => <div style={{ display: "grid", gap: "var(--space-md)" }}><HeaderCrumb place="Japan" onPlace={() => {}} title="Planning the Kyoto leg" /><HeaderCrumb title="Japan" /></div>, "<HeaderCrumb place onPlace title>"),
        form("HeaderNote", "what the page is and the one thing to do about it; working", () => <div class="g-row"><HeaderNote label="Not in Conduit" action={{ label: "Track", onClick: () => {} }} /><HeaderNote label="Not in Conduit" action={{ label: "Track", busy: true, busyLabel: "Tracking…", onClick: () => {} }} /></div>, "<HeaderNote label action>"),
        form("HeaderButton", "an icon with its label as its name; only one layout's", () => <div class="g-row"><HeaderButton label="Copy Tailscale chat link" icon={<Icons.Share />} /><HeaderButton label="Search chats" icon={<Icons.Search />} /></div>, "<HeaderButton label icon only>"),
      ]} on={["desktop"]} />, "row"),
    ] },
    { title: "Assembled", layout: "desktop", atoms: [
      lib("header-chat", "Header · a chat", "desktop", "header", "chat/chat-screen.tsx ChatHeader", () => <div style={{ width: "100%", "align-self": "stretch" }}><Header actions={<HeaderButton label="Copy Tailscale chat link" icon={<Icons.Share />} />}
        after={<HeaderNote label="Not in Conduit" action={{ label: "Track", onClick: () => {} }} />}><HeaderCrumb place="Codex" onPlace={() => {}} title="Fix the flaky upload test" /></Header></div>, true),
    ] },
  ] };
