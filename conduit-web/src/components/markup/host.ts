/*
 * The markup tool's boundary. The tool (this folder) marks up a running interface and sends what was marked; it
 * knows nothing of the app it runs in. Everything of the app's reaches it through a MarkupHost, and it imports only
 * solid-js and the library (components/ui): no app module, no virtual module, no fetch of its own. That is what lets
 * the folder be lifted into another project, which writes a host and mounts <MarkupTool>.
 *
 * The other half is the receiver (server/markup-store.js: the item folder, who is listening). A transport speaks
 * to one; httpTransport is the routes both Conduit's hub and `conduit-markup serve` answer.
 */
import type { JSX } from "solid-js";

/** Which piece draws an element, read from the host's own source at build time (Conduit: scripts/ui-pieces.mjs). */
export type PieceNames = {
  /** A piece: where it is declared, the piece its root is drawn through, the pieces that draw through it unnamed. */
  pieces: Record<string, { source: string; wraps?: string; through?: string[] }>;
  /** A class: the piece whose root it is (also: others that claim it), or the piece it is a part of. */
  classes: Record<string, { piece: string; also?: string[]; part?: true }>;
  /** A class: where its rules start, in each stylesheet that has one. */
  styles: Record<string, string[]>;
  /** An anchor (`data-region=sidebar`): where the app writes it. */
  anchors: Record<string, string>;
};
/** A host with no names of its own: a piece is then an element that says so (`data-piece`), or a control, a landmark or a heading. */
export const NO_NAMES: PieceNames = { pieces: {}, classes: {}, styles: {}, anchors: {} };

/** What a listener is: the artifact's own `thread`, the person's `agent`, a connected `chat`, or a `session` whose `wait` is running (all a receiver that does not say is listing). */
export type MarkupListenerKind = "thread" | "agent" | "chat" | "session";
/** Someone an item can be handed to, waiting or at work on one it took. `lead`: who an item for nobody by name goes to, where the receiver keeps one (an artifact's); at most one is. */
export type MarkupListener = { name: string; state: string; since?: string; kind: MarkupListenerKind; lead?: true };
export type MarkupHanded = { to: { name: string } | null };

/** An item once sent, as the person follows it: where it stands (`by`: the session it was handed to or that took it), and what was said about each comment (`n`) or the item as a whole.
 *  A message with `resolved` and no `text` is that comment settled (or reopened) by whoever it is `from`. `working`: the session has been handed it and has not yet answered. */
export type MarkupThread = { id: string; sentAt: string; state: "waiting" | "taken" | "handled"; by: string | null; unread: number; working?: boolean;
  comments: { n: number; name: string; comment: string; quote?: string; under?: Record<string, string | number | boolean>; resolved?: boolean; resolvedBy?: "agent" | "person"; working?: boolean }[]; messages: { at: string; from: "agent" | "person"; n: number | null; text?: string; resolved?: boolean }[] };
/** An item in the list of what was sent before; `first` is its first comment's words. */
export type MarkupSent = { id: string; sentAt: string; state: MarkupThread["state"]; by: string | null; unread: number; comments: number; first: string };

/** What Send carries besides the pictures. `comments` and `screenshot` are the tool's; `client` is the tool's facts (url, viewport, userAgent) with the host's own over them. */
export type MarkupSend = { comments: unknown[]; screenshot: Record<string, unknown>; client: Record<string, unknown>; to: string | null; live?: boolean; subject?: Record<string, string | number | boolean> };

