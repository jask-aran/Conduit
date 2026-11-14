import { Type } from "@earendil-works/pi-ai";
import { defineTool } from "@earendil-works/pi-durable";
import { callingChat } from "./conduit-mcp.js";

const text = (words, isError = false) => ({ output: [{ type: "text", text: words }], ...(isError ? { isError: true } : {}) });
const ACTIONS = ["list", "new", "read", "replace", "insert", "delete", "set", "comments", "reply", "resolve"];

/** Papers for an agent: the hub's document service (server/documents.js) as one tool, with the verbs `conduit-markup` has. */
export function PaperTool(runtime) {
  return defineTool({
    name: "conduit_paper",
    description: "Papers: the block documents the person and agents write together in a project (a `.paper` file; edit it only through this tool, since the hub holds the live copy). "
      + "`paper` is a paper's id; omit it in a paper's own thread, or in a chat connected to one paper. "
      + "list (project: id or slug, default this chat's) and new (name, project) give ids. "
      + "read prints the paper as Markdown, each block under `<!-- block <id> -->`. "
      + "set (name, text) writes one property of its front matter (the name: value lines read shows first); no text removes it. "
      + "replace (block, markdown: the first block written keeps the id), insert (block: the one to write after, or `start`; markdown) and delete (block) change it at once, for everyone who has it open. "
      + "To answer a comment by changing the paper, pass `for: \"<item>/<n>\"`: the person then sees what changed for that comment and can take it back. "
      + "comments lists what the person asked on the paper that is not settled (item ids, comment numbers, the text each is about). "
      + "reply (item, n?, text) answers in the margin beside the text; resolve (item, n) marks a comment done, which the person then confirms. "
      + "A project also holds sites: one HTML file each (`<name>.site.html`) that the person sees drawn in a pane and marks up. new with kind `site` makes one (so does writing such a file); "
      + "change it by editing the file with your own tools, not with read, replace, insert or delete. list, comments, reply and resolve take a site's id as they take a paper's.",
    parameters: Type.Object({
      action: Type.Union(ACTIONS.map((value) => Type.Literal(value))),
      paper: Type.Optional(Type.String({ description: "A paper's id." })),
      project: Type.Optional(Type.String({ description: "list, new: a project's id or slug." })),
      name: Type.Optional(Type.String({ description: "new: the paper's name." })),
      kind: Type.Optional(Type.Union([Type.Literal("paper"), Type.Literal("site")], { description: "new: paper (the default) or site." })),
      block: Type.Optional(Type.String({ description: "A block's id, from read." })),
      markdown: Type.Optional(Type.String()),
      for: Type.Optional(Type.String({ description: "The comment an edit answers, as <item>/<n>." })),
      item: Type.Optional(Type.String({ description: "reply, resolve: a markup item's id." })),
      n: Type.Optional(Type.Integer({ description: "A comment's number in its item." })),
      text: Type.Optional(Type.String({ description: "reply: what to say." })),
    }),
    replay: "unsafe",
    execute: async (args, api = {}, context) => {
      const documents = runtime.documents;
      if (!documents) return text("Papers are not ready yet.", true);
      try {
        const mine = documents.of(await callingChat(runtime, api, context));
        if (args.action === "list" || args.action === "new") {
          const project = args.project ?? mine.project;
          if (!project) throw new Error("Say which project.");
          const found = args.action === "list" ? await documents.list(project) : [await documents.create(project, { kind: args.kind, name: args.name })];
          return text(found.map((one) => `${one.id}  ${one.path}`).join("\n") || "No papers or sites in this project.");
        }
        const paper = args.paper ?? (mine.papers.length === 1 ? mine.papers[0].id : null);
        if (!paper) throw new Error(mine.papers.length ? `Say which paper: this chat is connected to ${mine.papers.map((one) => one.id).join(", ")}.` : "Say which paper (`list` gives ids).");
        const by = mine.papers.find((one) => one.id === paper)?.as ?? "agent";
        if (args.action === "read") { void documents.seat(paper, by, { state: "reading" }); return text(await documents.read(paper)); }
        if (args.action === "set") return text(`Its properties: ${JSON.stringify((await documents.edit(paper, { op: "set", block: args.name, markdown: args.text ?? "", by })).properties)}`);
        if (args.action === "replace" || args.action === "insert" || args.action === "delete") {
          const { blocks } = await documents.edit(paper, { op: args.action, block: args.block, markdown: args.markdown, by, for: args.for });
          return text(args.action === "delete" ? `Deleted ${args.block}.` : `Wrote ${blocks.length === 1 ? "block" : "blocks"} ${blocks.join(", ")}.`);
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
