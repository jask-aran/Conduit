import fs from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";

/*
 * The feedback receiver: what the feedback tool (components/feedback) sends to. It keeps "this moment" for each item
 * being written (a mark), takes its pictures, and on Send writes one item to <folder>/<id>/ (item.json, screenshot.png,
 * selection-<n>.png), built beside it and renamed into place, so a reader never sees half of one. It also knows which
 * agent sessions are listening (scripts/conduit-feedback.mjs `wait`) and hands an item to one by name.
 *
 * An item is also a thread: what the agent answers (the script's `reply`, written straight to the folder) and what the
 * person writes back (here) are lines of <id>/thread.jsonl, each about one comment (`n`) or the item as a whole. That
 * is the same whether a session was listening when the item was sent or one takes it days later. A line with
 * `resolved` settles its comment (or reopens it) from either side; an item whose every comment is resolved is handled.
 * A line with `working` is the session saying it has been handed that comment (the script's `wait` writes it): the
 * comment is being worked on until the session's next line about it.
 *
 * A live item (Send with `live`) is written at its first comment and grows: each later Send to the same mark adds its
 * comments and their pictures, and the mark is kept for the next.
 *
 * It runs with no hub: Node's own modules only, and everything of its host through the options. Conduit's hub wraps it
 * (feedback.js: what the hub knew at the mark, its routes); `conduit-feedback serve` runs it alone for any project.
 *
 *   folder     where items are written
 *   snapshot   ({ client, markedAt }) => fields added to the item, read when the item is started, not at Send
 *   about      lines for the item's `read`, saying what those fields are
 *   done       (id) => the command that marks an item handled, as the item states it
 *   answered   false for one-way feedback (from people owed no answer): no thread is served or taken, and an item does not invite a reply
 *   log        (entry) => told of each item written
 */
const MARKS = 12;
/** How many of the latest items are looked through for one still open, and how many finished ones are listed with those. */
const THREADS = 20;
const FINISHED = 6;
const MARK_MS = 6 * 60 * 60_000;
/** A session that took an item this long ago and has not finished it is no longer taken to be at work on it. */
const WORKING_MS = 60 * 60_000;
/** A finished item stays in the list of what was sent for this long, to be come back to. */
const RECENT_MS = 24 * 60 * 60_000;
/** A session handed a comment this long ago that has said nothing since is no longer shown as working on it. */
const ANSWERING_MS = 15 * 60_000;
/** What is kept of a host's `subject` (characters): a document's text, not a book's. */
const SUBJECT = 200_000;
const short = (value, length) => { const text = typeof value === "string" ? value : JSON.stringify(value) ?? ""; return text.length > length ? `${text.slice(0, length)}… (${text.length} characters)` : text; };

