import { TaskItem, TaskList } from "@tiptap/extension-list";
import { TableKit } from "@tiptap/extension-table";
import { UniqueID } from "@tiptap/extension-unique-id";
import StarterKit from "@tiptap/starter-kit";

/*
 * The Conduit document format, built the same way by the hub's document service (server/documents.js) and the editor
 * (components/document): a document is a list of blocks, and every block carries an id that never changes, which is
 * what a thread or an agent's edit names. The live copy is a Yjs document: its FRAGMENT holds the blocks, and its
 * AUTHORS map names who wrote under each Yjs client id, so every character keeps its author.
 */
export const BLOCK_TYPES = ["paragraph", "heading", "blockquote", "codeBlock", "bulletList", "orderedList", "taskList", "listItem", "taskItem", "table", "horizontalRule"];
export const FRAGMENT = "blocks";
export const AUTHORS = "authors";
export const blockId = () => Math.random().toString(36).slice(2, 10).padEnd(8, "0");
// No trailing block: an editor that adds one writes it into the hub's copy, once for each page that has the document open.
export const documentExtensions = () => [StarterKit.configure({ undoRedo: false, trailingNode: false, link: { openOnClick: false } }), TaskList, TaskItem.configure({ nested: true }), TableKit, UniqueID.configure({ types: BLOCK_TYPES, generateID: blockId })];

/*
 * The live socket (/v0/document/<id>/live) carries binary frames, the first byte saying which: `have` is a Yjs state
 * vector ("this is what I hold: send what I lack") and `update` a Yjs update. Each side sends `have` when the socket
 * opens and answers one with an update, then sends each change as it is made. A text frame is the client naming
 * itself, { client, name }, before it writes.
 */
export const FRAME = { have: 0, update: 1 };
export const frame = (kind, bytes) => { const out = new Uint8Array(bytes.length + 1); out[0] = kind; out.set(bytes, 1); return out; };
