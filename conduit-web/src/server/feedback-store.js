import fs from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";

/*
 * The feedback receiver: what the feedback tool (components/feedback) sends to. It keeps "this moment" for each item
 * being written (a mark), takes its pictures, and on Send writes one item to <folder>/<id>/ (item.json, screenshot.png,
 * selection-<n>.png), built beside it and renamed into place, so a reader never sees half of one. It also knows which
 * agent sessions are listening (scripts/conduit-feedback.mjs `wait`) and hands an item to one by name.
 *
 * It runs with no hub: Node's own modules only, and everything of its host through the options. Conduit's hub wraps it
 * (feedback.js: what the hub knew at the mark, its routes); `conduit-feedback serve` runs it alone for any project.
 *
 *   folder     where items are written
 *   snapshot   ({ client, markedAt }) => fields added to the item, read when the item is started, not at Send
 *   about      lines for the item's `read`, saying what those fields are
 *   done       (id) => the command that marks an item handled, as the item states it
 *   log        (entry) => told of each item written
 */
const MARKS = 12;
const MARK_MS = 6 * 60 * 60_000;
/** A session that took an item this long ago and has not finished it is no longer taken to be at work on it. */
const WORKING_MS = 60 * 60_000;
const short = (value, length) => { const text = typeof value === "string" ? value : JSON.stringify(value) ?? ""; return text.length > length ? `${text.slice(0, length)}… (${text.length} characters)` : text; };

