/*
 * The feedback tool's boundary. The tool (this folder) marks up a running interface and sends what was marked; it
 * knows nothing of the app it runs in. Everything of the app's reaches it through a FeedbackHost, and it imports only
 * solid-js and the library (components/ui): no app module, no virtual module, no fetch of its own. That is what lets
 * the folder be lifted into another project, which writes a host and mounts <FeedbackTool>.
 *
 * The other half is the receiver (server/feedback-store.js: the item folder, who is listening). A transport speaks
 * to one; httpTransport is the routes both Conduit's hub and `conduit-feedback serve` answer.
 */

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

/** A session an item can be handed to: its `wait` is running, or it is at work on one it took. */
export type FeedbackListener = { name: string; state: "waiting" | "working" };
export type FeedbackHanded = { to: { name: string } | null };

/** An item once sent, as the person follows it: where it stands (`by`: the session it was handed to or that took it), and what was said about each comment (`n`) or the item as a whole. */
export type FeedbackThread = { id: string; state: "waiting" | "taken" | "handled"; by: string | null; unread: number;
  comments: { n: number; name: string; comment: string }[]; messages: { at: string; from: "agent" | "person"; n: number | null; text: string }[] };

/** What Send carries besides the pictures. `comments` and `screenshot` are the tool's; `client` is the tool's facts (url, viewport, userAgent) with the host's own over them. */
export type FeedbackSend = { comments: unknown[]; screenshot: Record<string, unknown>; client: Record<string, unknown>; to: string | null };

export interface FeedbackTransport {
  /** "This moment": the receiver keeps what it knows now, under the id the item is later sent to. */
  mark(client: string): Promise<{ id: string }>;
  /** A PNG for a mark: the whole screenshot, or selection `n`'s own area of it. */
  picture(mark: string, png: Blob, n?: number): Promise<void>;
  send(mark: string, item: FeedbackSend): Promise<{ id: string; handed: FeedbackHanded }>;
  /** A sent item's thread; `seen`: the person is reading it now. */
  thread(id: string, seen?: boolean): Promise<FeedbackThread>;
  /** The person writes back, about comment `n` or the item as a whole. */
  say(id: string, n: number | null, text: string): Promise<FeedbackThread>;
  /** The latest items not finished or with an answer unread, newest first. */
  threads(): Promise<{ id: string; state: FeedbackThread["state"]; by: string | null; unread: number }[]>;
  /** A mark nothing was sent to. */
  drop(mark: string): Promise<void>;
  listening(): Promise<FeedbackListener[]>;
}

export interface FeedbackHost {
  names: PieceNames;
  /** Attributes the app marks its regions with, the outermost kind first (Conduit: data-region, data-pane…). An item's paths start from them. */
  anchors?: string[];
  transport: FeedbackTransport;
  /** This page, as the receiver knows it. */
  clientId(): string;
  /** What else an item should say about the client (its kind, its build). */
  client?(): Record<string, unknown> | Promise<Record<string, unknown>>;
  /** A shell that can take the page's picture itself, with nothing asked; null where it cannot, and the tool uses display capture. */
  capturePage?(): Promise<Blob | null>;
  notify(outcome: "sent" | "failed", message: string): void;
}

/** The receiver's routes over the host's own request function (its origin, its credentials); a 204 resolves with nothing. */
export function httpTransport(request: <T>(path: string, init?: { method?: string; headers?: Record<string, string>; body?: string | Blob }) => Promise<T>, base = "/v0/feedback"): FeedbackTransport {
  const png = (body: Blob) => ({ method: "PUT", headers: { "content-type": "image/png" }, body });
  return {
    mark: (client) => request(`${base}/marks`, { method: "POST", body: JSON.stringify({ client }) }),
    picture: (mark, body, n) => request(n === undefined ? `${base}/marks/${mark}/screenshot` : `${base}/marks/${mark}/areas/${n}`, png(body)),
    send: (mark, item) => request(`${base}/marks/${mark}/send`, { method: "POST", body: JSON.stringify(item) }),
    drop: (mark) => request(`${base}/marks/${mark}`, { method: "DELETE" }),
    thread: (id, seen) => request(`${base}/items/${id}${seen ? "?seen" : ""}`),
    say: (id, n, text) => request(`${base}/items/${id}/messages`, { method: "POST", body: JSON.stringify({ n, text }) }),
    threads: () => request<{ items: Awaited<ReturnType<FeedbackTransport["threads"]>> }>(`${base}/items`).then((answer) => answer.items),
    listening: () => request<{ waiting: FeedbackListener[] }>(`${base}/waiting`).then((answer) => answer.waiting),
  };
}
