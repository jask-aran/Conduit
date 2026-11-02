import { Icons } from "@/components/ui";
import { ServerControl } from "@/components/ui/connection";
import { NavPane, NavBrand, NavLead, NavFolder, NavFolderRow, NavSkeleton, NavNotice, NavRail, NavRailSection, Segmented as GSegmented, Button as GButton, Row, Group, Note, IconButton } from "@/components/ui";
import { row, token, type Page } from "../model";

const navScene = (folded = false) => <div class="g-nav-stage"><NavPane collapsed={folded} folded={folded}
        head={<><GButton variant="ghost" size="icon-sm" aria-label="Toggle Sidebar"><Icons.Sidebar /></GButton><NavBrand name="Conduit" /><GSegmented icons label="Sidebar section" value="conduit" onChange={() => {}} options={[{ value: "conduit", label: "Conduit", icon: <Icons.Dashboard /> }, { value: "computer", label: "Computer", icon: <Icons.Monitor /> }]} /></>}
        foot={<NavNotice icon={<Icons.Check />}>Conduit is up to date</NavNotice>}>
        <NavRail label="Quick navigation"><IconButton kind="rail" aria-label="Dashboard" current><Icons.Dashboard /></IconButton><IconButton kind="rail" aria-label="New project"><Icons.NewFolder /></IconButton><NavRailSection><IconButton kind="rail" aria-label="Japan" live><Icons.Folder /></IconButton></NavRailSection></NavRail>
        <Row density="nav" element="button" lead={<Icons.Dashboard />} current>Conduit Dashboard</Row><Row density="nav" element="button" lead={<Icons.NewFolder />}>New project</Row>
        <Group kind="nav" title="Projects"><NavFolder open row={<NavFolderRow icon={<Icons.Folder />} open within link={{}} toggle={{ "aria-label": "Collapse" }}>Japan</NavFolderRow>}><Row density="nav" element="button" indent lead={<Icons.Chat />}>Plan the trip</Row></NavFolder></Group>
        <Group kind="nav" title="Chats"><Row density="nav" element="button" lead={<Icons.Chat />}>Fix the build</Row><Row density="nav" element="button" quiet lead={<Icons.Search />} meta="7 more">View all chats</Row></Group>
      </NavPane></div>;

