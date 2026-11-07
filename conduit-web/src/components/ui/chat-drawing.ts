import { createContext, createSignal, onCleanup, useContext, type Accessor } from "solid-js";

/*
 * Whether a ChatView's lists are drawn (a TranscriptList says when everything on screen is): the view is held unseen
 * until they are, then shown (and a phone's drawer may slide back over it: paneDrawn). Every chat opens that way.
 */
type Drawing = { add: (drawn: Accessor<boolean>) => void; remove: (drawn: Accessor<boolean>) => void };
const ChatDrawing = createContext<Drawing | null>(null);
export const ChatDrawingProvider = ChatDrawing.Provider;
/** For a ChatView: its lists' drawn states, and whether any is still drawing. */
export function createChatDrawing() {
  const [lists, setLists] = createSignal<ReadonlyArray<Accessor<boolean>>>([]);
  const drawing: Drawing = {
    add: (drawn) => setLists((all) => [...all, drawn]),
    remove: (drawn) => setLists((all) => all.filter((item) => item !== drawn)),
  };
  return { drawing, pending: () => lists().some((drawn) => !drawn()) };
}
/** A list's drawn state, told to the ChatView it is in (none: nothing to tell). */
export function useChatDrawing(drawn: Accessor<boolean>) {
  const drawing = useContext(ChatDrawing);
  if (!drawing) return;
  drawing.add(drawn);
  onCleanup(() => drawing.remove(drawn));
}
