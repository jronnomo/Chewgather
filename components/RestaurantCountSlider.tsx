import React from 'react';
import { View, StyleSheet } from 'react-native';
import Slider from '@react-native-community/slider';
import StaticColors from '../constants/colors';
import { useColors } from '../context/ThemeContext';
import AppText from '@/components/AppText';

const Colors = StaticColors; // module level for StyleSheet.create()

interface RestaurantCountSliderProps {
  value: number;
  onValueChange: (n: number) => void;
  min?: number;
  max?: number;
  label?: string;
}

export default function RestaurantCountSlider({
  value,
  onValueChange,
  min = 5,
  max = 20,
  label,
}: RestaurantCountSliderProps) {
  const Colors = useColors(); // component level, shadows for dark mode

  return (
    <View style={styles.container}>
      {label ? (
        <AppText variant="dense" style={[styles.sectionLabel, { color: Colors.text }]}>{label}</AppText>
      ) : null}
      <View style={styles.row}>
        <AppText variant="dense" style={[styles.label, { color: Colors.text }]}>Restaurants</AppText>
        <View style={[styles.badge, { backgroundColor: Colors.primary }]}>
          <AppText variant="dense" style={[styles.badgeText, { color: '#FFFFFF' }]}>{value}</AppText>
        </View>
      </View>

      <Slider
        minimumValue={min}
        maximumValue={max}
        step={1}
        value={value}
        onValueChange={(val) => onValueChange(Math.round(val))}
        minimumTrackTintColor={Colors.primary}
        maximumTrackTintColor={Colors.border}
        thumbTintColor={Colors.primary}
        style={styles.slider}
      />

      <View style={styles.row}>
        <AppText variant="dense" style={[styles.rangeLabel, { color: Colors.textSecondary }]}>{min}</AppText>
        <AppText variant="dense" style={[styles.rangeLabel, { color: Colors.textSecondary }]}>{max}</AppText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingVertical: 8,
  },
  sectionLabel: {
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 10,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  label: {
    fontSize: 15,
    fontWeight: '600',
  },
  badge: {
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 2,
  },
  badgeText: {
    fontSize: 14,
    fontWeight: '700',
  },
  slider: {
    width: '100%',
    height: 40,
  },
  rangeLabel: {
    fontSize: 12,
  },
});
