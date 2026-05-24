import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  Pressable,
  Animated,
  StyleSheet,
  AccessibilityInfo,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';
import { X } from 'lucide-react-native';
import StaticColors from '../constants/colors';
import { useColors } from '../context/ThemeContext';
import { useAuth } from '../context/AuthContext';

const Colors = StaticColors;

export interface SortHintProps {
  onDismiss?: () => void;
}

export default function SortHint({ onDismiss }: SortHintProps) {
  const Colors = useColors();
  const { user } = useAuth();
  const storageKey = `chewabl:friends-sort-hint-dismissed:${user?.id ?? 'anon'}`;

  const [visible, setVisible] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(false);
  const opacity = useRef(new Animated.Value(1)).current;

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

  useEffect(() => {
    let cancelled = false;
    AsyncStorage.getItem(storageKey)
      .then(value => {
        if (!cancelled && value !== '1') {
          setVisible(true);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [storageKey]);

  const handleDismiss = () => {
    AsyncStorage.setItem(storageKey, '1');
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onDismiss?.();

    if (reduceMotion) {
      setVisible(false);
    } else {
      Animated.timing(opacity, {
        toValue: 0,
        duration: 150,
        useNativeDriver: true,
      }).start(() => {
        setVisible(false);
      });
    }
  };

  if (!visible) return null;

  return (
    <Animated.View
      style={[
        styles.container,
        { backgroundColor: Colors.primaryLight, opacity },
      ]}
    >
      <Text style={[styles.text, { color: Colors.primary }]}>
        Sorted by who you plan with most ✨
      </Text>
      <Pressable
        onPress={handleDismiss}
        accessibilityRole="button"
        accessibilityLabel="Dismiss"
        style={styles.dismissBtn}
      >
        <X size={14} color={Colors.primary} />
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.primaryLight,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    marginHorizontal: 20,
    marginBottom: 10,
  },
  text: {
    flex: 1,
    fontSize: 13,
    fontWeight: '600' as const,
    color: Colors.primary,
  },
  dismissBtn: {
    paddingLeft: 8,
  },
});
