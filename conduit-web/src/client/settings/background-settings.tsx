import { createSignal, Show } from "solid-js";
import { MeteorsPreview, PictureChoice, Segmented, Slider, Switch } from "@/components/ui/controls";
import { SettingLine } from "@/components/ui/overlay";
import { Columns, Group } from "@/components/ui/group";
import { Note } from "@/components/ui/state";
import { chatArtScenes, chatArtSet } from "@/components/ui/chat-art";
import { chatArtChoice, chatArtUpload, removeChatArtUpload, saveChatArt, uploadChatArt, type ChatArtChoice } from "../preferences/chat-art";

const percents = (from: number, to: number, step: number) => Array.from({ length: Math.round((to - from) / step) + 1 }, (_, index) => ({ value: String(from + index * step), label: `${from + index * step}%` }));
const BRIGHTNESS = percents(20, 100, 10), FADE = percents(0, 100, 10), STRENGTH = percents(20, 100, 10);

export function BackgroundSettings(props: { meteorField: boolean; onMeteorFieldChange: (on: boolean) => void }) {
  const [error, setError] = createSignal("");
  let chooser!: HTMLInputElement;
  const act = (work: Promise<void>) => { setError(""); void work.catch((failure) => setError(failure instanceof Error ? failure.message : String(failure))); };
  const dial = (key: "brightness" | "fade" | "strength", label: string, options: typeof FADE) =>
    <Slider label={label} options={options} value={String(Math.round(chatArtChoice()[key] * 100))} onChange={(value) => saveChatArt({ [key]: Number(value) / 100 } as Partial<ChatArtChoice>)} />;
  const shown = () => props.meteorField ? "meteors" : chatArtChoice().art;
  const choose = (art: string) => { props.onMeteorFieldChange(art === "meteors"); saveChatArt({ art: art === "meteors" ? "none" : art }); };
  const scene = () => chatArtScenes.some((item) => item.id === chatArtChoice().art);
  return <Group title="Background" scope="This device">
    {/* conventions-ok: a hidden file chooser the picture grid's last tile opens; components/ui has no piece for one */}
    <input ref={chooser} type="file" accept="image/*" hidden onChange={(event) => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ""; if (file) act(uploadChatArt(file)); }} />
    {/* One background at a time, chosen from two rows: pictures, which stand still and are dithered, and scenes,
        which move and are their own picture. The meteor field is a scene, never over a picture. */}
    <Group kind="column" title="Pictures">
      <PictureChoice label="Background picture" value={shown()} onChange={choose}
        add={{ label: chatArtUpload() ? "Replace yours" : "Upload", onClick: () => chooser.click() }}
        options={[{ value: "none", label: "None" }, ...chatArtSet.map((item) => ({ value: item.id, label: item.label, image: item.image })),
          ...(chatArtUpload() ? [{ value: "upload", label: "Yours", image: chatArtUpload(), onRemove: () => act(removeChatArtUpload()) }] : [])]} />
    </Group>
    <Group kind="column" title="Animated">
      <PictureChoice label="Animated background" value={shown()} onChange={choose}
        options={[{ value: "meteors", label: "Meteor field", preview: <MeteorsPreview /> }, ...chatArtScenes.map((item) => ({ value: item.id, label: item.label, image: item.image }))]} />
    </Group>
    <Show when={chatArtChoice().art !== "none"}>
      <Columns>
        <Group kind="column">{dial("brightness", "Brightness", BRIGHTNESS)}</Group>
        {/* A scene is its own picture: it is dimmed, never faded or dithered. */}
        <Show when={!scene()}><Group kind="column">{dial("fade", "Bottom fade", FADE)}</Group>
        <Group kind="column">
          <SettingLine label="Dither">
            <Switch label="Dither the background" checked={chatArtChoice().dither} onChange={(dither) => saveChatArt({ dither })} />
          </SettingLine>
          <SettingLine label="Dot size">
            <Segmented label="Dot size" size="sm" disabled={!chatArtChoice().dither} value={String(chatArtChoice().dot)} options={["1", "2", "3", "4"].map((value) => ({ value, label: `${value} px` }))} onChange={(value) => saveChatArt({ dot: Number(value) })} />
          </SettingLine>
          <Show when={chatArtChoice().dither}>{dial("strength", "Dither strength", STRENGTH)}</Show>
        </Group></Show>
      </Columns>
    </Show>
    <Show when={error()}><Note tone="error">{error()}</Note></Show>
  </Group>;
}
