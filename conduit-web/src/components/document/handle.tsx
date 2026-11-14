import type { Editor } from "@tiptap/core";
import type { EditorView } from "@tiptap/pm/view";
import { createEffect, createMemo, createSignal, For, onCleanup, Show, type Accessor, type JSX } from "solid-js";
import { readEditor, track } from "./read";
import { IconButton, Icons } from "@/components/ui";
import { DocumentDropLine, DocumentHandle, documentBlockIcons, documentToneIcons, documentToolIcons } from "@/components/ui/document";
import { DropdownMenu, MenuContent, MenuControl, MenuRow, MenuSection, MenuSub, MenuSubContent, MenuSubTrigger } from "@/components/ui/menus";
import { addUnder, blockAt, blockById, blockRange, blockStarts, caretBlockAt, caretInto, deleteBlock, duplicateBlock, moveBlock, shiftBlock } from "./blocks";
import { DOCUMENT_TURNABLE, type DocumentBlockKind } from "./host";

/** `is`: the node a block of this kind is, and its attrs (a heading's level); a paragraph is Text. */
type Tool = { name: DocumentBlockKind; label: string; icon: () => JSX.Element; is?: [string, Record<string, unknown>?]; run(): void };
// Under this, a press on the grip is a press (its menu), not a drag.
const DRAG_SLOP_PX = 4;

/**
 * The block handle: one grip and one "+" in the gutter beside the top-level block the mouse is over, or, after a touch (which has no hover and whose
 * long press stays the platform's selection), the block holding the caret. Dragged, the grip moves the block, a line saying where it lands; pressed,
 * it opens what can be done to the block, which `openMenu` (the caret's block, the keyboard in it) opens too.
 * Followed by its id, so what others write elsewhere leaves it on its block. `hover` is fed the pointer over the sheet's column; `scroller` is the column, whose room left of the text is the gutter. `onAdded`: the block "+" made, to offer the block kinds in.
 */
