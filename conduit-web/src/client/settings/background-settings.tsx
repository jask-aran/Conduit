import { createSignal, Show } from "solid-js";
import { MeteorsPreview, PictureChoice, Segmented, Slider, Switch } from "@/components/ui/controls";
import { SettingLine } from "@/components/ui/overlay";
import { Columns, Group } from "@/components/ui/group";
import { Note } from "@/components/ui/state";
import { chatArtScenes, chatArtSet, wavePalettes, waveColours } from "@/components/ui/chat-art";
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
        options={[{ value: "meteors", label: "Meteor field", preview: <MeteorsPreview />, source: "https://github.com/jask-aran/solid-components" }, ...chatArtScenes.map((item) => ({ value: item.id, label: item.label, image: item.image, source: item.id === "waves" ? "https://github.com/jask-aran/Conduit/blob/main/conduit-web/src/components/ui/chat-art-draw.ts" : item.id === "stacked-dither" ? "https://github.com/stackedlol/stacked-dither" : `https://github.com/stackedlol/ascii-${item.id}` }))]} />
    </Group>
    <Show when={chatArtChoice().art !== "none"}>
      <Columns>
        <Group kind="column">{dial("brightness", "Brightness", BRIGHTNESS)}</Group>
        <Show when={scene()}>
          <Show when={shown() === "waves" || shown() === "stacked-dither"}>
            <Group kind="column"><Slider label="Speed" options={[0.25, 0.5, 1, 1.5, 2].map((value) => ({ value: String(value), label: `${value}×` }))} value={String(chatArtChoice().speed)} onChange={(value) => saveChatArt({ speed: Number(value) })} />
              <Slider label="Cell size" options={[1, 2, 3, 4, 6, 8].map((value) => ({ value: String(value), label: `${value} px` }))} value={String(chatArtChoice().cell)} onChange={(value) => saveChatArt({ cell: Number(value) })} /></Group>
          </Show>
          <Show when={shown() === "waves"}><Group kind="column"><SettingLine label="Colour"><Segmented label="Wave colour" size="sm" value={chatArtChoice().waveColour} options={waveColours.map((value) => ({ value, label: value.charAt(0).toUpperCase() + value.slice(1) }))} onChange={(value) => { const waveColour = waveColours.find((item) => item === value); if (waveColour) saveChatArt({ waveColour }); }} /></SettingLine></Group></Show>
          <Show when={shown() === "stacked-dither"}>
            <Group kind="column"><SettingLine label="Palette"><Segmented label="Palette" size="sm" value={chatArtChoice().palette} options={wavePalettes.map((value) => ({ value, label: value.charAt(0).toUpperCase() + value.slice(1) }))} onChange={(value) => { const palette = wavePalettes.find((item) => item === value); if (palette) saveChatArt({ palette }); }} /></SettingLine>
              <Slider label="Quiet centre" options={FADE} value={String(Math.round(chatArtChoice().well * 100))} onChange={(value) => saveChatArt({ well: Number(value) / 100 })} /></Group>
          </Show>
          <Show when={shown() === "sharks"}><Group kind="column"><Slider label="Sharks" options={[1, 2, 4, 6, 8].map((value) => ({ value: String(value), label: String(value) }))} value={String(chatArtChoice().sharks)} onChange={(value) => saveChatArt({ sharks: Number(value) })} /></Group></Show>
          <Show when={shown() === "spiders"}><Group kind="column">
            <Slider label="Webs" options={[0, 2, 4, 6, 8, 12].map((value) => ({ value: String(value), label: String(value) }))} value={String(chatArtChoice().webs)} onChange={(value) => saveChatArt({ webs: Number(value) })} />
            <Slider label="Flies" options={[0, 12, 24, 48, 96].map((value) => ({ value: String(value), label: String(value) }))} value={String(chatArtChoice().flies)} onChange={(value) => saveChatArt({ flies: Number(value) })} />
            <SettingLine label="Jumping spider"><Switch label="Jumping spider" checked={chatArtChoice().jumper} onChange={(jumper) => saveChatArt({ jumper })} /></SettingLine>
          </Group></Show>
        </Show>
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
