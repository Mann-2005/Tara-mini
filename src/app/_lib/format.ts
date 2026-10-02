// Presentation helpers for the dashboard. Pure; no domain decisions here —
// they only turn engine output into words.

import { daysInMonth, isoDateToDb, parseIsoDate, type IsoDate } from "@/domain/calendar/isoDate";
import type { Gap } from "@/domain/gaps/gapEngine";

const UTC = { timeZone: "UTC" } as const; // IsoDates are stored as UTC midnight

/** "Mon 12 Oct" */
export function shortDate(date: IsoDate): string {
  return isoDateToDb(date).toLocaleDateString("en-GB", { ...UTC, weekday: "short", day: "numeric", month: "short" });
}

/** "Friday, 2 October 2026" */
export function longDate(date: IsoDate): string {
  return isoDateToDb(date).toLocaleDateString("en-GB", { ...UTC, weekday: "long", day: "numeric", month: "long", year: "numeric" });
}

/** "September 2026", "Q3 2026", or a plain range for anything else. */
export function periodLabel(start: IsoDate, end: IsoDate): string {
  const s = parseIsoDate(start);
  const e = parseIsoDate(end);
  const wholeMonths = s.day === 1 && e.day === daysInMonth(e.year, e.month);
  const months = (e.year - s.year) * 12 + (e.month - s.month) + 1;

  if (wholeMonths && months === 1) {
    return isoDateToDb(start).toLocaleDateString("en-GB", { ...UTC, month: "long", year: "numeric" });
  }
  if (wholeMonths && months === 3 && s.year === e.year && e.month % 3 === 0) {
    return `Q${e.month / 3} ${e.year}`;
  }
  return `${shortDate(start)} ${s.year} to ${shortDate(end)} ${e.year}`;
}

/** "46 days overdue", "due today", "due tomorrow", "due in 3 days" */
export function dueText(daysUntilDue: number): string {
  if (daysUntilDue < -1) return `${-daysUntilDue} days overdue`;
  if (daysUntilDue === -1) return "1 day overdue";
  if (daysUntilDue === 0) return "due today";
  if (daysUntilDue === 1) return "due tomorrow";
  return `due in ${daysUntilDue} days`;
}

/** What has to happen, in plain words, for one gap. */
export function gapAction(gap: Pick<Gap, "kind" | "receipt" | "typeName" | "confirmedDocumentCount" | "minDocuments">): {
  title: string;
  detail: string;
} {
  const docs = (n: number) => `${n} document${n === 1 ? "" : "s"}`;
  if (gap.kind === "FIRM_FILING") {
    return { title: `File ${gap.typeName}`, detail: "Not filed yet" };
  }
  switch (gap.receipt) {
    case "MISSING":
      return { title: gap.typeName, detail: "Nothing received" };
    case "PARTIAL":
      return { title: gap.typeName, detail: `${gap.confirmedDocumentCount} of ${gap.minDocuments} received` };
    case "AWAITING_CLOSE":
      return { title: `Close ${gap.typeName}`, detail: `${docs(gap.confirmedDocumentCount)} received, check they are complete` };
  }
}