export function createBlockHandle(editor: Accessor<Editor | undefined>, tools: readonly Tool[], options: { scroller: Accessor<HTMLElement | undefined>; onComment: () => ((about: Range) => void) | undefined; onAdded: (id: string | undefined) => void }) {
  const [hovered, setHovered] = createSignal<string | null>(null), [open, setOpen] = createSignal(false), [drop, setDrop] = createSignal<{ to: number; top: number } | null>(null), [touched, setTouched] = createSignal(false);
  let handle: HTMLDivElement | undefined, pressing = false, dragging = false, frame = 0, refocus = true;
  // Read with the text only while a block is pointed at.
  const from = createMemo(() => { const id = hovered(), made = editor(); if (!id || !made) return null; track(made, "doc"); return blockById(made.state.doc, id); });
  const origin = () => (handle?.offsetParent as HTMLElement | null)?.getBoundingClientRect() ?? null;
  const place = createMemo(() => {
    const pos = from(), view = editor()?.view, block = pos === null ? null : view?.nodeDOM(pos) as HTMLElement | null, body = origin(), scroller = options.scroller(), grip = handle?.querySelector<HTMLElement>("[data-grip]");
    if (!view || !block?.getBoundingClientRect || !handle || !body || !scroller || !grip) return undefined;
    // It stands left of the text in the sheet's own gutter, never over the text nor off the sheet:
    // where the "+" does not fit too it folds into the grip's menu, and where the grip does not fit it is not shown.
    const style = getComputedStyle(handle), room = view.dom.getBoundingClientRect().left - body.left - (parseFloat(style.marginRight) || 0);
    if (room < grip.offsetWidth) return undefined;
    // On the block's first line, however tall its line (a heading's), or on the block where it is thinner than a line (a divider).
    const box = block.getBoundingClientRect(), line = Math.min(parseFloat(getComputedStyle(block).lineHeight) || box.height, box.height);
    return { top: box.top - body.top + (line - handle.offsetHeight) / 2, add: room >= 2 * grip.offsetWidth + (parseFloat(style.columnGap) || 0) };
  });

  const hover = (event: PointerEvent | null) => {
    if (event?.pointerType === "mouse") setTouched(false);
    if (open() || pressing || touched()) return;
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

  const openOn = (view: EditorView, at: number | null) => { const id = at === null ? null : view.state.doc.nodeAt(at)?.attrs.id; if (!id) return; setHovered(id); setOpen(true); };
  const openMenu = () => { const view = editor()?.view; if (view) openOn(view, caretBlockAt(view)); };

  // After a touch the handle follows the caret's block: a tap puts the caret there, and the handle is how its menu is reached.
  const caret = readEditor(editor, "caret", (made) => { const view = made?.view, at = view ? caretBlockAt(view) : null; return at === null ? null : view!.state.doc.nodeAt(at)?.attrs.id as string | null ?? null; });
  createEffect(() => { if (touched() && !open()) setHovered(caret()); });
  createEffect(() => {
    const dom = editor()?.view.dom;
    if (!dom) return;
    const down = (event: PointerEvent) => setTouched(event.pointerType !== "mouse");
    dom.addEventListener("pointerdown", down);
    onCleanup(() => dom.removeEventListener("pointerdown", down));
  });

  /** The gap nearest the pointer, and where its line is drawn; none where the block would land where it is. */
  const gapAt = (view: EditorView, y: number, start: number) => {
    const starts = blockStarts(view.state.doc), boxes = starts.map((pos) => (view.nodeDOM(pos) as HTMLElement | null)?.getBoundingClientRect?.());
    let nth = boxes.findIndex((box) => box && y < box.top + box.height / 2);
    if (nth < 0) nth = starts.length;
    const to = starts[nth] ?? view.state.doc.content.size, size = view.state.doc.nodeAt(start)?.nodeSize ?? 0;
    if (to === start || to === start + size) return null;
    const above = boxes[nth - 1]?.bottom, below = boxes[nth]?.top, line = above !== undefined && below !== undefined ? (above + below) / 2 : (below ?? above ?? y);
    return { to, top: line - (origin()?.top ?? 0) };
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
  const comment = act((view, at) => { const about = blockRange(view, at), told = options.onComment(); if (about && told) { refocus = false; told(about); } });
  const keep = (event: MouseEvent) => event.preventDefault();
  // A callout's tone is chosen from its menu, where callouts are offered.
  const tone = createMemo(() => { const at = from(), made = editor(); if (at === null || !made) return null; track(made, "doc"); const node = made.state.doc.nodeAt(at); return node?.type.name === "callout" && tools.some((tool) => tool.name === "callout") ? node.attrs.tone as keyof typeof documentToneIcons : null; });
  const tones = [["note", "Note"], ["warning", "Warning"]] as const;
  const kind = createMemo(() => { const at = from(), made = editor(); if (at === null || !made) return null; track(made, "doc"); const node = made.state.doc.nodeAt(at);
    return node && (tools.find(({ is }) => is && node.type.name === is[0] && Object.entries(is[1] ?? {}).every(([key, value]) => node.attrs[key] === value))?.name ?? (node.type.name === "paragraph" ? "text" : null)); });
  const add = act((on, at) => options.onAdded(addUnder(on, at)));

  const view = <>
    <DocumentHandle ref={(element) => { handle = element; }} top={place()?.top}>
      <Show when={place()?.add}><IconButton label="Add a block below" onMouseDown={keep} onClick={add}><Icons.Add /></IconButton></Show>
      {/* Opened by the press lifting, never as it goes down (a drag starts there); by the keyboard as any menu is. */}
      <DropdownMenu modal={false} open={open()} onOpenChange={(next) => { if (!next || !pressing) setOpen(next); }} placement="bottom-start">
        <MenuControl as={IconButton} label="Drag to move, press for more" data-grip="" onPointerDown={press}><documentToolIcons.grip /></MenuControl>
        <MenuContent width="sm" onCloseAutoFocus={(event) => { event.preventDefault(); if (refocus) editor()?.commands.focus(); refocus = true; }}>
          <MenuSection>
            <Show when={!place()?.add}><MenuRow icon={<Icons.Add />} onSelect={add}>Add a block below</MenuRow></Show>
            <MenuRow icon={<Icons.ArrowUp />} keys={["Alt", "Shift", "↑"]} onSelect={act((on, at) => shiftBlock(on, at, -1))}>Move up</MenuRow>
            <MenuRow icon={<Icons.ArrowDown />} keys={["Alt", "Shift", "↓"]} onSelect={act((on, at) => shiftBlock(on, at, 1))}>Move down</MenuRow>
            <MenuRow icon={<Icons.Copy />} onSelect={act(duplicateBlock)}>Duplicate</MenuRow>
            <MenuSub>
              <MenuSubTrigger icon={<documentBlockIcons.text />}>Turn into</MenuSubTrigger>
              <MenuSubContent width="sm"><For each={tools.filter((tool) => (DOCUMENT_TURNABLE as readonly string[]).includes(tool.name))}>{(tool) => <MenuRow icon={tool.icon()} checked={kind() === tool.name} onSelect={turn(tool)}>{tool.label}</MenuRow>}</For></MenuSubContent>
            </MenuSub>
            <Show when={tone()}>{(now) => <MenuSub>
              <MenuSubTrigger icon={<documentBlockIcons.callout />}>Tone</MenuSubTrigger>
              <MenuSubContent width="sm"><For each={tones}>{([name, label]) => { const Icon = documentToneIcons[name]; return <MenuRow icon={<Icon />} checked={now() === name} onSelect={act((on, at) => on.dispatch(on.state.tr.setNodeAttribute(at, "tone", name)))}>{label}</MenuRow>; }}</For></MenuSubContent>
            </MenuSub>}</Show>
            <Show when={options.onComment()}><MenuRow icon={<documentToolIcons.comment />} onSelect={comment}>Comment</MenuRow></Show>
            <MenuRow destructive icon={<Icons.Delete />} onSelect={act(deleteBlock)}>Delete</MenuRow>
          </MenuSection>
        </MenuContent>
      </DropdownMenu>
    </DocumentHandle>
    <DocumentDropLine top={drop()?.top} />
  </>;
  return { hover, view, openMenu };
}
