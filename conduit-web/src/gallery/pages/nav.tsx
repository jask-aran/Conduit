import { Icons } from "@/components/ui";
import { ServerControl } from "@/components/ui/connection";
import { NavPane, NavBrand, NavLead, NavGroup as GNavGroup, NavRow as GNavRow, NavFolder, NavFolderRow, NavNote, NavSkeleton, NavNotice, NavRail, NavRailSection, RailButton, Segmented as GSegmented, Button as GButton } from "@/components/ui";
import { row, token, type Page } from "../model";

const navScene = (folded = false) => <div class="g-nav-stage"><NavPane collapsed={folded} folded={folded}
        head={<><GButton variant="ghost" size="icon-sm" aria-label="Toggle Sidebar"><Icons.Sidebar /></GButton><NavBrand name="Conduit" /><GSegmented icons label="Sidebar section" value="conduit" onChange={() => {}} options={[{ value: "conduit", label: "Conduit", icon: <Icons.Dashboard /> }, { value: "computer", label: "Computer", icon: <Icons.Monitor /> }]} /></>}
        foot={<NavNotice icon={<Icons.Check />}>Conduit is up to date</NavNotice>}>
        <NavRail label="Quick navigation"><RailButton aria-label="Dashboard" current><Icons.Dashboard /></RailButton><RailButton aria-label="New project"><Icons.NewFolder /></RailButton><NavRailSection><RailButton aria-label="Japan" live><Icons.Folder /></RailButton></NavRailSection></NavRail>
        <GNavRow icon={<Icons.Dashboard />} current>Conduit Dashboard</GNavRow><GNavRow icon={<Icons.NewFolder />}>New project</GNavRow>
        <GNavGroup label="Projects"><NavFolder open row={<NavFolderRow icon={<Icons.Folder />} open within link={{}} toggle={{ "aria-label": "Collapse" }}>Japan</NavFolderRow>}><GNavRow indent icon={<Icons.Chat />}>Plan the trip</GNavRow></NavFolder></GNavGroup>
        <GNavGroup label="Chats"><GNavRow icon={<Icons.Chat />}>Fix the build</GNavRow><GNavRow quiet icon={<Icons.Search />} meta="7 more">View all chats</GNavRow></GNavGroup>
      </NavPane></div>;

