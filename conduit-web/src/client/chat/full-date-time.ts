// Made once (a formatter per call cost every row of a chat drawn a few tenths of a ms).
let FULL: Intl.DateTimeFormat | null = null;
/** A message's time in full, for its tooltip and details: date, time to the second, and zone. */
export const fullDateTime = (value?: string) => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  FULL ??= new Intl.DateTimeFormat([], {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZoneName: "short",
  });
  return FULL.format(date);
};
