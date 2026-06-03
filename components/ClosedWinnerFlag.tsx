/**
 * ClosedWinnerFlag — shared passive "may be closed" amber flag.
 *
 * Used on PlanCard and group-session (Stream S4). Renders whenever
 * plan.winnerClosedAt is set — including after "Don't remind me again"
 * (winnerClosedDismissed suppresses only the modal auto-open, not this banner).
 *
 * Props:
 *   plan     — the DiningPlan to inspect
 *   onPress  — if provided, the flag is tappable (owner flow: reopens sheet)
 *
 * UX spec: gh issue 292
 *   LIGHT: amber `cautionText` text on `secondaryLight` (#FFF4E0) bg pill
 *   DARK:  amber `cautionText` text, no background fill (transparent)
 */
import React from 'react';
import { Pressable, StyleSheet } from 'react-native';
import { AlertTriangle } from 'lucide-react-native';
import AppText from './AppText';
import { DiningPlan } from '../types';
import StaticColors from '../constants/colors';
import { useColors } from '../context/ThemeContext';

// Module-level static Colors for StyleSheet.create()
const Colors = StaticColors;

export interface ClosedWinnerFlagProps {
  plan: DiningPlan;
  /** When provided, the flag is tappable — owner reopens the resolution sheet. */
  onPress?: () => void;
}

export default function ClosedWinnerFlag({ plan, onPress }: ClosedWinnerFlagProps) {
  const Colors = useColors();

  // Only render when winnerClosedAt is set — regardless of winnerClosedDismissed
  if (!plan.winnerClosedAt) return null;

  const restaurantName = plan.restaurant?.name ?? 'your pick';
  const accessibilityLabel = `Heads up, ${restaurantName} may be closed at this time`;

  const isInteractive = !!onPress;

  return (
    <Pressable
      testID="closed-winner-flag"
      style={[
        flagStyles.container,
        // LIGHT: Colors.secondaryLight = #FFF4E0 (amber tint pill)
        // DARK:  Colors.secondaryLight = #2A2210 (nearly transparent — keeps cards calm per UX spec)
        { backgroundColor: Colors.secondaryLight },
      ]}
      onPress={isInteractive ? onPress : undefined}
      disabled={!isInteractive}
      accessibilityRole={isInteractive ? 'button' : 'text'}
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={isInteractive ? 'Double tap to review options.' : undefined}
      hitSlop={isInteractive ? 4 : undefined}
    >
      <AlertTriangle size={12} color={Colors.secondary} strokeWidth={2.2} />
      <AppText
        variant="dense"
        style={[flagStyles.text, { color: Colors.cautionText }]}
        numberOfLines={2}
      >
        {accessibilityLabel}
      </AppText>
    </Pressable>
  );
}

const flagStyles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
  },
  text: {
    fontSize: 12,
    fontWeight: '500' as const,
    color: Colors.cautionText,
    flex: 1,
  },
});
