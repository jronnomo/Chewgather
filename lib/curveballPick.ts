import { Restaurant } from '@/types';

/**
 * Rank restaurants by curveball-worthiness using a three-tier fallback.
 *
 * Tier 1: deal-or-highly-rated AND off-cuisine
 * Tier 2: off-cuisine only
 * Tier 3: anything not excluded
 *
 * Within whichever tier yields candidates, sort: deals first, then by rating desc.
 *
 * Off-cuisine is defined by `avoidCuisine` (exclude one exact cuisine, used by
 * group-session against the active plan cuisine) and/or `userCuisines`
 * (exclude any cuisine in the user's preference list, used by Home Curveball
 * to surface unfamiliar food).
 */
export function rankCurveballCandidates(
  pool: readonly Restaurant[],
  opts: {
    excludeIds?: ReadonlySet<string>;
    avoidCuisine?: string;
    userCuisines?: readonly string[];
  } = {},
): Restaurant[] {
  const excludeIds = opts.excludeIds ?? new Set<string>();
  const userCuisineSet = opts.userCuisines && opts.userCuisines.length > 0
    ? new Set(opts.userCuisines)
    : null;

  const isOffCuisine = (r: Restaurant): boolean => {
    if (opts.avoidCuisine && r.cuisine === opts.avoidCuisine) return false;
    if (userCuisineSet && userCuisineSet.has(r.cuisine)) return false;
    return true;
  };

  const tier1 = pool.filter(r =>
    !excludeIds.has(r.id) &&
    isOffCuisine(r) &&
    (!!r.lastCallDeal || r.rating >= 4.5)
  );
  if (tier1.length > 0) return sortByDealThenRating(tier1);

  const tier2 = pool.filter(r =>
    !excludeIds.has(r.id) &&
    isOffCuisine(r)
  );
  if (tier2.length > 0) return sortByDealThenRating(tier2);

  const tier3 = pool.filter(r => !excludeIds.has(r.id));
  return sortByDealThenRating(tier3);
}

function sortByDealThenRating(list: Restaurant[]): Restaurant[] {
  return [...list].sort((a, b) => {
    if (a.lastCallDeal && !b.lastCallDeal) return -1;
    if (!a.lastCallDeal && b.lastCallDeal) return 1;
    return b.rating - a.rating;
  });
}

/**
 * Pick a single curveball restaurant for the Home Curveball action.
 * Returns null when the filtered pool is empty.
 *
 * `hangerLevel` is accepted for forward compatibility with PR 2 (Hangry-O-Meter)
 * but does not bias selection in PR 1.
 */
export function pickCurveball(
  pool: readonly Restaurant[],
  opts?: {
    excludeIds?: readonly string[];
    userCuisines?: readonly string[];
    hangerLevel?: number;
  },
): Restaurant | null {
  const excludeIds = opts?.excludeIds && opts.excludeIds.length > 0
    ? new Set(opts.excludeIds)
    : undefined;
  const ranked = rankCurveballCandidates(pool, {
    excludeIds,
    userCuisines: opts?.userCuisines,
  });
  return ranked[0] ?? null;
}
