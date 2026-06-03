import React, { useState, useRef, useCallback, useEffect } from 'react';
import { View, Pressable, Modal, Animated, Easing, StyleSheet } from 'react-native';
import { ChevronLeft, ChevronRight } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import StaticColors from '../constants/colors';
import { useColors } from '../context/ThemeContext';
import AppText from '@/components/AppText';

const Colors = StaticColors;

interface CalendarSheetProps {
  visible: boolean;
  onClose: () => void;
  onSelectDate: (date: string) => void;
  selectedDate: string;
}

const DAY_HEADERS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

function formatDateToISO(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
}

export default function CalendarSheet({ visible, onClose, onSelectDate, selectedDate }: CalendarSheetProps) {
  const Colors = useColors();

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const maxDate = new Date(today);
  maxDate.setDate(today.getDate() + 60);

  // Parse the incoming selectedDate to a Date for initial temp selection
  const parseSelectedDate = useCallback((): Date => {
    if (!selectedDate) return new Date(today);
    const d = new Date(selectedDate + 'T00:00:00');
    // Clamp to today–maxDate range
    if (d < today) return new Date(today);
    if (d > maxDate) return new Date(maxDate);
    return d;
  }, [selectedDate]); // eslint-disable-line react-hooks/exhaustive-deps

  const [tempSelectedDate, setTempSelectedDate] = useState<Date>(parseSelectedDate);
  const [currentMonth, setCurrentMonth] = useState<Date>(() => {
    const d = parseSelectedDate();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });

  // Sync when visible changes (re-open should reset to current selectedDate)
  useEffect(() => {
    if (visible) {
      const d = parseSelectedDate();
      setTempSelectedDate(d);
      setCurrentMonth(new Date(d.getFullYear(), d.getMonth(), 1));
    }
  }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps

  // Month transition animation
  const gridOpacity = useRef(new Animated.Value(1)).current;

  // Day cell scale animations — keyed by "YYYY-MM-DD"
  const dayCellAnims = useRef<Record<string, Animated.Value>>({}).current;
  const ensureDayAnim = (key: string) => {
    if (!dayCellAnims[key]) {
      dayCellAnims[key] = new Animated.Value(1);
    }
    return dayCellAnims[key];
  };

  const navigateMonth = useCallback((direction: 1 | -1) => {
    const newMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + direction, 1);

    // Block navigation outside allowed range
    if (direction === -1 && newMonth < new Date(today.getFullYear(), today.getMonth(), 1)) return;
    if (direction === 1 && newMonth > new Date(maxDate.getFullYear(), maxDate.getMonth(), 1)) return;

    Animated.timing(gridOpacity, {
      toValue: 0,
      duration: 150,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start(() => {
      setCurrentMonth(newMonth);
      Animated.timing(gridOpacity, {
        toValue: 1,
        duration: 200,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start();
    });
  }, [currentMonth, gridOpacity, today, maxDate]);

  const handleDayPress = (date: Date) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setTempSelectedDate(date);
    // Confirm immediately — parent handles closing the sheet
    onSelectDate(formatDateToISO(date));
  };

  // Build calendar grid for current month
  const calendarDays = useCallback((): (Date | null)[] => {
    const year = currentMonth.getFullYear();
    const month = currentMonth.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const startDow = firstDay.getDay(); // 0 = Sunday
    const cells: (Date | null)[] = [];

    // Leading nulls for days before the first
    for (let i = 0; i < startDow; i++) {
      cells.push(null);
    }
    for (let d = 1; d <= lastDay.getDate(); d++) {
      cells.push(new Date(year, month, d));
    }
    // Pad to complete last row
    while (cells.length % 7 !== 0) {
      cells.push(null);
    }
    return cells;
  }, [currentMonth]);

  const isPastDay = (date: Date) => date < today;
  const isBeyondMax = (date: Date) => date > maxDate;

  const canGoBack = currentMonth > new Date(today.getFullYear(), today.getMonth(), 1);
  const canGoForward = currentMonth < new Date(maxDate.getFullYear(), maxDate.getMonth(), 1);

  const monthLabel = currentMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  const days = calendarDays();

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
    >
      <Pressable style={[styles.overlay, { backgroundColor: Colors.overlay }]} onPress={onClose}>
        <Pressable style={[styles.sheet, { backgroundColor: Colors.card }]} onPress={e => e.stopPropagation()}>
          {/* Handle bar */}
          <View style={[styles.handle, { backgroundColor: Colors.border }]} />

          {/* Month navigation header */}
          <View style={styles.monthHeader}>
            <Pressable
              onPress={() => navigateMonth(-1)}
              disabled={!canGoBack}
              style={[styles.arrowBtn, !canGoBack && styles.arrowDisabled]}
              accessibilityRole="button"
              accessibilityLabel="Previous month"
            >
              <ChevronLeft size={20} color={canGoBack ? Colors.primary : Colors.textTertiary} />
            </Pressable>

            <AppText variant="display" numberOfLines={1} ellipsizeMode="tail" style={[styles.monthTitle, { color: Colors.text }]}>
              {monthLabel}
            </AppText>

            <Pressable
              onPress={() => navigateMonth(1)}
              disabled={!canGoForward}
              style={[styles.arrowBtn, !canGoForward && styles.arrowDisabled]}
              accessibilityRole="button"
              accessibilityLabel="Next month"
            >
              <ChevronRight size={20} color={canGoForward ? Colors.primary : Colors.textTertiary} />
            </Pressable>
          </View>

          {/* Day headers */}
          <View style={styles.dayHeadersRow}>
            {DAY_HEADERS.map((d) => (
              <View key={d} style={styles.dayHeaderCell}>
                <AppText variant="dense" style={[styles.dayHeaderText, { color: Colors.textSecondary }]}>{d}</AppText>
              </View>
            ))}
          </View>

          {/* Calendar grid */}
          <Animated.View style={[styles.calendarGrid, { opacity: gridOpacity }]}>
            {days.map((date, index) => {
              if (!date) {
                return <View key={`empty-${index}`} style={styles.dayCell} />;
              }

              const key = formatDateToISO(date);
              const isToday = isSameDay(date, today);
              const isSelected = isSameDay(date, tempSelectedDate);
              const isPast = isPastDay(date);
              const isBeyond = isBeyondMax(date);
              const isDisabled = isPast || isBeyond;
              const scaleAnim = ensureDayAnim(key);

              return (
                <Animated.View
                  key={key}
                  style={[styles.dayCell, { transform: [{ scale: scaleAnim }] }]}
                >
                  <Pressable
                    style={[
                      styles.dayCellInner,
                      isToday && !isSelected && { borderWidth: 2, borderColor: Colors.primary },
                      isSelected && { backgroundColor: Colors.primary },
                      isDisabled && styles.dayDisabled,
                    ]}
                    onPress={() => !isDisabled && handleDayPress(date)}
                    disabled={isDisabled}
                    accessibilityRole="button"
                    accessibilityState={{ selected: isSelected, disabled: isDisabled }}
                  >
                    <AppText
                      variant="dense"
                      style={[
                        styles.dayNumber,
                        { color: Colors.text },
                        isSelected && { color: '#FFF' },
                        isDisabled && { color: Colors.textTertiary },
                      ]}
                    >
                      {date.getDate()}
                    </AppText>
                  </Pressable>
                </Animated.View>
              );
            })}
          </Animated.View>

        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: Colors.card,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingBottom: 34,
    paddingTop: 12,
    paddingHorizontal: 20,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: Colors.border,
    alignSelf: 'center',
    marginBottom: 16,
  },
  monthHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 0,
    marginBottom: 16,
  },
  arrowBtn: {
    padding: 8,
  },
  arrowDisabled: {
    opacity: 0.4,
  },
  monthTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: Colors.text,
  },
  dayHeadersRow: {
    flexDirection: 'row',
    marginBottom: 8,
  },
  dayHeaderCell: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 4,
  },
  dayHeaderText: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.textSecondary,
  },
  calendarGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginBottom: 20,
  },
  dayCell: {
    width: `${100 / 7}%`,
    aspectRatio: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 2,
  },
  dayCellInner: {
    width: 44,
    minHeight: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayDisabled: {
    opacity: 0.3,
  },
  dayNumber: {
    fontSize: 15,
    fontWeight: '500',
    color: Colors.text,
  },
});
