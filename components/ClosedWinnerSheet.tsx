/**
 * ClosedWinnerSheet — owner-only bottom sheet for the Closed-Winner Resolution flow.
 *
 * Renders when a confirmed voting plan's winner is detected closed at the scheduled
 * date/time. Offers four resolution paths: Reschedule, Switch, Keep it anyway, and
 * Don't remind me again.
 *
 * Architecture: REQ-005 / architecture-blueprint-v2.md
 * UX spec: gh issue 292 (ASCII mockups + animation storyboard, LOCKED)
 *
 * Also exports:
 *   ClosedWinnerFlag  — small shared passive "may be closed" flag for PlanCard + group-session
 */
import React, {
  useEffect,
  useRef,
  useState,
  useCallback,
  ComponentProps,
} from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import AppText from '@/components/AppText';
import { Image } from 'expo-image';
import { AlertTriangle } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { DiningPlan, OpeningPeriod, Restaurant } from '../types';
import { resolveWinner } from '../services/plans';
import { sameDayOpenSlots, nextOpenDay, firstOpenRanked, TimeSlot } from '../lib/openWindows';
import { parsePlanDateTime, weekdayPlural, weekdayName, formatPlanDate } from '../lib/planDateTime';
import { formatHour12 } from '../lib/restaurantHours';
import StaticColors from '../constants/colors';
import { useColors } from '../context/ThemeContext';

// Module-level static Colors for StyleSheet.create()
const Colors = StaticColors;

// ---------------------------------------------------------------------------
// Public prop types (per architecture-blueprint-v2.md)
// ---------------------------------------------------------------------------

export interface ClosedWinnerSheetProps {
  /** Confirmed plan with winnerClosedAt set. */
  plan: DiningPlan;
  visible: boolean;
  /** Called after any action completes OR after backdrop/keep-anyway dismiss. */
  onClose: () => void;
  /** Called after a successful reschedule or switch mutation. */
  onResolved: (updatedPlan: DiningPlan) => void;
}

export interface ClosedWinnerFlagProps {
  plan: DiningPlan;
  isOwner: boolean;
  /** Owner-only: called when they tap the flag to reopen the sheet. */
  onOwnerTap?: () => void;
  style?: ComponentProps<typeof View>['style'];
}

// ---------------------------------------------------------------------------
// Internal sub-component prop types
// ---------------------------------------------------------------------------

interface CautionHeaderProps {
  restaurantName: string;
  plannedDate: string;     // e.g. "Fri, Jun 6"
  plannedTime: string;     // e.g. "11:00 PM"
  closedAllDay: boolean;
  closingTimeLabel?: string; // e.g. "10 PM"
  weekday?: string;          // e.g. "Fridays"
}

interface RescheduleWindowsProps {
  slots: TimeSlot[];
  nextOpenDate: Date | null;
  selectedSlot: TimeSlot | null;
  selectedNextDay: boolean;
  onSelectSlot: (slot: TimeSlot) => void;
  onSelectNextDay: () => void;
}

interface SwitchRowProps {
  restaurant: { id: string; name?: string; openingPeriods?: OpeningPeriod[]; imageUrl?: string };
  rank: number;
  voteCount: number;
  onPress: () => void;
}

// ---------------------------------------------------------------------------
// CautionHeader (module-level helper — MUST call useColors() in own body)
// ---------------------------------------------------------------------------
function CautionHeader({
  restaurantName,
  plannedDate,
  plannedTime,
  closedAllDay,
  closingTimeLabel,
  weekday,
}: CautionHeaderProps) {
  const Colors = useColors(); // required per CLAUDE.md

  const headline = closedAllDay
    ? `Crumb — ${restaurantName} is closed all day`
    : `Crumb — looks like ${restaurantName}'s lights are off then`;

  const subLine = closedAllDay
    ? `You picked ${plannedDate}. ${restaurantName} isn't open that day.`
    : `You picked ${plannedDate} at ${plannedTime}. ${restaurantName} closes at ${closingTimeLabel ?? '?'} ${weekday ?? ''}.`;

  return (
    <View style={[cautionHeaderStyles.container, { backgroundColor: Colors.card }]}>
      {/* Amber warning circle */}
      <View
        style={[
          cautionHeaderStyles.iconCircle,
          { backgroundColor: Colors.secondaryLight },
        ]}
      >
        <AlertTriangle
          size={18}
          color={Colors.secondary}
          strokeWidth={2.2}
        />
      </View>

      <View style={cautionHeaderStyles.textBlock}>
        <AppText
          variant="display"
          style={[cautionHeaderStyles.headline, { color: Colors.text }]}
          accessibilityRole="header"
        >
          {headline}
        </AppText>
        <AppText
          variant="body"
          style={[cautionHeaderStyles.subLine, { color: Colors.textSecondary }]}
        >
          {subLine}
        </AppText>
      </View>
    </View>
  );
}

