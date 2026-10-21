import { createSignal, Show } from "solid-js";
import { Slider, SliderValue, Menu, Section, Button, Icons } from "@/components/ui";
import { FormTable, form } from "../specs";
import { thinking } from "../demos";
import { lib, type Family } from "../model";
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
export const sliderFamily: Family = {
  title: "Slider", stage: true,
  note: "Slider reads the surface's --tint and --well values, at the surface and density picked above.",
  usage: `import { Slider } from "@/components/ui";

<Slider label="Thinking" value={level()} onChange={setLevel}
  options={[{ value: "low", label: "Low" }, { value: "high", label: "High" }]}
  onOpen={() => setOpen(true)} />`,
  api: ["Slider", "SliderValue"],
  groups: [
    { title: "Examples", staged: true, atoms: [
      lib("slider", "Slider", "both", "control", "Slider", () => <div style={{ width: "240px" }}><Levels /></div>),
      lib("slider-examples", "Slider · additional examples", "both", "control", "Slider · SliderValue", () => <FormTable rows={[
        form("in model menu", "Drag or open the value to choose a level", () => <ThinkingExample />, "Menu > Section kind=slider > Slider onOpen"),
        form("custom value control", "Icon value opens local level choices", () => <ThinkingExample custom />, "Slider control > SliderValue onClick"),
        form("long option labels", "Full descriptions in a model menu", () => <ThinkingExample long />, "Slider options label"),
        form("disabled one level", "Model supports only Off", () => <Menu><Section kind="slider"><Slider label="Thinking" options={[{ value: "off", label: "Off" }]} value="off" disabled onChange={() => {}} /></Section></Menu>, "Slider disabled options={[one]}"),
        form("plain value", "Track without an opening control", () => <PlainThinking />, "Slider without onOpen or control"),
        form("disabled value", "Unavailable value button", () => <SliderValue disabled>High</SliderValue>, "<SliderValue disabled>"),
      ]} on={["ground", "frost"]} />, "row"),
    ] },
  ],
};
