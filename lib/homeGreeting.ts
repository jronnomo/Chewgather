export interface Greeting {
  primary: string;
  secondary?: string;
}

const TIME_POOL = {
  morning: [
    'Crunch time, {name}.',
    'Brunch on the brain, {name}?',
    'Morning, {name} — pre-game your bite?',
    'Coffee + a plan, {name}?',
    'Eyes open, {name}. Stomach next.',
    'Hey {name}. First bite of the day?',
  ],
  midday: [
    'Hungry yet, {name}?',
    'Lunch is calling, {name}.',
    'Pick a bite, {name}.',
    'Midday munch, {name}?',
    'Hey {name} — desk lunch is a sin.',
    'Sun is up, {name}. So is your appetite.',
  ],
  evening: [
    'Tonight we feast, {name}.',
    "What's biting, {name}?",
    "Dinner's loading…",
    'Hey {name} — dinner sorted?',
    "Let's chew on something, {name}.",
    'Reservations for one craving, {name}?',
  ],
  late: [
    'Late-night nibbles, {name}?',
    'Midnight crunch?',
    'Still up, {name}? Still hungry?',
    'Hey {name} — kitchen never closes.',
  ],
} as const;

const TIME_EMOJI = {
  morning: '🥐',
  midday: '🍴',
  evening: '🍽️',
  late: '🌙',
} as const;

type TimeSlot = keyof typeof TIME_POOL;

/**
 * Pick the Home header greeting from the time-aware food-vocab pool.
 *
 * The header is pure brand atmosphere — short, rotating, time-of-day aware.
 * Actionable signals (friend activity, expiring deals, notifications) live
 * elsewhere on Home: the pail's sticky note for unread notifications, the
 * Today's Surprise token for variable picks. The greeting stays out of the
 * content-delivery business.
 */
export function pickHomeGreeting(input: {
  firstName: string;
  sessionIndex?: number;
  now: Date;
}): Greeting {
  const name = input.firstName || 'friend';
  const sessionIndex = input.sessionIndex ?? 0;
  const slot = timeSlotFor(input.now);
  const pool = TIME_POOL[slot];
  const daySeed = input.now.toISOString().slice(0, 10);
  const index = (hashString(daySeed) + sessionIndex) % pool.length;
  const template = pool[index < 0 ? index + pool.length : index];
  const emoji = TIME_EMOJI[slot];
  return {
    primary: `${template.replace('{name}', name)} ${emoji}`,
  };
}

function timeSlotFor(now: Date): TimeSlot {
  const hour = now.getHours();
  if (hour >= 5 && hour < 11) return 'morning';
  if (hour >= 11 && hour < 17) return 'midday';
  if (hour >= 17 && hour < 23) return 'evening';
  return 'late';
}

function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) | 0;
  }
  return h;
}
