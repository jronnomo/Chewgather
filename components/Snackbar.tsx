import React, { useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet, Text, Pressable, View, Image, AccessibilityInfo } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Check, Sparkle } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import StaticColors from '@/constants/colors';
import { useColors } from '@/context/ThemeContext';

const Colors = StaticColors;

const AUTO_DISMISS_MS = 2800;

interface SnackbarProps {
  visible: boolean;
  message: string;
  // existing optional
  actionLabel?: string;
  onAction?: () => void;
  onDismiss: () => void;
  /**
   * Callback when the bar itself is tapped. Mutually exclusive with
   * actionLabel/onAction — do NOT pass both; the outer Pressable and inner
   * action chip will both fire on a single tap.
   */
  onPress?: () => void;
  bgColor?: string;
  textColor?: string;
  borderColor?: string;
  avatarUri?: string;
  avatarLabel?: string;
  autoDismissMs?: number;
  entranceVariant?: 'standard' | 'celebratory';
}

// ---------------------------------------------------------------------------
// WelcomeSparkles — inline module-level helper (must NOT close over parent
// component's Colors; must call useColors() as its first line per CLAUDE.md)
// ---------------------------------------------------------------------------
interface SparklesProps { active: boolean; }

function WelcomeSparkles({ active }: SparklesProps) {
  const Colors = useColors(); // FIRST LINE — required
  const anims = useRef([0, 1, 2].map(() => new Animated.Value(0))).current;

  useEffect(() => {
    if (!active) return;
    const animations = anims.map((anim, i) =>
      Animated.sequence([
        Animated.delay(i * 80),
        Animated.timing(anim, { toValue: 1, duration: 300, useNativeDriver: true }),
        Animated.timing(anim, { toValue: 0, duration: 300, useNativeDriver: true }),
      ])
    );
    Animated.parallel(animations).start();
  }, [active, anims]);

  const positions: { top: number; right: number }[] = [
    { top: -8,  right: 4  },
    { top: -4,  right: 18 },
    { top: -12, right: 30 },
  ];

  return (
    <>
      {anims.map((anim, i) => (
        <Animated.View
          key={i}
          pointerEvents="none"
          style={{
            position: 'absolute',
            ...positions[i],
            opacity: anim,
            transform: [
              { scale: anim.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0, 1.2, 0] }) },
              { rotate: anim.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '30deg'] }) },
            ],
          }}
        >
          <Sparkle size={10} color={Colors.primary} />
        </Animated.View>
      ))}
    </>
  );
}

// ---------------------------------------------------------------------------
// Snackbar
// ---------------------------------------------------------------------------

/**
 * Lightweight bottom-anchored snackbar. Slides up + fades in on `visible`,
 * auto-dismisses after 2.8s (configurable via autoDismissMs), supports an
 * optional (e.g. Undo) action OR a tappable bar (onPress). Do NOT pass both
 * onPress and actionLabel simultaneously — they are mutually exclusive.
 */
export default function Snackbar({
  visible,
  message,
  actionLabel,
  onAction,
  onDismiss,
  onPress,
  bgColor,
  textColor,
  borderColor,
  avatarUri,
  avatarLabel,
  autoDismissMs = AUTO_DISMISS_MS,
  entranceVariant = 'standard',
}: SnackbarProps) {
  const Colors = useColors();
  const insets = useSafeAreaInsets();
  const translateY = useRef(new Animated.Value(60)).current;
  const opacity = useRef(new Animated.Value(0)).current;
  const scale = useRef(new Animated.Value(0.95)).current;
  const dismissTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [sparkleActive, setSparkleActive] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(false);

  // Mirror NibbleFeedback.tsx:62-73 reduce-motion pattern exactly
  useEffect(() => {
    let cancelled = false;
    AccessibilityInfo.isReduceMotionEnabled().then(v => { if (!cancelled) setReduceMotion(v); });
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => { cancelled = true; sub.remove(); };
  }, []);

  const resolvedBgColor = bgColor ?? Colors.card;
  const resolvedTextColor = textColor ?? Colors.text;
  const resolvedBorderColor = borderColor ?? Colors.border;

  useEffect(() => {
    if (visible) {
      if (entranceVariant === 'celebratory' && !reduceMotion) {
        // Celebratory entrance: slide-up + spring scale + Light haptic at start
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        Animated.parallel([
          Animated.timing(translateY, { toValue: 0, duration: 200, useNativeDriver: true }),
          Animated.spring(scale, { toValue: 1.0, friction: 7, tension: 120, useNativeDriver: true }),
          Animated.timing(opacity, { toValue: 1, duration: 200, useNativeDriver: true }),
        ]).start(() => {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          setSparkleActive(true);
        });
      } else {
        // Standard entrance (also used as reduce-motion fallback)
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        Animated.parallel([
          Animated.timing(translateY, { toValue: 0, duration: 250, useNativeDriver: true }),
          Animated.timing(opacity, { toValue: 1, duration: 250, useNativeDriver: true }),
        ]).start();
      }
      dismissTimer.current = setTimeout(() => onDismiss(), autoDismissMs);
    } else {
      setSparkleActive(false);
      Animated.parallel([
        Animated.timing(translateY, { toValue: 60, duration: 250, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0, duration: 250, useNativeDriver: true }),
      ]).start();
    }
    return () => {
      if (dismissTimer.current) clearTimeout(dismissTimer.current);
    };
  }, [visible, translateY, opacity, scale, onDismiss, autoDismissMs, entranceVariant, reduceMotion]);

  if (!visible) return null;

  const BarWrapper = onPress ? Pressable : View;

  return (
    <Animated.View
      pointerEvents="box-none"
      style={[
        styles.wrap,
        { bottom: insets.bottom + 16, opacity, transform: [{ translateY }, { scale }] },
      ]}
    >
      <BarWrapper
        onPress={onPress}
        accessibilityRole={onPress ? 'button' : undefined}
        style={[styles.bar, { backgroundColor: resolvedBgColor, borderColor: resolvedBorderColor }]}
      >
        {/* Avatar or fallback check icon */}
        {avatarUri ? (
          <Image
            source={{ uri: avatarUri }}
            style={{ width: 24, height: 24, borderRadius: 12, borderWidth: 1.5, borderColor: '#fff' }}
          />
        ) : avatarLabel ? (
          <View style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: Colors.primary, alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ fontSize: 11, fontWeight: '700', color: '#fff' }}>{avatarLabel[0].toUpperCase()}</Text>
          </View>
        ) : (
          <Check size={16} color={resolvedTextColor} />
        )}

        <Text style={[styles.message, { color: resolvedTextColor }]} numberOfLines={2}>
          {message}
        </Text>

        {actionLabel && onAction && (
          <Pressable
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
              if (dismissTimer.current) clearTimeout(dismissTimer.current);
              onAction();
            }}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={actionLabel}
          >
            <Text style={[styles.action, { color: Colors.primary }]}>{actionLabel}</Text>
          </Pressable>
        )}

        {/* Sparkles — only for celebratory variant when reduce motion is off */}
        {entranceVariant === 'celebratory' && !reduceMotion && (
          <WelcomeSparkles active={sparkleActive} />
        )}
      </BarWrapper>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 20,
    right: 20,
    alignItems: 'center',
  },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 16,
    width: '100%',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18,
    shadowRadius: 12,
    elevation: 6,
    position: 'relative',
  },
  message: {
    flex: 1,
    fontSize: 14,
    fontWeight: '600' as const,
  },
  action: {
    fontSize: 14,
    fontWeight: '800' as const,
  },
});
