import { OpeningPeriod } from '../types';
import { isOpenAt } from './restaurantHours';

/** One tappable reschedule slot within a day's open windows */
export interface TimeSlot {
  hour: number;   // 0–23
  minute: number; // 0 or 30 (30-min granularity)
}

/**
 * Returns tappable start-times (30-min granularity) within the named day's
 * open windows. Handles midnight-crossing periods.
 *
 * - Returns [] when closed all day (openingPeriods === []) or no periods match that day.
 * - Returns a representative full-day set when openingPeriods === undefined (treat-as-open).
 *
 * @param periods  The restaurant's opening periods from Google Places.
 * @param date     A local-time Date for the target day (only date portion used).
 * @param slotIntervalMinutes  Granularity of slots; default 30.
 */
export function sameDayOpenSlots(
  periods: OpeningPeriod[] | undefined,
  date: Date,
  slotIntervalMinutes = 30,
): TimeSlot[] {
  const slots: TimeSlot[] = [];

  // undefined → treat as open all day; return a representative set (8am–10pm)
  if (periods === undefined) {
    for (let h = 8; h < 22; h++) {
      for (let m = 0; m < 60; m += slotIntervalMinutes) {
        slots.push({ hour: h, minute: m });
      }
    }
    return slots;
  }

  // [] → permanently closed; no slots
  if (periods.length === 0) return [];

  // Build a Date probe for each 30-min slot and use isOpenAt
  const year = date.getFullYear();
  const month = date.getMonth();
  const day = date.getDate();

  for (let h = 0; h < 24; h++) {
    for (let m = 0; m < 60; m += slotIntervalMinutes) {
      const probe = new Date(year, month, day, h, m);
      if (isOpenAt(periods, probe)) {
        slots.push({ hour: h, minute: m });
      }
    }
  }

  return slots;
}

/**
 * Finds the next calendar day (starting the day AFTER `fromDate`) that has
 * any open period. Returns null if none found within a 14-day lookahead.
 *
 * - undefined periods → treat as open; returns the very next day.
 * - [] periods → permanently closed; returns null.
 */
export function nextOpenDay(
  periods: OpeningPeriod[] | undefined,
  fromDate: Date,
): Date | null {
  // [] → permanently closed
  if (periods !== undefined && periods.length === 0) return null;

  // undefined → treat as always open; next day is always valid
  if (periods === undefined) {
    const next = new Date(fromDate);
    next.setDate(next.getDate() + 1);
    next.setHours(0, 0, 0, 0);
    return next;
  }

  // Walk up to 14 days forward from fromDate (exclusive)
  for (let i = 1; i <= 14; i++) {
    const candidate = new Date(fromDate);
    candidate.setDate(candidate.getDate() + i);
    candidate.setHours(0, 0, 0, 0);

    // Check if there is any open slot on this day by testing midday (12:00)
    // as a representative probe, then fall back to checking each opening period
    // directly for the candidate's day-of-week.
    const candidateDay = candidate.getDay();
    const hasOpenPeriod = periods.some(period => {
      // 24/7 period (no close) is always open
      if (!period.close) return true;

      const openDay = period.open.day;
      const closeDay = period.close.day;

      if (openDay === closeDay) {
        // Same-day period: candidate must be on openDay
        return candidateDay === openDay;
      }

      // Midnight-crossing period: candidate is open if it matches openDay OR closeDay
      return candidateDay === openDay || candidateDay === closeDay;
    });

    if (hasOpenPeriod) {
      return candidate;
    }
  }

  return null;
}

/**
 * Walks `ranked` (vote-order array of objects with openingPeriods) and returns
 * the first entry that isOpenAt(entry.openingPeriods, eventDate) === true.
 *
 * - Skips entries with openingPeriods === [] (permanently closed).
 * - Treats openingPeriods === undefined as "open" (returns it if encountered first).
 * - Returns null if the array is empty or all entries are closed.
 *
 * Accepts a structural minimum type so it works for both client Restaurant[]
 * and backend IPlanRestaurantOption[] without casting.
 */
export function firstOpenRanked(
  ranked: Array<{ id: string; name?: string; openingPeriods?: OpeningPeriod[] }>,
  eventDate: Date,
): { id: string; name?: string; openingPeriods?: OpeningPeriod[] } | null {
  for (const entry of ranked) {
    // Skip permanently closed entries
    if (entry.openingPeriods !== undefined && entry.openingPeriods.length === 0) {
      continue;
    }
    // undefined → treat as open; or explicitly verify open
    if (isOpenAt(entry.openingPeriods, eventDate)) {
      return entry;
    }
  }
  return null;
}
