import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text, Pressable } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Check } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import StaticColors from '@/constants/colors';
import { useColors } from '@/context/ThemeContext';

const Colors = StaticColors;

const AUTO_DISMISS_MS = 2800;

interface SnackbarProps {
  visible: boolean;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
  onDismiss: () => void;
}

/**
 * Lightweight bottom-anchored snackbar. Slides up + fades in on `visible`,
 * auto-dismisses after 2.8s, supports an optional (e.g. Undo) action.
 */
export default function Snackbar({
  visible,
  message,
  actionLabel,
  onAction,
  onDismiss,
}: SnackbarProps) {
  const Colors = useColors();
  const insets = useSafeAreaInsets();
  const translateY = useRef(new Animated.Value(40)).current;
  const opacity = useRef(new Animated.Value(0)).current;
  const dismissTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (visible) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      Animated.parallel([
        Animated.timing(translateY, { toValue: 0, duration: 250, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 1, duration: 250, useNativeDriver: true }),
      ]).start();
      dismissTimer.current = setTimeout(() => onDismiss(), AUTO_DISMISS_MS);
    } else {
      Animated.parallel([
        Animated.timing(translateY, { toValue: 40, duration: 250, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0, duration: 250, useNativeDriver: true }),
      ]).start();
    }
    return () => {
      if (dismissTimer.current) clearTimeout(dismissTimer.current);
    };
  }, [visible, translateY, opacity, onDismiss]);

  if (!visible) return null;

  return (
    <Animated.View
      pointerEvents="box-none"
      style={[
        styles.wrap,
        { bottom: insets.bottom + 16, opacity, transform: [{ translateY }] },
      ]}
    >
      <Animated.View
        style={[styles.bar, { backgroundColor: Colors.card, borderColor: Colors.border }]}
      >
        <Check size={16} color={Colors.primary} />
        <Text style={[styles.message, { color: Colors.text }]} numberOfLines={2}>
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
      </Animated.View>
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
