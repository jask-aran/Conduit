import { createEffect, createSignal, For, onCleanup } from "solid-js";
import { Select } from "@/components/ui/menus";
import { ToolBar } from "@/components/ui";
import { chatArtLook, chatArtSet, setChatArt } from "@/components/ui/chat-art";
import { ChatScreen } from "./stories";

const dials = [
  { key: "dot", label: "Dot", unit: "px", values: [1, 2, 3, 4] },
  { key: "levels", label: "Levels", unit: "", values: [2, 3, 4, 5, 6, 8] },
  { key: "strength", label: "Strength", unit: "%", values: [0.25, 0.5, 0.75, 1] },
  { key: "brightness", label: "Brightness", unit: "%", values: [0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1] },
  { key: "fade", label: "Bottom fade", unit: "%", values: [0, 0.2, 0.4, 0.6, 0.8, 1] },
] as const;

export function BackgroundReferences() {
  const [look, setLook] = createSignal({ ...chatArtLook, image: chatArtSet[0]!.image });
  const [uploads, setUploads] = createSignal<{ label: string; image: string }[]>([]);
  createEffect(() => setChatArt(look()));
  onCleanup(() => setChatArt(null));
  return <div class="g-background-reference">
    <ToolBar>
      <Select aria-label="Background" value={look().image} onChange={(event) => setLook({ ...look(), image: event.currentTarget.value })}>
        <For each={[...chatArtSet, ...uploads()]}>{(item) => <option value={item.image}>{item.label}</option>}</For>
      </Select>
      <input type="file" accept="image/*" aria-label="Upload a background" onChange={(event) => {
        const file = event.currentTarget.files?.[0];
        if (!file) return;
        const image = URL.createObjectURL(file);
        setUploads([...uploads(), { label: file.name, image }]);
        setLook({ ...look(), image });
      }} />
      <Select aria-label="Effect" value={look().dither ? "dither" : "none"} onChange={(event) => setLook({ ...look(), dither: event.currentTarget.value === "dither" })}>
        <option value="dither">Dither</option><option value="none">No effect</option>
      </Select>
      <For each={dials}>{(dial) => <Select aria-label={dial.label} value={String(look()[dial.key])} onChange={(event) => setLook({ ...look(), [dial.key]: Number(event.currentTarget.value) })}>
        <For each={dial.values}>{(value) => <option value={String(value)}>{dial.label} {dial.unit === "%" ? value * 100 : value}{dial.unit}</option>}</For>
      </Select>}</For>
    </ToolBar>
    <ChatScreen />
  </div>;
}