const cautionHeaderStyles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    paddingBottom: 20,
    backgroundColor: Colors.card,
  },
  iconCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.secondaryLight,
    flexShrink: 0,
    marginTop: 2,
  },
  textBlock: {
    flex: 1,
  },
  headline: {
    fontSize: 20,
    fontWeight: '700' as const,
    color: Colors.text,
    marginBottom: 6,
    lineHeight: 26,
  },
  subLine: {
    fontSize: 14,
    color: Colors.textSecondary,
    lineHeight: 20,
  },
});

// ---------------------------------------------------------------------------
// RescheduleWindows (module-level helper — MUST call useColors() in own body)
// ---------------------------------------------------------------------------
function RescheduleWindows({
  slots,
  nextOpenDate,
  selectedSlot,
  selectedNextDay,
  onSelectSlot,
  onSelectNextDay,
}: RescheduleWindowsProps) {
  const Colors = useColors(); // required per CLAUDE.md

  // Scale anim map for chip press pulse (mirrors TimeGrid handleChipPress)
  const chipScaleAnims = useRef<Record<string, Animated.Value>>({}).current;
  const getChipAnim = useCallback(
    (key: string): Animated.Value => {
      if (!chipScaleAnims[key]) chipScaleAnims[key] = new Animated.Value(1);
      return chipScaleAnims[key];
    },
    [chipScaleAnims],
  );

  const handleSlotPress = useCallback(
    (slot: TimeSlot) => {
      Haptics.selectionAsync();
      onSelectSlot(slot);
      const key = `${slot.hour}:${slot.minute}`;
      const anim = getChipAnim(key);
      Animated.spring(anim, {
        toValue: 1.08,
        tension: 300,
        friction: 10,
        useNativeDriver: true,
      }).start(() => {
        Animated.spring(anim, {
          toValue: 1,
          tension: 300,
          friction: 10,
          useNativeDriver: true,
        }).start();
      });
    },
    [onSelectSlot, getChipAnim],
  );

  const handleNextDayPress = useCallback(() => {
    Haptics.selectionAsync();
    onSelectNextDay();
    const anim = getChipAnim('nextday');
    Animated.spring(anim, {
      toValue: 1.08,
      tension: 300,
      friction: 10,
      useNativeDriver: true,
    }).start(() => {
      Animated.spring(anim, {
        toValue: 1,
        tension: 300,
        friction: 10,
        useNativeDriver: true,
      }).start();
    });
  }, [onSelectNextDay, getChipAnim]);

  const formatSlot = (slot: TimeSlot): string =>
    formatHour12(slot.hour, slot.minute).toUpperCase().replace('AM', ' AM').replace('PM', ' PM');

  // Closed all day — show only next-open-day chip
  if (slots.length === 0) {
    return (
      <View
        testID="cw-reschedule-windows"
        style={[rwStyles.container, { backgroundColor: Colors.card }]}
      >
        <AppText variant="dense" style={[rwStyles.sectionLabel, { color: Colors.textSecondary }]}>
          Move it to when they're open
        </AppText>

        {nextOpenDate ? (
          <Animated.View
            testID="cw-next-open-day"
            style={[
              rwStyles.chipWrapper,
              { transform: [{ scale: getChipAnim('nextday') }] },
            ]}
          >
            <Pressable
              style={[
                rwStyles.nextDayChip,
                {
                  backgroundColor: selectedNextDay ? Colors.primary : Colors.card,
                  borderColor: selectedNextDay ? Colors.primary : Colors.border,
                },
              ]}
              onPress={handleNextDayPress}
              accessibilityRole="button"
              accessibilityLabel={`Next open: ${weekdayName(nextOpenDate)}, ${formatPlanDate(nextOpenDate)}. Tap to move to that day.`}
              accessibilityState={{ selected: selectedNextDay }}
            >
              <AppText
                variant="dense"
                style={[
                  rwStyles.nextDayChipText,
                  { color: selectedNextDay ? '#FFFFFF' : Colors.text },
                ]}
              >
                {'📅  '}Next open: {weekdayName(nextOpenDate)}
              </AppText>
              <AppText
                variant="dense"
                style={[
                  rwStyles.nextDayChipSub,
                  { color: selectedNextDay ? 'rgba(255,255,255,0.8)' : Colors.textSecondary },
                ]}
              >
                Tap to move to {weekdayName(nextOpenDate)}, {formatPlanDate(nextOpenDate)}
              </AppText>
            </Pressable>
          </Animated.View>
        ) : (
          <AppText variant="body" style={[rwStyles.noSlotsText, { color: Colors.textSecondary }]}>
            No open days found in the next 14 days.
          </AppText>
        )}
      </View>
    );
  }

  // Same-day slots available
  return (
    <View
      testID="cw-reschedule-windows"
      style={[rwStyles.container, { backgroundColor: Colors.card }]}
    >
      <AppText variant="dense" style={[rwStyles.sectionLabel, { color: Colors.textSecondary }]}>
        Move it to when they're open
      </AppText>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={rwStyles.chipsRow}
      >
        {slots.map((slot) => {
          const key = `${slot.hour}:${slot.minute}`;
          const isSelected =
            !selectedNextDay &&
            selectedSlot?.hour === slot.hour &&
            selectedSlot?.minute === slot.minute;

          return (
            <Animated.View
              key={key}
              style={{ transform: [{ scale: getChipAnim(key) }] }}
            >
              <Pressable
                style={[
                  rwStyles.chip,
                  {
                    backgroundColor: isSelected ? Colors.primary : Colors.card,
                    borderColor: isSelected ? Colors.primary : Colors.border,
                  },
                ]}
                onPress={() => handleSlotPress(slot)}
                accessibilityRole="button"
                accessibilityLabel={`Reschedule to ${formatSlot(slot)}`}
                accessibilityState={{ selected: isSelected }}
                testID={`cw-reschedule-slot-${slot.hour}-${slot.minute}`}
              >
                <AppText
                  variant="dense"
                  style={[
                    rwStyles.chipText,
                    { color: isSelected ? '#FFFFFF' : Colors.text },
                  ]}
                >
                  {formatSlot(slot)}
                </AppText>
              </Pressable>
            </Animated.View>
          );
        })}
      </ScrollView>
    </View>
  );
}

