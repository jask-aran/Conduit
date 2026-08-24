export type IncremarkPacingMode = "adaptive" | "fixed" | "buffered";

export const INCREMARK_PACING_STORAGE_KEY = "conduit:incremark-pacing";

export const INCREMARK_PACING_OPTIONS: ReadonlyArray<{
  value: IncremarkPacingMode;
  label: string;
}> = [
  { value: "adaptive", label: "Adaptive" },
  { value: "fixed", label: "Fixed" },
  { value: "buffered", label: "Buffered" },
];

function parsePacing(value: string | null): IncremarkPacingMode | null {
  if (value === "adaptive" || value === "fixed" || value === "buffered") return value;
  if (value === "1" || value === "true") return "adaptive";
  if (value === "0" || value === "false") return "fixed";
  return null;
}

export function selectedIncremarkPacing(
  storage: Pick<Storage, "getItem"> = localStorage,
): IncremarkPacingMode {
  const params = typeof location === "undefined" ? null : new URLSearchParams(location.search);
  const override = parsePacing(params ? params.get("incremarkPacing") || params.get("adaptivePacing") : null);
  if (override) return override;
  return parsePacing(storage.getItem(INCREMARK_PACING_STORAGE_KEY)) || "buffered";
}

export function saveIncremarkPacing(
  mode: IncremarkPacingMode,
  storage: Pick<Storage, "setItem"> = localStorage,
): IncremarkPacingMode {
  const selected = mode === "adaptive" || mode === "fixed" ? mode : "buffered";
  storage.setItem(INCREMARK_PACING_STORAGE_KEY, selected);
  return selected;
}
