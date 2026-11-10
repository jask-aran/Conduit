declare module "virtual:settings-index" {
  /** Every setting and group, by section (scripts/settings-index.mjs). acts: its buttons' words. words: what else the row says (its title, state, options). */
  const index: { section: string; group: string | null; label: string; words?: string; acts?: string }[];
  export default index;
}