const rwStyles = StyleSheet.create({
  container: {
    paddingBottom: 20,
    backgroundColor: Colors.card,
  },
  sectionLabel: {
    fontSize: 13,
    fontWeight: '600' as const,
    color: Colors.textSecondary,
    marginBottom: 10,
    letterSpacing: 0.1,
  },
  chipsRow: {
    flexDirection: 'row',
    gap: 8,
    paddingRight: 4,
  },
  chipWrapper: {
    // used for nextday chip scale anim container
  },
  chip: {
    minHeight: 44,
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 14,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 80,
  },
  chipText: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: Colors.text,
  },
  nextDayChip: {
    borderRadius: 14,
    borderWidth: 1.5,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  nextDayChipText: {
    fontSize: 15,
    fontWeight: '600' as const,
    color: Colors.text,
  },
  nextDayChipSub: {
    fontSize: 13,
    color: Colors.textSecondary,
    marginTop: 3,
  },
  noSlotsText: {
    fontSize: 14,
    color: Colors.textSecondary,
    fontStyle: 'italic',
  },
});

// ---------------------------------------------------------------------------
// SwitchRow (module-level helper — MUST call useColors() in own body)
// ---------------------------------------------------------------------------
function SwitchRow({ restaurant, rank, voteCount, onPress }: SwitchRowProps) {
  const Colors = useColors(); // required per CLAUDE.md

  return (
    <View
      testID="cw-switch-row"
      style={[switchRowStyles.container, { backgroundColor: Colors.card }]}
    >
      <AppText variant="dense" style={[switchRowStyles.sectionLabel, { color: Colors.textSecondary }]}>
        Or switch to an open spot
      </AppText>

      <Pressable
        style={[switchRowStyles.row, { backgroundColor: Colors.surfaceElevated, borderColor: Colors.border }]}
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={`Switch to ${restaurant.name ?? 'restaurant'}, open at your time, ranked number ${rank} with ${voteCount} vote${voteCount !== 1 ? 's' : ''}`}
        hitSlop={4}
      >
        {/* Restaurant image */}
        {restaurant.imageUrl ? (
          <Image
            source={{ uri: restaurant.imageUrl }}
            style={switchRowStyles.image}
            contentFit="cover"
          />
        ) : (
          <View style={[switchRowStyles.image, { backgroundColor: Colors.border }]} />
        )}

        {/* Name + rank line */}
        <View style={switchRowStyles.meta}>
          <View style={switchRowStyles.nameRow}>
            <AppText
              variant="dense"
              style={[switchRowStyles.name, { color: Colors.text }]}
              numberOfLines={1}
              ellipsizeMode="tail"
            >
              {restaurant.name ?? 'Runner-up'}
            </AppText>
            {/* "Open then" green pill */}
            <View style={switchRowStyles.openPill}>
              <AppText variant="dense" style={switchRowStyles.openPillText}>Open then</AppText>
            </View>
          </View>
          <AppText variant="dense" style={[switchRowStyles.rankLine, { color: Colors.textSecondary }]}>
            #{rank} pick · {voteCount} vote{voteCount !== 1 ? 's' : ''}
          </AppText>
        </View>

        {/* Chevron hint */}
        <AppText variant="dense" style={[switchRowStyles.chevron, { color: Colors.textTertiary }]}>›</AppText>
      </Pressable>
    </View>
  );
}

