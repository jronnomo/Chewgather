// components/ConversionPrompt.tsx
import React, {
  useState,
  useEffect,
  useRef,
  useCallback,
} from 'react';
import {
  Modal,
  View,
  Text,
  Pressable,
  Animated,
  Easing,
  AccessibilityInfo,
  StyleSheet,
  Dimensions,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import type { ComponentType } from 'react';

// ── Icon imports — all icons used by this file ─────────────────────────────
import { Heart, Bookmark, UtensilsCrossed } from 'lucide-react-native';

import type { FunnelTrigger } from '../lib/guestFunnel';
import StaticColors from '../constants/colors';
import { useColors } from '../context/ThemeContext';
import NibbleFeedback from './NibbleFeedback';
import ScallopDivider from './ScallopDivider';
import CrumbParticles, { createBurst, animateBurst } from './CrumbParticles';
import type { CrumbBurst } from './CrumbParticles';

// Module-level color alias — for StyleSheet.create() only (static)
const Colors = StaticColors;

// ── Icon prop shape ─────────────────────────────────────────────────────────
type LucideIconComponent = ComponentType<{ size: number; color: string }>;

// ── Per-trigger copy config ─────────────────────────────────────────────────
export interface TriggerCopyConfig {
  headline: string;
  /** Use {N} as a placeholder for pickCount interpolation (end-of-swipe only). */
  body: string;
  /** Use {N} for count in CTA (end-of-swipe only). */
  primaryCTA: string;
  secondaryCTA: string;
  /**
   * The actual Lucide component reference — NOT a string name.
   * Import the icon and assign it directly here.
   */
  Icon: LucideIconComponent;
  /** Whether to fire CrumbParticles burst on settle. False for nudge. */
  showCrumbs: boolean;
  /** Spring friction for the sheet entrance. Higher = less overshoot (nudge: 11). */
  springFriction: number;
}

export const CONVERSION_COPY: Record<FunnelTrigger, TriggerCopyConfig> = {
  'save': {
    headline: 'Want to keep this one?',
    body: 'Create a free account and this spot is saved to your favorites for good.',
    primaryCTA: 'Create account & save',
    secondaryCTA: 'Keep browsing',
    Icon: Heart,          // ← direct component reference, not a string
    showCrumbs: true,
    springFriction: 9,
  },
  'end-of-swipe': {
    headline: 'Take your picks home',
    body: 'You found {N} spots worth remembering. Create a free account to keep them.',
    primaryCTA: 'Create account & save {N}',
    secondaryCTA: 'Maybe later',
    Icon: Bookmark,       // ← direct component reference
    showCrumbs: true,
    springFriction: 9,
  },
  'nudge': {
    headline: 'Enjoying Chewabl?',
    body: 'Make it yours — a free account saves your favorites, plans, and friends.',
    primaryCTA: 'Create free account',
    secondaryCTA: 'Not now',
    Icon: UtensilsCrossed, // ← direct component reference
    showCrumbs: false,
    springFriction: 11,
  },
};

// ── Component props ─────────────────────────────────────────────────────────
export interface ConversionPromptProps {
  /** Controls Modal visibility. */
  visible: boolean;
  /** Which of the 3 conversion scenarios triggered this prompt. */
  trigger: FunnelTrigger;
  /**
   * Number of picks (for end-of-swipe {N} interpolation).
   * Ignored for 'save' and 'nudge' triggers.
   */
  pickCount?: number;
  /**
   * Called when the user taps the primary CTA.
   * The CALLER is responsible for firing requestChomp → router.push.
   * ConversionPrompt does NOT navigate itself.
   */
  onAccept: () => void;
  /**
   * Called when the user dismisses (secondary CTA, backdrop tap, swipe-down).
   * The CALLER is responsible for calling markTriggerDismissed().
   * ConversionPrompt does NOT write dismissal state itself.
   */
  onDismiss: () => void;
}

// ── Pure helper — no React, no colors ──────────────────────────────────────
function interpolateCopy(template: string, pickCount?: number): string {
  return template.replace(/\{N\}/g, String(pickCount ?? 0));
}

const { height: SCREEN_HEIGHT } = Dimensions.get('window');
const SHEET_HEIGHT = SCREEN_HEIGHT * 0.52;

// ── Component ───────────────────────────────────────────────────────────────
export default function ConversionPrompt({
  visible,
  trigger,
  pickCount,
  onAccept,
  onDismiss,
}: ConversionPromptProps) {
  // Component-level colors — reactive to dark mode
  const Colors = useColors();

  const config = CONVERSION_COPY[trigger];
  const { Icon } = config;

  // Animated values
  const sheetY = useRef(new Animated.Value(SHEET_HEIGHT)).current;
  const backdropOpacity = useRef(new Animated.Value(0)).current;
  const badgeScale = useRef(new Animated.Value(0)).current;
  const headlineOpacity = useRef(new Animated.Value(0)).current;
  const bodyOpacity = useRef(new Animated.Value(0)).current;
  const ctaOpacity = useRef(new Animated.Value(0)).current;

  // State
  const [crumbBursts, setCrumbBursts] = useState<CrumbBurst[]>([]);
  const [accepting, setAccepting] = useState(false);

  // Refs
  const isExitingRef = useRef(false);     // S-2: prevent double-exit

  // ── Reset animated values when becoming visible ─────────────────────────
  const resetValues = useCallback(() => {
    sheetY.setValue(SHEET_HEIGHT);
    backdropOpacity.setValue(0);
    badgeScale.setValue(0);
    headlineOpacity.setValue(0);
    bodyOpacity.setValue(0);
    ctaOpacity.setValue(0);
    setCrumbBursts([]);
    setAccepting(false);
    isExitingRef.current = false;
  }, [sheetY, backdropOpacity, badgeScale, headlineOpacity, bodyOpacity, ctaOpacity]);

  // ── Entrance animation ───────────────────────────────────────────────────
  const startEntrance = useCallback(async () => {
    resetValues();
    const reducedMotion = await AccessibilityInfo.isReduceMotionEnabled();

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    if (reducedMotion) {
      // Reduced motion: fade only, no spring, no crumbs, no stagger
      Animated.timing(backdropOpacity, {
        toValue: 1,
        duration: 150,
        useNativeDriver: true,
      }).start();
      Animated.timing(sheetY, {
        toValue: 0,
        duration: 150,
        useNativeDriver: true,
      }).start();
      // Set all content visible immediately
      headlineOpacity.setValue(1);
      bodyOpacity.setValue(1);
      ctaOpacity.setValue(1);
      badgeScale.setValue(1);
      return;
    }

    // Full animated entrance
    Animated.timing(backdropOpacity, {
      toValue: 1,
      duration: 200,
      useNativeDriver: true,
    }).start();

    Animated.spring(sheetY, {
      toValue: 0,
      tension: 60,
      friction: config.springFriction,
      useNativeDriver: true,
    }).start(() => {
      // Sheet has settled — fire secondary animations
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

      // CrumbParticles burst (only for save and end-of-swipe)
      if (config.showCrumbs) {
        const burst = createBurst(
          SHEET_HEIGHT * 0.5, // cx: center horizontally
          0,                  // cy: top of sheet
          6,
          Colors.primary,
          trigger === 'save' ? 0 : 1,
        );
        setCrumbBursts(prev => [...prev, burst]);
        animateBurst(burst, trigger === 'save' ? 0 : 1);
      }

      // Badge spring pop
      Animated.spring(badgeScale, {
        toValue: 1,
        tension: 120,
        friction: 6,
        useNativeDriver: true,
      }).start();

      // Staggered content entrance
      Animated.stagger(40, [
        Animated.timing(headlineOpacity, { toValue: 1, duration: 200, useNativeDriver: true }),
        Animated.timing(bodyOpacity, { toValue: 1, duration: 200, useNativeDriver: true }),
        Animated.timing(ctaOpacity, { toValue: 1, duration: 200, useNativeDriver: true }),
      ]).start();
    });
  }, [
    resetValues,
    backdropOpacity,
    sheetY,
    config.springFriction,
    config.showCrumbs,
    badgeScale,
    headlineOpacity,
    bodyOpacity,
    ctaOpacity,
    Colors.primary,
    trigger,
  ]);

  // ── Exit animation ───────────────────────────────────────────────────────
  const startExit = useCallback(() => {
    // S-2: idempotent guard — only one exit at a time
    if (isExitingRef.current) return;
    isExitingRef.current = true;

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    Animated.timing(sheetY, {
      toValue: SHEET_HEIGHT,
      duration: 220,
      easing: Easing.in(Easing.cubic),
      useNativeDriver: true,
    }).start(() => {
      isExitingRef.current = false;
      onDismiss();
    });

    Animated.timing(backdropOpacity, {
      toValue: 0,
      duration: 200,
      useNativeDriver: true,
    }).start();
  }, [sheetY, backdropOpacity, onDismiss]);

  // ── Respond to visible changes ───────────────────────────────────────────
  useEffect(() => {
    if (visible) {
      startEntrance();
    }
    // We do NOT call startExit here — callers control visibility directly.
    // startExit is triggered by user interaction (backdrop/secondary CTA).
  }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Accept handler ───────────────────────────────────────────────────────
  const handleAccept = useCallback(() => {
    if (accepting) return; // D-5: idempotent on double-tap
    setAccepting(true);
    onAccept(); // caller handles isAnimating check + chomp + navigation
  }, [accepting, onAccept]);

  // ── Interpolated copy strings ────────────────────────────────────────────
  const headline = config.headline;
  const body = interpolateCopy(config.body, pickCount);
  const primaryCTA = interpolateCopy(config.primaryCTA, pickCount);
  const secondaryCTA = config.secondaryCTA;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      onRequestClose={startExit}
      statusBarTranslucent
    >
      {/* Dimmed backdrop */}
      <Animated.View
        style={[styles.backdrop, { opacity: backdropOpacity, backgroundColor: Colors.overlay }]}
      >
        <Pressable style={styles.backdropPressable} onPress={startExit} />
      </Animated.View>

      {/* Sliding sheet */}
      <Animated.View
        style={[
          styles.sheet,
          {
            backgroundColor: Colors.card,
            transform: [{ translateY: sheetY }],
          },
        ]}
        accessible
        accessibilityViewIsModal
      >
        {/* Scallop lip at top of sheet */}
        <ScallopDivider color={Colors.card} />

        {/* Grab handle */}
        <View
          style={[styles.handle, { backgroundColor: Colors.border }]}
          accessibilityElementsHidden
        />

        {/* Icon badge */}
        <Animated.View
          style={[
            styles.badge,
            {
              backgroundColor: Colors.surfaceElevated,
              transform: [{ scale: badgeScale }],
            },
          ]}
        >
          <Icon size={26} color={Colors.primary} />
        </Animated.View>

        {/* Headline */}
        <Animated.Text
          style={[styles.headline, { color: Colors.text, opacity: headlineOpacity }]}
        >
          {headline}
        </Animated.Text>

        {/* Body */}
        <Animated.Text
          style={[styles.body, { color: Colors.textSecondary, opacity: bodyOpacity }]}
        >
          {body}
        </Animated.Text>

        {/* CTA group */}
        <Animated.View style={[styles.ctaGroup, { opacity: ctaOpacity }]}>
          <NibbleFeedback
            onPress={handleAccept}
            disabled={accepting}
            accessibilityLabel={primaryCTA}
          >
            <View style={[styles.ctaPill, { backgroundColor: '#E85D3A' }]}>
              <Text style={[styles.ctaText, { color: '#FFF' }]}>
                {primaryCTA}
              </Text>
            </View>
          </NibbleFeedback>

          <Pressable
            onPress={startExit}
            style={styles.secondaryBtn}
            accessibilityLabel={secondaryCTA}
            accessibilityRole="button"
          >
            <Text style={[styles.secondaryText, { color: Colors.textSecondary }]}>
              {secondaryCTA}
            </Text>
          </Pressable>
        </Animated.View>

        {/* Crumb particles overlay */}
        <CrumbParticles bursts={crumbBursts} />
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  backdropPressable: {
    flex: 1,
  },
  sheet: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    minHeight: SHEET_HEIGHT,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingBottom: 40,
    overflow: 'hidden',
  },
  handle: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: 2,
    marginTop: 6,
    marginBottom: 20,
  },
  badge: {
    alignSelf: 'center',
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  headline: {
    fontSize: 22,
    fontWeight: '700',
    textAlign: 'center',
    letterSpacing: -0.3,
    marginHorizontal: 28,
    marginBottom: 10,
  },
  body: {
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'center',
    marginHorizontal: 32,
    marginBottom: 28,
  },
  ctaGroup: {
    paddingHorizontal: 24,
    gap: 12,
  },
  ctaPill: {
    borderRadius: 28,
    paddingVertical: 16,
    paddingHorizontal: 24,
    alignItems: 'center',
  },
  ctaText: {
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
  secondaryBtn: {
    alignItems: 'center',
    paddingVertical: 8,
  },
  secondaryText: {
    fontSize: 15,
    fontWeight: '500',
  },
});
