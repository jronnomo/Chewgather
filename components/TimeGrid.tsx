import React, { useEffect, useRef, useMemo, useState, useCallback } from 'react';
import { View, Text, Pressable, Animated, Easing, LayoutAnimation, Modal, Platform, StyleSheet, UIManager } from 'react-native';
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { Coffee, Sun, Sunset, Moon, ChevronRight, MoreHorizontal } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { MEAL_PERIODS, parseTimeToMinutes } from '../constants/mealPeriods';
import StaticColors from '../constants/colors';
import { useColors } from '../context/ThemeContext';
import { useApp } from '../context/AppContext';

const Colors = StaticColors;

function localDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Enable LayoutAnimation on Android
if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

interface TimeGridProps {
  selectedTime: string | null;
  onSelectTime: (time: string) => void;
  selectedDate: string;
}

const PERIOD_ICONS = {
  coffee: Coffee,
  sun: Sun,
  sunset: Sunset,
  moon: Moon,
} as const;

export default function TimeGrid({ selectedTime, onSelectTime, selectedDate }: TimeGridProps) {
  const Colors = useColors();
  const { preferences } = useApp();

  // Track which collapsed periods the user has manually expanded
  const [manuallyExpanded, setManuallyExpanded] = useState<Set<string>>(new Set());
  // Track which active (default-expanded) periods the user has manually collapsed
  const [manuallyCollapsed, setManuallyCollapsed] = useState<Set<string>>(new Set());
  // Custom time picker visibility
  const [pickerVisible, setPickerVisible] = useState(false);
  const [pickerDraft, setPickerDraft] = useState<Date>(() => {
    const d = new Date();
    d.setSeconds(0, 0);
    return d;
  });

  // One animated value per period for staggered mount animation
  const periodAnims = useRef(MEAL_PERIODS.map(() => ({
    opacity: new Animated.Value(0),
    translateY: new Animated.Value(8),
  }))).current;

  // Map of time -> Animated.Value for scale pulse on selection
  const chipScaleAnims = useRef<Record<string, Animated.Value>>({}).current;
  const ensureChipAnim = (time: string) => {
    if (!chipScaleAnims[time]) {
      chipScaleAnims[time] = new Animated.Value(1);
    }
    return chipScaleAnims[time];
  };

  const isToday = useMemo(() => {
    return selectedDate === localDateStr(new Date());
  }, [selectedDate]);

  // Compute which times are disabled (past times when date is today)
  const disabledTimes = useMemo(() => {
    if (!isToday) return new Set<string>();
    const now = new Date();
    const currentMinutes = now.getHours() * 60 + now.getMinutes();
    const disabled = new Set<string>();
    for (const period of MEAL_PERIODS) {
      for (const time of period.times) {
        if (parseTimeToMinutes(time) <= currentMinutes + 120) {
          disabled.add(time);
        }
      }
    }
    return disabled;
  }, [isToday]);

  // Compute which periods are fully past (all times disabled)
  const fullyPastPeriods = useMemo(() => {
    const past = new Set<string>();
    if (!isToday) return past;
    for (const period of MEAL_PERIODS) {
      if (period.times.every(t => disabledTimes.has(t))) {
        past.add(period.name);
      }
    }
    return past;
  }, [isToday, disabledTimes]);

  // Determine which period contains the selected time
  const activePeriodName = useMemo(() => {
    if (!selectedTime) return null;
    for (const period of MEAL_PERIODS) {
      if (period.times.includes(selectedTime)) {
        return period.name;
      }
    }
    return null;
  }, [selectedTime]);

  // True when the current selection isn't in any meal period's preset list
  const isCustomTime = useMemo(
    () => !!selectedTime && activePeriodName === null,
    [selectedTime, activePeriodName],
  );

  // Reset manual toggle sets when the active period changes (user picked time in different period)
  const prevActivePeriod = useRef(activePeriodName);
  useEffect(() => {
    if (prevActivePeriod.current !== activePeriodName && prevActivePeriod.current !== null) {
      setManuallyExpanded(new Set());
      setManuallyCollapsed(new Set());
    }
    prevActivePeriod.current = activePeriodName;
  }, [activePeriodName]);

  // Reset manual expansions when date changes
  useEffect(() => {
    setManuallyExpanded(new Set());
    setManuallyCollapsed(new Set());
  }, [selectedDate]);

  // Staggered mount animation
  useEffect(() => {
    const animations = periodAnims.map((anim, index) =>
      Animated.parallel([
        Animated.timing(anim.opacity, {
          toValue: 1,
          duration: 200,
          delay: index * 50,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(anim.translateY, {
          toValue: 0,
          duration: 200,
          delay: index * 50,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
      ])
    );
    Animated.parallel(animations).start();
  }, [periodAnims]);

  const handleChipPress = (time: string, isDisabled: boolean) => {
    if (isDisabled) return;
    Haptics.selectionAsync();
    onSelectTime(time);
    const scaleAnim = ensureChipAnim(time);
    Animated.spring(scaleAnim, {
      toValue: 1.08,
      tension: 300,
      friction: 10,
      useNativeDriver: true,
    }).start(() => {
      Animated.spring(scaleAnim, {
        toValue: 1,
        tension: 300,
        friction: 10,
        useNativeDriver: true,
      }).start();
    });
  };

  const formatTimeString = useCallback((date: Date) => {
    const h = date.getHours();
    const m = date.getMinutes();
    const period = h >= 12 ? 'PM' : 'AM';
    const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
    return `${h12}:${String(m).padStart(2, '0')} ${period}`;
  }, []);

  const openCustomPicker = useCallback(() => {
    Haptics.selectionAsync();
    if (isCustomTime && selectedTime) {
      // Seed the picker with the current custom time
      const match = selectedTime.match(/^(\d+):(\d+)\s*(AM|PM)$/i);
      if (match) {
        const [, hRaw, mRaw, periodRaw] = match;
        let h = parseInt(hRaw, 10);
        const m = parseInt(mRaw, 10);
        if (periodRaw.toUpperCase() === 'PM' && h !== 12) h += 12;
        if (periodRaw.toUpperCase() === 'AM' && h === 12) h = 0;
        const d = new Date();
        d.setHours(h, m, 0, 0);
        setPickerDraft(d);
      }
    } else {
      const d = new Date();
      d.setSeconds(0, 0);
      setPickerDraft(d);
    }
    setPickerVisible(true);
  }, [isCustomTime, selectedTime]);

  const handlePickerChange = useCallback((event: DateTimePickerEvent, date?: Date) => {
    // Android dismisses the picker via the event; iOS keeps it open until Done.
    if (Platform.OS === 'android') {
      setPickerVisible(false);
      if (event.type === 'set' && date) {
        onSelectTime(formatTimeString(date));
      }
    } else if (date) {
      setPickerDraft(date);
    }
  }, [formatTimeString, onSelectTime]);

  const confirmIosPicker = useCallback(() => {
    setPickerVisible(false);
    onSelectTime(formatTimeString(pickerDraft));
  }, [formatTimeString, pickerDraft, onSelectTime]);

  const togglePeriod = useCallback((periodName: string, isDefaultExpanded: boolean) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    Haptics.selectionAsync();
    if (isDefaultExpanded) {
      // Active period: toggle manuallyCollapsed
      setManuallyCollapsed(prev => {
        const next = new Set(prev);
        if (next.has(periodName)) {
          next.delete(periodName);
        } else {
          next.add(periodName);
        }
        return next;
      });
    } else {
      // Non-active period: toggle manuallyExpanded
      setManuallyExpanded(prev => {
        const next = new Set(prev);
        if (next.has(periodName)) {
          next.delete(periodName);
        } else {
          next.add(periodName);
        }
        return next;
      });
    }
  }, []);

  return (
    <View style={styles.container}>
      {MEAL_PERIODS.map((period, periodIndex) => {
        const anim = periodAnims[periodIndex];
        const Icon = PERIOD_ICONS[period.icon];
        const isPeriodFullyPast = fullyPastPeriods.has(period.name);
        const isActivePeriod = period.name === activePeriodName;

        // Default expanded = active period AND not fully past
        const defaultExpanded = isActivePeriod && !isPeriodFullyPast;
        const isCollapsed = defaultExpanded
          ? manuallyCollapsed.has(period.name)
          : !manuallyExpanded.has(period.name);

        const availableCount = period.times.filter(t => !disabledTimes.has(t)).length;

        return (
          <Animated.View
            key={period.name}
            style={[
              styles.periodSection,
              periodIndex > 0 && styles.periodSectionGap,
              {
                opacity: anim.opacity,
                transform: [{ translateY: anim.translateY }],
              },
            ]}
          >
            {/* Period header — always tappable */}
            <Pressable
              style={[
                styles.periodHeader,
                isCollapsed && styles.periodHeaderCollapsible,
              ]}
              onPress={() => togglePeriod(period.name, defaultExpanded)}
            >
              <Icon
                size={14}
                color={
                  isPeriodFullyPast
                    ? Colors.textTertiary
                    : isActivePeriod
                      ? Colors.primary
                      : Colors.textSecondary
                }
              />
              <Text style={[
                styles.periodLabel,
                {
                  color: isPeriodFullyPast
                    ? Colors.textTertiary
                    : isActivePeriod
                      ? Colors.primary
                      : Colors.textSecondary,
                },
              ]}>
                {period.name}
              </Text>
              <View style={{ marginLeft: 'auto', flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                {isPeriodFullyPast && (
                  <Text style={{ fontSize: 12, color: Colors.textTertiary }}>Passed</Text>
                )}
                {!isPeriodFullyPast && isCollapsed && (
                  <View style={[styles.countBadge, { backgroundColor: Colors.card, borderColor: Colors.border }]}>
                    <Text style={[styles.countBadgeText, { color: Colors.textSecondary }]}>
                      {availableCount}
                    </Text>
                  </View>
                )}
                <ChevronRight
                  size={14}
                  color={isPeriodFullyPast ? Colors.textTertiary : Colors.textSecondary}
                  style={{ transform: [{ rotate: isCollapsed ? '0deg' : '90deg' }] }}
                />
              </View>
            </Pressable>

            {/* Time chips grid — hidden when collapsed */}
            {!isCollapsed && (
              <View style={styles.chipsGrid}>
                {period.times.map((time) => {
                  const isSelected = selectedTime === time;
                  const isDisabled = disabledTimes.has(time);
                  const scaleAnim = ensureChipAnim(time);

                  return (
                    <Animated.View
                      key={time}
                      style={[
                        styles.chipWrapper,
                        { transform: [{ scale: scaleAnim }] },
                      ]}
                    >
                      <Pressable
                        style={[
                          styles.chip,
                          { backgroundColor: Colors.card, borderColor: Colors.border },
                          isSelected && { backgroundColor: Colors.primary, borderColor: Colors.primary },
                          isDisabled && styles.chipDisabled,
                        ]}
                        onPress={() => handleChipPress(time, isDisabled)}
                        disabled={isDisabled}
                        accessibilityRole="button"
                        accessibilityState={{ selected: isSelected, disabled: isDisabled }}
                      >
                        <Text
                          style={[
                            styles.chipText,
                            { color: Colors.text },
                            isSelected && styles.chipTextSelected,
                          ]}
                        >
                          {time}
                        </Text>
                      </Pressable>
                    </Animated.View>
                  );
                })}
              </View>
            )}
          </Animated.View>
        );
      })}

      {/* Custom time — escape hatch for users whose desired time isn't in any meal period */}
      <View style={[styles.periodSection, styles.periodSectionGap]}>
        <View style={styles.periodHeader}>
          <MoreHorizontal size={14} color={isCustomTime ? Colors.primary : Colors.textSecondary} />
          <Text
            style={[
              styles.periodLabel,
              { color: isCustomTime ? Colors.primary : Colors.textSecondary },
            ]}
          >
            Custom
          </Text>
        </View>
        <View style={styles.chipsGrid}>
          <Pressable
            style={[
              styles.chip,
              styles.customChip,
              { backgroundColor: Colors.card, borderColor: Colors.border },
              isCustomTime && { backgroundColor: Colors.primary, borderColor: Colors.primary },
              !isCustomTime && { borderStyle: 'dashed' as const },
            ]}
            onPress={openCustomPicker}
            accessibilityRole="button"
            accessibilityState={{ selected: isCustomTime }}
          >
            <Text
              style={[
                styles.chipText,
                { color: isCustomTime ? '#FFF' : Colors.textSecondary },
              ]}
            >
              {isCustomTime ? selectedTime : 'Pick a time...'}
            </Text>
          </Pressable>
        </View>
      </View>

      {pickerVisible && Platform.OS === 'android' && (
        <DateTimePicker
          value={pickerDraft}
          mode="time"
          is24Hour={false}
          display="default"
          onChange={handlePickerChange}
        />
      )}

      {Platform.OS === 'ios' && (
        <Modal visible={pickerVisible} transparent animationType="fade" onRequestClose={() => setPickerVisible(false)}>
          <Pressable style={styles.pickerOverlay} onPress={() => setPickerVisible(false)}>
            <Pressable style={[styles.pickerSheet, { backgroundColor: Colors.card }]} onPress={() => { /* swallow */ }}>
              <DateTimePicker
                value={pickerDraft}
                mode="time"
                is24Hour={false}
                display="spinner"
                onChange={handlePickerChange}
                themeVariant={preferences.isDarkMode ? 'dark' : 'light'}
              />
              <Pressable style={[styles.pickerDoneBtn, { backgroundColor: Colors.primary }]} onPress={confirmIosPicker}>
                <Text style={styles.pickerDoneText}>Done</Text>
              </Pressable>
            </Pressable>
          </Pressable>
        </Modal>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    // no gap here; periods add their own gap via periodSectionGap
  },
  periodSection: {
    // base section — no extra margin (first one)
  },
  periodSectionGap: {
    marginTop: 16,
  },
  periodHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginBottom: 8,
  },
  periodHeaderCollapsible: {
    marginBottom: 0,
  },
  periodLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.textSecondary,
  },
  chipsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chipWrapper: {
    minWidth: 96,
    flex: 1,
    maxWidth: '33%',
  },
  chip: {
    height: 44,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: Colors.border,
    backgroundColor: Colors.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipDisabled: {
    opacity: 0.4,
  },
  customChip: {
    flex: 1,
    borderRadius: 22,
    paddingHorizontal: 20,
  },
  chipText: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.text,
  },
  chipTextSelected: {
    color: '#FFF',
  },
  countBadge: {
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  countBadgeText: {
    fontSize: 11,
    fontWeight: '600',
  },
  pickerOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  pickerSheet: {
    paddingTop: 12,
    paddingHorizontal: 20,
    paddingBottom: 24,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    alignItems: 'center',
  },
  pickerDoneBtn: {
    marginTop: 8,
    paddingHorizontal: 32,
    paddingVertical: 12,
    borderRadius: 24,
  },
  pickerDoneText: {
    color: '#FFF',
    fontWeight: '700',
    fontSize: 15,
  },
});
