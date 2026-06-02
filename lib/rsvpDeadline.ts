/**
 * Human-readable time remaining until an RSVP deadline.
 *
 * - Under 48h: hours only, rounded up — e.g. "5h", "47h".
 * - 48h or more: days + hours — e.g. "3d 4h", or "3d" when there's no
 *   remaining-hours component.
 *
 * Returns `null` when the deadline is missing or already passed, so callers
 * can render their own "deadline passed" copy.
 */
export function formatTimeUntilDeadline(
  deadline: Date | string | null | undefined,
  now: number = Date.now(),
): string | null {
  if (!deadline) return null;
  const ms = new Date(deadline).getTime() - now;
  if (ms <= 0) return null;

  const totalHours = ms / (1000 * 60 * 60);

  // Under two days, hours alone reads fine ("in 6h").
  if (totalHours < 48) {
    return `${Math.ceil(totalHours)}h`;
  }

  // Two days out or more, break it into days + hours ("in 3d 4h").
  let days = Math.floor(totalHours / 24);
  let hours = Math.ceil(totalHours - days * 24);
  // Ceil can roll the remainder up to a full day (e.g. 71.7h → 3d 0h).
  if (hours >= 24) {
    days += 1;
    hours -= 24;
  }
  return hours === 0 ? `${days}d` : `${days}d ${hours}h`;
}
