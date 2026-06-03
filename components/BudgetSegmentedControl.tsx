import React, { useRef, useState, useEffect } from 'react';
import { View, Pressable, Animated, StyleSheet, LayoutChangeEvent } from 'react-native';
import * as Haptics from 'expo-haptics';
import StaticColors from '../constants/colors';
import { useColors } from '../context/ThemeContext';
import AppText from './AppText';

const Colors = StaticColors;

interface BudgetSegmentedControlProps {
  options: string[]; // e.g. ['$', '$$', '$$$', '$$$$']
  selected: string;
  onSelect: (value: string) => void;
}

export default function BudgetSegmentedControl({
  options,
  selected,
  onSelect,
}: BudgetSegmentedControlProps) {
  const Colors = useColors();
  const [containerWidth, setContainerWidth] = useState(0);
  const indicatorPosition = useRef(new Animated.Value(0)).current;

  const selectedIndex = options.indexOf(selected);
  const segmentWidth = containerWidth > 0 ? containerWidth / options.length : 0;

  useEffect(() => {
    if (containerWidth > 0 && selectedIndex >= 0) {
      Animated.spring(indicatorPosition, {
        toValue: selectedIndex * segmentWidth,
        tension: 300,
        friction: 12,
        useNativeDriver: true,
      }).start();
    }
  }, [selectedIndex, segmentWidth, containerWidth, indicatorPosition]);

  const handleLayout = (e: LayoutChangeEvent) => {
    setContainerWidth(e.nativeEvent.layout.width);
  };

  const handlePress = (value: string) => {
    Haptics.selectionAsync();
    onSelect(value);
  };

  return (
    <View
      style={[
        styles.container,
        { backgroundColor: Colors.card, borderColor: Colors.border },
      ]}
      onLayout={handleLayout}
    >
      {/* Animated sliding indicator */}
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

      {/* Segment buttons */}
      {options.map((option) => {
        const isSelected = option === selected;
        return (
          <Pressable
            key={option}
            style={styles.segment}
            onPress={() => handlePress(option)}
            accessibilityRole="button"
            accessibilityState={{ selected: isSelected }}
          >
            <AppText
              variant="dense"
              style={[
                styles.segmentText,
                { color: Colors.textSecondary },
                isSelected && styles.segmentTextSelected,
              ]}
            >
              {option}
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
    minHeight: 44,
  },
  indicator: {
    position: 'absolute',
    top: 0,
    left: 0,
    bottom: 0,
    borderRadius: 12,
  },
  segment: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1,
  },
  segmentText: {
    fontSize: 15,
    fontWeight: '500',
  },
  segmentTextSelected: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
});
