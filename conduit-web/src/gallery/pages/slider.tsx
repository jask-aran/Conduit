import { createSignal, Show } from "solid-js";
import { Slider, SliderValue, Menu, Section, Button, Icons } from "@/components/ui";
import { thinking } from "../demos";
import { row, token, type Page } from "../model";
import { Levels } from "../demos";

function PlainThinking() {
  const [value, setValue] = createSignal("high");
  return <Slider label="Thinking" options={thinking} value={value()} onChange={setValue} />;
}
function ThinkingExample(props: { custom?: boolean; long?: boolean }) {
  const [value, setValue] = createSignal("low");
  const [open, setOpen] = createSignal(false);
  const options = () => props.long ? [{ value: "low", label: "Low effort for quick workspace questions" }, { value: "high", label: "High effort for a full repository review" }] : thinking;
  return <Menu><Section kind="slider"><Slider label="Thinking" value={value()} onChange={setValue}
    options={options()}
    onOpen={() => setOpen((value) => !value)}
    control={props.custom ? (shown) => <SliderValue aria-expanded={open()} onClick={() => setOpen((value) => !value)}><Icons.Search />{shown()}</SliderValue> : undefined} />
    <Show when={open()}>{options().map((level) => <Button variant="ghost" size="sm" onClick={() => { setValue(level.value); setOpen(false); }}>{level.label}</Button>)}</Show>
  </Section></Menu>;
}
export const sliderPage: Page = {
  title: "Slider",
  summary: "Slider reads the surface's --tint and --well values.",
  preview: () => <div style={{ width: "240px" }}><Levels /></div>,
  usage: `import { Slider } from "@/components/ui";

<Slider label="Thinking" value={level()} onChange={setLevel}
  options={[{ value: "low", label: "Low" }, { value: "high", label: "High" }]}
  onOpen={() => setOpen(true)} />`,
  anatomy: { scene: () => <div style={{ width: "240px" }}><Levels /></div>, parts: [
    { selector: ".ui-slider-head label", name: "Label", does: "names the ordered choice", from: "Slider label" },
    { selector: ".ui-slider-value", name: "Value", does: "shows the selected level", from: "SliderValue" },
    { selector: ".ui-slider-input", name: "Track", does: "changes the level by dragging", from: "Slider options" },
    { selector: ".ui-slider-ticks", name: "Ticks", does: "mark the available levels", from: "Slider options" },
  ] },
  examples: [
    row("Slider", "Slider", () => <div style={{ width: "240px" }}><Levels /></div>),
    row("in model menu", "Drag or open the value to choose a level", () => <ThinkingExample />, { code: "Menu > Section kind=slider > Slider onOpen", surfaces: ["ground"] }),
    row("custom value control", "Icon value opens local level choices", () => <ThinkingExample custom />, { code: "Slider control > SliderValue onClick", surfaces: ["ground"] }),
    row("long option labels", "Full descriptions in a model menu", () => <ThinkingExample long />, { code: "Slider options label", surfaces: ["ground"] }),
    row("disabled one level", "Model supports only Off", () => <Menu><Section kind="slider"><Slider label="Thinking" options={[{ value: "off", label: "Off" }]} value="off" disabled onChange={() => {}} /></Section></Menu>, { code: "Slider disabled options={[one]}", surfaces: ["ground"] }),
    row("plain value", "Track without an opening control", () => <PlainThinking />, { code: "Slider without onOpen or control" }),
    row("disabled value", "Unavailable value button", () => <SliderValue disabled>High</SliderValue>, { code: "<SliderValue disabled>" }),
  ],
  tokens: [{ title: "Slider", tokens: [
    token("--track-size", "Track height"),
    token("--control-2xs", "Small control size"),
    token("--foreground", "Text or filled track colour"),
    token("--tint", "Surface tint"),
    token("--text-caption", "Label or value size"),
  ] }],
  api: ["Slider", "SliderValue"],
};
