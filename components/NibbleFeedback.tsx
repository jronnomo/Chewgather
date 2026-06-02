import React, { useRef, useCallback, useState, useEffect } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Pressable,
  StyleSheet,
  GestureResponderEvent,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { seededRandom } from '../lib/scallopUtils';

interface NibbleFeedbackProps {
  onPress: (e: GestureResponderEvent) => void;
  disabled?: boolean;
  // Match the style type Pressable actually accepts under the strict API
  // (the exported StyleProp<ViewStyle> isn't assignable to its internal style).
  style?: React.ComponentProps<typeof Pressable>['style'];
  children: React.ReactNode;
  testID?: string;
  accessibilityLabel?: string;
}

const CRUMB_COUNT = 12;
const BURST_RADIUS = 28;

interface Crumb {
  angle: number;
  distance: number;
  size: number;
  delay: number;
}

// Pre-generate crumb directions so they're consistent per-render
function generateCrumbs(): Crumb[] {
  return Array.from({ length: CRUMB_COUNT }, (_, i) => ({
    angle: (seededRandom(i * 13) * Math.PI * 2),
    distance: BURST_RADIUS * (0.4 + seededRandom(i * 13 + 1) * 0.6),
    size: 2.5 + seededRandom(i * 13 + 2) * 3,
    delay: seededRandom(i * 13 + 3) * 60, // stagger 0-60ms
  }));
}

export default function NibbleFeedback({
  onPress,
  disabled,
  style,
  children,
  testID,
  accessibilityLabel,
}: NibbleFeedbackProps) {
  const crumbs = useRef(generateCrumbs()).current;

  // Each crumb gets its own animated progress (0 → 1)
  const crumbAnims = useRef(crumbs.map(() => new Animated.Value(0))).current;
  const [pressPos, setPressPos] = useState<{ x: number; y: number } | null>(null);

  // Respect the OS Reduce Motion setting (iOS Accessibility > Motion > Reduce
  // Motion, Android Accessibility > Remove animations). Same pattern used in
  // SizzleShimmer.tsx and RestaurantCardSkeleton.tsx — when reduced, we skip
  // the crumb burst and call onPress immediately. Haptic still fires since
  // it's a separate accessibility setting.
  const [reduceMotion, setReduceMotion] = useState(false);
  useEffect(() => {
    let cancelled = false;
    AccessibilityInfo.isReduceMotionEnabled().then(reduced => {
      if (!cancelled) setReduceMotion(reduced);
    });
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => {
      cancelled = true;
      sub.remove();
    };
  }, []);

  const handlePress = useCallback(
    (e: GestureResponderEvent) => {
      if (disabled) return;

      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

      if (reduceMotion) {
        // Reduced motion: skip the crumb burst, fire onPress immediately.
        onPress(e);
        return;
      }

      const locationX = e.nativeEvent?.locationX ?? 0;
      const locationY = e.nativeEvent?.locationY ?? 0;

      setPressPos({ x: locationX, y: locationY });

      // Reset all crumbs
      crumbAnims.forEach(a => a.setValue(0));

      // Stagger-launch each crumb
      Animated.parallel(
        crumbAnims.map((anim, i) =>
          Animated.sequence([
            Animated.delay(crumbs[i].delay),
            Animated.timing(anim, {
              toValue: 1,
              duration: 350,
              useNativeDriver: true,
            }),
          ])
        )
      ).start(() => setPressPos(null));

      setTimeout(() => onPress(e), 100);
    },
    [onPress, disabled, crumbAnims, crumbs, reduceMotion],
  );

  return (
    <Pressable
      onPress={handlePress}
      disabled={disabled}
      style={style}
      testID={testID}
      accessibilityLabel={accessibilityLabel}
    >
      {children}
      {pressPos && crumbs.map((crumb, i) => {
        const dx = Math.cos(crumb.angle) * crumb.distance;
        const dy = Math.sin(crumb.angle) * crumb.distance;

        const translateX = crumbAnims[i].interpolate({
          inputRange: [0, 1],
          outputRange: [0, dx],
        });
        const translateY = crumbAnims[i].interpolate({
          inputRange: [0, 0.5, 1],
          outputRange: [0, dy * 0.7, dy + 8], // slight gravity at end
        });
        const scale = crumbAnims[i].interpolate({
          inputRange: [0, 0.15, 0.5, 1],
          outputRange: [0, 1.3, 1, 0.3], // pop in big, shrink as they fly
        });
        const opacity = crumbAnims[i].interpolate({
          inputRange: [0, 0.1, 0.6, 1],
          outputRange: [0, 1, 0.8, 0],
        });

        return (
          <Animated.View
            key={i}
            pointerEvents="none"
            style={[
              styles.crumb,
              {
                left: pressPos.x - crumb.size / 2,
                top: pressPos.y - crumb.size / 2,
                width: crumb.size,
                height: crumb.size,
                borderRadius: crumb.size / 2,
                transform: [{ translateX }, { translateY }, { scale }],
                opacity,
              },
            ]}
          />
        );
      })}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  crumb: {
    position: 'absolute',
    backgroundColor: 'rgba(255,255,255,0.9)',
  },
});
