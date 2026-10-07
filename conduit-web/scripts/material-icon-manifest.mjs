import { generateManifest } from "material-icon-theme";

/**
 * The file and folder icon lookup, worked out at build time rather than in
 * the page. `generateManifest` builds the whole VS Code icon theme, and in the
 * browser that was a quarter-second of the first open spent before a file list
 * could draw. What the lookup reads is a handful of maps, so only those ship.
 */
export function buildMaterialIconManifest() {
  const manifest = generateManifest({ files: { associations: { "*.dax": "table" } } });
  const { file, folder, folderExpanded, fileNames, fileExtensions, folderNames, folderNamesExpanded } = manifest;
  const icons = Object.fromEntries(Object.entries(manifest.iconDefinitions || {})
    .map(([name, definition]) => [name, definition.iconPath?.split("/").at(-1)]));
  return { file, folder, folderExpanded, fileNames, fileExtensions, folderNames, folderNamesExpanded, icons };
}
