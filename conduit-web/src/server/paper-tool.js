import { Type } from "@earendil-works/pi-ai";
import { defineTool } from "@earendil-works/pi-durable";
import { colIndex } from "../sheet-format.js";
import { callingChat } from "./conduit-mcp.js";

const text = (words, isError = false) => ({ output: [{ type: "text", text: words }], ...(isError ? { isError: true } : {}) });
const ACTIONS = ["answer", "list", "new", "show", "lead", "read", "replace", "insert", "delete", "set", "suggestions", "accept", "reject", "comments", "reply", "resolve", "cells", "fill", "rows", "cols", "tabs"];
const TAB_OPS = { add: "add-tab", rename: "rename-tab", delete: "delete-tab", move: "move-tab", hide: "hide-tab", show: "hide-tab" };

/** Artifacts for an agent (papers, Markdown files, sheets and sites): the hub's document service (server/documents.js) as one tool, with the verbs `conduit-markup` has. */
export function PaperTool(runtime) {
  return defineTool({
    name: "conduit_artifact",
    description: "Artifacts: what the person and agents make together in a project and the person marks up. Papers: the block documents the person and agents write together in a project (a `.paper` file; edit it only through this tool, since the hub holds the live copy). "
      + "`paper` is a paper's id; omit it in a paper's own thread, or in a chat connected to one paper. "
      + "answer (item, n: omit it for an item with one comment; edits: [{ op: replace | insert | delete, at: a block id, markdown }]; reply; resolve) answers a comment in one call: every edit is made for it, all or none, then the reply and the resolve. "
      + "A comment handed to you carries its text and the blocks it is on, so answer needs no read first; an edit on a block that has gone writes nothing and says what the comment is on now. "
      + "list (project: id or slug, default this chat's) and new (name, kind: paper, markdown or site, project) give ids. "
      + "A Markdown file (kind `markdown`, a `.md` file) is a paper whose file is plain Markdown, for other tools to read too: every action a paper's takes works on it but set, since its front matter is kept as the file has it. "
      + "new also makes this chat the artifact's lead (the person's comments on it come here, not to a thread of its own) and shows it to them beside this chat (show: false leaves it closed). "
      + "show opens one for the person. lead takes the lead on one that exists, when the person asks you to work on it. "
      + "read prints the paper as Markdown, each block under `<!-- block <id> -->`. "
      + "set (name, text) writes one property of its front matter (the name: value lines read shows first); no text removes it. "
      + "replace (block, markdown: the first block written keeps the id), insert (block: the one to write after, or `start`; markdown) and delete (block) change it at once, for everyone who has it open. "
      + "To answer a comment by changing the paper, pass `for: \"<item>/<n>\"`: the person then sees what changed for that comment and can take it back. "
      + "Pass `suggest: true` instead when the person asked for proposals rather than changes: the edit stands as a suggestion they accept or reject (with `suggestion`, it adds to that one). "
      + "suggestions lists those standing (the person's and agents'); accept and reject (suggestion) settle one, when the person asks you to. "
      + "comments lists what the person asked on the paper that is not settled (item ids, comment numbers, the text each is about). "
      + "reply (item, n?, text) answers in the margin beside the text; resolve (item, n) marks a comment done, which the person then confirms. "
      + "A project also holds sites: one HTML file each (`<name>.site.html`) that the person sees drawn in a pane and marks up. new with kind `site` makes one (so does writing such a file); "
      + "change it by editing the file with your own tools, not with read, replace, insert or delete. list, comments, reply and resolve take a site's id as they take a paper's. "
      + "A sheet (kind `sheet`, a `.csv` file whose cells can hold formulas; `paper` is its id too) is changed only through this tool: cells (range: optional, A1 such as B2:C5; computed: true for what formulas compute) reads it as CSV of what was typed; "
      + "set (at: one cell such as B4, value: text, a number, TRUE/FALSE or a formula starting with =; \"\" clears it) and fill (range, values: rows of cells' text repeated over the range, a formula's relative references moved per cell as a spreadsheet's fill does; or value for every cell; a range past the edge grows the sheet) write cells; "
      + "rows and cols (op: insert | delete, at: the row number or column letter to insert before or to delete from, count) change its shape, rewriting formulas that refer to moved cells. They take `for` as an edit does; answer then takes reply and resolve, not edits. "
      + "A sheet can have tabs: each of those actions takes `tab` (a tab's name; the first tab unsaid), or an address that names one (at: \"Data!B4\", range: \"'My data'!A1:C3\"), and a formula reads another tab as Data!A1. "
      + "tabs lists them with their sizes; tabs with op add (name, at: its place, 1 first; last unsaid), rename (tab, name: the new one; formulas naming it are rewritten), delete (tab; formulas naming it then show #REF!), move (tab, at), hide or show (tab) changes them.",
    parameters: Type.Object({
      action: Type.Union(ACTIONS.map((value) => Type.Literal(value))),
      paper: Type.Optional(Type.String({ description: "A paper's id." })),
      project: Type.Optional(Type.String({ description: "list, new: a project's id or slug." })),
      name: Type.Optional(Type.String({ description: "new: the paper's name; tabs add, rename: the tab's name." })),
      tab: Type.Optional(Type.String({ description: "A sheet's tab, by name: cells, set, fill, rows, cols, tabs." })),
      kind: Type.Optional(Type.Union([Type.Literal("paper"), Type.Literal("markdown"), Type.Literal("sheet"), Type.Literal("site")], { description: "new: paper (the default), markdown (a plain .md file), sheet (a .csv, 20 rows x 8 columns) or site." })),
      block: Type.Optional(Type.String({ description: "A block's id, from read." })),
      markdown: Type.Optional(Type.String()),
      for: Type.Optional(Type.String({ description: "The comment an edit answers, as <item>/<n>." })),
      suggest: Type.Optional(Type.Boolean({ description: "replace, insert, delete: make the edit a suggestion." })),
      suggestion: Type.Optional(Type.String({ description: "A suggestion's key (suggestion/<id>), from suggestions or an earlier suggest: accept, reject, or add to it with suggest." })),
      item: Type.Optional(Type.String({ description: "answer, reply, resolve: a markup item's id." })),
      n: Type.Optional(Type.Integer({ description: "A comment's number in its item." })),
      text: Type.Optional(Type.String({ description: "reply: what to say." })),
      edits: Type.Optional(Type.Array(Type.Object({
        op: Type.Union([Type.Literal("replace"), Type.Literal("insert"), Type.Literal("delete")]),
        at: Type.String({ description: "A block's id; insert also takes `start`." }),
        markdown: Type.Optional(Type.String()),
      }), { description: "answer: the paper's edits for the comment, in order." })),
      reply: Type.Optional(Type.String({ description: "answer: what the person reads beside the comment." })),
      show: Type.Optional(Type.Boolean({ description: "new: false leaves the new artifact closed." })),
      resolve: Type.Optional(Type.Boolean({ description: "answer: mark the comment done." })),
      at: Type.Optional(Type.String({ description: "set: a cell (B4, or Data!B4); rows: a row number (5); cols: a column letter (C); tabs add, move: a tab's place (1 first)." })),
      range: Type.Optional(Type.String({ description: "cells, fill: an A1 range (B2:C5) or one cell." })),
      values: Type.Optional(Type.Array(Type.Array(Type.String()), { description: "fill: rows of cells' text." })),
      value: Type.Optional(Type.String({ description: "set, fill: one cell's text." })),
      op: Type.Optional(Type.Union(["insert", "delete", "add", "rename", "move", "hide", "show"].map((value) => Type.Literal(value)), { description: "rows, cols: insert or delete; tabs: add, rename, delete, move, hide or show." })),
      count: Type.Optional(Type.Integer({ description: "rows, cols: how many (1)." })),
      computed: Type.Optional(Type.Boolean({ description: "cells: what formulas compute, as the file holds it." })),
    }),
    replay: "unsafe",
    execute: async (args, api = {}, context) => {
      const documents = runtime.documents;
      if (!documents) return text("Papers are not ready yet.", true);
      try {
        const chat = await callingChat(runtime, api, context), mine = documents.of(chat);
        // Shown beside the chat that asked, in the tab the person talks to it from; an artifact nobody has open is still made.
        const show = (id) => runtime.uiControl ? runtime.uiControl.command({ action: "open", view: `artifact:${id}`, beside: true }, null, chat).then(({ result }) => `Shown to the person: ${result}`, (error) => `Not shown (${error.message}); conduit_ui opens it as artifact:${id}.`) : `conduit_ui opens it as artifact:${id}.`;
        if (args.action === "list" || args.action === "new") {
          const project = args.project ?? mine.project;
          if (!project) throw new Error("Say which project.");
          const found = args.action === "list" ? await documents.list(project) : [await documents.create(project, { kind: args.kind, name: args.name })];
          if (args.action === "list") return text(found.map((one) => `${one.id}  ${one.path}`).join("\n") || "No papers, Markdown files, sheets or sites in this project.");
          // Whoever makes an artifact leads it: what the person says of it comes to the chat that knows why it was made.
          if (chat) await documents.lead(found[0].id, chat);
          return text(`${found[0].id}  ${found[0].path}${chat ? "\nThis chat leads it: the person's comments on it come here." : ""}${args.show === false ? "" : `\n${await show(found[0].id)}`}`);
        }
        const paper = args.paper ?? (mine.papers.length === 1 ? mine.papers[0].id : null);
        if (!paper) throw new Error(mine.papers.length ? `Say which paper: this chat is connected to ${mine.papers.map((one) => one.id).join(", ")}.` : "Say which paper (`list` gives ids).");
        const by = mine.papers.find((one) => one.id === paper)?.as ?? "agent";
        if (args.action === "show") return text(await show(paper));
        if (args.action === "lead") { if (!chat) throw new Error("Only a chat can lead an artifact."); await documents.lead(paper, chat); return text(`This chat leads ${paper}: the person's comments on it come here.`); }
        if (args.action === "answer") {
          const done = await documents.answer(paper, { item: args.item, n: args.n, edits: args.edits ?? [], reply: args.reply ?? args.text, resolve: args.resolve, by });
          const did = [args.edits?.length && `made ${args.edits.length === 1 ? "the edit" : `the ${args.edits.length} edits`}${done.blocks.length ? ` (wrote ${done.blocks.join(", ")})` : ""}`, done.replied && "replied", done.resolved && `resolved it${done.handled ? ", so the item is handled" : ""}`].filter(Boolean);
          return text(`Answered ${done.item}${done.n ? `, comment ${done.n}` : ""}: ${did.join("; ")}.`);
        }
        if (args.action === "read") { void documents.seat(paper, by, { state: "reading" }); return text(await documents.read(paper)); }
        if (args.action === "cells") { const read = await documents.read(paper, args.computed ? "values" : undefined, args.range, args.tab); return text(typeof read === "string" ? read : JSON.stringify(read)); }
        if (args.action === "fill" || (args.action === "set" && args.at !== undefined)) {
          const done = await documents.cells(paper, { op: args.action, tab: args.tab, at: args.at, range: args.range, values: args.values, value: args.value ?? args.text, by, for: args.for });
          return text(`Wrote ${done.cells.join(", ")}; the ${done.tab ? `tab ${done.tab}` : "sheet"} is ${done.rows} rows x ${done.cols} columns.`);
        }
        if (args.action === "tabs") {
          const place = args.at === undefined ? undefined : /^\d+$/.test(String(args.at).trim()) ? Number(args.at) - 1 : NaN;
          if (args.op && (!Object.hasOwn(TAB_OPS, args.op) || Number.isNaN(place) || (args.op === "move" && place === undefined))) throw new Error("tabs takes op add (name, at?), rename (tab, name), delete (tab), move (tab, at: a place, 1 first), hide or show (tab).");
          const { tabs } = args.op ? await documents.cells(paper, { op: TAB_OPS[args.op], tab: args.tab, name: args.name, at: place, hidden: args.op === "hide", by, for: args.for }) : await documents.read(paper, "tabs");
          return text(tabs.map((one, at) => `${at + 1}. ${one.name}  ${one.rows} rows x ${one.cols} columns${one.hidden ? ", hidden" : ""}`).join("\n"));
        }
        if (args.action === "rows" || args.action === "cols") {
          const rows = args.action === "rows", label = String(args.at ?? "").trim(), at = rows ? (/^\d+$/.test(label) ? Number(label) - 1 : NaN) : /^[A-Za-z]{1,3}$/.test(label) ? colIndex(label) : NaN;
          if (!args.op || !Number.isInteger(at) || at < 0) throw new Error(`${args.action} takes op (insert or delete) and at: ${rows ? "a row number, as 5" : "a column letter, as C"}.`);
          const done = await documents.cells(paper, { op: `${args.op}-${args.action}`, tab: args.tab, at, count: args.count ?? 1, by, for: args.for });
          return text(`The ${done.tab ? `tab ${done.tab}` : "sheet"} is ${done.rows} rows x ${done.cols} columns.`);
        }
        if (args.action === "set") return text(`Its properties: ${JSON.stringify((await documents.edit(paper, { op: "set", block: args.name, markdown: args.text ?? "", by })).properties)}`);
        if (args.action === "replace" || args.action === "insert" || args.action === "delete") {
          const { blocks, suggestion } = await documents.edit(paper, { op: args.action, block: args.block, markdown: args.markdown, by, for: args.for, suggest: args.suggest ? args.suggestion ?? true : undefined });
          return text(`${args.action === "delete" ? `Deleted ${args.block}.` : `Wrote ${blocks.length === 1 ? "block" : "blocks"} ${blocks.join(", ")}.`}${suggestion ? ` As the suggestion ${suggestion}.` : ""}`);
        }
        if (args.action === "suggestions") return text((await documents.suggestions(paper)).map((one) => `${one.key} by ${one.by}, blocks ${one.blocks.join(", ")}\n  before: ${one.before || "(nothing)"}\n  now: ${one.after || "(removed)"}`).join("\n\n") || "No suggestions stand in this paper.");
        if (args.action === "accept" || args.action === "reject") {
          if (!args.suggestion) throw new Error("Say which suggestion.");
          await documents[args.action](paper, args.suggestion);
          return text(`${args.action === "accept" ? "Accepted" : "Rejected"} ${args.suggestion}.`);
        }
        const markup = await documents.markup(paper);
        if (args.action === "comments") {
          const items = await markup.open();
          return text(items.map((item) => [`item ${item.id} (${item.state}${item.by ? `, ${item.by}` : ""})`, ...item.comments.map((comment) => `  ${comment.n}${comment.resolved ? ` [resolved by ${comment.resolvedBy ?? "the person"}]` : ""}: ${comment.comment}${comment.quote ? `\n     on “${comment.quote}”` : ""}${comment.under?.blocks ? `\n     in block ${comment.under.blocks}` : ""}${comment.under?.elements ? `\n     over ${comment.under.elements}` : ""}`),
            ...item.messages.map((message) => `  ${message.from === "agent" ? message.by ?? "agent" : "person"}${message.n ? ` on ${message.n}` : ""}: ${message.text}`)].join("\n")).join("\n\n") || "Nothing on this paper waits for an answer.");
        }
        if (!args.item) throw new Error("Say which item.");
        if (args.action === "reply") { await markup.answer(args.item, { n: args.n, text: args.text, by }); return text(`Said on ${args.item}${args.n ? `, comment ${args.n}` : ""}.`); }
        const done = await markup.answer(args.item, { n: args.n, resolved: true, by });
        return text(`Resolved comment ${args.n} of ${args.item}${done.state === "handled" ? ": every comment is resolved, so the item is handled" : ""}. The person still sees it until they resolve it too.`);
      } catch (error) { return text(error?.message || String(error), true); }
    },
  });
}
