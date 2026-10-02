// Working-day logic for deadlines (§108 Abs. 3 AO).

import { holidayOn, type FederalState } from "./holidays";
import { addDays, weekday, type IsoDate } from "./isoDate";

/** Monday–Friday and not a public holiday in the given state. */
export function isWorkingDay(date: IsoDate, state: FederalState): boolean {
  const dow = weekday(date);
  if (dow === 0 || dow === 6) return false;
  return holidayOn(date, state) === undefined;
}

/** The date itself if it is a working day, otherwise the next working day. */
export function nextWorkingDay(date: IsoDate, state: FederalState): IsoDate {
  let d = date;
  // Bounded loop: German calendars never have more than a few non-working days in a row.
  for (let i = 0; i < 14; i++) {
    if (isWorkingDay(d, state)) return d;
    d = addDays(d, 1);
  }
  throw new Error(`No working day found within 14 days of ${date}`);
}