export function createFeedbackStore({ folder, snapshot = async () => ({}), about = [], done = (id) => `node scripts/conduit-feedback.mjs done ${id}`, log = () => {} }) {
  const marks = new Map();

  /**
   * The sessions an item can be handed to, by name: one whose `wait` is running (its file in .waiting, while its
   * process lives), and one at work on an item it took and has not finished, which will wait again when it has.
   */
  async function waiting() {
    const dir = path.join(folder, ".waiting");
    const found = new Map();
    for (const name of await fs.readdir(dir).catch(() => [])) {
      const waiter = await fs.readFile(path.join(dir, name), "utf8").then(JSON.parse).catch(() => null);
      let alive = false;
      try { alive = Boolean(waiter?.id) && (process.kill(Number(waiter.id), 0), true); } catch (error) { alive = error.code === "EPERM"; }
      if (alive) found.set(String(waiter.name), { name: short(String(waiter.name ?? ""), 80), state: "waiting", since: String(waiter.since ?? "") });
      else await fs.rm(path.join(dir, name), { force: true });
    }
    for (const id of (await fs.readdir(folder).catch(() => [])).filter((name) => !name.startsWith("."))) {
      const taken = await fs.readFile(path.join(folder, id, "taken.json"), "utf8").then(JSON.parse).catch(() => null);
      if (!taken?.name || found.has(taken.name) || Date.now() - Date.parse(taken.at) > WORKING_MS) continue;
      if (await fs.stat(path.join(folder, id, "handled.json")).then(() => false, () => true)) found.set(taken.name, { name: short(String(taken.name), 80), state: "working", since: String(taken.at) });
    }
    return [...found.values()].sort((a, b) => b.since.localeCompare(a.since));
  }

  async function mark({ client } = {}) {
    for (const [id, kept] of marks) if (Date.now() - kept.time > MARK_MS) marks.delete(id);
    while (marks.size >= MARKS) marks.delete(marks.keys().next().value);
    const now = new Date();
    const id = `${now.toISOString().replace(/[-:T]/g, "").slice(0, 14).replace(/^(\d{8})/, "$1-")}-${randomBytes(2).toString("hex")}`;
    marks.set(id, { time: now.getTime(), markedAt: now.toISOString(), screenshot: null, areas: new Map(), snapshot: await snapshot({ client, markedAt: now.toISOString() }) });
    return { id };
  }

  function comment(entry, scale, areas) {
    const where = (described) => ({
      component: described.component ?? null, source: described.source ?? null, styles: described.styles ?? [],
      ...(described.orComponent ? { orComponent: described.orComponent } : {}), ...(described.maybeDrawnBy ? { maybeDrawnBy: described.maybeDrawnBy } : {}),
      within: described.within ?? [], anchors: described.anchors ?? {}, ...(described.regionSource ? { regionSource: described.regionSource } : {}),
      label: described.label ?? "", domPath: described.domPath ?? "", classes: described.classes ?? [], attributes: described.attributes ?? {}, rect: described.rect ?? null, html: short(described.html ?? "", 2400),
    });
    const rect = entry.rect ?? null;
    return {
      n: entry.n, comment: String(entry.comment ?? ""), kind: entry.kind === "group" ? "group" : "component", name: String(entry.name ?? ""), rect,
      ...(entry.drawing && ["pen", "arrow", "box"].includes(entry.drawing.kind) && Array.isArray(entry.drawing.points) ? { drawing: { kind: entry.drawing.kind, points: entry.drawing.points.slice(0, 80).map((point) => [Number(point?.[0]) || 0, Number(point?.[1]) || 0]) } } : {}),
      ...(areas.has(entry.n) ? { picture: { file: `selection-${entry.n}.png`, area: entry.area ?? null, dragged: Boolean(entry.dragged) } } : {}),
      ...(rect && scale ? { screenshotRect: Object.fromEntries(Object.entries(rect).map(([key, value]) => [key, Math.round(value * scale)])) } : {}),
      ...(entry.kind === "group" ? { members: (entry.members ?? []).slice(0, 40).map(where) } : where(entry)),
    };
  }

  async function send(id, body) {
    const kept = marks.get(id);
    if (!kept) throw Object.assign(new Error("That feedback mark has gone; start the item again"), { status: 404, code: "feedback_mark_gone" });
    if (!Array.isArray(body?.comments) || !body.comments.length) throw Object.assign(new Error("A feedback item needs a comment"), { status: 400, code: "feedback_empty" });
    const client = body.client ?? {};
    const shot = kept.screenshot && body.screenshot?.width ? body.screenshot : null;
    // The picture is the page alone when it has the page's shape (a browser's tab; a window with no frame of its own): then a box on the page is a box in it.
    const viewport = client.viewport ?? {};
    const exact = Boolean(shot && viewport.width && Math.abs(shot.width / shot.height - viewport.width / viewport.height) < 0.01);
    const scale = exact ? shot.width / viewport.width : null;
    const sentAt = new Date().toISOString();
    // Every item lands in the folder; one handed to a session that is listening is also that session's next item.
    const to = body.to ? (await waiting()).find((waiter) => waiter.name === String(body.to)) ?? null : null;
    const handed = { to: to && { name: to.name } };
    const item = {
      schema: "conduit.feedback/1",
      id,
      summary: `${body.comments.length} ${body.comments.length === 1 ? "comment" : "comments"} on the interface, from the ${client.kind ?? "browser"} client at ${client.url ?? "?"}`,
      read: [
        "Each entry of `comments` is one thing the person asked for, about one selection of the live interface.",
        "`source` is where that library piece is declared and `styles` where its CSS rules start; paths are from the repository root. `within` is the pieces it sits in, outermost first. `regionSource` is where the app writes the region it is in; to find the app code that drew this instance, search the app's source for `label` or an attribute in `attributes`.",
        "A comment with `drawing` is something the person drew on the page (a pen line, an arrow whose head is its last point, a box), its `points` in the same pixels as `rect`; what it describes is then the pieces under the drawing, and the arrow's head or the box says where among them. It is in the pictures as drawn.",
        "A group's `members` are each described the same way. `rect` is in CSS pixels of the client's viewport; `screenshotRect` is the same box in screenshot.png, present only when the picture is the page alone.",
        "screenshot.png shows the page at Send with each selection outlined and numbered as `n`. A comment's `picture.file` is that selection alone, cut from it: `picture.area` is the part of the page it shows, the area the person dragged round when `dragged`, else the piece with a margin. Look at it first.",
        ...about,
        `When the item is dealt with: ${done(id)}`,
      ],
      markedAt: kept.markedAt,
      sentAt,
      handed,
      comments: body.comments.slice(0, 50).map((entry) => comment(entry, scale, shot ? kept.areas : new Map())),
      screenshot: shot ? { file: "screenshot.png", width: shot.width, height: shot.height, surface: shot.surface ?? "unknown", outlined: true, pageOnly: exact, ...(scale ? { scale } : {}) }
        : { file: null, missing: String(body.screenshot?.missing ?? "not sent") },
      client: { id: client.id ?? null, kind: client.kind ?? null, build: client.build ?? null, shell: client.shell ?? null, url: client.url ?? null, viewport, interfaceSize: client.interfaceSize ?? null, userAgent: short(client.userAgent ?? "", 300) },
      ...kept.snapshot,
    };
    const staging = path.join(folder, `.${id}.partial`);
    const final = path.join(folder, id);
    await fs.mkdir(staging, { recursive: true, mode: 0o700 });
    if (shot) await fs.writeFile(path.join(staging, "screenshot.png"), kept.screenshot);
    if (shot) for (const [n, bytes] of kept.areas) await fs.writeFile(path.join(staging, `selection-${n}.png`), bytes);
    await fs.writeFile(path.join(staging, "item.json"), `${JSON.stringify(item, null, 2)}\n`);
    await fs.rename(staging, final);
    marks.delete(id);
    log({ type: "feedback", id, comments: item.comments.length, screenshot: Boolean(shot), to: to?.name ?? null });
    return { id, path: path.join(final, "item.json"), handed };
  }

  function picture(id, bytes, n) {
    const kept = marks.get(id);
    if (!kept) throw Object.assign(new Error("That feedback mark has gone; start the item again"), { status: 404, code: "feedback_mark_gone" });
    if (!Buffer.isBuffer(bytes) || bytes.length < 8 || bytes.readUInt32BE(0) !== 0x89504e47) throw Object.assign(new Error("A screenshot is a PNG"), { status: 415, code: "feedback_screenshot_invalid" });
    if (n === undefined) kept.screenshot = bytes;
    else if (Number.isInteger(n) && n >= 1 && n <= 50) kept.areas.set(n, bytes);
    else throw Object.assign(new Error("No such selection"), { status: 400, code: "feedback_area_invalid" });
  }

  return { mark, send, picture, waiting, drop: (id) => marks.delete(id) };
}

