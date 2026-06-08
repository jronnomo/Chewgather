/**
 * VisibilitySegmentedControl — 3-way sliding segmented control for plan visibility.
 *
 * Visual design: three stacked cells (icon + label + subtext) in a single row, with a
 * sliding Colors.primary indicator behind the selected cell. Container radius 12, matching
 * BudgetSegmentedControl. Cell minHeight 64 — provisional; verify subtext does not truncate
 * at 390pt with standard Dynamic Type.
 *
 * REQ-011 / A11Y-011-1..4
 */

import React, { useRef, useState, useEffect } from 'react';
import {
  View,
  Pressable,
  Animated,
  StyleSheet,
  LayoutChangeEvent,
  AccessibilityInfo,
} from 'react-native';
import { Lock, Users, Globe } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import StaticColors from '../constants/colors';
import { useColors } from '../context/ThemeContext';
import AppText from './AppText';

// Module-level alias for StyleSheet.create() static fallbacks only.
const Colors = StaticColors;

export type VisibilityValue = 'public' | 'private' | 'friends_request';

export interface VisibilitySegmentedControlProps {
  value: VisibilityValue;
  onSelect: (v: VisibilityValue) => void;
}

interface VisibilityOption {
  value: VisibilityValue;
  label: string;
  subtext: string;
  /** Icon component factory — receives size + color */
  Icon: (props: { size: number; color: string }) => React.JSX.Element;
}

const OPTIONS: VisibilityOption[] = [
  {
    value: 'private',
    label: 'Private',
    subtext: 'Only people you invite. (default)',
    Icon: ({ size, color }) => <Lock size={size} color={color} />,
  },
  {
    value: 'friends_request',
    label: 'Friends',
    subtext: 'Friends can ask to join.',
    Icon: ({ size, color }) => <Users size={size} color={color} />,
  },
  {
    value: 'public',
    label: 'Public',
    subtext: 'Anyone can ask to join.',
    Icon: ({ size, color }) => <Globe size={size} color={color} />,
  },
];

export default function VisibilitySegmentedControl({
  value,
  onSelect,
}: VisibilitySegmentedControlProps) {
  // Reactive color palette — shadows the module-level alias for dark mode.
  const Colors = useColors();

  const [containerWidth, setContainerWidth] = useState(0);
  const indicatorPosition = useRef(new Animated.Value(0)).current;
  const [reduceMotion, setReduceMotion] = useState(false);

  const selectedIndex = OPTIONS.findIndex(o => o.value === value);
  const segmentWidth = containerWidth > 0 ? containerWidth / OPTIONS.length : 0;

  // A11Y-011-4: read reduce-motion preference once on mount.
  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion);
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => sub.remove();
  }, []);

  // Slide indicator to the selected segment.
  useEffect(() => {
    if (containerWidth <= 0 || selectedIndex < 0) return;
    const targetX = selectedIndex * segmentWidth;
    if (reduceMotion) {
      // A11Y-011-4: jump instantly under reduced motion.
      indicatorPosition.setValue(targetX);
    } else {
      Animated.spring(indicatorPosition, {
        toValue: targetX,
        tension: 300,
        friction: 12,
        useNativeDriver: true,
      }).start();
    }
  }, [selectedIndex, segmentWidth, containerWidth, indicatorPosition, reduceMotion]);

  const handleLayout = (e: LayoutChangeEvent) => {
    setContainerWidth(e.nativeEvent.layout.width);
  };

  const handlePress = (optionValue: VisibilityValue) => {
    Haptics.selectionAsync();
    onSelect(optionValue);
  };

  return (
    <View
      testID="visibility-control"
      style={[
        styles.container,
        { backgroundColor: Colors.card, borderColor: Colors.border },
      ]}
      onLayout={handleLayout}
    >
      {/* Animated sliding indicator behind cells */}
      {containerWidth > 0 && selectedIndex >= 0 && (
        <Animated.View
          style={[
            styles.indicator,
            {
              width: segmentWidth,
              backgroundColor: Colors.primary,
              transform: [{ translateX: indicatorPosition }],
            },
          ]}
        />
      )}

      {/* Option cells */}
      {OPTIONS.map((option) => {
        const isSelected = option.value === value;
        // A11Y-011-2: "Private — Only people you invite. (default)"
        const a11yLabel = `${option.label} — ${option.subtext}`;
        const iconColor = isSelected ? Colors.card : Colors.textSecondary;

        return (
          <Pressable
            key={option.value}
            testID={`visibility-option-${option.value === 'friends_request' ? 'friends' : option.value}`}
            style={styles.cell}
            onPress={() => handlePress(option.value)}
            accessibilityRole="button"
            // A11Y-011-1
            accessibilityState={{ selected: isSelected }}
            // A11Y-011-2
            accessibilityLabel={a11yLabel}
          >
            <option.Icon size={18} color={iconColor} />
            <AppText
              variant="dense"
              style={[
                styles.cellLabel,
                { color: isSelected ? Colors.card : Colors.text },
              ]}
            >
              {option.label}
            </AppText>
            <AppText
              variant="dense"
              style={[
                styles.cellSubtext,
                { color: isSelected ? Colors.card : Colors.textSecondary },
              ]}
            >
              {option.subtext}
            </AppText>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    borderRadius: 12,
    borderWidth: 1,
    overflow: 'hidden',
    position: 'relative',
    backgroundColor: Colors.card,   // static fallback; overridden inline
    borderColor: Colors.border,     // static fallback; overridden inline
  },
  indicator: {
    position: 'absolute',
    top: 0,
    left: 0,
    bottom: 0,
    borderRadius: 12,
    backgroundColor: Colors.primary, // static fallback; overridden inline
  },
  // A11Y-011-3: minHeight 64 — provisional, verify at 390pt that subtext wraps
  // without truncation at standard Dynamic Type.
  cell: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    paddingHorizontal: 4,
    minHeight: 64,
    zIndex: 1,
    gap: 2,
  },
  cellLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.text,       // static fallback; overridden inline
    textAlign: 'center',
    marginTop: 2,
  },
  cellSubtext: {
    fontSize: 11,
    fontWeight: '400',
    color: Colors.textSecondary, // static fallback; overridden inline
    textAlign: 'center',
    lineHeight: 14,
  },
});
