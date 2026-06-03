import { useEffect, useRef } from 'react';
import {
  View,
  Pressable,
  StyleSheet,
  Animated,
} from 'react-native';
import { Check } from 'lucide-react-native';
import { useColors } from '../context/ThemeContext';
import AppText from '@/components/AppText';

interface PlanSuccessOverlayProps {
  visible: boolean;
  variant: 'voting' | 'pinned';
  onConfirm: () => void;
}

const SUBTITLES: Record<PlanSuccessOverlayProps['variant'], string> = {
  voting: 'Invites sent! Voting will open after your RSVP deadline.',
  pinned: 'Your group session is ready to start!',
};

export default function PlanSuccessOverlay({
  visible,
  variant,
  onConfirm,
}: PlanSuccessOverlayProps) {
  const Colors = useColors();

  // Animations
  const backdropOpacity = useRef(new Animated.Value(0)).current;
  const cardScale = useRef(new Animated.Value(0.85)).current;
  const cardOpacity = useRef(new Animated.Value(0)).current;
  const checkScale = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      // Reset
      backdropOpacity.setValue(0);
      cardScale.setValue(0.85);
      cardOpacity.setValue(0);
      checkScale.setValue(0);

      // Backdrop fade
      Animated.timing(backdropOpacity, {
        toValue: 1,
        duration: 200,
        useNativeDriver: true,
      }).start();

      // Card entrance: fade + scale spring
      Animated.parallel([
        Animated.timing(cardOpacity, {
          toValue: 1,
          duration: 220,
          useNativeDriver: true,
        }),
        Animated.spring(cardScale, {
          toValue: 1,
          tension: 280,
          friction: 12,
          useNativeDriver: true,
        }),
      ]).start(() => {
        // Checkmark bounce-in after card settles
        Animated.spring(checkScale, {
          toValue: 1,
          tension: 300,
          friction: 8,
          useNativeDriver: true,
        }).start();
      });
    }
  }, [visible, backdropOpacity, cardScale, cardOpacity, checkScale]);

  if (!visible) return null;

  return (
    <Animated.View style={[styles.backdrop, { opacity: backdropOpacity }]}>
      {/* Tapping the backdrop dismisses, same as the CTA */}
      <Pressable
        style={StyleSheet.absoluteFill}
        onPress={onConfirm}
        accessibilityLabel="Dismiss"
        accessibilityRole="button"
      />
      <Animated.View
        onStartShouldSetResponder={() => true}
        style={[
          styles.card,
          {
            backgroundColor: Colors.card,
            transform: [{ scale: cardScale }],
            opacity: cardOpacity,
          },
        ]}
      >
        {/* Checkmark circle */}
        <Animated.View
          style={[
            styles.checkCircle,
            {
              backgroundColor: Colors.primary,
              transform: [{ scale: checkScale }],
            },
          ]}
        >
          <Check size={40} color="#FFFFFF" strokeWidth={3} />
        </Animated.View>

        {/* Heading */}
        <AppText variant="display" style={[styles.heading, { color: Colors.text }]}>
          Plan's in the Oven!
        </AppText>

        {/* Subtitle */}
        <AppText variant="body" style={[styles.subtitle, { color: Colors.textSecondary }]}>
          {SUBTITLES[variant]}
        </AppText>

        {/* CTA */}
        <Pressable
          onPress={onConfirm}
          style={({ pressed }) => [
            styles.ctaButton,
            { backgroundColor: Colors.primary, opacity: pressed ? 0.85 : 1 },
          ]}
        >
          <AppText variant="dense" style={styles.ctaText}>Let's Feast!</AppText>
        </Pressable>
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 9000,
  },
  card: {
    width: '82%',
    borderRadius: 24,
    paddingVertical: 36,
    paddingHorizontal: 28,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.18,
    shadowRadius: 24,
    elevation: 12,
  },
  checkCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
  },
  heading: {
    fontSize: 24,
    fontWeight: '800',
    textAlign: 'center',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 15,
    lineHeight: 21,
    textAlign: 'center',
    marginBottom: 28,
  },
  ctaButton: {
    minHeight: 50,
    paddingVertical: 14,
    paddingHorizontal: 48,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaText: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '700',
  },
});
