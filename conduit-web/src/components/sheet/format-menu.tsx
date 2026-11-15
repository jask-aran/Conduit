import { For } from "solid-js";
import { Icons } from "@/components/ui";
import { PHONE_LAYOUT_QUERY } from "@/components/ui/layout";
import { MenuRow, MenuSection, MenuSub, MenuSubContent, MenuSubTrigger } from "@/components/ui/menus";
import { SHEET_PRESETS, type SheetFormats } from "./formats";
import type { SheetRange } from "./host";

const KEY: Readonly<Record<string, string>> = { Backquote: "`" };

/** The context menu's Number format: the presets, the one the range has bold, and a decimal place more or fewer. */
export function FormatMenu(props: { formats: SheetFormats; range: SheetRange }) {
  const now = () => props.formats.uniform(props.range);
  const named = () => { const format = now(); return format === null ? undefined : SHEET_PRESETS.find((one) => one.format === (format ?? "General"))?.name ?? "Custom"; };
  return <MenuSection>
    {/* On a phone it opens in the menu's place, as every submenu there does, not off its edge. */}
    <MenuSub phone={matchMedia(PHONE_LAYOUT_QUERY).matches}>
      <MenuSubTrigger icon={<Icons.Label />} meta={named()}>Number format</MenuSubTrigger>
      <MenuSubContent>
        <MenuSection>
          <For each={SHEET_PRESETS}>{(preset) => <MenuRow checked={now() !== null && (now() ?? "General") === preset.format} meta={preset.sample} keys={["Ctrl", "Shift", KEY[preset.code] ?? preset.code.slice(-1)]}
            onSelect={() => props.formats.set(props.range, preset.format)}>{preset.name}</MenuRow>}</For>
        </MenuSection>
        <MenuSection>
          <MenuRow icon={<Icons.Add />} onSelect={() => props.formats.decimals(props.range, 1)}>More decimals</MenuRow>
          <MenuRow icon={<Icons.Less />} onSelect={() => props.formats.decimals(props.range, -1)}>Fewer decimals</MenuRow>
        </MenuSection>
      </MenuSubContent>
    </MenuSub>
  </MenuSection>;
}
