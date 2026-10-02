// German public holidays (gesetzliche Feiertage), per federal state.
//
// Pure and deterministic: computed from the year, no external data.
// Used by the "next working day" rule for deadlines (§108 Abs. 3 AO:
// a deadline ending on a Saturday, Sunday or public holiday ends on the
// next working day).
//
// ASSUMPTIONS (verify):
// - Holidays are applied state-wide. Partial ones are handled like this:
//     * Mariä Himmelfahrt (15.08.) in BY: officially only in municipalities
//       with a Catholic majority (most of Bavaria, incl. Munich). Treated as
//       BY-wide.
//     * Fronleichnam in parts of SN and TH: NOT included.
//     * Augsburger Hohes Friedensfest (08.08., city of Augsburg only): NOT included.
// - One-off holidays (e.g. 08.05.2025 in Berlin) are NOT included.
// - The relevant state is the client's (assumed to equal its Finanzamt's).

import { addDays, toIsoDate, weekday, type IsoDate } from "./isoDate";

export type FederalState =
  | "BW" | "BY" | "BE" | "BB" | "HB" | "HH" | "HE" | "MV"
  | "NI" | "NW" | "RP" | "SL" | "SN" | "ST" | "SH" | "TH";

export interface Holiday {
  date: IsoDate;
  name: string;
}

/** Easter Sunday (Gregorian), "Anonymous Gregorian algorithm" (Meeus/Jones/Butcher). */
export function easterSunday(year: number): IsoDate {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return toIsoDate(year, month, day);
}

/** Buß- und Bettag: the last Wednesday before 23 November (SN only). */
function bussUndBettag(year: number): IsoDate {
  for (let day = 22; day >= 16; day--) {
    const date = toIsoDate(year, 11, day);
    if (weekday(date) === 3) return date;
  }
  throw new Error("unreachable");
}

const ALL: readonly FederalState[] = ["BW", "BY", "BE", "BB", "HB", "HH", "HE", "MV", "NI", "NW", "RP", "SL", "SN", "ST", "SH", "TH"];

/** All public holidays for one state and year, sorted by date. */
export function publicHolidays(year: number, state: FederalState): Holiday[] {
  const easter = easterSunday(year);
  const fixed = (month: number, day: number) => toIsoDate(year, month, day);

  // [date, name, states where it applies]
  const rules: [IsoDate, string, readonly FederalState[]][] = [
    // Nationwide
    [fixed(1, 1), "Neujahr", ALL],
    [addDays(easter, -2), "Karfreitag", ALL],
    [addDays(easter, 1), "Ostermontag", ALL],
    [fixed(5, 1), "Tag der Arbeit", ALL],
    [addDays(easter, 39), "Christi Himmelfahrt", ALL],
    [addDays(easter, 50), "Pfingstmontag", ALL],
    [fixed(10, 3), "Tag der Deutschen Einheit", ALL],
    [fixed(12, 25), "1. Weihnachtstag", ALL],
    [fixed(12, 26), "2. Weihnachtstag", ALL],
    // State-specific (with the year each was introduced, where recent)
    [fixed(1, 6), "Heilige Drei Könige", ["BW", "BY", "ST"]],
    [fixed(3, 8), "Internationaler Frauentag", year >= 2023 ? ["BE", "MV"] : year >= 2019 ? ["BE"] : []],
    [addDays(easter, 60), "Fronleichnam", ["BW", "BY", "HE", "NW", "RP", "SL"]],
    [fixed(8, 15), "Mariä Himmelfahrt", ["BY", "SL"]],
    [fixed(9, 20), "Weltkindertag", year >= 2019 ? ["TH"] : []],
    [
      fixed(10, 31),
      "Reformationstag",
      year >= 2018 ? ["BB", "HB", "HH", "MV", "NI", "SN", "ST", "SH", "TH"] : ["BB", "MV", "SN", "ST", "TH"],
    ],
    [fixed(11, 1), "Allerheiligen", ["BW", "BY", "NW", "RP", "SL"]],
    [bussUndBettag(year), "Buß- und Bettag", ["SN"]],
  ];

  return rules
    .filter(([, , states]) => states.includes(state))
    .map(([date, name]) => ({ date, name }))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/** The holiday on this date in this state, or undefined. */
export function holidayOn(date: IsoDate, state: FederalState): Holiday | undefined {
  const year = Number(date.slice(0, 4));
  return publicHolidays(year, state).find((h) => h.date === date);
}
