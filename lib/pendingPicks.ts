// lib/pendingPicks.ts
//
// AsyncStorage carry layer for guest session picks across the signup navigation.
// Key: 'chewabl_pending_picks' — stores full Restaurant[] so the registry
// survives a cold start.
//
// Design mirrors lib/guestFunnel.ts: best-effort, never throws.
// savePendingPicks MERGES with existing picks (deduped by restaurant id;
// incoming picks win on collision — fresher data).

import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Restaurant } from '../types';

export const PENDING_PICKS_KEY = 'chewabl_pending_picks';

/**
 * Returns all pending picks currently in AsyncStorage.
 * Returns [] if the key is absent, if the stored value is not a valid JSON
 * array of Restaurant objects, or on any AsyncStorage error.
 * Never throws.
 */
export async function readPendingPicks(): Promise<Restaurant[]> {
  try {
    const raw = await AsyncStorage.getItem(PENDING_PICKS_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed as Restaurant[];
  } catch {
    return [];
  }
}

/**
 * Merges `picks` into any existing pending picks, deduplicating by restaurant id.
 * The INCOMING picks take precedence (overwrite existing entry for the same id).
 * Best-effort — errors are swallowed and the function never throws.
 */
export async function savePendingPicks(picks: Restaurant[]): Promise<void> {
  try {
    const existing = await readPendingPicks();
    const merged = [...existing];
    for (const pick of picks) {
      const idx = merged.findIndex(r => r.id === pick.id);
      if (idx >= 0) {
        merged[idx] = pick; // incoming wins (fresher data)
      } else {
        merged.push(pick);
      }
    }
    await AsyncStorage.setItem(PENDING_PICKS_KEY, JSON.stringify(merged));
  } catch {
    // best-effort — never throws
  }
}

/**
 * Removes PENDING_PICKS_KEY from AsyncStorage.
 * Idempotent. Swallows errors and never throws.
 */
export async function clearPendingPicks(): Promise<void> {
  try {
    await AsyncStorage.removeItem(PENDING_PICKS_KEY);
  } catch {
    // best-effort — never throws
  }
}
