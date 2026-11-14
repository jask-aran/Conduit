import { lazy, type Component, type JSX } from "solid-js";
import { DOCUMENT_EXTRAS, DOCUMENT_TOOLS, type DocumentHost, type DocumentToolName } from "@/components/document/host";
import type { MarkupCapabilities, MarkupHost } from "@/components/markup";
import type { ShortcutManager } from "../shortcuts/shortcut-manager";
import { Icons } from "@/components/ui";
import type { Artifact, ArtifactKind } from "./artifacts";
import type { FocusedArtifact } from "./focused-artifact";

/*
 * A kind of artifact, on the client: everything else (the pane, Markup over it, its comments and their margin, the
 * palette's commands) is written once for every kind and reaches the kind only through its entry here and the
 * ArtifactSurface its Surface reports. A new kind is an entry and a surface file.
 */

/** What the open Markup tool offers a surface that asks itself (a paper's `@`): who is listening, and opening a comment on a range for one of them. */
export type MarkupOffer = NonNullable<Parameters<NonNullable<MarkupHost["asks"]>>[0]>;

/** The members of a MarkupHost the pane sets for every kind: where items go and who sends them, the bar's frame, the kind's capabilities (from its entry), and the open tool's `asks` and `sent`. */
type PaneMarkup = "names" | "anchors" | "transport" | "clientId" | "capturePage" | "frame" | "notify" | "capabilities" | "asks" | "sent";

/** What a surface is to its pane, handed over once as it is made. Every member but `markup` is optional: a kind without it simply has none of what it gives. */
export type ArtifactSurface = {
  /** The kind's part of Markup's host: at least `client` and `subject` (what an item says it was made on), and `under` (what a mark lies over, in the kind's own terms; only the kind reads it back). A kind whose Markup sends comments to the margin also gives `margin`, which is where its anchors are kept and placed. */
  markup: Omit<MarkupHost, PaneMarkup>;
  /** Its own commands of the palette's ARTIFACT_COMMANDS (the pane adds the thread and the margin's next and previous comment). Read each time the palette or a shortcut asks, so it follows what the surface has ready. */
  offers?(): FocusedArtifact["offers"];
  /** Controls of its own for the pane's header, put after the comment list and before "Connect a chat". */
  header?(): JSX.Element;
  /** Its copy is out of touch with the hub and keeps what is written until it is back: the header says it is reconnecting. */
  away?(): boolean;
  /** The hub refuses this page as older than the artifact: the header offers a reload, the only mend. */
  stale?(): boolean;
  /** Showing a place in it, as its anchors name one (a comment's card pressed in a thread asks for it): read reactively, undefined until the surface can, and the pane waits until then. */
  reveal?(): ((place: string) => void) | undefined;
};

/** What the pane gives every surface. */
export type ArtifactSurfaceProps = {
  /** The artifact as the hub last told it (renamed, its name follows); its id is the surface's for life, since another artifact is another surface. */
  about(): Artifact;
  /** The app's own interface feedback is open over it: the artifact's Markup tool is shut, and a surface asks nothing of it (no `@`, no comment on a selection). */
  quiet?: boolean;
  /** What the open Markup tool offers for asking; null while it is shut. */
  offer(): MarkupOffer | null;
  /** The comment margin over the host the surface reported, for a kind whose Markup sends comments to the margin (`sent: "margin"`) to place beside what it draws; read once, after `onSurface`. `marginEmpty`: it has no card, so it can take no room. */
  margin: JSX.Element;
  marginEmpty: boolean;
  /** The pane's element, which holds what the surface draws: for finding its own parts. */
  pane(): HTMLElement | undefined;
  /** The app's shortcuts, for a kind that lists its keys: what each of the palette's commands is bound to now. */
  shortcuts?: ShortcutManager;
  /** Called once, as the surface is made and before it reads `margin`. */
  onSurface(surface: ArtifactSurface): void;
};