export const navPage: Page = {
  title: "Nav", rail: "Blocks",
  summary: "The sidebar on the frame: a NavPane (head, list, foot) of NavGroups, Rows (density nav) and NavFolders, and the rail it folds to. Rows rest grey; the cursor is the wash and white; current is white at the current weight with no fill, and so is the folder holding it. The keys are the app's (navigation/sidebar-cursor.ts).",
  preview: navScene,
  usage: `import { NavPane, NavBrand, NavLead, Group, NavFolder, NavFolderRow, Row, Button, Icons } from "@/components/ui";
import { ServerControl } from "@/components/ui/connection";

<NavPane head={<NavBrand name="Conduit" />} foot={<ServerControl name="Laptop" connectivity="online" />}>
  <NavLead server={<ServerControl name="Laptop" connectivity="online" />} actions={<Button onClick={newChat}>New chat</Button>} />
  <Group kind="nav" title="Projects">
    <NavFolder open={open()} row={<NavFolderRow icon={<Icons.Folder />} open={open()} link={{ onClick: openProject, children: "Conduit" }} toggle={{ onClick: toggleFolder, "aria-label": "Toggle Conduit" }} />}>
      <Row density="nav" element="button" indent current lead={<Icons.Chat />} onClick={openChat}>Fix the build</Row>
    </NavFolder>
  </Group>
</NavPane>`,
  anatomy: { scene: navScene, parts: [
    {selector: ".ui-nav-head",name: "Head",does: "holds the brand and section choice",from: "NavPane head"},
    {selector: ".ui-nav-list",name: "List",does: "holds groups, folders and chat rows",from: "NavPane children"},
    {selector: ".ui-nav-foot",name: "Foot",does: "shows update status",from: "NavPane foot"},
  ] },
  examples: [
    row("Row", "rest, current, within (holds current), open beside, selected", () => <div data-surface="frame" class="g-nav-frame"><Row density="nav" element="button" lead={<Icons.Chat />}>Rest</Row><Row density="nav" element="button" lead={<Icons.Chat />} current>Current</Row><Row density="nav" element="button" lead={<Icons.Folder />} within>Within</Row><Row density="nav" element="button" lead={<Icons.Chat />} open>Open beside</Row><Row density="nav" element="button" lead={<Icons.Chat />} selected>Selected</Row></div>, { phone: true, surfaces: ["ground"], code: "<Row (nav) current | within | open | selected>" }),
    row("Row (nav) · indent, detail, meta, end, quiet", "a chat in its folder, a terminal, View all, a link out", () => <div data-surface="frame" class="g-nav-frame"><Row density="nav" element="button" indent lead={<Icons.Chat />}>In a folder</Row><Row density="nav" element="button" lead={<Icons.Terminal />} detail="Japan · zsh · Active now">Shell</Row><Row density="nav" element="button" quiet lead={<Icons.Search />} meta="7 more">View all chats</Row><Row density="nav" element="button" lead={<Icons.Terminal />} end={<Icons.ExternalLink />}>Terminal View</Row></div>, { phone: true, surfaces: ["ground"], code: "<Row (nav) indent detail meta end quiet>" }),
    row("Group · away", "a client's section while it is offline: said after its label, its rows faint but still open", () => <div data-surface="frame" class="g-nav-frame"><Group kind="nav" title="Jask · Windows" away="Offline since 14:02"><NavFolder open={false} row={<NavFolderRow icon={<Icons.Workspace />} open={false} link={{}} toggle={{ "aria-label": "Expand" }}>Screenshots</NavFolderRow>}><Row density="nav" element="button" indent lead={<Icons.Chat />}>Casual greeting</Row></NavFolder></Group></div>, { code: '<Group label="Jask · Windows" away="Offline since 14:02">' }),
    row("NavFolder · Open", "its row (link and chevron, out of the tab order) and its rows, which slide; --duration-fold", () => <div data-surface="frame" class="g-nav-frame"><NavFolder open={true} row={<NavFolderRow icon={<Icons.Folder />} open={true} link={{}} toggle={{ "aria-label": "Toggle" }}>Japan</NavFolderRow>}><Row density="nav" element="button" indent lead={<Icons.Chat />}>Plan the trip</Row><Row density="nav" element="button" indent lead={<Icons.Chat />}>Gassho houses</Row></NavFolder></div>, { phone: true, surfaces: ["ground"], code: "<NavFolder open row={<NavFolderRow …>}>" }),
    row("NavFolder · Shut", "its row (link and chevron, out of the tab order) and its rows, which slide; --duration-fold", () => <div data-surface="frame" class="g-nav-frame"><NavFolder open={false} row={<NavFolderRow icon={<Icons.Folder />} open={false} link={{}} toggle={{ "aria-label": "Toggle" }}>Japan</NavFolderRow>}><Row density="nav" element="button" indent lead={<Icons.Chat />}>Plan the trip</Row><Row density="nav" element="button" indent lead={<Icons.Chat />}>Gassho houses</Row></NavFolder></div>, { phone: true, surfaces: ["ground"], code: "<NavFolder open row={<NavFolderRow …>}>" }),
    row("Note · NavSkeleton", "nothing here; not arrived yet", () => <div data-surface="frame" class="g-nav-frame"><Note kind="nav">No chats</Note><NavSkeleton rows={3} /></div>, { phone: true, surfaces: ["ground"], code: "<Note> · <NavSkeleton rows>" }),
    row("NavLead", "a phone's first line of the list, on its ground: the server it is on, New chat, search and the palette beside it, and what the server has to say under it; it scrolls with the list, so the head never moves", () => <div data-surface="frame" class="g-nav-frame" data-density="phone"><NavLead server={<ServerControl name="Desktop-Dev" detail="Connected" connectivity="online" />} actions={<><GButton variant="ghost" size="icon" aria-label="New chat"><Icons.NewChat /></GButton><GButton variant="ghost" size="icon" aria-label="Search chats"><Icons.Search /></GButton><GButton variant="ghost" size="icon" aria-label="Open command palette"><Icons.Terminal /></GButton></>}><NavNotice icon={<Icons.Check />}>Conduit updated</NavNotice></NavLead></div>, { phone: "only", surfaces: ["ground"], code: "<NavLead server actions><NavNotice /></NavLead>" }),
    row("NavNotice · ServerControl inline", "a desktop's foot: an update working, one waiting on a person; the server on one line (the downloads are in its menu)", () => <div data-surface="frame" class="g-nav-frame"><NavNotice busy>Checking for updates…</NavNotice><NavNotice ready icon={<Icons.Download />} action={{ label: "Restart", onClick: () => {} }}>New version ready</NavNotice><ServerControl inline name="Desktop-Dev" detail="Connected · 14 ms" connectivity="online" /></div>, { phone: true, surfaces: ["ground"], code: "<NavNotice busy | ready action> · <ServerControl inline>" }),
    row("IconButton", "rest, current, live (something works there)", () => <div data-surface="frame" class="g-nav-frame g-row"><IconButton kind="rail" aria-label="Dashboard"><Icons.Dashboard /></IconButton><IconButton kind="rail" aria-label="Japan" current><Icons.Folder /></IconButton><IconButton kind="rail" aria-label="Chat" live><Icons.Chat /></IconButton></div>, { phone: true, surfaces: ["ground"], code: "<IconButton current live>" }),
    row("NavPane · open and folded", "an open sidebar beside its folded rail", () => <div class="g-row g-top">{navScene()}{navScene(true)}</div>, { source: "navigation/sidebar.tsx", surfaces: ["ground"] }),
  ],
  tokens: [{ title: "Its surface", tokens: [
    token("--nav-width", "Expanded pane width"),
    token("--nav-rail-width", "Folded rail width"),
    token("--muted-foreground", "Rows at rest"),
    token("--duration-quick", "Row and folder changes")
  ] }],
  api: ["NavPane", "NavBrand", "NavLead", "ServerControl", "Group", "NavFolder", "NavFolderRow", "Row", "Note", "NavSkeleton", "NavNotice", "NavRail", "NavRailSection", "IconButton", "Segmented", "Button"],
};
