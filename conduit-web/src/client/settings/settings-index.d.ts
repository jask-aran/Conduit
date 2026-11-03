declare module "virtual:settings-index" {
  /** Every setting with a literal label, by section and group (scripts/settings-index.mjs). */
  const index: { section: string; group: string | null; label: string }[];
  export default index;
}
