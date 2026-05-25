// components/DecisiveResultView.tsx
import React, { useRef, useEffect, useState } from 'react';
import {
  View,
  Text,
  Pressable,
  Animated,
  Easing,
  AccessibilityInfo,
  StyleSheet,
  ScrollView,
  LayoutChangeEvent,
} from 'react-native';
import { Image } from 'expo-image';
import { Heart, ArrowLeft, UtensilsCrossed } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import StaticColors from '@/constants/colors';
import { useColors } from '@/context/ThemeContext';
import type { Restaurant } from '@/types';

// Module-level color alias — for StyleSheet.create() only (static)
const Colors = StaticColors;

// ── Props ────────────────────────────────────────────────────────────────────
export interface DecisiveResultViewProps {
  restaurant: Restaurant;
  isSaved: boolean;
  onToggleSave: (r: Restaurant) => void;
  onPlanDinner: () => void;
  onOpenDetail: () => void;
  onDirections: () => void;
  onSwipeAgain: () => void;
  onBack: () => void;
}

// ── SparkleBurst helper ──────────────────────────────────────────────────────
// 3-particle micro-burst at the ✨ glyph position.
// Pattern: NibbleFeedback.tsx crumb-burst (opacity 0→1→0 + translate outward).
// Single emission — hasAnimated ref guard.
// Module-level component; declares its own useColors() inside the function body.
function SparkleBurst({ cx, cy }: { cx: number; cy: number }) {
  const Colors = useColors();

  const hasAnimated = useRef(false);
  const burstRef = useRef<Animated.CompositeAnimation | null>(null);

  // 3 particles: each has opacity + translateX/Y
  const particles = useRef(
    Array.from({ length: 3 }, () => ({
      opacity: new Animated.Value(0),
      translateX: new Animated.Value(0),
      translateY: new Animated.Value(0),
    }))
  ).current;

  // Directions: spread 120° apart, offset by 30°
  const angles = [30, 150, 270].map(deg => (deg * Math.PI) / 180);
  const radius = 18;

  useEffect(() => {
    if (hasAnimated.current) return;
    hasAnimated.current = true;

    const animations = particles.map((p, i) => {
      const dx = Math.cos(angles[i]) * radius;
      const dy = Math.sin(angles[i]) * radius;

      return Animated.sequence([
        Animated.delay(i * 80),
        Animated.parallel([
          Animated.sequence([
            Animated.timing(p.opacity, { toValue: 1, duration: 150, useNativeDriver: true }),
            Animated.timing(p.opacity, { toValue: 0, duration: 450, useNativeDriver: true }),
          ]),
          Animated.timing(p.translateX, { toValue: dx, duration: 600, useNativeDriver: true }),
          Animated.timing(p.translateY, { toValue: dy, duration: 600, useNativeDriver: true }),
        ]),
      ]);
    });

    burstRef.current = Animated.parallel(animations);
    burstRef.current.start();

    return () => {
      burstRef.current?.stop();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <View
      style={{ position: 'absolute', left: cx - 2, top: cy - 2, pointerEvents: 'none' }}
      accessibilityElementsHidden
    >
      {particles.map((p, i) => (
        <Animated.View
          key={i}
          style={{
            position: 'absolute',
            width: 4,
            height: 4,
            borderRadius: 2,
            backgroundColor: Colors.primary,
            opacity: p.opacity,
            transform: [{ translateX: p.translateX }, { translateY: p.translateY }],
          }}
        />
      ))}
    </View>
  );
}

// ── Main component ───────────────────────────────────────────────────────────
export default function DecisiveResultView({
  restaurant,
  isSaved,
  onToggleSave,
  onPlanDinner,
  onOpenDetail,
  onDirections,
  onSwipeAgain,
  onBack,
}: DecisiveResultViewProps) {
  const Colors = useColors();

  // ── Reduced-motion — NibbleFeedback.tsx:62-73 pattern exactly ──────────────
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

  // ── Sparkle position from onLayout on the ✨ container ────────────────────
  const [sparklePos, setSparklePos] = useState<{ cx: number; cy: number } | null>(null);
  const handleSparkleLayout = (e: LayoutChangeEvent) => {
    const { x, y, width, height } = e.nativeEvent.layout;
    setSparklePos({ cx: x + width / 2, cy: y + height / 2 });
  };

  // ── Animation values ──────────────────────────────────────────────────────
  const heroScale = useRef(new Animated.Value(reduceMotion ? 1 : 0.92)).current;
  const heroOpacity = useRef(new Animated.Value(0)).current;
  const titleY = useRef(new Animated.Value(reduceMotion ? 0 : 8)).current;
  const titleOpacity = useRef(new Animated.Value(0)).current;
  const ctaOpacity = useRef(new Animated.Value(0)).current;
  const ctaScale = useRef(new Animated.Value(1.0)).current;
  // Wrapper opacity for reduced-motion fade
  const wrapperOpacity = useRef(new Animated.Value(reduceMotion ? 0 : 1)).current;

  // Animation handles for cleanup
  const heroEntranceRef = useRef<Animated.CompositeAnimation | null>(null);
  const ctaPulseRef = useRef<Animated.CompositeAnimation | null>(null);

  useEffect(() => {
    if (reduceMotion) {
      // Reduced motion: 200ms opacity fade only, all values already at final state
      heroEntranceRef.current = Animated.timing(wrapperOpacity, {
        toValue: 1,
        duration: 200,
        useNativeDriver: true,
      });
      heroEntranceRef.current.start();
      // Set all other animated values to final state immediately
      heroScale.setValue(1);
      heroOpacity.setValue(1);
      titleY.setValue(0);
      titleOpacity.setValue(1);
      ctaOpacity.setValue(1);
      ctaScale.setValue(1);
      return () => {
        heroEntranceRef.current?.stop();
      };
    }

    // Full entrance animation
    heroEntranceRef.current = Animated.parallel([
      Animated.spring(heroScale, { toValue: 1, tension: 80, friction: 8, useNativeDriver: true }),
      Animated.timing(heroOpacity, { toValue: 1, duration: 300, useNativeDriver: true }),
      Animated.timing(titleY, { toValue: 0, duration: 280, delay: 120, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      Animated.timing(titleOpacity, { toValue: 1, duration: 280, delay: 120, useNativeDriver: true }),
      Animated.timing(ctaOpacity, { toValue: 1, duration: 200, delay: 450, useNativeDriver: true }),
    ]);
    heroEntranceRef.current.start();

    ctaPulseRef.current = Animated.sequence([
      Animated.delay(800),
      Animated.spring(ctaScale, { toValue: 1.04, tension: 80, friction: 8, useNativeDriver: true }),
      Animated.spring(ctaScale, { toValue: 1.0, tension: 80, friction: 8, useNativeDriver: true }),
    ]);
    ctaPulseRef.current.start();

    return () => {
      heroEntranceRef.current?.stop();
      ctaPulseRef.current?.stop();
    };
  }, [reduceMotion]); // deps: re-run if reduce-motion flips after mount

  const showTagline = restaurant.description && restaurant.description.length > 0 && restaurant.description.length < 80;

  const containerAnimStyle = reduceMotion
    ? { opacity: wrapperOpacity }
    : {};

  return (
    <Animated.View style={[styles.outerContainer, { backgroundColor: Colors.background }, containerAnimStyle]}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Header row ──────────────────────────────────────────────────── */}
        <View style={styles.header}>
          <Pressable
            style={[styles.backBtn, { backgroundColor: Colors.card, borderColor: Colors.border }]}
            onPress={onBack}
            accessibilityRole="button"
            accessibilityLabel="Go back"
          >
            <ArrowLeft size={20} color={Colors.text} />
          </Pressable>
        </View>

        {/* ── Title block ─────────────────────────────────────────────────── */}
        <Animated.View
          style={[
            styles.titleBlock,
            { transform: [{ translateY: titleY }], opacity: titleOpacity },
          ]}
        >
          <Text style={[styles.titlePreamble, { color: Colors.textSecondary }]}>
            You're going with
          </Text>
          <View style={styles.titleNameRow}>
            <Text
              style={[styles.titleName, { color: Colors.text, flex: 1 }]}
              numberOfLines={2}
              ellipsizeMode="tail"
            >
              {restaurant.name}
              {'  '}
              <Text
                onLayout={handleSparkleLayout}
                style={{ color: Colors.primary }}
              >
                ✨
              </Text>
            </Text>
          </View>
        </Animated.View>

        {/* ── Hero photo card ──────────────────────────────────────────────── */}
        <Animated.View
          style={[
            styles.heroCard,
            { opacity: heroOpacity, transform: [{ scale: heroScale }] },
          ]}
        >
          {restaurant.imageUrl ? (
            <Image
              source={{ uri: restaurant.imageUrl }}
              style={styles.heroImage}
              contentFit="cover"
              transition={200}
            />
          ) : (
            <View style={[styles.heroImage, styles.heroFallback, { backgroundColor: Colors.primaryLight }]} />
          )}

          {/* Heart overlay */}
          <Pressable
            style={styles.heartOverlay}
            onPress={() => onToggleSave(restaurant)}
            accessibilityRole="button"
            accessibilityLabel={isSaved ? 'Remove from favorites' : 'Save to favorites'}
          >
            <Heart
              size={20}
              color={Colors.error}
              fill={isSaved ? Colors.error : 'transparent'}
            />
          </Pressable>
        </Animated.View>

        {/* ── Metadata line ────────────────────────────────────────────────── */}
        <Text
          style={[styles.metadata, { color: Colors.textSecondary }]}
          numberOfLines={1}
        >
          {restaurant.cuisine}
          {' · ⭐ '}
          {restaurant.rating}
          {' · '}
          {'$'.repeat(restaurant.priceLevel)}
          {' · '}
          {restaurant.distance}
        </Text>

        {/* ── Optional tagline ─────────────────────────────────────────────── */}
        {showTagline && (
          <Text
            style={[styles.tagline, { color: Colors.textSecondary }]}
            numberOfLines={1}
            ellipsizeMode="tail"
          >
            {restaurant.description}
          </Text>
        )}

        {/* ── Primary CTA ──────────────────────────────────────────────────── */}
        <Animated.View style={[styles.planCtaWrapper, { opacity: ctaOpacity, transform: [{ scale: ctaScale }] }]}>
          <Pressable
            style={[styles.planCta, { backgroundColor: Colors.primary }]}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
              onPlanDinner();
            }}
            testID="decisive-plan-cta"
            accessibilityRole="button"
            accessibilityLabel="Plan a meal here"
          >
            <UtensilsCrossed size={20} color="#FFF" />
            <Text style={styles.planCtaText}>Plan a meal here</Text>
          </Pressable>
        </Animated.View>

        {/* ── Secondary row ────────────────────────────────────────────────── */}
        <View style={styles.secondaryRow}>
          <Pressable
            style={[styles.secondaryBtn, { backgroundColor: Colors.card, borderColor: Colors.border }]}
            onPress={onOpenDetail}
            testID="decisive-open-cta"
            accessibilityRole="button"
            accessibilityLabel="Open restaurant detail"
          >
            <Text style={[styles.secondaryBtnText, { color: Colors.text }]}>Open</Text>
          </Pressable>
          <Pressable
            style={[styles.secondaryBtn, { backgroundColor: Colors.card, borderColor: Colors.border }]}
            onPress={onDirections}
            testID="decisive-directions-cta"
            accessibilityRole="button"
            accessibilityLabel="Get directions"
          >
            <Text style={[styles.secondaryBtnText, { color: Colors.text }]}>Directions</Text>
          </Pressable>
        </View>

        {/* ── Tertiary text link ───────────────────────────────────────────── */}
        <Pressable
          style={styles.swipeAgainLink}
          onPress={onSwipeAgain}
          accessibilityRole="button"
          accessibilityLabel="Swipe again"
        >
          <Text style={[styles.swipeAgainText, { color: Colors.textTertiary }]}>
            Changed your mind? Swipe again
          </Text>
        </Pressable>
      </ScrollView>

      {/* SparkleBurst — positioned absolutely relative to the outer container */}
      {!reduceMotion && sparklePos && (
        <SparkleBurst cx={sparklePos.cx} cy={sparklePos.cy} />
      )}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  outerContainer: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 32,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    backgroundColor: Colors.card,
    borderColor: Colors.border,
  },
  titleBlock: {
    marginTop: 20,
    marginHorizontal: 16,
  },
  titlePreamble: {
    fontSize: 22,
    fontWeight: '400',
    color: Colors.textSecondary,
  },
  titleNameRow: {
    flex: 1,
  },
  titleName: {
    fontSize: 28,
    fontWeight: '700',
    color: Colors.text,
    marginTop: 2,
  },
  heroCard: {
    marginHorizontal: 16,
    marginTop: 16,
    borderRadius: 16,
    overflow: 'hidden',
    position: 'relative',
  },
  heroImage: {
    width: '100%',
    height: 220,
    borderRadius: 16,
  },
  heroFallback: {
    backgroundColor: Colors.primaryLight,
  },
  heartOverlay: {
    position: 'absolute',
    top: 12,
    right: 12,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  metadata: {
    fontSize: 14,
    color: Colors.textSecondary,
    marginTop: 12,
    marginHorizontal: 16,
  },
  tagline: {
    fontSize: 14,
    fontStyle: 'italic',
    color: Colors.textSecondary,
    marginTop: 4,
    marginHorizontal: 16,
  },
  planCtaWrapper: {
    marginHorizontal: 16,
    marginTop: 24,
  },
  planCta: {
    height: 56,
    borderRadius: 28,
    backgroundColor: Colors.primary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  planCtaText: {
    color: '#FFF',
    fontSize: 17,
    fontWeight: '700',
  },
  secondaryRow: {
    flexDirection: 'row',
    gap: 12,
    marginHorizontal: 16,
    marginTop: 12,
  },
  secondaryBtn: {
    flex: 1,
    height: 48,
    borderRadius: 24,
    backgroundColor: Colors.card,
    borderWidth: 1.5,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryBtnText: {
    fontSize: 15,
    fontWeight: '600',
    color: Colors.text,
  },
  swipeAgainLink: {
    alignItems: 'center',
    marginTop: 24,
    marginBottom: 8,
  },
  swipeAgainText: {
    fontSize: 14,
    color: Colors.textTertiary,
    textDecorationLine: 'underline',
  },
});
