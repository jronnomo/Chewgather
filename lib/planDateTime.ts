/**
 * Parse a plan's stored date ('YYYY-MM-DD') + time ('7:00 PM') into a single
 * local-time Date. Returns null if either part is missing or malformed.
 *
 * Local time (not UTC) on purpose: it must match the device's wall clock and
 * isOpenAt()'s day-of-week / minutes-since-midnight comparisons.
 */
export function parsePlanDateTime(
  date?: string | null,
  time?: string | null,
): Date | null {
  if (!date || !time) return null;

  const [year, month, day] = date.split('-').map(Number);
  const timeMatch = time.match(/^(\d+):(\d+)\s*(AM|PM)$/i);
  if (!year || !month || !day || !timeMatch) return null;

  let hour = parseInt(timeMatch[1], 10);
  const minute = parseInt(timeMatch[2], 10);
  const isPM = timeMatch[3].toUpperCase() === 'PM';
  if (isPM && hour !== 12) hour += 12;
  if (!isPM && hour === 12) hour = 0;

  return new Date(year, month - 1, day, hour, minute);
}

/**
 * Returns the plural weekday name for a Date (e.g. "Fridays").
 * Used in ClosedWinnerSheet sub-line copy.
 */
export function weekdayPlural(date: Date): string {
  const days: string[] = ['Sundays', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays'];
  return days[date.getDay()];
}

/**
 * Returns the short weekday name for a Date (e.g. "Friday").
 */
export function weekdayName(date: Date): string {
  const days: string[] = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  return days[date.getDay()];
}

/**
 * Formats a Date as a human-readable string like "Fri, Jun 6".
 */
export function formatPlanDate(date: Date): string {
  return date.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}
