/**
 * Today's Surprise picker — currently UNUSED in production.
 *
 * Built for the round-1 Daily Lunch Pail's 4th token. The pail was replaced
 * by the Lazy Susan Carousel, which doesn't surface a daily-rotating mode.
 *
 * PRESERVED for repurpose as part of the "Today's Pail" restaurant-picks
 * widget (the pail metaphor moved to a non-critical-path slot — see #283).
 * The friend-pick / last-call / curveball priority cascade is the right
 * surface for picking what to surface in a daily widget.
 */
import { Restaurant, FriendEngagement } from '@/types';

export type TodaysSurprise =
  | { mode: 'curveball'; label: string }
  | { mode: 'last-call'; label: string; restaurant: Restaurant }
  | { mode: 'friend-pick'; label: string; restaurant: Restaurant; firstName: string };

type TrendingRestaurantLike = Restaurant & { friendEngagement: FriendEngagement };

interface TrendingResultLike {
  restaurants: TrendingRestaurantLike[];
}

const FRIEND_RECENCY_MS = 24 * 60 * 60 * 1000;
const LAST_CALL_HOUR_LOCAL = 19;

/**
 * Pick which "Today's Surprise" mode the Daily Lunch Pail's 4th token should
 * show. Priority cascade:
 *
 *   1. Friend-pick — a friend saved/picked something in the last 24h
 *   2. Last-call  — a nearby restaurant has a lastCallDeal AND it's past 7pm local
 *   3. Curveball  — default
 *
 * When multiple candidates qualify in a tier, the same date seed always picks
 * the same one so the surprise is stable across re-mounts on the same day.
 */
export function pickTodaysSurprise(input: {
  allRestaurants: readonly Restaurant[];
  trendingData?: TrendingResultLike;
  date: Date;
}): TodaysSurprise {
  const { allRestaurants, trendingData, date } = input;
  const daySeed = date.toISOString().slice(0, 10);

  const friendPick = pickFriendPick(trendingData, date, daySeed);
  if (friendPick) return friendPick;

  if (date.getHours() >= LAST_CALL_HOUR_LOCAL) {
    const lastCall = pickLastCall(allRestaurants, daySeed);
    if (lastCall) return lastCall;
  }

  return { mode: 'curveball', label: 'Curveball today' };
}

function pickFriendPick(
  trendingData: TrendingResultLike | undefined,
  date: Date,
  daySeed: string,
): TodaysSurprise | null {
  if (!trendingData || trendingData.restaurants.length === 0) return null;

  const cutoff = date.getTime() - FRIEND_RECENCY_MS;
  const fresh = trendingData.restaurants.filter(r => {
    const ts = Date.parse(r.friendEngagement.lastActivityAt);
    return Number.isFinite(ts) && ts >= cutoff && r.friendEngagement.friends.length > 0;
  });
  if (fresh.length === 0) return null;

  const chosen = fresh[seedIndex(daySeed, fresh.length)];
  const firstName = firstNameOf(chosen.friendEngagement.friends[0].name);
  return {
    mode: 'friend-pick',
    label: `${firstName} just saved this`,
    restaurant: chosen,
    firstName,
  };
}

function pickLastCall(
  allRestaurants: readonly Restaurant[],
  daySeed: string,
): TodaysSurprise | null {
  const deals = allRestaurants.filter(r => !!r.lastCallDeal);
  if (deals.length === 0) return null;
  const chosen = deals[seedIndex(daySeed, deals.length)];
  return {
    mode: 'last-call',
    label: `Closing soon: ${chosen.name}`,
    restaurant: chosen,
  };
}

function seedIndex(seed: string, length: number): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) {
    h = (h * 31 + seed.charCodeAt(i)) | 0;
  }
  return Math.abs(h) % length;
}

function firstNameOf(fullName: string): string {
  const trimmed = fullName.trim();
  const space = trimmed.indexOf(' ');
  return space === -1 ? trimmed : trimmed.slice(0, space);
}