export interface MarkupTransport {
  /** "This moment": the receiver keeps what it knows now, under the id the item is later sent to. */
  mark(client: string): Promise<{ id: string }>;
  /** A PNG for a mark: the whole screenshot, or selection `n`'s own area of it. */
  picture(mark: string, png: Blob, n?: number): Promise<void>;
  /** A `live` send leaves the mark open: the next to it adds its comments to the same item. */
  send(mark: string, item: MarkupSend): Promise<{ id: string; handed: MarkupHanded }>;
  /** A sent item's thread; `seen`: the person is reading it now. */
  thread(id: string, seen?: boolean): Promise<MarkupThread>;
  /** The person writes back, about comment `n` or the item as a whole. */
  say(id: string, n: number | null, text: string): Promise<MarkupThread>;
  /** Comment `n` is settled, or reopened. */
  resolve(id: string, n: number, resolved: boolean): Promise<MarkupThread>;
  /** The latest items not finished, with an answer unread or sent in the last day, newest first. */
  threads(): Promise<MarkupSent[]>;
  /** Every item the person has not put away, oldest first: one with a comment they have not resolved themselves, or with an answer unread. A margin shows these. */
  open(): Promise<MarkupThread[]>;
  /** A mark nothing was sent to. */
  drop(mark: string): Promise<void>;
  listening(): Promise<MarkupListener[]>;
}

/**
 * How what is marked up reaches whoever answers, which is a matter of who the person is to them:
 *   one-way   markup from someone who is owed no answer (a visitor, a tester): Send delivers the item and that is all.
 *             Nothing comes back, and the tool asks the receiver for nothing but to take it.
 *   batched   a collaborator's: comments wait until Send, which delivers every one outstanding. What is sent in one
 *             sitting is one item that grows, and each comment sent is a thread the agent answers and the person
 *             writes back on.
 *   live      with batched: each comment has "Send now", which is on while a session is listening, so it goes as it
 *             is Done; turned off, or with no one listening, it waits for Send like any other.
 */
export type MarkupDelivery = "one-way" | "batched" | "live";

/** A tool of the rail. */
export type MarkupToolName = "select" | "quote" | "pen" | "highlight" | "shape" | "text" | "erase" | "note";

/**
 * What the tool is in one place it is put: a host declares only what belongs there, and nothing else is offered, by
 * the bar or by a key. (The receiver has its own half: a one-way one is made with `answered: false`.)
 */
export type MarkupCapabilities = {
  /** How it reaches whoever answers. One-way stands alone; a collaborator's host offers batched, live or both, the first being what it opens on. */
  deliveries: readonly ["one-way"] | readonly [Exclude<MarkupDelivery, "one-way">, ...Exclude<MarkupDelivery, "one-way">[]];
  /** The rail, in its own order whatever order they are listed in. */
  tools: readonly MarkupToolName[];
  /** Annotating a screenshot, where the client can take one. */
  screenshot: boolean;
  /** Showing the sessions that are listening and handing an item to one. Live needs it, and one listening: a comment that goes as it is Done goes to someone. */
  listeners: boolean;
  /** Choosing what a drawing is drawn in, and how thick. */
  inks: boolean;
  /** Where a comment stands once sent: in the tool's own `corner` stack while the tool is open, or in the host's `margin` (MarkupMargin, which the host mounts) beside what it is about, the tool open or not. */
  sent: "corner" | "margin";
  /** The bar is thinner than the library's frost, to show the interface being looked at under it; a document's needs no such thing. */
  thin: boolean;
  /** Where the bar stands: at the `foot` of what is marked up, opened and closed, in parts side by side (what is marked up, the tools, sending; one bar on a phone); or a `ribbon` at the head of the host's frame, always there, the host's own tools in it beside Markup's: an artifact's, which is edited and marked up in one place. */
  bar: "foot" | "ribbon";
  /** What the tool stands over may be light (a site in a frame), where frost alone cannot be read: its bar and cards then have a dark ground of their own. */
  grounded: boolean;
};
/** What a host that declares nothing gets: a collaborator's batched markup with every tool. */
export const MARKUP_CAPABILITIES: MarkupCapabilities = { deliveries: ["batched"], tools: ["select", "quote", "pen", "highlight", "shape", "text", "erase", "note"], screenshot: true, listeners: true, inks: true, sent: "corner", thin: true, bar: "foot", grounded: false };

