import { lib, type Family } from "../model";
import { Levels } from "../demos";

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
    ] },
  ],
};
