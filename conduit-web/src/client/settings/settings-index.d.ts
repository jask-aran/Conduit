declare module "virtual:settings-index" {
  /** Every setting and group, by section (scripts/settings-index.mjs). words: what else the row says (its title, state, options, buttons). */
  const index: { section: string; group: string | null; label: string; words?: string }[];
  export default index;
}
