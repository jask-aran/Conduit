import type { Editor } from "@tiptap/core";
import type { EditorView } from "@tiptap/pm/view";
import { createMemo, createSignal, For, onCleanup, Show, type Accessor, type JSX } from "solid-js";
import { createEditorTransaction } from "solid-tiptap";
import { IconButton, Icons } from "@/components/ui";
import { DocumentDropLine, DocumentHandle, documentBlockIcons, documentToolIcons } from "@/components/ui/document";
import { DropdownMenu, MenuContent, MenuControl, MenuRow, MenuSection, MenuSub, MenuSubContent, MenuSubTrigger } from "@/components/ui/menus";
import { addUnder, blockAt, blockRange, blockStarts, caretInto, deleteBlock, duplicateBlock, moveBlock, shiftBlock } from "./blocks";

type Tool = { name: string; label: string; icon: () => JSX.Element; run(): void };
// Under this, a press on the grip is a press (its menu), not a drag.
const DRAG_SLOP_PX = 4;
// Made beside a block, not of it, so not among what a block turns into.
const BESIDE = new Set(["table", "divider"]);

/**
 * The block handle: one grip and one "+" in the gutter beside the top-level block the mouse is over (touch has none yet). Dragged, the grip moves the
 * block, a line saying where it lands; pressed, it opens what can be done to the block. Followed by its id, so what others write elsewhere leaves it on
 * its block. `hover` is fed the pointer over the sheet's column.
 */
