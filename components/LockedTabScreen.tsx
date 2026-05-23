import React, { useEffect, useRef } from 'react';
import {
  View,
  Text,
  Animated,
  AccessibilityInfo,
  StyleSheet,
  Pressable,
  Dimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import type { ComponentType } from 'react';
import Svg, { Defs, Mask, Rect, Circle } from 'react-native-svg';

// ── All icons used by LockedTabScreen ──────────────────────────────────────
import {
  CalendarDays,
  Users,
  User,
  Heart,
  Utensils,
  Settings,
  Check,
  Star,
} from 'lucide-react-native';

import StaticColors from '../constants/colors';
import { useColors } from '../context/ThemeContext';
import NibbleFeedback from './NibbleFeedback';
import { generateScallops } from '../lib/scallopUtils';

const Colors = StaticColors; // module level — for StyleSheet.create() only

const { width: SCREEN_WIDTH } = Dimensions.get('window');

// ── Icon prop shape ─────────────────────────────────────────────────────────
type LucideIconComponent = ComponentType<{ size: number; color: string }>;

// ── Variant types ───────────────────────────────────────────────────────────
export type LockedTabVariant = 'plans' | 'friends' | 'profile';

export interface VariantBullet {
  /** Direct Lucide component reference — NOT a string name. */
  Icon: LucideIconComponent;
  label: string;
  /** Combined accessibility label for screen readers (icon + text as one unit). */
  accessibilityLabel: string;
}

export interface LockedTabVariantConfig {
  /** Direct Lucide component reference for the hero badge icon. */
  HeroIcon: LucideIconComponent;
  headline: string;
  body: string;
  bullets: [VariantBullet, VariantBullet, VariantBullet];
  primaryCTA: string;
  secondaryCTA: string;
}

// ── Per-variant config ──────────────────────────────────────────────────────
export const LOCKED_TAB_CONFIG: Record<LockedTabVariant, LockedTabVariantConfig> = {
  plans: {
    HeroIcon: CalendarDays,
    headline: 'Eat together, on purpose',
    body: 'Create a free account to plan dining outings and bring your friends along.',
    bullets: [
      { Icon: CalendarDays, label: 'Plan outings around great food',  accessibilityLabel: 'Plan outings around great food' },
      { Icon: Users,        label: 'Invite friends to the table',     accessibilityLabel: 'Invite friends to the table' },
      { Icon: Check,        label: 'Vote on where to go together',    accessibilityLabel: 'Vote on where to go together' },
    ],
    primaryCTA: 'Create your account',
    secondaryCTA: 'I already have an account',
  },
  friends: {
    HeroIcon: Users,
    headline: 'Food is better with friends',
    body: "Create a free account to connect with people and see what they're craving.",
    bullets: [
      { Icon: Users,  label: 'Connect with people you know',   accessibilityLabel: 'Connect with people you know' },
      { Icon: Heart,  label: 'See the spots your friends love', accessibilityLabel: 'See the spots your friends love' },
      { Icon: Star,   label: 'Get picks from people you trust', accessibilityLabel: 'Get picks from people you trust' },
    ],
    primaryCTA: 'Create your account',
    secondaryCTA: 'I already have an account',
  },
  profile: {
    HeroIcon: User,
    headline: 'Your spot for your spots',
    body: 'Create a free account to keep the restaurants you love in one place.',
    bullets: [
      { Icon: Heart,    label: 'Save favorites you can revisit',    accessibilityLabel: 'Save favorites you can revisit' },
      { Icon: Utensils, label: "See every spot you've bitten on",   accessibilityLabel: "See every spot you've bitten on" },
      { Icon: Settings, label: 'Tune your taste preferences',       accessibilityLabel: 'Tune your taste preferences' },
    ],
    primaryCTA: 'Create your account',
    secondaryCTA: 'I already have an account',
  },
};

// ── Component props ─────────────────────────────────────────────────────────
export interface LockedTabScreenProps {
  variant: LockedTabVariant;
}

// ── Hero badge dimensions ───────────────────────────────────────────────────
const BADGE_SIZE = 96;
const BADGE_RADIUS = BADGE_SIZE / 2;
const SCALLOP_BASE_R = BADGE_SIZE * 0.08;

// ── BulletRow — module-level helper (MUST declare its own useColors()) ──────
function BulletRow({ Icon, label, accessibilityLabel }: VariantBullet) {
  const Colors = useColors(); // MANDATORY: module-level helper
  return (
    <View
      style={styles.bulletRow}
      accessible
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="text"
    >
      <Icon size={20} color={Colors.primary} />
      <Text style={[styles.bulletLabel, { color: Colors.text }]}>{label}</Text>
    </View>
  );
}

// ── HeroBadgeSvg — module-level helper (MUST declare its own useColors()) ──
function HeroBadgeSvg({ HeroIcon }: { HeroIcon: LucideIconComponent }) {
  const Colors = useColors(); // MANDATORY: module-level helper

  const scallops = generateScallops(
    42,                   // seed offset
    BADGE_RADIUS * 0.82,  // targetR
    -Math.PI * 0.9,       // arcStart — nearly full circle
    Math.PI * 0.9,        // arcEnd
    SCALLOP_BASE_R,
    0.6,                  // jitter
  );

  const maskId = 'heroScallopMask';
  const cx = BADGE_SIZE / 2;
  const cy = BADGE_SIZE / 2;
  const biteR = BADGE_RADIUS * 0.82;

  return (
    <View
      style={[
        styles.heroBadgeContainer,
        { backgroundColor: Colors.surfaceElevated },
      ]}
    >
      {/* Scallop notch overlay — clips the badge edge */}
      <Svg
        width={BADGE_SIZE}
        height={BADGE_SIZE}
        style={StyleSheet.absoluteFillObject}
        pointerEvents="none"
      >
        <Defs>
          <Mask id={maskId}>
            {/* White = visible, black = cut out */}
            <Rect x={0} y={0} width={BADGE_SIZE} height={BADGE_SIZE} fill="white" />
            {/* Main circular bite from the edge */}
            {scallops.map((sc, i) => (
              <Circle
                key={i}
                cx={cx + biteR * Math.cos(sc.angle)}
                cy={cy + biteR * Math.sin(sc.angle)}
                r={sc.radius}
                fill="black"
              />
            ))}
          </Mask>
        </Defs>
        <Rect
          x={0}
          y={0}
          width={BADGE_SIZE}
          height={BADGE_SIZE}
          fill={Colors.surfaceElevated}
          mask={`url(#${maskId})`}
        />
      </Svg>

      {/* Icon centered */}
      <HeroIcon size={36} color={Colors.primary} />
    </View>
  );
}

// ── Main component ──────────────────────────────────────────────────────────
export default function LockedTabScreen({ variant }: LockedTabScreenProps) {
  const Colors = useColors(); // component level — shadows module-level for reactivity
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const config = LOCKED_TAB_CONFIG[variant];
  const { HeroIcon } = config;

  // Animation values — start at 0 (animated), or 1 (reduced-motion fast path)
  const heroScale       = useRef(new Animated.Value(0)).current;
  const headlineOpacity = useRef(new Animated.Value(0)).current;
  const bulletsOpacity  = useRef(new Animated.Value(0)).current;
  const ctaOpacity      = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then((reduced) => {
      if (reduced) {
        // M-3 fix: set all values immediately — no spring, no stagger
        heroScale.setValue(1);
        headlineOpacity.setValue(1);
        bulletsOpacity.setValue(1);
        ctaOpacity.setValue(1);
        return;
      }
      // Staggered entrance
      Animated.spring(heroScale, {
        toValue: 1,
        tension: 80,
        friction: 8,
        useNativeDriver: true,
      }).start();
      Animated.stagger(50, [
        Animated.timing(headlineOpacity, { toValue: 1, duration: 250, useNativeDriver: true }),
        Animated.timing(bulletsOpacity,  { toValue: 1, duration: 250, useNativeDriver: true }),
        Animated.timing(ctaOpacity,      { toValue: 1, duration: 250, useNativeDriver: true }),
      ]).start();
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handlePrimary = () => {
    router.push('/auth?intent=signup' as never);
  };

  const handleSecondary = () => {
    router.push('/auth' as never);
  };

  return (
    <View
      testID={`locked-tab-${variant}`}
      style={[
        styles.container,
        { paddingTop: insets.top, backgroundColor: Colors.background },
      ]}
    >
      {/* Hero badge */}
      <Animated.View
        style={[styles.heroBadgeWrap, { transform: [{ scale: heroScale }] }]}
      >
        <HeroBadgeSvg HeroIcon={HeroIcon} />
      </Animated.View>

      {/* Headline */}
      <Animated.Text
        style={[styles.headline, { color: Colors.text, opacity: headlineOpacity }]}
      >
        {config.headline}
      </Animated.Text>

      {/* Body */}
      <Text style={[styles.body, { color: Colors.textSecondary }]}>
        {config.body}
      </Text>

      {/* Value-bullet card */}
      <Animated.View
        style={[
          styles.bulletsCard,
          { backgroundColor: Colors.card, opacity: bulletsOpacity },
        ]}
      >
        <BulletRow {...config.bullets[0]} />
        <View style={[styles.bulletDivider, { borderColor: Colors.border }]} />
        <BulletRow {...config.bullets[1]} />
        <View style={[styles.bulletDivider, { borderColor: Colors.border }]} />
        <BulletRow {...config.bullets[2]} />
      </Animated.View>

      {/* CTA buttons */}
      <Animated.View style={[styles.ctaWrap, { opacity: ctaOpacity }]}>
        <NibbleFeedback
          onPress={handlePrimary}
          accessibilityLabel={config.primaryCTA}
          style={styles.primaryPill}
        >
          <View testID="locked-tab-create-account" style={styles.primaryPillInner}>
            <Text style={[styles.primaryPillText, { color: '#FFF' }]}>
              {config.primaryCTA}
            </Text>
          </View>
        </NibbleFeedback>

        <Pressable
          onPress={handleSecondary}
          testID="locked-tab-sign-in"
          style={styles.secondaryBtn}
          accessibilityLabel={config.secondaryCTA}
          accessibilityRole="button"
        >
          <Text style={[styles.secondaryBtnText, { color: Colors.primary }]}>
            {config.secondaryCTA}
          </Text>
        </Pressable>
      </Animated.View>
    </View>
  );
}

// ── Styles ──────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
    paddingBottom: 32,
  },
  heroBadgeWrap: {
    marginBottom: 28,
  },
  heroBadgeContainer: {
    width: BADGE_SIZE,
    height: BADGE_SIZE,
    borderRadius: BADGE_RADIUS,
    backgroundColor: Colors.surfaceElevated,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  headline: {
    fontSize: 24,
    fontWeight: '800' as const,
    color: Colors.text,
    textAlign: 'center',
    marginBottom: 10,
    lineHeight: 30,
  },
  body: {
    fontSize: 15,
    color: Colors.textSecondary,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 28,
    maxWidth: SCREEN_WIDTH * 0.78,
  },
  bulletsCard: {
    width: '100%',
    backgroundColor: Colors.card,
    borderRadius: 18,
    paddingVertical: 8,
    paddingHorizontal: 16,
    marginBottom: 28,
  },
  bulletRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
  },
  bulletLabel: {
    fontSize: 15,
    fontWeight: '600' as const,
    color: Colors.text,
    flex: 1,
  },
  bulletDivider: {
    borderTopWidth: 1,
    borderColor: Colors.border,
  },
  ctaWrap: {
    width: '100%',
    alignItems: 'center',
    gap: 12,
  },
  primaryPill: {
    width: '100%',
    borderRadius: 28,
    overflow: 'hidden',
  },
  primaryPillInner: {
    backgroundColor: '#E85D3A',
    borderRadius: 28,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryPillText: {
    fontSize: 16,
    fontWeight: '700' as const,
    color: '#FFF',
  },
  secondaryBtn: {
    paddingVertical: 10,
    paddingHorizontal: 16,
  },
  secondaryBtnText: {
    fontSize: 15,
    fontWeight: '600' as const,
    color: Colors.primary,
    textAlign: 'center',
  },
});