/** A comment that stands in the margin, as the surface is told of it: `key` is "<item>/<n>"; `quote` and `under` are what it was sent with; `current`: its card is open; `resolved`: by the person, so it is no longer marked. */
export type MarkupAnchor = { key: string; quote?: string; under?: Record<string, string | number | boolean>; current: boolean; resolved: boolean };

/** What a surface with a margin does for it: it marks what each comment is about, and says where that is. */
export interface MarkupMarginHost {
  /** Told every comment in the margin, each time they change. */
  anchors(list: MarkupAnchor[]): void;
  /** Where what one is about is now (its box, in the viewport's pixels); null when the surface cannot find it. */
  place(key: string): { left: number; top: number; width: number; height: number } | null;
  /** The column of what is marked up (a paper's text), which an open card spans where the margin lies over it. */
  column?(): { left: number; width: number } | null;
  /** The listener is told when a place may have changed, and (with its key) when the person pressed what a comment is about. The return ends it. */
  watch(listener: (pressed?: string) => void): () => void;
  /** Where the surface keeps what an agent changed to answer a comment: whether there is such a change (read where it is drawn, so it follows), and taking it back. */
  revert?: { can(key: string): boolean; run(key: string): Promise<unknown> };
  /** Stops whoever is at work on a comment (its chat's turn), where the surface can. */
  stop?(key: string): Promise<unknown>;
  /** Who is at work on a comment now and what they are doing (thinking, reading, writing), read where drawn so it follows; undefined while no one is. */
  working?(key: string): { by: string; state: string } | undefined;
  /** Changes an agent has proposed to the surface and not made, each a card of its own in the margin, in the order of their places: `list` read where drawn,
   *  `place` where each is now (as `place` above), and the person taking or declining it. */
  suggestions?: { list(): MarkupSuggestion[]; place(key: string): { left: number; top: number; width: number; height: number } | null; accept(key: string): unknown; reject(key: string): unknown; acceptAll?(by?: string): unknown; rejectAll?(by?: string): unknown };
  /** Gives the keyboard back to the surface, as a card is shut from it. */
  focus?(): void;
}
/** A proposed change, as a margin shows it: who proposed it, when, and what it would do. */
export type MarkupSuggestion = { key: string; by: string; at: string; summary: string };

/** One of the host's own tools: what it is called, its icon, and doing it; read where it is drawn, so getters follow. `menu`: on the ribbon, the tools of one menu
 *  are one control (a document's block kinds), `active` the one the surface is now (a heading where the caret is). A tool of no menu is a toggle, `pressed` while
 *  it is on (a mark the selection wears; unsaid, `active`). `disabled`: not to be done here now (a menu dims and strikes it). `keys`: its shortcut, for its tooltip. */
export type MarkupHostTool = { name: string; label: string; icon: () => JSX.Element; active?: boolean; pressed?: boolean; disabled?: boolean; keys?: string[]; menu?: string; compact?: boolean; swatch?: string; pick?(hex: string): void; mode?: "edit" | "review"; run(): void };

/** The surface's own undo history (a paper's typing), which the bar's Undo and Redo step where Markup has no mark of its own newer. Read where drawn, so `can…` follow. */
export type MarkupHostHistory = { undo(): boolean; redo(): boolean; canUndo(): boolean; canRedo(): boolean };

