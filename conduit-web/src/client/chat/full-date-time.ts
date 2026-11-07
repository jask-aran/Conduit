import { fullTime } from "@/components/ui/time";
/** A message's time in full, for its tooltip and details: date, time to the second, and zone (the library's fullTime). */
export const fullDateTime = (value?: string) => fullTime(value);
