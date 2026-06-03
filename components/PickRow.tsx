// components/PickRow.tsx
//
// Checklist row for the "Unpack your Doggy Bag" review screen.
// Displays a restaurant thumbnail, name, meta line, distance, and a checkbox.
// Parent passes an `enterAnim` Animated.Value that drives the staggered entrance
// (opacity 0→1, translateY 20→0). Parent owns all Animated.Values.
//
// DARK MODE: this is a module-level component — it MUST call `const Colors = useColors()`
// inside its own function body (per CLAUDE.md rule).

import React from 'react';
import {
  View,
  StyleSheet,
  Pressable,
  Animated,
} from 'react-native';
import AppText from './AppText';
import { Image } from 'expo-image';
import { Check } from 'lucide-react-native';
import type { Restaurant } from '../types';
import StaticColors from '../constants/colors';
import { useColors } from '../context/ThemeContext';

const Colors = StaticColors; // module-level for StyleSheet.create()

export interface PickRowProps {
  restaurant: Restaurant;
  selected: boolean;
  onToggle: () => void;
  /** Opacity + translateY animation value for staggered entrance — parent owns all Animated.Values. */
  enterAnim: Animated.Value;
}

export default function PickRow({ restaurant, selected, onToggle, enterAnim }: PickRowProps): React.JSX.Element {
  const Colors = useColors(); // component-level — shadows module-level for reactive dark mode

  const priceString = '$'.repeat(restaurant.priceLevel);
  const metaLine = `★ ${restaurant.rating} · ${priceString} · ${restaurant.cuisine}`;

  const translateY = enterAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [20, 0],
  });

  return (
    <Animated.View
      style={[
        styles.animWrapper,
        {
          opacity: enterAnim,
          transform: [{ translateY }],
        },
      ]}
    >
      <Pressable
        onPress={onToggle}
        testID={`pick-row-${restaurant.id}`}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: selected }}
        accessibilityLabel={`${restaurant.name}, ${selected ? 'selected' : 'deselected'}`}
      >
        <View
          style={[
            styles.card,
            {
              backgroundColor: Colors.card,
              borderColor: Colors.border,
              opacity: selected ? 1 : 0.55,
            },
          ]}
        >
          {/* Thumbnail */}
          <Image
            source={{ uri: restaurant.imageUrl }}
            style={styles.thumbnail}
            contentFit="cover"
          />

          {/* Info column */}
          <View style={styles.infoColumn}>
            <AppText
              variant="dense"
              style={[styles.name, { color: Colors.text }]}
              numberOfLines={1}
            >
              {restaurant.name}
            </AppText>
            <AppText
              variant="dense"
              style={[styles.meta, { color: Colors.textSecondary }]}
              numberOfLines={1}
            >
              {metaLine}
            </AppText>
            <AppText
              variant="dense"
              style={[styles.distance, { color: Colors.textTertiary }]}
              numberOfLines={1}
            >
              {restaurant.distance}
            </AppText>
          </View>

          {/* Checkbox */}
          <View
            style={[
              styles.checkbox,
              selected
                ? { backgroundColor: Colors.primary, borderWidth: 0 }
                : { backgroundColor: 'transparent', borderWidth: 1.5, borderColor: Colors.border },
            ]}
          >
            {selected && <Check size={14} color="#FFF" strokeWidth={3} />}
          </View>
        </View>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  animWrapper: {
    // No background — transparent by default (correct)
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 12,
    marginHorizontal: 16,
    marginVertical: 6,
    padding: 12,
    gap: 12,
  },
  thumbnail: {
    width: 72,
    height: 72,
    borderRadius: 8,
  },
  infoColumn: {
    flex: 1,
    gap: 3,
  },
  name: {
    fontSize: 15,
    fontWeight: '700',
    color: Colors.text,
  },
  meta: {
    fontSize: 12,
    fontWeight: '400',
    color: Colors.textSecondary,
  },
  distance: {
    fontSize: 12,
    fontWeight: '400',
    color: Colors.textTertiary,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
