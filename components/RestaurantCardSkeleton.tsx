import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, View, AccessibilityInfo } from 'react-native';
import { useColors } from '../context/ThemeContext';

interface RestaurantCardSkeletonProps {
  variant: 'horizontal' | 'compact';
}

// Pulsing placeholder that mirrors RestaurantCard's footprint. Used by sections
// that are mid-fetch so the empty-state copy doesn't appear simultaneously
// across every section during the initial load (#55).
export default function RestaurantCardSkeleton({ variant }: RestaurantCardSkeletonProps) {
  const Colors = useColors();
  const pulse = useRef(new Animated.Value(0.4)).current;

  useEffect(() => {
    let cancelled = false;
    AccessibilityInfo.isReduceMotionEnabled().then(reduced => {
      if (cancelled || reduced) return;
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulse, { toValue: 0.8, duration: 700, useNativeDriver: true }),
          Animated.timing(pulse, { toValue: 0.4, duration: 700, useNativeDriver: true }),
        ]),
      ).start();
    });
    return () => {
      cancelled = true;
      pulse.stopAnimation();
    };
  }, [pulse]);

  const blockStyle = { backgroundColor: Colors.border, opacity: pulse };

  if (variant === 'horizontal') {
    return (
      <Animated.View
        accessibilityRole="progressbar"
        accessibilityLabel="Loading restaurants"
        style={[styles.horizontalCard, { backgroundColor: Colors.card }]}
      >
        <Animated.View style={[styles.horizontalImage, blockStyle]} />
        <View style={styles.horizontalInfo}>
          <Animated.View style={[styles.lineWide, blockStyle]} />
          <Animated.View style={[styles.lineNarrow, blockStyle]} />
        </View>
      </Animated.View>
    );
  }

  return (
    <Animated.View
      accessibilityRole="progressbar"
      accessibilityLabel="Loading restaurants"
      style={[styles.compactCard, { backgroundColor: Colors.card }]}
    >
      <Animated.View style={[styles.compactImage, blockStyle]} />
      <View style={styles.compactInfo}>
        <Animated.View style={[styles.lineWide, blockStyle]} />
        <Animated.View style={[styles.lineNarrow, blockStyle]} />
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  horizontalCard: {
    width: 220,
    borderRadius: 14,
    overflow: 'hidden',
    marginRight: 12,
  },
  horizontalImage: {
    width: '100%',
    height: 130,
  },
  horizontalInfo: {
    padding: 12,
    gap: 6,
  },
  compactCard: {
    flexDirection: 'row',
    borderRadius: 12,
    overflow: 'hidden',
    marginBottom: 10,
  },
  compactImage: {
    width: 80,
    height: 80,
  },
  compactInfo: {
    flex: 1,
    padding: 12,
    gap: 8,
    justifyContent: 'center',
  },
  lineWide: {
    height: 12,
    borderRadius: 6,
    width: '80%',
  },
  lineNarrow: {
    height: 10,
    borderRadius: 5,
    width: '50%',
  },
});
