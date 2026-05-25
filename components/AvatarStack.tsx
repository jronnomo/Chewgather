import React, { useRef, useEffect } from 'react';
import {
  View,
  Text,
  Animated,
  StyleSheet,
  AccessibilityInfo,
} from 'react-native';
import { Image } from 'expo-image';
import StaticColors from '../constants/colors';
import { useColors } from '../context/ThemeContext';

const Colors = StaticColors;

interface AvatarStackProps {
  friends: Array<{ id: string; name: string; avatarUri?: string }>;
  count: number;
  size?: 28 | 32;
  max?: number;
  animateOnMount?: boolean;
  staggerMs?: number;
  accessibilityLabel?: string;
}

// Module-level helper — must call useColors() inside its own body (CLAUDE.md rule)
function AvatarCircle({
  name,
  avatarUri,
  size,
  index,
  animateOnMount,
  staggerMs,
  hasAnimated,
}: {
  name: string;
  avatarUri?: string;
  size: number;
  index: number;
  animateOnMount: boolean;
  staggerMs: number;
  hasAnimated: React.MutableRefObject<boolean>;
}) {
  const Colors = useColors();
  const scaleAnim = useRef(new Animated.Value(animateOnMount ? 0.6 : 1)).current;
  const opacityAnim = useRef(new Animated.Value(animateOnMount ? 0 : 1)).current;

  useEffect(() => {
    if (!animateOnMount || hasAnimated.current) return;

    AccessibilityInfo.isReduceMotionEnabled().then((reduced) => {
      if (reduced) {
        // Reduced motion: single 150ms opacity fade, no scale, no stagger
        Animated.timing(opacityAnim, {
          toValue: 1,
          duration: 150,
          useNativeDriver: true,
        }).start();
      } else {
        // Spring entrance with stagger
        const delay = index * staggerMs;
        const timer = setTimeout(() => {
          Animated.parallel([
            Animated.spring(scaleAnim, {
              toValue: 1,
              damping: 14,
              stiffness: 180,
              useNativeDriver: true,
            }),
            Animated.timing(opacityAnim, {
              toValue: 1,
              duration: 150,
              useNativeDriver: true,
            }),
          ]).start();
        }, delay);
        return () => clearTimeout(timer);
      }
    });
    // We intentionally don't list hasAnimated in deps — it's a ref
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [animateOnMount, index, staggerMs]);

  const initial = (name?.trim()?.[0] ?? '?').toUpperCase();
  const fontSize = Math.round(size * 0.43);

  return (
    <Animated.View
      style={[
        styles.avatarWrapper,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          borderWidth: 2,
          borderColor: Colors.card,
          marginLeft: index === 0 ? 0 : -10,
          transform: [{ scale: scaleAnim }],
          opacity: opacityAnim,
        },
      ]}
      importantForAccessibility="no-hide-descendants"
    >
      {avatarUri ? (
        <Image
          source={{ uri: avatarUri }}
          style={{ width: size, height: size, borderRadius: size / 2 }}
          contentFit="cover"
          accessibilityIgnoresInvertColors
        />
      ) : (
        <View
          style={[
            styles.initialCircle,
            {
              width: size,
              height: size,
              borderRadius: size / 2,
              backgroundColor: Colors.primary,
            },
          ]}
        >
          <Text
            style={{
              color: '#FFFFFF',
              fontSize,
              fontWeight: '700',
              lineHeight: fontSize * 1.2,
            }}
          >
            {initial}
          </Text>
        </View>
      )}
    </Animated.View>
  );
}

// Module-level helper — must call useColors() inside its own body (CLAUDE.md rule)
function OverflowPill({
  overflow,
  size,
  animateOnMount,
  staggerMs,
  totalAvatars,
  hasAnimated,
}: {
  overflow: number;
  size: number;
  animateOnMount: boolean;
  staggerMs: number;
  totalAvatars: number;
  hasAnimated: React.MutableRefObject<boolean>;
}) {
  const Colors = useColors();
  const scaleAnim = useRef(new Animated.Value(animateOnMount ? 0.6 : 1)).current;
  const opacityAnim = useRef(new Animated.Value(animateOnMount ? 0 : 1)).current;

  useEffect(() => {
    if (!animateOnMount || hasAnimated.current) return;

    AccessibilityInfo.isReduceMotionEnabled().then((reduced) => {
      if (reduced) {
        Animated.timing(opacityAnim, {
          toValue: 1,
          duration: 150,
          useNativeDriver: true,
        }).start();
      } else {
        const delay = totalAvatars * staggerMs;
        const timer = setTimeout(() => {
          Animated.parallel([
            Animated.spring(scaleAnim, {
              toValue: 1,
              damping: 14,
              stiffness: 180,
              useNativeDriver: true,
            }),
            Animated.timing(opacityAnim, {
              toValue: 1,
              duration: 150,
              useNativeDriver: true,
            }),
          ]).start();
        }, delay);
        return () => clearTimeout(timer);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [animateOnMount, staggerMs, totalAvatars]);

  const fontSize = Math.round(size * 0.43);

  return (
    <Animated.View
      style={[
        styles.pillWrapper,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          borderWidth: 2,
          borderColor: Colors.card,
          backgroundColor: Colors.border,
          marginLeft: -10,
          transform: [{ scale: scaleAnim }],
          opacity: opacityAnim,
        },
      ]}
      importantForAccessibility="no-hide-descendants"
    >
      <Text
        style={{
          color: Colors.text,
          fontSize,
          fontWeight: '700',
          lineHeight: fontSize * 1.2,
        }}
      >
        +{overflow}
      </Text>
    </Animated.View>
  );
}

export default function AvatarStack({
  friends,
  count,
  size = 28,
  max = 3,
  animateOnMount = true,
  staggerMs = 50,
  accessibilityLabel,
}: AvatarStackProps) {
  // Gate cascade so cell recycling doesn't re-trigger (delta D-10a)
  const hasAnimated = useRef<boolean>(false);

  useEffect(() => {
    if (animateOnMount) {
      // Mark as animated after the stagger completes so recycled cells stay static
      const totalDelay = Math.min(friends.length, max) * staggerMs + 300;
      const timer = setTimeout(() => {
        hasAnimated.current = true;
      }, totalDelay);
      return () => clearTimeout(timer);
    }
  }, [animateOnMount, friends.length, max, staggerMs]);

  if (count === 0 || friends.length === 0) return null;

  const visible = friends.slice(0, max);
  const overflow = count > max ? count - max : 0;

  const a11yLabel =
    accessibilityLabel ??
    (count === 1
      ? '1 friend engaged with this'
      : `${count} friends engaged with this`);

  return (
    <View
      style={styles.row}
      accessibilityRole="image"
      accessibilityLabel={a11yLabel}
    >
      {visible.map((friend, index) => (
        <AvatarCircle
          key={friend.id}
          name={friend.name}
          avatarUri={friend.avatarUri}
          size={size}
          index={index}
          animateOnMount={animateOnMount}
          staggerMs={staggerMs}
          hasAnimated={hasAnimated}
        />
      ))}
      {overflow > 0 && (
        <OverflowPill
          overflow={overflow}
          size={size}
          animateOnMount={animateOnMount}
          staggerMs={staggerMs}
          totalAvatars={visible.length}
          hasAnimated={hasAnimated}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  avatarWrapper: {
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  initialCircle: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  pillWrapper: {
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
