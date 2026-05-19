import React, { useRef, useState } from 'react';
import {
  Animated,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import * as Haptics from 'expo-haptics';
import StaticColors from '../constants/colors';
import { useColors } from '../context/ThemeContext';

const Colors = StaticColors;

interface DateChipPickerProps {
  value: Date;
  onChange: (next: Date) => void;
  maxDaysOut?: number;
}

function normalizeToMidnight(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function formatMonthDay(d: Date): string {
  const month = d.toLocaleString('en-US', { month: 'short' });
  return `${month} ${d.getDate()}`;
}

function buildQuickChips(today: Date): { label: string; date: Date }[] {
  const chips: { label: string; date: Date }[] = [];
  for (let i = 0; i < 5; i++) {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() + i);
    let label: string;
    if (i === 0) label = 'Today';
    else if (i === 1) label = 'Tomorrow';
    else label = WEEKDAY_LABELS[d.getDay()];
    chips.push({ label, date: d });
  }
  return chips;
}

function ChipButton({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  const Colors = useColors();
  const scale = useRef(new Animated.Value(1)).current;

  const handlePressIn = () => {
    Animated.spring(scale, {
      toValue: 0.95,
      useNativeDriver: true,
      speed: 40,
      bounciness: 0,
    }).start();
  };

  const handlePressOut = () => {
    Animated.spring(scale, {
      toValue: 1,
      useNativeDriver: true,
      speed: 30,
      bounciness: 4,
    }).start();
  };

  return (
    <Pressable
      onPress={onPress}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
    >
      <Animated.View
        style={[
          styles.chip,
          { transform: [{ scale }] },
          active
            ? { backgroundColor: Colors.primary }
            : { backgroundColor: Colors.primaryLight },
        ]}
      >
        <Text
          style={[
            styles.chipText,
            active ? { color: '#FFFFFF' } : { color: Colors.primary },
          ]}
        >
          {label}
        </Text>
      </Animated.View>
    </Pressable>
  );
}

export default function DateChipPicker({
  value,
  onChange,
  maxDaysOut = 30,
}: DateChipPickerProps) {
  const Colors = useColors();
  const [showPicker, setShowPicker] = useState(false);

  const today = normalizeToMidnight(new Date());
  const maxDate = new Date(today.getFullYear(), today.getMonth(), today.getDate() + maxDaysOut);
  const normalizedValue = normalizeToMidnight(value);

  const quickChips = buildQuickChips(today);
  const matchedQuick = quickChips.find(c => isSameDay(c.date, normalizedValue));
  const isCustomDate = !matchedQuick && normalizedValue > today;

  const customLabel = isCustomDate ? formatMonthDay(normalizedValue) : 'Pick date…';
  const pickChipActive = isCustomDate;

  const fireChip = (date: Date) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onChange(normalizeToMidnight(date));
  };

  const handlePickChipPress = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setShowPicker(true);
  };

  const handlePickerChange = (event: DateTimePickerEvent, selected?: Date) => {
    if (Platform.OS === 'android') {
      setShowPicker(false);
      if (event.type === 'set' && selected) {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        onChange(normalizeToMidnight(selected));
      }
    } else {
      // iOS inline — update value live; Done button commits
      if (selected) {
        onChange(normalizeToMidnight(selected));
      }
    }
  };

  const handleIOSDone = () => {
    setShowPicker(false);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  return (
    <View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        {quickChips.map(chip => (
          <ChipButton
            key={chip.label}
            label={chip.label}
            active={!isCustomDate && isSameDay(chip.date, normalizedValue)}
            onPress={() => fireChip(chip.date)}
          />
        ))}
        <ChipButton
          label={customLabel}
          active={pickChipActive}
          onPress={handlePickChipPress}
        />
      </ScrollView>

      {/* Android: mount conditionally so the native dialog appears immediately */}
      {Platform.OS === 'android' && showPicker && (
        <DateTimePicker
          mode="date"
          value={normalizedValue}
          minimumDate={today}
          maximumDate={maxDate}
          onChange={handlePickerChange}
        />
      )}

      {/* iOS: wrap in a modal with a Done button */}
      {Platform.OS === 'ios' && (
        <Modal
          visible={showPicker}
          transparent
          animationType="slide"
          onRequestClose={() => setShowPicker(false)}
        >
          <Pressable
            style={[styles.iosOverlay, { backgroundColor: Colors.overlay }]}
            onPress={() => setShowPicker(false)}
          >
            <Pressable
              style={[styles.iosSheet, { backgroundColor: Colors.card }]}
              onPress={() => {}}
            >
              <View style={[styles.iosDoneRow, { borderBottomColor: Colors.border }]}>
                <Pressable onPress={handleIOSDone} hitSlop={12}>
                  <Text style={[styles.iosDoneText, { color: Colors.primary }]}>Done</Text>
                </Pressable>
              </View>
              <DateTimePicker
                mode="date"
                display="spinner"
                value={normalizedValue}
                minimumDate={today}
                maximumDate={maxDate}
                onChange={handlePickerChange}
                style={styles.iosPicker}
              />
            </Pressable>
          </Pressable>
        </Modal>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  scrollContent: {
    paddingHorizontal: 20,
    gap: 8,
    flexDirection: 'row',
    alignItems: 'center',
  },
  chip: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 20,
  },
  chipText: {
    fontSize: 13,
    fontWeight: '600',
  },
  iosOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  iosSheet: {
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingBottom: 34,
  },
  iosDoneRow: {
    alignItems: 'flex-end',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  iosDoneText: {
    fontSize: 16,
    fontWeight: '600',
  },
  iosPicker: {
    height: 216,
  },
});
