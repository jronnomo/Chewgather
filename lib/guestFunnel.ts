// lib/guestFunnel.ts
import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * The three intent-moment triggers for ConversionPrompt.
 * Single authoritative definition — ConversionPrompt, swipe.tsx,
 * and home/index.tsx all import from here.
 */
export type FunnelTrigger = 'save' | 'save-single' | 'end-of-swipe' | 'nudge' | 'plan-dinner';

// ── AsyncStorage keys ──────────────────────────────────────────────────────
export const OPEN_COUNT_KEY = 'chewabl_guest_open_count';
export const NUDGE_SHOWN_KEY = 'chewabl_guest_nudge_shown';

// ── Per-session in-memory dismissal state (resets on module reload / app restart) ──
const dismissed: Partial<Record<FunnelTrigger, boolean>> = {};

/**
 * Increment and return the guest app-open counter.
 * Called once per Home mount when isGuest=true && !isLoading && isOnboarded.
 * Returns the new count (1-based).
 */
export async function recordGuestAppOpen(): Promise<number> {
  const stored = await AsyncStorage.getItem(OPEN_COUNT_KEY);
  const current = stored ? (JSON.parse(stored) as number) : 0;
  const next = current + 1;
  await AsyncStorage.setItem(OPEN_COUNT_KEY, JSON.stringify(next));
  return next;
}

/**
 * Returns true if the lifetime nudge has already been shown.
 */
export async function hasNudgeBeenShown(): Promise<boolean> {
  const val = await AsyncStorage.getItem(NUDGE_SHOWN_KEY);
  return val === 'true';
}

/**
 * Marks the lifetime nudge as shown. Idempotent.
 */
export async function markNudgeShown(): Promise<void> {
  await AsyncStorage.setItem(NUDGE_SHOWN_KEY, 'true');
}

/**
 * Returns true if the given trigger was dismissed this session.
 * Pure synchronous — reads in-memory state only.
 */
export function wasTriggerDismissed(trigger: FunnelTrigger): boolean {
  return dismissed[trigger] === true;
}

/**
 * Marks the given trigger as dismissed for this session.
 * Pure synchronous — writes in-memory state only.
 */
export function markTriggerDismissed(trigger: FunnelTrigger): void {
  dismissed[trigger] = true;
}

/**
 * Clears all guest funnel AsyncStorage state.
 * Called from AppContext's sign-out cleanup so returning guests
 * get a fresh counter and nudge eligibility.
 */
export async function clearGuestFunnelState(): Promise<void> {
  await AsyncStorage.multiRemove([OPEN_COUNT_KEY, NUDGE_SHOWN_KEY]);
}
