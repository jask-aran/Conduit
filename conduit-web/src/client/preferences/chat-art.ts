// The picture behind every chat and how it is drawn. This device's own: the choice in localStorage, an image the person
// gave in IndexedDB.
import { createRoot, createSignal } from "solid-js";
import { chatArtLook, chatArtScenes, chatArtSet, setChatArt, type ChatArtLook } from "@/components/ui/chat-art";

const KEY = "conduit:chat-art";
const LONGEST = 2560;
/** `art` is an id from chatArtSet or chatArtScenes, "upload" (the person's own image) or "none". */
export type ChatArtChoice = Omit<ChatArtLook, "image"> & { art: string };
const first: ChatArtChoice = { ...chatArtLook, art: "waves" };

function saved(): ChatArtChoice {
  try { return { ...first, ...JSON.parse(localStorage.getItem(KEY) || "{}") as Partial<ChatArtChoice> }; } catch { return first; }
}
const [choice, setChoice] = createRoot(() => createSignal(saved()));
const [upload, setUpload] = createRoot(() => createSignal(""));
export const chatArtChoice = choice;
export const chatArtUpload = upload;

const store = <T>(mode: IDBTransactionMode, run: (art: IDBObjectStore) => IDBRequest<T>) => new Promise<T>((resolve, reject) => {
  const open = indexedDB.open("conduit-chat-art", 1);
  open.onupgradeneeded = () => open.result.createObjectStore("art");
  open.onerror = () => reject(open.error);
  open.onsuccess = () => {
    const request = run(open.result.transaction("art", mode).objectStore("art"));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  };
});

function draw() {
  const { art, ...look } = choice();
  const scene = chatArtScenes.find((item) => item.id === art)?.id;
  const image = art === "upload" ? upload() : chatArtSet.find((item) => item.id === art)?.image;
  setChatArt(scene ? { ...look, image: "", scene } : image ? { ...look, image } : null);
}

export function applyChatArt() {
  draw();
  void store<Blob | undefined>("readonly", (art) => art.get("upload")).then((blob) => { if (blob) { setUpload(URL.createObjectURL(blob)); draw(); } }).catch(() => {});
}

export function saveChatArt(patch: Partial<ChatArtChoice>) {
  setChoice({ ...choice(), ...patch });
  try { localStorage.setItem(KEY, JSON.stringify(choice())); } catch { /* this session only */ }
  draw();
}

/** Keeps the person's image, no larger than a screen needs, and shows it. */
export async function uploadChatArt(file: File) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, LONGEST / Math.max(bitmap.width, bitmap.height));
  const canvas = new OffscreenCanvas(Math.round(bitmap.width * scale), Math.round(bitmap.height * scale));
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const blob = await canvas.convertToBlob({ type: "image/webp", quality: 0.9 });
  await store("readwrite", (art) => art.put(blob, "upload"));
  if (upload()) URL.revokeObjectURL(upload());
  setUpload(URL.createObjectURL(blob));
  saveChatArt({ art: "upload" });
}

export async function removeChatArtUpload() {
  await store("readwrite", (art) => art.delete("upload"));
  if (choice().art === "upload") saveChatArt({ art: first.art });
  URL.revokeObjectURL(upload());
  setUpload("");
}
