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

/**
 * Status of a secondary-hours period (happy hour, brunch, etc.) relative to
 * "now". Used to drive the MenuTent's Happy Hour + Brunch sections.
 *
 * - `active`: currently happening; `minutesLeft` until close
 * - `upcoming`: starting within `UPCOMING_WINDOW_MIN`; `minutesUntilStart`
 * - `null`: nothing active or upcoming → don't surface
 */
export interface SpecialHoursStatus {
  state: 'active' | 'upcoming';
  minutesLeft?: number;
  minutesUntilStart?: number;
  startHour24: number;
  startMinute: number;
  endHour24: number;
  endMinute: number;
}

/** @deprecated alias of SpecialHoursStatus, kept for any older consumers */
export type HappyHourStatus = SpecialHoursStatus;

const UPCOMING_WINDOW_MIN = 120; // surface places whose happy hour starts within 2h

/**
 * Returns whether `now` falls inside a secondary-hours period (happy hour,
 * brunch, etc.) OR whether one is starting within the next 2 hours. Returns
 * null if neither (don't surface this restaurant in the corresponding
 * section).
 *
 * Works generically for any `secondaryOpeningHours` period array — pass
 * `restaurant.happyHour` for the Happy Hour section or `restaurant.brunch`
 * for the Brunch section.
 */
export function getSpecialHoursStatus(
  periods: OpeningPeriod[] | undefined,
  now: Date,
): SpecialHoursStatus | null {
  if (!periods || periods.length === 0) return null;

  const nowDay = now.getDay();
  const nowMinutes = now.getHours() * 60 + now.getMinutes();

  let bestUpcoming: SpecialHoursStatus | null = null;

  for (const period of periods) {
    if (!period.close) continue; // happy hour periods always have a close time

    const openDay = period.open.day;
    const openMin = period.open.hour * 60 + period.open.minute;
    const closeDay = period.close.day;
    const closeMin = period.close.hour * 60 + period.close.minute;

    const sameDay = openDay === closeDay;

    if (sameDay) {
      if (nowDay === openDay && nowMinutes >= openMin && nowMinutes < closeMin) {
        return {
          state: 'active',
          minutesLeft: closeMin - nowMinutes,
          startHour24: period.open.hour,
          startMinute: period.open.minute,
          endHour24: period.close.hour,
          endMinute: period.close.minute,
        };
      }
      // Upcoming check (only for periods that haven't started yet today)
      if (nowDay === openDay && nowMinutes < openMin) {
        const untilStart = openMin - nowMinutes;
        if (
          untilStart <= UPCOMING_WINDOW_MIN &&
          (!bestUpcoming || (bestUpcoming.minutesUntilStart ?? Infinity) > untilStart)
        ) {
          bestUpcoming = {
            state: 'upcoming',
            minutesUntilStart: untilStart,
            startHour24: period.open.hour,
            startMinute: period.open.minute,
            endHour24: period.close.hour,
            endMinute: period.close.minute,
          };
        }
      }
    } else {
      // Crosses midnight — active branches
      if (nowDay === openDay && nowMinutes >= openMin) {
        // After open, before midnight — still active until midnight then closeMin next day
        const minutesLeft = 24 * 60 - nowMinutes + closeMin;
        return {
          state: 'active',
          minutesLeft,
          startHour24: period.open.hour,
          startMinute: period.open.minute,
          endHour24: period.close.hour,
          endMinute: period.close.minute,
        };
      }
      if (nowDay === closeDay && nowMinutes < closeMin) {
        return {
          state: 'active',
          minutesLeft: closeMin - nowMinutes,
          startHour24: period.open.hour,
          startMinute: period.open.minute,
          endHour24: period.close.hour,
          endMinute: period.close.minute,
        };
      }
    }
  }

  return bestUpcoming;
}

/** @deprecated use getSpecialHoursStatus — kept for any older consumers */
export const getHappyHourStatus = getSpecialHoursStatus;

/** Format a 24h hour+minute into "4pm" / "4:30pm" / "noon" / "midnight". */
export function formatHour12(hour24: number, minute: number): string {
  if (hour24 === 12 && minute === 0) return 'noon';
  if (hour24 === 0 && minute === 0) return 'midnight';
  const h12 = hour24 === 0 ? 12 : hour24 > 12 ? hour24 - 12 : hour24;
  const ampm = hour24 < 12 ? 'am' : 'pm';
  return minute === 0 ? `${h12}${ampm}` : `${h12}:${minute.toString().padStart(2, '0')}${ampm}`;
}