export type ArtifactKindClient = {
  /** What it is called where it is named (the creator, a tab with no name yet); lowercased, the pane's word for it ("Opening the paper…"). */
  label: string;
  /** The creator's line about it. */
  says: string;
  /** Its mark in a row. */
  icon: Component;
  /**
   * What its ribbon offers, as two sets that stand apart on it: `edit`, the tools that change the artifact itself (a
   * paper's block kinds and text marks; a site has none, since its file is an agent's to change), and `markup`, what
   * Markup offers over it. `suggest`: Suggesting is offered beside Editing (DocumentHost.suggest). A tool in neither is
   * not drawn and cannot be called. The interface's own feedback declares its Markup in client/feedback/conduit-feedback.tsx.
   */
  edit: readonly DocumentToolName[];
  suggest?: DocumentHost["suggest"];
  /** For a kind drawn in the document editor, what its file holds beyond plain Markdown (DocumentHost.holds). */
  holds?: DocumentHost["holds"];
  markup: Partial<MarkupCapabilities>;
  /** The hub gives its Markdown (`?as=markdown`): its row offers Copy and Download Markdown. `count`: it can say how many blocks and words it has. */
  markdown?: boolean;
  count?: boolean;
  /** The ending of the files that are this kind only when asked: one opens in the file viewer until it is opened as this (artifactAt with `adopt`). */
  opens?: string;
  /** Draws it in its pane. Lazy, so a kind's code is fetched only once one is opened, and the pane waits for it with the artifact itself. */
  Surface: Component<ArtifactSurfaceProps> & { preload(): Promise<unknown> };
};

const PAPER_MARKUP: Partial<MarkupCapabilities> = { deliveries: ["batched", "live"], tools: ["quote", "highlight", "pen", "shape", "text", "erase", "note"], screenshot: false, sent: "margin", thin: false, bar: "ribbon" };
const paperSurface = lazy(() => import("./paper-surface"));

/** Every kind, in the order the creator offers them. */
export const ARTIFACT_KINDS: Record<ArtifactKind, ArtifactKindClient> = {
  paper: {
    label: "Paper",
    says: "Blocks of text you and agents write together, with comments in the margin.",
    icon: Icons.FileText,
    edit: DOCUMENT_TOOLS,
    suggest: { controls: "margin" },
    holds: DOCUMENT_EXTRAS,
    markup: PAPER_MARKUP,
    markdown: true, count: true,
    Surface: paperSurface,
  },
  // A paper's editor over a plain Markdown file: only what Markdown itself says.
  markdown: {
    label: "Markdown",
    says: "A plain Markdown file you and agents write together, with comments in the margin.",
    opens: ".md",
    icon: Icons.File,
    edit: ["text", "heading-1", "heading-2", "heading-3", "bullets", "numbers", "checklist", "quote", "code", "table", "image", "divider", "bold", "italic", "strike"], // "code" names both the block and the mark
    suggest: { controls: "margin" },
    holds: ["callout", "toggle"], // What common Markdown says itself: an alert and a <details>. Colour, highlight, underline and dates wait for the styling layer beside the file.
    markup: PAPER_MARKUP,
    markdown: true, count: true,
    Surface: paperSurface,
  },
  site: {
    label: "Site",
    says: "A page an agent builds as one HTML file. You mark it up, and the agent changes the file.",
    icon: Icons.Browser,
    edit: [],
    markup: { deliveries: ["batched", "live"], tools: ["pen", "highlight", "shape", "text", "erase", "note"], screenshot: true, sent: "corner", thin: false, bar: "ribbon", grounded: true },
    Surface: lazy(() => import("./site-surface")),
  },
};
/** The kind a file may be opened as when asked, if any. */
export const opensAs = (path: string) => (Object.keys(ARTIFACT_KINDS) as ArtifactKind[]).find((kind) => { const ending = ARTIFACT_KINDS[kind].opens; return ending !== undefined && path.endsWith(ending); });