export function createBlockHandle(editor: Accessor<Editor | undefined>, tools: readonly Tool[], onComment?: () => ((about: Range) => void) | undefined) {
  const [hovered, setHovered] = createSignal<string | null>(null), [open, setOpen] = createSignal(false), [drop, setDrop] = createSignal<{ to: number; top: number } | null>(null);
  let handle: HTMLDivElement | undefined, pressing = false, dragging = false, frame = 0, refocus = true;
  const doc = createEditorTransaction(editor, (made) => made?.state.doc);
  const from = createMemo(() => { const id = hovered(), now = doc(); let found: number | null = null; if (id && now) now.forEach((node, pos) => { if (node.attrs.id === id) found = pos; }); return found; });
  const origin = () => (handle?.offsetParent as HTMLElement | null)?.getBoundingClientRect().top ?? 0;
  const top = createMemo(() => {
    const pos = from(), view = editor()?.view, block = pos === null ? null : view?.nodeDOM(pos) as HTMLElement | null;
    if (!block?.getBoundingClientRect || !handle) return undefined;
    // On the block's first line, however tall its line (a heading's), or on the block where it is thinner than a line (a divider).
    const box = block.getBoundingClientRect(), line = Math.min(parseFloat(getComputedStyle(block).lineHeight) || box.height, box.height);
    return box.top - origin() + (line - handle.offsetHeight) / 2;
  });

  const hover = (event: PointerEvent | null) => {
    if (open() || pressing) return;
    if (!event) { cancelAnimationFrame(frame); return setHovered(null); }
    if (event.pointerType !== "mouse" || handle?.contains(event.target as Node)) return;
    const { clientX, clientY } = event;
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      const view = editor()?.view;
      if (!view) return;
      const box = view.dom.getBoundingClientRect();
      // The gutter to the text's left is the handle's; the margin to its right is the comments'.
      if (clientY < box.top || clientY > box.bottom || clientX > box.right) return setHovered(null);
      // Read at the text's own edge, so the gutter beside a block finds it too.
      const found = view.posAtCoords({ left: Math.max(box.left + 1, Math.min(clientX, box.right - 1)), top: clientY });
      const at = found ? blockAt(view.state.doc, found.inside >= 0 ? found.inside : found.pos) : null;
      setHovered(at === null ? null : view.state.doc.nodeAt(at)?.attrs.id ?? null);
    });
  };
  onCleanup(() => cancelAnimationFrame(frame));

  /** The gap nearest the pointer, and where its line is drawn; none where the block would land where it is. */
  const gapAt = (view: EditorView, y: number, start: number) => {
    const starts = blockStarts(view.state.doc), boxes = starts.map((pos) => (view.nodeDOM(pos) as HTMLElement | null)?.getBoundingClientRect?.());
    let nth = boxes.findIndex((box) => box && y < box.top + box.height / 2);
    if (nth < 0) nth = starts.length;
    const to = starts[nth] ?? view.state.doc.content.size, size = view.state.doc.nodeAt(start)?.nodeSize ?? 0;
    if (to === start || to === start + size) return null;
    const above = boxes[nth - 1]?.bottom, below = boxes[nth]?.top, line = above !== undefined && below !== undefined ? (above + below) / 2 : (below ?? above ?? y);
    return { to, top: line - origin() };
  };
  const press = (event: PointerEvent) => {
    const view = editor()?.view, start = from();
    if (event.button !== 0 || !view || start === null) return;
    // No focus moves and no text is selected: the editor keeps its caret, and the grip has the pointer until it lifts.
    event.preventDefault();
    pressing = true; dragging = false;
    const grip = event.currentTarget as HTMLElement, startY = event.clientY;
    grip.setPointerCapture(event.pointerId);
    const move = (moved: PointerEvent) => { if (!dragging && Math.abs(moved.clientY - startY) < DRAG_SLOP_PX) return; dragging = true; setDrop(gapAt(view, moved.clientY, start)); };
    const lift = (lifted: PointerEvent) => {
      grip.removeEventListener("pointermove", move); grip.removeEventListener("pointerup", lift); grip.removeEventListener("pointercancel", lift);
      const target = drop();
      setDrop(null); pressing = false;
      if (!dragging) return setOpen(true);
      if (target && lifted.type === "pointerup") moveBlock(view, start, target.to);
    };
    grip.addEventListener("pointermove", move); grip.addEventListener("pointerup", lift); grip.addEventListener("pointercancel", lift);
  };

  const act = (run: (view: EditorView, at: number) => void) => () => { const view = editor()?.view, at = from(); if (view && at !== null) run(view, at); };
  const turn = (tool: Tool) => act((view, at) => { caretInto(view, at); tool.run(); });
  const comment = act((view, at) => { const about = blockRange(view, at), told = onComment?.(); if (about && told) { refocus = false; told(about); } });
  const keep = (event: MouseEvent) => event.preventDefault();

  const view = <>
    <DocumentHandle ref={(element) => { handle = element; }} top={top()}>
      <IconButton label="Add a block below" onMouseDown={keep} onClick={act(addUnder)}><Icons.Add /></IconButton>
      {/* Opened by the press lifting, never as it goes down (a drag starts there); by the keyboard as any menu is. */}
      <DropdownMenu open={open()} onOpenChange={(next) => { if (!next || !pressing) setOpen(next); }} placement="bottom-start">
        <MenuControl as={IconButton} label="Drag to move, press for more" data-grip="" onPointerDown={press}><documentToolIcons.grip /></MenuControl>
        <MenuContent width="sm" onCloseAutoFocus={(event) => { event.preventDefault(); if (refocus) editor()?.commands.focus(); refocus = true; }}>
          <MenuSection>
            <MenuRow icon={<Icons.ArrowUp />} onSelect={act((on, at) => shiftBlock(on, at, -1))}>Move up</MenuRow>
            <MenuRow icon={<Icons.ArrowDown />} onSelect={act((on, at) => shiftBlock(on, at, 1))}>Move down</MenuRow>
            <MenuRow icon={<Icons.Copy />} onSelect={act(duplicateBlock)}>Duplicate</MenuRow>
            <MenuSub>
              <MenuSubTrigger icon={<documentBlockIcons.text />}>Turn into</MenuSubTrigger>
              <MenuSubContent width="sm"><For each={tools.filter((tool) => !BESIDE.has(tool.name))}>{(tool) => <MenuRow icon={tool.icon()} onSelect={turn(tool)}>{tool.label}</MenuRow>}</For></MenuSubContent>
            </MenuSub>
            <Show when={onComment?.()}><MenuRow icon={<documentToolIcons.comment />} onSelect={comment}>Comment</MenuRow></Show>
            <MenuRow destructive icon={<Icons.Delete />} onSelect={act(deleteBlock)}>Delete</MenuRow>
          </MenuSection>
        </MenuContent>
      </DropdownMenu>
    </DocumentHandle>
    <DocumentDropLine top={drop()?.top} />
  </>;
  return { hover, view };
}
