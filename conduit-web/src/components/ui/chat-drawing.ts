import { createContext, createSignal, onCleanup, useContext, type Accessor } from "solid-js";

type Drawing = { add: (drawn: Accessor<boolean>) => void; remove: (drawn: Accessor<boolean>) => void };
const ChatDrawing = createContext<Drawing | null>(null);
export const ChatDrawingProvider = ChatDrawing.Provider;
export function createChatDrawing() {
  const [lists, setLists] = createSignal<ReadonlyArray<Accessor<boolean>>>([]);
  const drawing: Drawing = {
    add: (drawn) => setLists((all) => [...all, drawn]),
    remove: (drawn) => setLists((all) => all.filter((item) => item !== drawn)),
  };
  return { drawing, pending: () => lists().some((drawn) => !drawn()) };
}
export function useChatDrawing(drawn: Accessor<boolean>) {
  const drawing = useContext(ChatDrawing);
  if (!drawing) return;
  drawing.add(drawn);
  onCleanup(() => drawing.remove(drawn));
}