export const navPage: Page = {
  title: "Nav", rail: "Blocks",
  summary: "The sidebar on the frame: a NavPane (head, list, foot) of NavGroups, NavRows and NavFolders, and the rail it folds to. Rows rest grey; the cursor is the wash and white; current is white at the current weight with no fill, and so is the folder holding it. The keys are the app's (navigation/sidebar-cursor.ts).",
  preview: navScene,
  usage: `import { NavPane, NavBrand, NavLead, NavGroup, NavRow, NavFolder, NavFolderRow, Button, Icons } from "@/components/ui";
import { ServerControl } from "@/components/ui/connection";

<NavPane head={<NavBrand name="Conduit" />} foot={<ServerControl name="Laptop" connectivity="online" />}>
  <NavLead server={<ServerControl name="Laptop" connectivity="online" />} actions={<Button onClick={newChat}>New chat</Button>} />
  <NavGroup label="Projects">
    <NavFolder open={open()} row={<NavFolderRow icon={<Icons.Folder />} open={open()} link={{ onClick: openProject, children: "Conduit" }} toggle={{ onClick: toggleFolder, "aria-label": "Toggle Conduit" }} />}>
      <NavRow indent current icon={<Icons.Chat />} onClick={openChat}>Fix the build</NavRow>
    </NavFolder>
  </NavGroup>
</NavPane>`,
  anatomy: { scene: navScene, parts: [
    {selector: ".ui-nav-head",name: "Head",does: "holds the brand and section choice",from: "NavPane head"},
    {selector: ".ui-nav-list",name: "List",does: "holds groups, folders and chat rows",from: "NavPane children"},
    {selector: ".ui-nav-foot",name: "Foot",does: "shows update status",from: "NavPane foot"},
  ] },
  examples: [
    row("NavRow", "rest, current, within (holds current), open beside, selected", () => <div data-surface="frame" class="g-nav-frame"><GNavRow icon={<Icons.Chat />}>Rest</GNavRow><GNavRow icon={<Icons.Chat />} current>Current</GNavRow><GNavRow icon={<Icons.Folder />} within>Within</GNavRow><GNavRow icon={<Icons.Chat />} open>Open beside</GNavRow><GNavRow icon={<Icons.Chat />} selected>Selected</GNavRow></div>, { phone: true, surfaces: ["ground"], code: "<NavRow current | within | open | selected>" }),
    row("NavRow · indent, detail, meta, end, quiet", "a chat in its folder, a terminal, View all, a link out", () => <div data-surface="frame" class="g-nav-frame"><GNavRow indent icon={<Icons.Chat />}>In a folder</GNavRow><GNavRow icon={<Icons.Terminal />} detail="Japan · zsh · Active now">Shell</GNavRow><GNavRow quiet icon={<Icons.Search />} meta="7 more">View all chats</GNavRow><GNavRow icon={<Icons.Terminal />} end={<Icons.ExternalLink />}>Terminal View</GNavRow></div>, { phone: true, surfaces: ["ground"], code: "<NavRow indent detail meta end quiet>" }),
    row("NavFolder · Open", "its row (link and chevron, out of the tab order) and its rows, which slide; --duration-fold", () => <div data-surface="frame" class="g-nav-frame"><NavFolder open={true} row={<NavFolderRow icon={<Icons.Folder />} open={true} link={{}} toggle={{ "aria-label": "Toggle" }}>Japan</NavFolderRow>}><GNavRow indent icon={<Icons.Chat />}>Plan the trip</GNavRow><GNavRow indent icon={<Icons.Chat />}>Gassho houses</GNavRow></NavFolder></div>, { phone: true, surfaces: ["ground"], code: "<NavFolder open row={<NavFolderRow …>}>" }),
    row("NavFolder · Shut", "its row (link and chevron, out of the tab order) and its rows, which slide; --duration-fold", () => <div data-surface="frame" class="g-nav-frame"><NavFolder open={false} row={<NavFolderRow icon={<Icons.Folder />} open={false} link={{}} toggle={{ "aria-label": "Toggle" }}>Japan</NavFolderRow>}><GNavRow indent icon={<Icons.Chat />}>Plan the trip</GNavRow><GNavRow indent icon={<Icons.Chat />}>Gassho houses</GNavRow></NavFolder></div>, { phone: true, surfaces: ["ground"], code: "<NavFolder open row={<NavFolderRow …>}>" }),
    row("NavNote · NavSkeleton", "nothing here; not arrived yet", () => <div data-surface="frame" class="g-nav-frame"><NavNote>No chats</NavNote><NavSkeleton rows={3} /></div>, { phone: true, surfaces: ["ground"], code: "<NavNote> · <NavSkeleton rows>" }),
    row("NavLead", "a phone's first line of the list, on its ground: the server it is on, New chat, search and the palette beside it, and what the server has to say under it; it scrolls with the list, so the head never moves", () => <div data-surface="frame" class="g-nav-frame" data-density="phone"><NavLead server={<ServerControl name="Desktop-Dev" detail="Connected" connectivity="online" />} actions={<><GButton variant="ghost" size="icon" aria-label="New chat"><Icons.NewChat /></GButton><GButton variant="ghost" size="icon" aria-label="Search chats"><Icons.Search /></GButton><GButton variant="ghost" size="icon" aria-label="Open command palette"><Icons.Terminal /></GButton></>}><NavNotice icon={<Icons.Check />}>Conduit updated</NavNotice></NavLead></div>, { phone: "only", surfaces: ["ground"], code: "<NavLead server actions><NavNotice /></NavLead>" }),
    row("NavNotice · ServerControl inline", "a desktop's foot: an update working, one waiting on a person; the server on one line (the downloads are in its menu)", () => <div data-surface="frame" class="g-nav-frame"><NavNotice busy>Checking for updates…</NavNotice><NavNotice ready icon={<Icons.Download />} action={{ label: "Restart", onClick: () => {} }}>New version ready</NavNotice><ServerControl inline name="Desktop-Dev" detail="Connected · 14 ms" connectivity="online" /></div>, { phone: true, surfaces: ["ground"], code: "<NavNotice busy | ready action> · <ServerControl inline>" }),
    row("RailButton", "rest, current, live (something works there)", () => <div data-surface="frame" class="g-nav-frame g-row"><RailButton aria-label="Dashboard"><Icons.Dashboard /></RailButton><RailButton aria-label="Japan" current><Icons.Folder /></RailButton><RailButton aria-label="Chat" live><Icons.Chat /></RailButton></div>, { phone: true, surfaces: ["ground"], code: "<RailButton current live>" }),
    row("NavPane · open and folded", "an open sidebar beside its folded rail", () => <div class="g-row g-top">{navScene()}{navScene(true)}</div>, { source: "navigation/sidebar.tsx", surfaces: ["ground"] }),
  ],
  tokens: [{ title: "Its surface", tokens: [
    token("--nav-width", "Expanded pane width"),
    token("--nav-rail-width", "Folded rail width"),
    token("--muted-foreground", "Rows at rest"),
    token("--duration-quick", "Row and folder changes")
  ] }],
  api: ["NavPane", "NavBrand", "NavLead", "ServerControl", "NavGroup", "NavFolder", "NavFolderRow", "NavRow", "NavNote", "NavSkeleton", "NavNotice", "NavRail", "NavRailSection", "RailButton", "Segmented", "Button"],
};