export function createFeedbackStore({ folder, snapshot = async () => ({}), about = [], done = (id) => `node scripts/conduit-feedback.mjs done ${id}`, answered = true, log = () => {} }) {
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
    if (entry.kind === "note") return { n: entry.n, comment: String(entry.comment ?? ""), kind: "note", name: String(entry.name ?? "") };
    const rect = entry.rect ?? null;
    return {
      n: entry.n, comment: String(entry.comment ?? ""), kind: entry.kind === "group" ? "group" : "component", name: String(entry.name ?? ""), rect,
      on: entry.on === "screenshot" ? "screenshot" : "page",
      ...(typeof entry.quote === "string" ? { quote: short(entry.quote, 1000) } : {}),
      ...(entry.under && typeof entry.under === "object" ? { under: subject(entry.under) } : {}),
      ...(Array.isArray(entry.drawings) ? { drawings: entry.drawings.slice(0, 40).filter((drawing) => ["pen", "highlight", "line", "arrow", "box", "text"].includes(drawing?.kind) && Array.isArray(drawing.points)).map((drawing) => ({
        kind: drawing.kind, ...(typeof drawing.colour === "string" ? { colour: drawing.colour.slice(0, 20) } : {}), ...(["thin", "medium", "thick"].includes(drawing.weight) ? { weight: drawing.weight } : {}), ...(drawing.kind === "text" ? { text: short(String(drawing.text ?? ""), 400) } : {}), points: drawing.points.slice(0, 80).map((point) => [Number(point?.[0]) || 0, Number(point?.[1]) || 0]) })) } : {}),
      ...(areas.has(entry.n) ? { picture: { file: `selection-${entry.n}.png`, area: entry.area ?? null, dragged: Boolean(entry.dragged) } } : {}),
      ...(rect && scale ? { screenshotRect: Object.fromEntries(Object.entries(rect).map(([key, value]) => [key, Math.round(value * scale)])) } : {}),
      ...(entry.kind === "group" ? { members: (entry.members ?? []).slice(0, 40).map(where) } : where(entry)),
    };
  }

  const subject = (told) => Object.fromEntries(Object.entries(told).slice(0, 12).map(([key, value]) => [key, typeof value === "string" ? short(value, SUBJECT) : typeof value === "number" || typeof value === "boolean" ? value : null]));

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
    const final = path.join(folder, id);
    const put = async (dir, value) => { await fs.writeFile(path.join(dir, ".item.json"), `${JSON.stringify(value, null, 2)}\n`); await fs.rename(path.join(dir, ".item.json"), path.join(dir, "item.json")); };
    if (kept.live) {
      // More of a live item: its new comments and their pictures, the item rewritten whole so a reader never sees half of it.
      const grown = await read(path.join(final, "item.json"));
      if (!grown) throw gone();
      const added = body.comments.slice(0, 50).map((entry) => comment(entry, scale, shot ? kept.areas : new Map()));
      if (shot) { await fs.writeFile(path.join(final, "screenshot.png"), kept.screenshot); for (const entry of added) if (kept.areas.has(entry.n)) await fs.writeFile(path.join(final, `selection-${entry.n}.png`), kept.areas.get(entry.n)); }
      grown.comments.push(...added);
      if (body.subject) grown.subject = subject(body.subject);
      if (shot && !grown.screenshot.file) grown.screenshot = { file: "screenshot.png", width: shot.width, height: shot.height, surface: shot.surface ?? "unknown", of: shot.of === "screenshot" ? "screenshot" : "page", outlined: true, pageOnly: exact, ...(scale ? { scale } : {}) };
      await put(final, grown);
      kept.areas.clear();
      log({ type: "feedback", id, comments: grown.comments.length, added: added.length, screenshot: Boolean(shot), to: grown.handed?.to?.name ?? null });
      return { id, path: path.join(final, "item.json"), handed: grown.handed };
    }
    // Every item lands in the folder; one handed to a session that is listening is also that session's next item.
    const to = body.to ? (await waiting()).find((waiter) => waiter.name === String(body.to)) ?? null : null;
    const handed = { to: to && { name: to.name } };
    const item = {
      schema: "conduit.feedback/1",
      id,
      summary: `${body.comments.length} ${body.comments.length === 1 ? "comment" : "comments"} on the interface, from the ${client.kind ?? "browser"} client at ${client.url ?? "?"}`,
      read: [
        "Each entry of `comments` is one thing the person asked for, about one selection of the interface. `on` says what it was made on: `screenshot`, a picture of the page the person took earlier (so what does not last could be marked) and drew on, or `page`, the live page at Send. One of kind `note` is about no selection: words about the interface as a whole, with no picture of its own.",
        "`source` is where that library piece is declared and `styles` where its CSS rules start; paths are from the repository root. `within` is the pieces it sits in, outermost first. `regionSource` is where the app writes the region it is in; to find the app code that drew this instance, search the app's source for `label` or an attribute in `attributes`.",
        "A comment with `drawings` is what the person drew on the page for it, any number together (a pen line, a `highlight` (a wide see-through pen line), a straight `line`, an arrow whose head is its last point, a box, `text` written at its one point; `weight` is how thick its line is), `points` in the same pixels as `rect`; what it describes is then the pieces under them, and an arrow's head or a box says where among them. They are in the pictures as drawn. On a `screenshot` comment the pieces are what the live page had there, which may not be what the screenshot shows.",
        "A comment with `quote` is about that run of text, which the person selected on the live page; its `rect` is round the text, and what it describes is the piece the text is in.",
        "A group's `members` are each described the same way. `rect` is in CSS pixels of the client's viewport; `screenshotRect` is the same box in screenshot.png, present only when the picture is the page alone.",
        "screenshot.png shows what `screenshot.of` says (the `screenshot` the person drew on, or the live `page` at Send) with the selections made on it outlined and numbered as `n`. A comment's `picture.file` is that selection alone, cut from the one it was made on: `picture.area` is the part of the page it shows, the area the person dragged round when `dragged`, else its marks with a margin. Look at it first.",
        ...(body.subject ? ["`subject` is what was being marked up, as its host tells it: a document's `text` is as it was at the latest Send, and a comment's `quote` is a run of it. A comment's `under` is what that host says its marks cover: a document's lines (`from` to `to`, numbered from 1) and their `text` as it was when the comment was sent."] : []),
        ...(body.live ? ["This item grows: the person may add comments while you work, and `wait` hands you each as it comes. `screenshot.png` is the latest taken; a comment's own picture is as it was when the comment was made."] : []),
        ...about,
        ...(answered ? [`To answer the person: \`${done(id).replace(/ done .*/, "")} reply ${id} [n] "<words>"\`, n being the comment answered (none: the item as a whole). They read it in the tool beside that comment and may write back; \`wait\` hands you what they say.`] : ["This is one-way feedback: the person is not shown an answer."]),
        ...(answered ? [`When one comment is dealt with: \`${done(id).replace(/ done .*/, "")} resolve ${id} <n>\`. The person may resolve or reopen one too, and the item is handled once every comment is resolved.`] : []),
        `When the whole item is dealt with: ${done(id)}`,
      ],
      ...(body.live ? { live: true } : {}),
      markedAt: kept.markedAt,
      sentAt,
      handed,
      comments: body.comments.slice(0, 50).map((entry) => comment(entry, scale, shot ? kept.areas : new Map())),
      screenshot: shot ? { file: "screenshot.png", width: shot.width, height: shot.height, surface: shot.surface ?? "unknown", of: shot.of === "screenshot" ? "screenshot" : "page", outlined: true, pageOnly: exact, ...(scale ? { scale } : {}) }
        : { file: null, missing: String(body.screenshot?.missing ?? "not sent") },
      client: { id: client.id ?? null, kind: client.kind ?? null, build: client.build ?? null, shell: client.shell ?? null, url: client.url ?? null, viewport, interfaceSize: client.interfaceSize ?? null, userAgent: short(client.userAgent ?? "", 300) },
      ...(body.subject ? { subject: subject(body.subject) } : {}),
      ...kept.snapshot,
    };
    const staging = path.join(folder, `.${id}.partial`);
    await fs.mkdir(staging, { recursive: true, mode: 0o700 });
    if (shot) await fs.writeFile(path.join(staging, "screenshot.png"), kept.screenshot);
    if (shot) for (const [n, bytes] of kept.areas) await fs.writeFile(path.join(staging, `selection-${n}.png`), bytes);
    await fs.writeFile(path.join(staging, "item.json"), `${JSON.stringify(item, null, 2)}\n`);
    await fs.rename(staging, final);
    if (body.live) { kept.live = true; kept.areas.clear(); } else marks.delete(id);
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

  const gone = () => Object.assign(new Error("No such feedback item"), { status: 404, code: "feedback_item_gone" });
  const read = (file) => fs.readFile(file, "utf8").then(JSON.parse).catch(() => null);
  const lines = async (dir) => (await fs.readFile(path.join(dir, "thread.jsonl"), "utf8").catch(() => "")).split("\n").filter(Boolean).map((line) => { try { return JSON.parse(line); } catch { return null; } }).filter(Boolean);

  /** An item as the person follows it: where it stands, its comments in brief, and what has been said. `seen`: the person has now read it. */
  async function thread(id, { seen = false } = {}) {
    if (!answered || !/^[\w-]+$/.test(String(id))) throw gone();
    const dir = path.join(folder, id), item = await read(path.join(dir, "item.json"));
    if (!item) throw gone();
    const all = await lines(dir), messages = all.filter((message) => !message.working), taken = await read(path.join(dir, "taken.json")), handled = Boolean(await read(path.join(dir, "handled.json")));
    // Being worked on: the session's last line about it is that it was handed it, not long ago.
    const lastBy = new Map(all.filter((message) => message.from === "agent").map((message) => [message.n ?? null, message]));
    const working = (n) => { const last = lastBy.get(n); return Boolean(last?.working && !handled && Date.now() - Date.parse(last.at) < ANSWERING_MS); };
    const resolved = new Map(messages.filter((message) => typeof message.resolved === "boolean").map((message) => [message.n, message.resolved]));
    const unread = messages.filter((message) => message.from === "agent").length - ((await read(path.join(dir, "person-read.json")))?.agent ?? 0);
    if (seen && unread) await fs.writeFile(path.join(dir, "person-read.json"), `${JSON.stringify({ agent: messages.filter((message) => message.from === "agent").length })}\n`);
    return { id, sentAt: item.sentAt, state: handled ? "handled" : taken ? "taken" : "waiting", by: taken?.name ?? item.handed?.to?.name ?? null, unread: Math.max(0, unread), working: working(null),
      comments: (item.comments ?? []).map((entry) => ({ n: entry.n, name: entry.name, comment: entry.comment, resolved: resolved.get(entry.n) === true, working: resolved.get(entry.n) !== true && working(entry.n) })), messages };
  }

  /** What the person writes back, about comment `n` or the item as a whole; or, with `resolved`, comment `n` settled or reopened. */
  async function say(id, { n, text, resolved } = {}) {
    if (typeof resolved === "boolean" && Number.isInteger(n)) {
      const dir = path.join(folder, id), now = await thread(id);
      await fs.appendFile(path.join(dir, "thread.jsonl"), `${JSON.stringify({ at: new Date().toISOString(), from: "person", n, resolved })}\n`);
      // The last comment resolved finishes the item; one reopened hands it back to the session that took it.
      if (!resolved) await fs.rm(path.join(dir, "handled.json"), { force: true });
      else if (now.comments.every((entry) => entry.resolved || entry.n === n)) await fs.writeFile(path.join(dir, "handled.json"), `${JSON.stringify({ at: new Date().toISOString(), by: "person" })}\n`);
      return thread(id);
    }
    const words = String(text ?? "").trim();
    if (!words) throw Object.assign(new Error("Nothing was said"), { status: 400, code: "feedback_message_empty" });
    await thread(id);
    await fs.appendFile(path.join(folder, id, "thread.jsonl"), `${JSON.stringify({ at: new Date().toISOString(), from: "person", n: Number.isInteger(n) ? n : null, text: short(words, 4000) })}\n`);
    return thread(id);
  }

  /** The latest items that are not finished, have an answer unread or were sent in the last day, newest first. */
  async function threads() {
    const found = [];
    let finished = 0;
    if (!answered) return found;
    for (const id of (await fs.readdir(folder).catch(() => [])).filter((name) => !name.startsWith(".")).sort().reverse().slice(0, THREADS)) {
      const one = await thread(id).catch(() => null);
      if (one && (one.unread || one.state !== "handled" || (Date.now() - Date.parse(one.sentAt) < RECENT_MS && finished++ < FINISHED))) found.push({ id, sentAt: one.sentAt, state: one.state, by: one.by, unread: one.unread, comments: one.comments.length, first: short(one.comments[0]?.comment ?? "", 120) });
    }
    return found;
  }

  return { mark, send, picture, waiting, thread, say, threads, drop: (id) => marks.delete(id) };
}

/** The store's routes for a plain Node server (the hub has its own, behind its sign-in): true when the request was one of them. */
export async function handleFeedback(store, request, response, base = "/v0/feedback") {
  const url = new URL(request.url, "http://localhost");
  if (!url.pathname.startsWith(`${base}/`)) return false;
  const [, id, what, n] = /^\/marks(?:\/([\w-]+))?(?:\/(\w+))?(?:\/(\d+))?$/.exec(url.pathname.slice(base.length)) ?? [];
  const [, item, said] = /^\/items\/([\w-]+)(\/messages)?$/.exec(url.pathname.slice(base.length)) ?? [];
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
    else if (route === "GET /items") answer(200, { items: await store.threads() });
    else if (request.method === "GET" && item && !said) answer(200, await store.thread(item, { seen: url.searchParams.has("seen") }));
    else if (request.method === "POST" && item && said) answer(201, await store.say(item, await json()));
    else answer(404, { error: "No such feedback route" });
  } catch (error) {
    answer(error.status ?? 500, { error: error.message, code: error.code });
  }
  return true;
}
