import { For } from "solid-js";
import { CopyIcon, FolderIcon, MenuIcon, PaperclipIcon, PencilIcon, PlusIcon, SearchIcon, ShareIcon, SquarePenIcon, Trash2Icon } from "lucide-solid";
import { Button, Input } from "@/components/primitives";
import { Bubble, Card, Frost, Menu, Pill, Row, Sep, Title } from "@/components/ui";
import { HarnessMark } from "../client/harness-brand";
import { PlaceGlyph } from "../client/chat/place-picker";
import type { Atom } from "./atoms";
import { MODELS, PROFILES, PROJECTS } from "./seed";

/* The unified library, piece by piece, primitives first. Same pieces on desktop and in the phone frame. */

const lib = (id: string, name: string, source: string, render: Atom["render"]): Atom => ({ id: `ui-${id}`, name, scope: "both", kind: "component", source, render });

export const libraryAtoms: Atom[] = [
  lib("frost", "Frost · rest", "Frost", () => <Frost class="g-swatch" />),
  lib("frost-raised", "Frost · raised", "Frost lift=raised", () => <Frost lift="raised" class="g-swatch" />),
  lib("frost-core", "Frost · core", "Frost core", () => <Frost lift="raised" core class="g-swatch" />),
  lib("pill-one", "Pill · one", "Pill", () => <Pill icons={[{ label: "Menu", icon: <MenuIcon /> }]} />),
  lib("pill-many", "Pill · several", "Pill", () => <div class="g-row"><Pill icons={[{ label: "Menu", icon: <MenuIcon /> }, { label: "New chat", icon: <SquarePenIcon /> }]} /><Pill icons={[{ label: "Search", icon: <SearchIcon /> }, { label: "Folder", icon: <FolderIcon /> }, { label: "Share", icon: <ShareIcon /> }]} /></div>),
  lib("bubble", "User message", "Bubble", () => <div style={{ width: "240px" }}><Bubble>write a .txt file with lorem ipsum</Bubble></div>),
  lib("title", "Section title", "Title", () => <Menu><Title aside="12% context">Profile</Title></Menu>),
  lib("rows", "Row kinds", "Row", () => <Menu>
    <Row>Manage settings</Row>
    <Row icon={<PaperclipIcon />}>Attach files</Row>
    <Row meta="xai">Grok 4.6</Row>
    <Row icon={<SearchIcon />} keys={["Ctrl", "K"]}>Search</Row>
    <Row opens>Route</Row>
    <Row icon={<HarnessMark id="conduit" class="size-4" />} opens>Assistant</Row>
    <Row checked>Muse Spark 1.3</Row>
    <Row disabled meta="offline">Laptop</Row>
    <Row icon={<Trash2Icon />} destructive>Delete</Row>
  </Menu>),
  lib("list", "List section", "Title + Row", () => <Menu><Title>Project</Title><For each={PROJECTS.slice(2, 6)}>{(project) => <Row icon={<PlaceGlyph project={project} />}>{project.name}</Row>}</For><Sep /><Row icon={<PlusIcon />}>New project</Row></Menu>),
  lib("choice", "Choice section", "Title + Row checked", () => <Menu><Title>Model</Title><For each={MODELS.slice(0, 4)}>{(model, index) => <Row checked={index() === 2} meta={model.provider}>{model.label}</Row>}</For></Menu>),
  lib("profiles", "Profiles", "Row + HarnessMark", () => <Menu><Title>Profile</Title><For each={PROFILES}>{(profile, index) => <Row checked={index() === 0} icon={<HarnessMark id={profile.implementation || "conduit"} class="size-4" />} meta={profile.implementation}>{profile.label}</Row>}</For></Menu>),
  lib("server", "Server menu", "Menu", () => <Menu><Title>Servers</Title><Row checked>Desktop-Dev</Row><Row checked={false}>Laptop</Row><Sep /><Row opens>Route</Row><Row>Manage settings</Row><Row>Sign out</Row></Menu>),
  lib("chat", "Chat menu", "Menu", () => <Menu><Title>Lorem ipsum file</Title><Row icon={<ShareIcon />}>Share</Row><Row icon={<PencilIcon />}>Rename</Row><Row icon={<CopyIcon />}>Copy link</Row><Sep /><Row icon={<Trash2Icon />} destructive>Delete</Row></Menu>),
  lib("confirm", "Confirm card", "Card", () => <Card title="Delete this chat?" detail="It can't be brought back." class="g-card" actions={<><Button variant="outline">Cancel</Button><Button variant="destructive">Delete</Button></>} />),
  lib("prompt", "Prompt card", "Card + Input", () => <Card title="Rename chat" class="g-card" actions={<><Button variant="outline">Cancel</Button><Button>Save</Button></>}><Input value="Lorem ipsum file" /></Card>),
];
