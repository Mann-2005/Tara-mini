// The only place that reads the clock. The domain never does: callers pass
// an explicit as-of date, which keeps the gap engine deterministic.

import type { IsoDate } from "@/domain/calendar/isoDate";

/** Today's calendar date in Germany (Europe/Berlin), as YYYY-MM-DD. */
export function todayInGermany(now: Date = new Date()): IsoDate {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}
