// The only place that reads the clock. The domain never does: callers pass
// an explicit as-of date, which keeps the gap engine deterministic.

import type { IsoDate } from "@/domain/calendar/isoDate";

const BERLIN_DATE = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin", year: "numeric", month: "2-digit", day: "2-digit" });

/** The calendar date in Germany (Europe/Berlin) of an instant, as YYYY-MM-DD. */
export function germanDate(instant: Date): IsoDate {
  return BERLIN_DATE.format(instant); // en-CA formats as YYYY-MM-DD
}

/** Today's calendar date in Germany (Europe/Berlin), as YYYY-MM-DD. */
export function todayInGermany(now: Date = new Date()): IsoDate {
  return germanDate(now);
}
