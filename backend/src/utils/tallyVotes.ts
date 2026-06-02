import { IPlan, IPlanRestaurant, IPlanRestaurantOption } from '../models/Plan';

/**
 * Tally votes from a plan and return the winning restaurant.
 * Tie-breaks by highest rating.
 * Returns null if no restaurantOptions exist.
 */
export function tallyWinner(plan: IPlan): IPlanRestaurant | null {
  if (!plan.restaurantOptions || plan.restaurantOptions.length === 0) {
    return null;
  }

  // Exclude curveball restaurants from winner eligibility
  const curveballSet = new Set(plan.curveballIds ?? []);
  const eligible = plan.restaurantOptions.filter(r => !curveballSet.has(r.id));
  if (eligible.length === 0) return null;

  const voteCounts: Record<string, number> = {};
  const votesObj: Record<string, string[]> =
    plan.votes instanceof Map
      ? Object.fromEntries(plan.votes)
      : (plan.votes as Record<string, string[]>);

  for (const userVotes of Object.values(votesObj)) {
    for (const rid of userVotes) {
      voteCounts[rid] = (voteCounts[rid] || 0) + 1;
    }
  }

  const sorted = eligible
    .map(r => ({ restaurant: r, count: voteCounts[r.id] || 0 }))
    .sort((a, b) => b.count - a.count || b.restaurant.rating - a.restaurant.rating);

  return sorted[0].restaurant;
}

/**
 * Returns the full vote-ranked array of options (winner first), curveball-excluded.
 * Same sort logic as tallyWinner. The existing tallyWinner return type and call sites
 * are unchanged.
 */
export function tallyRanked(plan: IPlan): IPlanRestaurantOption[] {
  if (!plan.restaurantOptions?.length) return [];
  const curveballSet = new Set(plan.curveballIds ?? []);
  const eligible = plan.restaurantOptions.filter(r => !curveballSet.has(r.id));
  if (eligible.length === 0) return [];

  const votesObj: Record<string, string[]> =
    plan.votes instanceof Map
      ? Object.fromEntries(plan.votes)
      : (plan.votes as Record<string, string[]>);

  const voteCounts: Record<string, number> = {};
  for (const uv of Object.values(votesObj)) {
    for (const rid of uv) voteCounts[rid] = (voteCounts[rid] || 0) + 1;
  }

  return eligible
    .map(r => ({ r, count: voteCounts[r.id] || 0 }))
    .sort((a, b) => b.count - a.count || b.r.rating - a.r.rating)
    .map(({ r }) => r);
}
