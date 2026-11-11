/* Each formatter is made once: toLocale*String and a new Intl.DateTimeFormat per call build one each time (a few
 * tenths of a ms a row, the most of a long chat's first draw). */
const CLOCK = new Intl.DateTimeFormat([], { hour: "2-digit", minute: "2-digit" });
let FULL: Intl.DateTimeFormat | null = null;
const dateOf = (at?: string | number | Date | null) => {
  if (at == null || at === "") return null;
  const date = at instanceof Date ? at : new Date(at);
  return Number.isFinite(date.getTime()) ? date : null;
};
export const clockTime = (at?: string | number | Date | null) => { const date = dateOf(at); return date ? CLOCK.format(date) : undefined; };
export const fullTime = (at?: string | number | Date | null) => {
  const date = dateOf(at);
  if (!date) return typeof at === "string" ? at : "";
  FULL ??= new Intl.DateTimeFormat([], { year: "numeric", month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", timeZoneName: "short" });
  return FULL.format(date);
};
