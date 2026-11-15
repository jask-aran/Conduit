import { Slider, Switch } from "@/components/ui/controls";
import { SettingLine } from "@/components/ui/overlay";
import { Columns, Group } from "@/components/ui/group";
import { SHEET_ZOOMS, saveSheetDisplay, sheetDisplay } from "../preferences/sheet-display";

export function ArtifactsSettings() {
  return <Group title="Sheet" scope="This device">
    <Columns>
      <Group kind="column">
        <Slider label="Zoom" value={String(sheetDisplay().zoom)} options={SHEET_ZOOMS.map((zoom) => ({ value: String(zoom), label: `${Math.round(zoom * 100)}%` }))} onChange={(value) => saveSheetDisplay({ zoom: Number(value) })} />
      </Group>
      <Group kind="column">
        <SettingLine label="Gridlines"><Switch label="Gridlines" checked={sheetDisplay().gridlines} onChange={(gridlines) => saveSheetDisplay({ gridlines })} /></SettingLine>
        <SettingLine label="Focus cell" title="Washes the active cell's row and column, so the eye finds it."><Switch label="Focus cell" checked={sheetDisplay().focusCell} onChange={(focusCell) => saveSheetDisplay({ focusCell })} /></SettingLine>
      </Group>
    </Columns>
  </Group>;
}