/** The store's routes for a plain Node server (the hub has its own, behind its sign-in): true when the request was one of them. */
export async function handleFeedback(store, request, response, base = "/v0/feedback") {
  const url = new URL(request.url, "http://localhost");
  if (!url.pathname.startsWith(`${base}/`)) return false;
  const [, id, what, n] = /^\/marks(?:\/([\w-]+))?(?:\/(\w+))?(?:\/(\d+))?$/.exec(url.pathname.slice(base.length)) ?? [];
  const body = async (limit) => { const parts = []; let size = 0; for await (const part of request) { size += part.length; if (size > limit) throw Object.assign(new Error("Too large"), { status: 413 }); parts.push(part); } return Buffer.concat(parts); };
  const json = async () => JSON.parse((await body(4 << 20)).toString("utf8") || "{}");
  const answer = (status, value) => { response.writeHead(status, value === undefined ? {} : { "content-type": "application/json" }); response.end(value === undefined ? undefined : JSON.stringify(value)); };
  try {
    const route = `${request.method} ${url.pathname.slice(base.length).replace(/^\/marks\/[\w-]+/, "/marks/:id").replace(/\/\d+$/, "/:n")}`;
    if (route === "GET /waiting") answer(200, { waiting: await store.waiting() });
    else if (route === "POST /marks") answer(201, await store.mark(await json()));
    else if (route === "PUT /marks/:id/screenshot") { store.picture(id, await body(32 << 20)); answer(204); }
    else if (route === "PUT /marks/:id/areas/:n" && what === "areas") { store.picture(id, await body(32 << 20), Number(n)); answer(204); }
    else if (route === "POST /marks/:id/send") answer(201, await store.send(id, await json()));
    else if (route === "DELETE /marks/:id") { store.drop(id); answer(204); }
    else answer(404, { error: "No such feedback route" });
  } catch (error) {
    answer(error.status ?? 500, { error: error.message, code: error.code });
  }
  return true;
}
