import { OpeningPeriod } from '../types';

/**
 * Returns true if a restaurant should be considered "open" at the given event date/time.
 *
 * Rules:
 * - `undefined` periods → true (don't punish places with incomplete Google data).
 * - `[]` (explicitly empty array) → false (Google's "permanently closed" signal).
 * - `open` present, `close` missing → 24/7 venue → true.
 * - Period that crosses midnight (close.day !== open.day, e.g. Fri-night bar) →
 *   handled via day-rollover comparison.
 * - Day-of-week extracted from `eventDate.getDay()` (0=Sunday … 6=Saturday) — matches Google convention.
 * - Time-of-day compared in minutes since midnight for precision.
 *
 * eventDate must be a local-time Date (the one already computed in plan-event.tsx).
 */
export function isOpenAt(
  periods: OpeningPeriod[] | undefined,
  eventDate: Date,
): boolean {
  if (periods === undefined) return true;
  if (periods.length === 0) return false;

  const eventDay = eventDate.getDay();
  const eventMinutes = eventDate.getHours() * 60 + eventDate.getMinutes();

  for (const period of periods) {
    // 24/7 venue: open exists, no close
    if (!period.close) return true;

    const openDay = period.open.day;
    const openMin = period.open.hour * 60 + period.open.minute;
    const closeDay = period.close.day;
    const closeMin = period.close.hour * 60 + period.close.minute;

    // Case 1: period starts and ends on same day
    if (openDay === closeDay) {
      if (eventDay === openDay && eventMinutes >= openMin && eventMinutes < closeMin) {
        return true;
      }
      continue;
    }

    // Case 2: period crosses midnight (closeDay !== openDay).
    // Two sub-cases for the event:
    //   a) Event is on openDay AT or AFTER openMin → true (still in the open half)
    //   b) Event is on closeDay BEFORE closeMin → true (still in the post-midnight half)
    if (eventDay === openDay && eventMinutes >= openMin) return true;
    if (eventDay === closeDay && eventMinutes < closeMin) return true;
  }

  return false;
}