export interface MarkupHost {
  /** What differs from MARKUP_CAPABILITIES here. */
  capabilities?: Partial<MarkupCapabilities>;
  names: PieceNames;
  /** Attributes the app marks its regions with, the outermost kind first (Conduit: data-region, data-pane…). An item's paths start from them. */
  anchors?: string[];
  transport: MarkupTransport;
  /** This page, as the receiver knows it. */
  clientId(): string;
  /** What else an item should say about the client (its kind, its build). */
  client?(): Record<string, unknown> | Promise<Record<string, unknown>>;
  /** What is being marked up, where that is more than the page says of itself: a document's name and text, read at each Send. */
  subject?(): Record<string, string | number | boolean>;
  /** What a mark covers (its box, in the viewport's pixels), where the host knows more than the pieces there say: a document's lines under a drawing. A host that has to ask (a site in its frame) answers later. */
  under?(box: { left: number; top: number; width: number; height: number }): Record<string, string | number | boolean> | null | Promise<Record<string, string | number | boolean> | null>;
  /** A shell that can take the page's picture itself, with nothing asked; null where it cannot, and the tool uses display capture. */
  capturePage?(): Promise<Blob | null>;
  /** What the tool is put over, where that is less than the window (a document in one pane): the bar stands at its foot, centred on it. Read once, as the tool opens. */
  frame?(): Element | null | undefined;
  /** The surface's margin, where its capabilities say sent comments stand there. */
  margin?: MarkupMarginHost;
  /** Tools of the host's own (a document's block kinds), shown in a rail of their own above the bar while the app is in use; read where they are drawn, so `active` follows. */
  tools?(): MarkupHostTool[];
  /** The surface's own undo history, where it has one. */
  history?: MarkupHostHistory;
  /** What a comment asked for from that rail is about: the surface's selection, or where its caret is; null when there is neither. */
  asking?(): Range | null;
  /** Given, as the tool opens (null as it closes), who is listening and opening a comment on a range for one of them: for a surface that asks itself (a paper's `@`).
   *  `unsent` and `send`: the comments written and not yet sent, for a host that shows Send with its own list of them. `to` and `hand`: which listener
   *  they go to, for a host that says who listens itself. */
  asks?(offer: { names(): string[]; listeners(): MarkupListener[]; ask(about: Range, to?: string, words?: string): void; unsent(): number; send(): void; to(): string | null; hand(name: string): void } | null): void;
  /** Where the receiver keeps who an item for nobody by name goes to (an artifact's lead): choosing one sets it there (null: the receiver's own default), and the tool asks who is listening again. Without it the choice is this page's. */
  lead?(name: string | null): Promise<unknown>;
  /** Told when comments have gone, where something other than the tool shows them. */
  sent?(): void;
  notify(outcome: "sent" | "failed", message: string): void;
}

/** The receiver's routes over the host's own request function (its origin, its credentials); a 204 resolves with nothing. */
export function httpTransport(request: <T>(path: string, init?: { method?: string; headers?: Record<string, string>; body?: string | Blob }) => Promise<T>, base = "/v0/markup"): MarkupTransport {
  const png = (body: Blob) => ({ method: "PUT", headers: { "content-type": "image/png" }, body });
  return {
    mark: (client) => request(`${base}/marks`, { method: "POST", body: JSON.stringify({ client }) }),
    picture: (mark, body, n) => request(n === undefined ? `${base}/marks/${mark}/screenshot` : `${base}/marks/${mark}/areas/${n}`, png(body)),
    send: (mark, item) => request(`${base}/marks/${mark}/send`, { method: "POST", body: JSON.stringify(item) }),
    drop: (mark) => request(`${base}/marks/${mark}`, { method: "DELETE" }),
    thread: (id, seen) => request(`${base}/items/${id}${seen ? "?seen" : ""}`),
    say: (id, n, text) => request(`${base}/items/${id}/messages`, { method: "POST", body: JSON.stringify({ n, text }) }),
    resolve: (id, n, resolved) => request(`${base}/items/${id}/messages`, { method: "POST", body: JSON.stringify({ n, resolved }) }),
    threads: () => request<{ items: MarkupSent[] }>(`${base}/items`).then((answer) => answer.items),
    open: () => request<{ items: MarkupThread[] }>(`${base}/open`).then((answer) => answer.items),
    listening: () => request<{ waiting: (Omit<MarkupListener, "kind"> & { kind?: MarkupListenerKind })[] }>(`${base}/waiting`).then((answer) => answer.waiting.map((one) => ({ ...one, kind: one.kind ?? "session" }))),
  };
}