const switchRowStyles = StyleSheet.create({
  container: {
    paddingBottom: 24,
    backgroundColor: Colors.card,
  },
  sectionLabel: {
    fontSize: 13,
    fontWeight: '600' as const,
    color: Colors.textSecondary,
    marginBottom: 10,
    letterSpacing: 0.1,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
    gap: 12,
    backgroundColor: Colors.surfaceElevated,
    borderColor: Colors.border,
    minHeight: 56,
  },
  image: {
    width: 56,
    height: 56,
    borderRadius: 12,
    flexShrink: 0,
  },
  meta: {
    flex: 1,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  name: {
    fontSize: 16,
    fontWeight: '600' as const,
    color: Colors.text,
    flexShrink: 1,
  },
  openPill: {
    backgroundColor: 'rgba(52,199,89,0.15)',
    borderRadius: 9,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  openPillText: {
    fontSize: 12,
    fontWeight: '600' as const,
    color: '#34C759',
  },
  rankLine: {
    fontSize: 13,
    color: Colors.textSecondary,
    marginTop: 3,
  },
  chevron: {
    fontSize: 22,
    color: Colors.textTertiary,
    lineHeight: 28,
    flexShrink: 0,
  },
});

// ---------------------------------------------------------------------------
// ClosedWinnerSheet — main export
// ---------------------------------------------------------------------------

export default function ClosedWinnerSheet({
  plan,
  visible,
  onClose,
  onResolved,
}: ClosedWinnerSheetProps) {
  const Colors = useColors();

  // ---------------------------------------------------------------------------
  // Reduce-motion detection (mirrors NibbleFeedback.tsx lines 62–73)
  // ---------------------------------------------------------------------------
  const [reduceMotion, setReduceMotion] = useState(false);
  useEffect(() => {
    let cancelled = false;
    AccessibilityInfo.isReduceMotionEnabled().then((v) => {
      if (!cancelled) setReduceMotion(v);
    });
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => {
      cancelled = true;
      sub.remove();
    };
  }, []);

  // ---------------------------------------------------------------------------
  // Animation refs (all useNativeDriver, interruptible)
  // ---------------------------------------------------------------------------
  const backdropOpacity = useRef(new Animated.Value(0)).current;
  const sheetTranslateY = useRef(new Animated.Value(600)).current;
  // amber icon entrance
  const iconOpacity = useRef(new Animated.Value(0)).current;
  const iconScale = useRef(new Animated.Value(0.9)).current;

  // ---------------------------------------------------------------------------
  // Derive computed state from plan data (synchronous — no network call)
  // ---------------------------------------------------------------------------
  const eventDate = parsePlanDateTime(plan.date, plan.time);
  const winner: Restaurant | undefined = plan.restaurant ?? undefined;

  // Find closing time for the winner on the planned day
  const closingTimeLabel = React.useMemo(() => {
    if (!winner?.openingPeriods || !eventDate) return undefined;
    const day = eventDate.getDay();
    for (const period of winner.openingPeriods) {
      if (period.close && period.open.day === day) {
        return formatHour12(period.close.hour, period.close.minute).toUpperCase().replace('AM', ' AM').replace('PM', ' PM');
      }
    }
    return undefined;
  }, [winner, eventDate]);

  const sameDaySlots = React.useMemo(
    () => (eventDate ? sameDayOpenSlots(winner?.openingPeriods, eventDate) : []),
    [winner, eventDate],
  );

  const closedAllDay = sameDaySlots.length === 0 && winner?.openingPeriods !== undefined;

  const nextOpenDate = React.useMemo(
    () =>
      closedAllDay && eventDate
        ? nextOpenDay(winner?.openingPeriods, eventDate)
        : null,
    [closedAllDay, winner, eventDate],
  );

  // Ranked options excluding the winner — sorted by vote count descending
  const rankedOptions = React.useMemo(() => {
    if (!plan.restaurantOptions?.length) return [];
    const options = plan.restaurantOptions.filter(
      (r) => r.id !== plan.restaurant?.id,
    );
    const voteCounts: Record<string, number> = {};
    for (const votes of Object.values(plan.votes ?? {})) {
      for (const rid of votes) {
        voteCounts[rid] = (voteCounts[rid] ?? 0) + 1;
      }
    }
    return [...options].sort(
      (a, b) => (voteCounts[b.id] ?? 0) - (voteCounts[a.id] ?? 0),
    );
  }, [plan.restaurantOptions, plan.restaurant, plan.votes]);

  const switchTarget = React.useMemo(
    () =>
      eventDate
        ? (firstOpenRanked(rankedOptions, eventDate) as Restaurant | null)
        : null,
    [rankedOptions, eventDate],
  );

  const switchTargetRank = React.useMemo(() => {
    if (!switchTarget) return 0;
    const idx = rankedOptions.findIndex((r) => r.id === switchTarget.id);
    return idx + 2; // +1 for winner, +1 for 1-based
  }, [switchTarget, rankedOptions]);

  const switchTargetVotes = React.useMemo(() => {
    if (!switchTarget) return 0;
    const voteCounts: Record<string, number> = {};
    for (const votes of Object.values(plan.votes ?? {})) {
      for (const rid of votes) {
        voteCounts[rid] = (voteCounts[rid] ?? 0) + 1;
      }
    }
    return voteCounts[switchTarget.id] ?? 0;
  }, [switchTarget, plan.votes]);

  // ---------------------------------------------------------------------------
  // Local UI state
  // ---------------------------------------------------------------------------
  const [selectedSlot, setSelectedSlot] = useState<TimeSlot | null>(null);
  const [selectedNextDay, setSelectedNextDay] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Opacity refs for chip stagger animation
  const chipOpacityAnims = useRef<Animated.Value[]>([]).current;
  const ensureChipOpacity = (index: number): Animated.Value => {
    if (!chipOpacityAnims[index]) {
      chipOpacityAnims[index] = new Animated.Value(0);
    }
    return chipOpacityAnims[index];
  };

  // ---------------------------------------------------------------------------
  // Entrance animation (storyboard-exact, from gh#292 comments)
  // ---------------------------------------------------------------------------
  const runEntrance = useCallback(() => {
    // Reset
    backdropOpacity.setValue(0);
    sheetTranslateY.setValue(600);
    iconOpacity.setValue(0);
    iconScale.setValue(0.9);

    // Haptic: soft Warning on present
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);

    if (reduceMotion) {
      // Present at rest — no animation
      backdropOpacity.setValue(1);
      sheetTranslateY.setValue(0);
      iconOpacity.setValue(1);
      iconScale.setValue(1);
      return;
    }

    // FRAME 1: backdrop fade 0→1 (220ms) + sheet slide (260ms, Easing.out(cubic))
    Animated.parallel([
      Animated.timing(backdropOpacity, {
        toValue: 1,
        duration: 220,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(sheetTranslateY, {
        toValue: 0,
        duration: 260,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ]).start(() => {
      // FRAME 2: amber icon fades + gently scales 0.9→1 (200ms)
      Animated.parallel([
        Animated.timing(iconOpacity, {
          toValue: 1,
          duration: 200,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(iconScale, {
          toValue: 1,
          duration: 200,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
      ]).start();

      // FRAME 3: stagger chips in
      if (!reduceMotion) {
        const totalSlots = sameDaySlots.length + (nextOpenDate ? 1 : 0);
        const staggerAnims = Array.from({ length: totalSlots }, (_, i) => {
          const op = ensureChipOpacity(i);
          op.setValue(0);
          return Animated.sequence([
            Animated.delay(i * 50),
            Animated.timing(op, {
              toValue: 1,
              duration: 150,
              easing: Easing.out(Easing.cubic),
              useNativeDriver: true,
            }),
          ]);
        });
        Animated.parallel(staggerAnims).start();
      }
    });
  }, [
    backdropOpacity,
    sheetTranslateY,
    iconOpacity,
    iconScale,
    reduceMotion,
    sameDaySlots.length,
    nextOpenDate,
    ensureChipOpacity,
  ]);

  const runExit = useCallback(
    (onComplete?: () => void) => {
      if (reduceMotion) {
        backdropOpacity.setValue(0);
        sheetTranslateY.setValue(600);
        onComplete?.();
        return;
      }
      Animated.parallel([
        Animated.timing(sheetTranslateY, {
          toValue: 600,
          duration: 220,
          easing: Easing.in(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(backdropOpacity, {
          toValue: 0,
          duration: 220,
          easing: Easing.in(Easing.cubic),
          useNativeDriver: true,
        }),
      ]).start(() => onComplete?.());
    },
    [backdropOpacity, sheetTranslateY, reduceMotion],
  );

  useEffect(() => {
    if (visible) {
      runEntrance();
    }
  }, [visible, runEntrance]);

  // ---------------------------------------------------------------------------
  // Action handlers
  // ---------------------------------------------------------------------------
  const primaryCTALabel = React.useMemo(() => {
    if (closedAllDay && nextOpenDate) {
      return `Move to ${weekdayName(nextOpenDate)}`;
    }
    return 'Reschedule';
  }, [closedAllDay, nextOpenDate]);

  const handleReschedule = useCallback(async () => {
    if (resolving) return;

    // Build payload from selection
    let timeStr: string | undefined;
    let dateStr: string | undefined;

    if (selectedNextDay && nextOpenDate) {
      // Move to next open day — use first available slot on that day or noon as placeholder
      dateStr = `${nextOpenDate.getFullYear()}-${String(nextOpenDate.getMonth() + 1).padStart(2, '0')}-${String(nextOpenDate.getDate()).padStart(2, '0')}`;
      // Find first slot on next open day
      const nextSlots = sameDayOpenSlots(winner?.openingPeriods, nextOpenDate);
      if (nextSlots.length > 0) {
        const slot = nextSlots[0];
        const h12 = slot.hour === 0 ? 12 : slot.hour > 12 ? slot.hour - 12 : slot.hour;
        const ampm = slot.hour < 12 ? 'AM' : 'PM';
        timeStr = `${h12}:${String(slot.minute).padStart(2, '0')} ${ampm}`;
      }
    } else if (selectedSlot) {
      dateStr = plan.date;
      const slot = selectedSlot;
      const h12 = slot.hour === 0 ? 12 : slot.hour > 12 ? slot.hour - 12 : slot.hour;
      const ampm = slot.hour < 12 ? 'AM' : 'PM';
      timeStr = `${h12}:${String(slot.minute).padStart(2, '0')} ${ampm}`;
    } else {
      setErrorMsg('Please select a time first.');
      return;
    }

    setResolving(true);
    setErrorMsg(null);
    try {
      const updated = await resolveWinner(plan.id, {
        action: 'reschedule',
        time: timeStr,
        date: dateStr,
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      runExit(() => onResolved(updated));
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Something went wrong. Try again.';
      setErrorMsg(msg);
    } finally {
      setResolving(false);
    }
  }, [
    resolving,
    selectedSlot,
    selectedNextDay,
    nextOpenDate,
    winner,
    plan.id,
    plan.date,
    runExit,
    onResolved,
  ]);

  const handleSwitch = useCallback(async () => {
    if (!switchTarget || resolving) return;
    setResolving(true);
    setErrorMsg(null);
    try {
      const updated = await resolveWinner(plan.id, {
        action: 'switch',
        restaurantId: switchTarget.id,
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      runExit(() => onResolved(updated));
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Something went wrong. Try again.';
      setErrorMsg(msg);
    } finally {
      setResolving(false);
    }
  }, [switchTarget, resolving, plan.id, runExit, onResolved]);

  const handleKeepAnyway = useCallback(async () => {
    if (resolving) return;
    setResolving(true);
    try {
      const updated = await resolveWinner(plan.id, { action: 'keep' });
      runExit(() => onResolved(updated));
    } catch {
      // Non-fatal — keep-anyway is best-effort; sheet still closes
      runExit(onClose);
    } finally {
      setResolving(false);
    }
  }, [resolving, plan.id, runExit, onResolved, onClose]);

  const handleDontRemind = useCallback(async () => {
    if (resolving) return;
    setResolving(true);
    try {
      const updated = await resolveWinner(plan.id, { action: 'dismiss' });
      runExit(() => onResolved(updated));
    } catch {
      // Non-fatal
      runExit(onClose);
    } finally {
      setResolving(false);
    }
  }, [resolving, plan.id, runExit, onResolved, onClose]);

  // Backdrop tap = keep-anyway semantics (re-prompts later; does NOT dismiss permanently)
  const handleBackdropTap = useCallback(() => {
    if (resolving) return;
    handleKeepAnyway();
  }, [resolving, handleKeepAnyway]);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  if (!visible) return null;

  const plannedDate = eventDate ? formatPlanDate(eventDate) : plan.date ?? '';
  const weekdayStr = eventDate ? weekdayPlural(eventDate) : '';

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      onRequestClose={handleBackdropTap}
      accessibilityViewIsModal
    >
      {/* Backdrop */}
      <Animated.View
        style={[
          sheetStyles.backdrop,
          { opacity: backdropOpacity },
        ]}
      >
        <Pressable
          testID="closed-winner-backdrop"
          style={StyleSheet.absoluteFill}
          onPress={handleBackdropTap}
          accessibilityLabel="Dismiss. Keeps current plan and re-prompts later."
          accessibilityRole="button"
        />
      </Animated.View>

      {/* Sheet */}
      <Animated.View
        testID="closed-winner-sheet"
        style={[
          sheetStyles.sheet,
          {
            backgroundColor: Colors.card,
            transform: [{ translateY: sheetTranslateY }],
          },
        ]}
        accessibilityViewIsModal
      >
        {/* Drag handle */}
        <View style={[sheetStyles.handle, { backgroundColor: Colors.border }]} />

        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={[
            sheetStyles.scrollContent,
            { backgroundColor: Colors.card },
          ]}
          bounces={false}
        >
          {/* Caution header */}
          <Animated.View
            style={{
              opacity: iconOpacity,
              transform: [{ scale: iconScale }],
            }}
          >
            <CautionHeader
              restaurantName={winner?.name ?? 'Your pick'}
              plannedDate={plannedDate}
              plannedTime={plan.time ?? ''}
              closedAllDay={closedAllDay}
              closingTimeLabel={closingTimeLabel}
              weekday={weekdayStr}
            />
          </Animated.View>

          {/* Reschedule windows */}
          <RescheduleWindows
            slots={sameDaySlots}
            nextOpenDate={nextOpenDate}
            selectedSlot={selectedSlot}
            selectedNextDay={selectedNextDay}
            onSelectSlot={(slot) => {
              setSelectedSlot(slot);
              setSelectedNextDay(false);
            }}
            onSelectNextDay={() => {
              setSelectedNextDay(true);
              setSelectedSlot(null);
            }}
          />

          {/* Switch row — only rendered when a ranked open option exists */}
          {switchTarget && (
            <SwitchRow
              restaurant={switchTarget}
              rank={switchTargetRank}
              voteCount={switchTargetVotes}
              onPress={handleSwitch}
            />
          )}

          {/* Error message */}
          {errorMsg && (
            <AppText variant="dense" style={[sheetStyles.errorText, { color: Colors.error }]}>
              {errorMsg}
            </AppText>
          )}

          {/* Primary CTA: Reschedule */}
          <Pressable
            testID="cw-reschedule-cta"
            style={({ pressed }) => [
              sheetStyles.primaryCTA,
              { backgroundColor: Colors.primary, opacity: pressed || resolving ? 0.75 : 1 },
            ]}
            onPress={handleReschedule}
            disabled={resolving}
            accessibilityRole="button"
            accessibilityLabel={primaryCTALabel}
            accessibilityState={{ disabled: resolving }}
          >
            <AppText variant="dense" style={sheetStyles.primaryCTAText}>
              {resolving ? 'Saving…' : primaryCTALabel}
            </AppText>
          </Pressable>

          {/* Keep it anyway */}
          <Pressable
            testID="cw-keep-anyway"
            style={sheetStyles.tertiaryBtn}
            onPress={handleKeepAnyway}
            disabled={resolving}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={`Keep ${winner?.name ?? 'current pick'} at the current time. We'll remind you next time you open this plan.`}
            accessibilityState={{ disabled: resolving }}
          >
            <AppText variant="dense" style={[sheetStyles.tertiaryBtnText, { color: Colors.textSecondary }]}>
              Keep it anyway
            </AppText>
          </Pressable>

          {/* Don't remind me again */}
          <Pressable
            testID="cw-dont-remind"
            style={sheetStyles.mutedLinkBtn}
            onPress={handleDontRemind}
            disabled={resolving}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={`Keep ${winner?.name ?? 'current pick'} and stop reminding me about its hours for this plan.`}
            accessibilityState={{ disabled: resolving }}
          >
            <AppText variant="dense" style={[sheetStyles.mutedLinkText, { color: Colors.textTertiary }]}>
              Don't remind me again
            </AppText>
          </Pressable>
        </ScrollView>
      </Animated.View>
    </Modal>
  );
}

const sheetStyles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.55)',
    zIndex: 100,
  },
  sheet: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    backgroundColor: Colors.card,
    zIndex: 101,
    maxHeight: '92%',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.15,
    shadowRadius: 20,
    elevation: 16,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: Colors.border,
    alignSelf: 'center',
    marginTop: 12,
    marginBottom: 20,
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingBottom: 36,
    backgroundColor: Colors.card,
  },
  errorText: {
    fontSize: 13,
    color: Colors.error,
    marginBottom: 12,
    textAlign: 'center',
  },
  primaryCTA: {
    minHeight: 50,
    paddingVertical: 8,
    borderRadius: 25,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.primary,
    marginBottom: 8,
  },
  primaryCTAText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700' as const,
  },
  tertiaryBtn: {
    minHeight: 44,
    paddingVertical: 8,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  tertiaryBtnText: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: Colors.textSecondary,
  },
  mutedLinkBtn: {
    minHeight: 40,
    paddingVertical: 6,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  mutedLinkText: {
    fontSize: 13,
    fontWeight: '500' as const,
    color: Colors.textTertiary,
  },
});

// ---------------------------------------------------------------------------
// ClosedWinnerFlag — exported shared passive flag
// ---------------------------------------------------------------------------

/**
 * Small inline "may be closed" amber flag, used on PlanCard and group-session.
 * Owner can tap it to reopen the ClosedWinnerSheet.
 */
export function ClosedWinnerFlag({
  plan,
  isOwner,
  onOwnerTap,
  style,
}: ClosedWinnerFlagProps) {
  const Colors = useColors(); // required per CLAUDE.md

  // Only render when there's an unresolved closed-winner state
  if (!plan.winnerClosedAt) return null;

  const label = `Heads up — ${plan.restaurant?.name ?? 'your pick'} may be closed at this time`;

  return (
    <Pressable
      testID="closed-winner-flag"
      style={[
        flagStyles.container,
        // Light: amber background pill; Dark: no background (rely on text color)
        { backgroundColor: Colors.secondaryLight },
        style,
      ]}
      onPress={isOwner && onOwnerTap ? onOwnerTap : undefined}
      disabled={!(isOwner && onOwnerTap)}
      accessibilityRole={isOwner && onOwnerTap ? 'button' : 'text'}
      accessibilityLabel={label}
      accessibilityHint={isOwner && onOwnerTap ? 'Double tap to review options.' : undefined}
      hitSlop={4}
    >
      <AlertTriangle size={12} color={Colors.secondary} strokeWidth={2.2} />
      <AppText
        variant="dense"
        style={[flagStyles.text, { color: Colors.cautionText }]}
        numberOfLines={2}
      >
        {label}
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
    backgroundColor: Colors.secondaryLight,
  },
  text: {
    fontSize: 12,
    fontWeight: '500' as const,
    color: Colors.cautionText,
    flex: 1,
  },
});
