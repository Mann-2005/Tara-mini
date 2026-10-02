// Calendar-date helpers.
//
// The domain works with plain "YYYY-MM-DD" strings (IsoDate), not Date objects.
// A tax deadline is a calendar day in Germany, not an instant in time; using
// strings means no time zone (Europe/Berlin vs UTC) can ever shift a date by
// one. Internally we use UTC Date arithmetic, which has no DST.

/** A calendar date as "YYYY-MM-DD". */
export type IsoDate = string;

/** A calendar month as "YYYY-MM". */
export type IsoMonth = string;

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function parseIsoDate(date: IsoDate): { year: number; month: number; day: number } {
  const m = ISO_DATE.exec(date);
  if (!m) throw new Error(`Invalid ISO date: ${date}`);
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (toIsoDate(year, month, day) !== date) throw new Error(`Invalid ISO date: ${date}`);
  return { year, month, day };
}

/** Build an IsoDate; month is 1–12. Overflowing days roll into the next month. */
export function toIsoDate(year: number, month: number, day: number): IsoDate {
  return new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10);
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function addDays(date: IsoDate, days: number): IsoDate {
  const { year, month, day } = parseIsoDate(date);
  return toIsoDate(year, month, day + days);
}

/** 0 = Sunday … 6 = Saturday. */
export function weekday(date: IsoDate): number {
  const { year, month, day } = parseIsoDate(date);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

/** Shift a (year, month) pair by n months; month is 1–12. */
export function addMonths(year: number, month: number, n: number): { year: number; month: number } {
  const index = year * 12 + (month - 1) + n;
  return { year: Math.floor(index / 12), month: (index % 12) + 1 };
}

export function parseIsoMonth(m: IsoMonth): { year: number; month: number } {
  const match = /^(\d{4})-(\d{2})$/.exec(m);
  if (!match || Number(match[2]) < 1 || Number(match[2]) > 12) throw new Error(`Invalid ISO month: ${m}`);
  return { year: Number(match[1]), month: Number(match[2]) };
}

export function toIsoMonth(year: number, month: number): IsoMonth {
  return `${year}-${String(month).padStart(2, "0")}`;
}

/** Convert to a Date at UTC midnight, for Prisma @db.Date columns. */
export function isoDateToDb(date: IsoDate): Date {
  parseIsoDate(date);
  return new Date(`${date}T00:00:00.000Z`);
}

/** Convert a Prisma @db.Date value (UTC midnight) back to an IsoDate. */
export function dbToIsoDate(date: Date): IsoDate {
  return date.toISOString().slice(0, 10);
}

/** Whole calendar days from `from` to `to` (negative if `to` is earlier). */
export function daysBetween(from: IsoDate, to: IsoDate): number {
  return Math.round((isoDateToDb(to).getTime() - isoDateToDb(from).getTime()) / 86_400_000);
}
