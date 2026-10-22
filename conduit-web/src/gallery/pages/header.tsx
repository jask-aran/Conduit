import { Header, HeaderButton, HeaderCrumb, HeaderNote, Icons } from "@/components/ui";
import { row, token, type Page } from "../model";

const chat = () => <div style={{ width: "100%" }}><Header actions={<HeaderButton label="Copy Tailscale chat link" icon={<Icons.Share />} />}
  after={<HeaderNote label="Not in Conduit" action={{ label: "Track", onClick: () => {} }} />}><HeaderCrumb place="Codex" onPlace={() => {}} title="Fix the flaky upload test" /></Header></div>;

export const headerPage: Page = {
  title: "Header", rail: "Blocks",
  summary: "A pane's top line: its name at the left (a place's crumb, then the title, or the tab row), what the page is beside it, quiet controls at the right, the pane's swap and close last. It fades into what scrolls under it.",
  preview: chat,
  usage: `import { Header, HeaderCrumb, HeaderNote, HeaderButton, Icons } from "@/components/ui";

<Header
  after={<HeaderNote label="Not in Conduit" action={{ label: "Track", onClick: trackChat }} />}
  actions={<HeaderButton label="Copy chat link" icon={<Icons.Share />} onClick={copyLink} />}
>
  <HeaderCrumb place="Conduit" onPlace={openProject} title="Fix the build" />
</Header>`,
  anatomy: { scene: chat, parts: [
    { selector: ".ui-header-place", name: "Place", does: "the project or workspace the chat sits in; opens it", from: "HeaderCrumb place" },
    { selector: ".ui-header-crumb > :last-child", name: "Title", does: "the chat's name, cut short when the line is full", from: "HeaderCrumb title" },
    { selector: ".ui-header-note", name: "Note", does: "what the page is, and the one thing to do about it", from: "HeaderNote (after)" },
    { selector: ".ui-header-group[data-actions]", name: "Actions", does: "quiet icon buttons, each named by its label", from: "HeaderButton (actions)" },
  ] },
  examples: [
    row("crumb under a place", "the place is a link to it", () => <HeaderCrumb place="Japan" onPlace={() => {}} title="Planning the Kyoto leg" />, { code: "<HeaderCrumb place onPlace title>" }),
    row("crumb alone", "a place itself", () => <HeaderCrumb title="Japan" />, { code: "<HeaderCrumb title>" }),
    row("note", "what the page is and the one thing to do about it", () => <HeaderNote label="Not in Conduit" action={{ label: "Track", onClick: () => {} }} />, { code: "<HeaderNote label action>" }),
    row("note · working", "its action under way", () => <HeaderNote label="Not in Conduit" action={{ label: "Track", busy: true, busyLabel: "Tracking…", onClick: () => {} }} />),
    row("buttons", "an icon with its label as its name", () => <div class="g-row"><HeaderButton label="Copy Tailscale chat link" icon={<Icons.Share />} /><HeaderButton label="Search chats" icon={<Icons.Search />} /></div>, { code: "<HeaderButton label icon>" }),
    row("assembled", "a chat's header: crumb, note, an action", chat, { surfaces: ["ground"] }),
  ],
  tokens: [{ title: "Its line", tokens: [
    token("--header-height", "its height"),
    token("--text-row", "the title's size"),
    token("--muted-foreground", "the place and the note's label"),
  ] }],
  api: ["Header", "HeaderCrumb", "HeaderNote", "HeaderButton", "HeaderPill"],
};
