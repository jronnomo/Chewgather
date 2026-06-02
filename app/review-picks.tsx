// app/review-picks.tsx
//
// "Unpack your Doggy Bag" — post-signup curation screen.
// Reads pending picks on mount, lets the user toggle which become real Bites,
// then batch-promotes via promotePicks() (one backend write, not N).
//
// Only reachable from auth.tsx after a guest-originated signup with pending picks.
// Mount guard: if picks are empty (or non-guest direct-nav), redirect safely.
//
// Dark mode: two-level color system (module-level StaticColors + useColors() in component body).
// Reduced motion: GAP-4/GAP-5 — suppress card fly-up AND CrumbParticles burst.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import { ShoppingBag } from 'lucide-react-native';

import StaticColors from '../constants/colors';
import { useColors } from '../context/ThemeContext';
import { useApp } from '../context/AppContext';
import { readPendingPicks, clearPendingPicks } from '../lib/pendingPicks';
import PickRow from '../components/PickRow';
import ScallopDivider from '../components/ScallopDivider';
import CrumbParticles, { CrumbBurst, createBurst, animateBurst } from '../components/CrumbParticles';
import NibbleFeedback from '../components/NibbleFeedback';

import type { Restaurant } from '../types';

const Colors = StaticColors; // module-level for StyleSheet.create()

export default function ReviewPicksScreen() {
  const Colors = useColors(); // component-level — shadows module-level for reactive dark mode
  const router = useRouter();
  const queryClient = useQueryClient();
  const { isOnboarded, promotePicks } = useApp();

  // --------------------------------------------------------------------------
  // State
  // --------------------------------------------------------------------------
  const [picks, setPicks] = useState<Restaurant[]>([]);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [promoting, setPromoting] = useState(false);
  const [crumbBursts, setCrumbBursts] = useState<CrumbBurst[]>([]);
  const [reducedMotion, setReducedMotion] = useState(false);

  // --------------------------------------------------------------------------
  // Animation refs
  // --------------------------------------------------------------------------
  const headerOpacity = useRef(new Animated.Value(0)).current;
  const headerTranslateY = useRef(new Animated.Value(12)).current;
  const badgeScale = useRef(new Animated.Value(0)).current;
  // cardAnims allocated after picks are loaded (starts as [])
  const cardAnims = useRef<Animated.Value[]>([]).current;
  // flyAnims — dedicated translateY values for the promote fly-up (Frame 5).
  // One per card, init 0 (no offset). On promote, checked cards animate 0 → -200.
  const flyAnims = useRef<Animated.Value[]>([]).current;

  // --------------------------------------------------------------------------
  // Reduced-motion detection (GAP-4 / GAP-5)
  // --------------------------------------------------------------------------
  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReducedMotion);
  }, []);

  // --------------------------------------------------------------------------
  // Mount: load pending picks + entrance animations (MED-5 / GAP-6 guard)
  // --------------------------------------------------------------------------
  useEffect(() => {
    (async () => {
      const loaded = await readPendingPicks();

      if (loaded.length === 0) {
        // Defensive guard: auth.tsx checks first, but protect against direct nav
        // (e.g. deep link). Route to tabs if already onboarded, else onboarding.
        router.replace(isOnboarded ? '/(tabs)' as never : '/onboarding' as never);
        return;
      }

      setPicks(loaded);
      setChecked(new Set(loaded.map(r => r.id)));

      // Allocate one Animated.Value per card
      while (cardAnims.length < loaded.length) {
        cardAnims.push(new Animated.Value(0));
      }
      // Allocate fly-up values (one per card, start at 0 = no vertical offset)
      while (flyAnims.length < loaded.length) {
        flyAnims.push(new Animated.Value(0));
      }

      if (reducedMotion) {
        // Skip all positional/spring animations — apply only a short 150ms fade-in.
        // setValue(0) first so the timing animation actually plays from transparent.
        // Fix 2: was setValue(1) — a no-op that prevented the fade from running.
        headerOpacity.setValue(0);
        headerTranslateY.setValue(0);
        badgeScale.setValue(1);
        cardAnims.forEach(a => a.setValue(1));
        Animated.timing(headerOpacity, {
          toValue: 1,
          duration: 150,
          useNativeDriver: true,
        }).start();
      } else {
        // Frame 2 — 200ms: header + bag drop in
        Animated.parallel([
          Animated.timing(headerOpacity, {
            toValue: 1,
            duration: 300,
            delay: 200,
            useNativeDriver: true,
          }),
          Animated.timing(headerTranslateY, {
            toValue: 0,
            duration: 300,
            delay: 200,
            useNativeDriver: true,
          }),
          Animated.spring(badgeScale, {
            toValue: 1,
            tension: 120,
            friction: 6,
            delay: 200,
            useNativeDriver: true,
          }),
        ]).start(() => {
          // Frame 3 — 350–650ms: staggered card entrance (70ms gap, spring friction 7)
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          Animated.stagger(
            70,
            cardAnims.map(anim =>
              Animated.spring(anim, {
                toValue: 1,
                tension: 120,
                friction: 7,
                useNativeDriver: true,
              })
            )
          ).start();
        });
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --------------------------------------------------------------------------
  // Toggle a single pick's checked state
  // --------------------------------------------------------------------------
  const handleToggle = useCallback((id: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setChecked(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  // --------------------------------------------------------------------------
  // Skip — clear pending picks and route to onboarding
  // --------------------------------------------------------------------------
  const handleSkip = useCallback(async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    await clearPendingPicks();
    router.replace('/onboarding' as never);
  }, [router]);

  // --------------------------------------------------------------------------
  // Promote — batch-add checked picks to favorites, then navigate
  // --------------------------------------------------------------------------
  const promoteButtonRef = useRef<React.ComponentRef<typeof View>>(null);

  const handlePromote = useCallback(async () => {
    if (promoting) return;

    const toPromote = picks.filter(p => checked.has(p.id));

    // All-deselected: behave like skip
    if (toPromote.length === 0) {
      await handleSkip();
      return;
    }

    setPromoting(true);

    // Promote animation — Frame 5: cards fly up + fade (GAP-4: skip if reducedMotion)
    const checkedIndices = picks.reduce<number[]>((acc, p, i) => {
      if (checked.has(p.id)) acc.push(i);
      return acc;
    }, []);

    if (!reducedMotion) {
      // Selected cards fly UP (translateY 0 → -200) while fading out.
      // Blueprint Frame 5: "the bag tipping out" — cards leave upward, not downward.
      // Deselected cards just fade (cardAnims controls opacity; no fly needed).
      Animated.parallel(
        checkedIndices.flatMap(i => [
          Animated.timing(cardAnims[i], {
            toValue: 0,
            duration: 300,
            useNativeDriver: true,
          }),
          Animated.timing(flyAnims[i], {
            toValue: -200,
            duration: 300,
            useNativeDriver: true,
          }),
        ])
      ).start();
    } else {
      // Reduced motion: instant disappear — no fly, no fade animation (just set values)
      checkedIndices.forEach(i => {
        cardAnims[i].setValue(0);
        flyAnims[i].setValue(0); // no positional offset under reduced motion
      });
    }

    // CrumbParticles burst — GAP-5: suppress under reduced motion
    if (!reducedMotion) {
      promoteButtonRef.current?.measureInWindow((x, y, width, height) => {
        const cx = x + width / 2;
        const cy = y + height / 2;
        const seed = Date.now();
        const burst = createBurst(cx, cy, 6, Colors.primary, seed);
        setCrumbBursts(prev => [...prev, burst]);
        animateBurst(burst, seed);
      });
    }

    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

    // Core operations
    await promotePicks(toPromote);
    await clearPendingPicks();

    // Defensive: ensure onboarded state is fresh (guests are already onboarded at guest-entry
    // time, but invalidate to be safe against any edge-case state inconsistency — HIGH-2 / §6)
    queryClient.invalidateQueries({ queryKey: ['onboarded'] });

    // Route to profile tab so promoted picks are visible with BiteCard glow
    router.replace('/(tabs)/profile' as never);
  }, [promoting, picks, checked, reducedMotion, cardAnims, flyAnims, Colors.primary, promotePicks, queryClient, router, handleSkip]);

  // --------------------------------------------------------------------------
  // Derived values
  // --------------------------------------------------------------------------
  const checkedCount = checked.size;
  const isSinglePick = picks.length === 1;

  const title = isSinglePick ? "One spot's in your bag" : 'Unpack your Doggy Bag';
  const subCopy = isSinglePick
    ? 'You saved this while browsing. Add it to Your Bites to find it again anytime.'
    : `You picked these ${picks.length} spots while browsing. Pick the ones worth keeping in Your Bites.`;

  const primaryLabel = (() => {
    if (checkedCount === 0) return 'Skip for now';
    if (isSinglePick) return 'Add to Your Bites';
    return `Add ${checkedCount} to Your Bites`;
  })();

  const skipLabel = isSinglePick ? 'Not right now' : 'Skip for now';

  const allDeselected = checkedCount === 0 && picks.length > 0;

  return (
    <View testID="review-picks-screen" style={[styles.root, { backgroundColor: Colors.background }]}>
      {/* ScallopDivider header — scallops read against background */}
      <ScallopDivider color={Colors.card} />

      {/* Animated header section */}
      <Animated.View
        style={[
          styles.header,
          {
            opacity: headerOpacity,
            transform: [{ translateY: headerTranslateY }],
          },
        ]}
      >
        {/* Bag badge with spring scale */}
        <Animated.View
          style={[
            styles.badgeWrap,
            { backgroundColor: Colors.surfaceElevated, transform: [{ scale: badgeScale }] },
          ]}
        >
          <ShoppingBag size={32} color={Colors.primary} />
        </Animated.View>

        <Text style={[styles.title, { color: Colors.text }]}>{title}</Text>
        <Text style={[styles.subCopy, { color: Colors.textSecondary }]}>{subCopy}</Text>
      </Animated.View>

      {/* Pick list */}
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {picks.map((restaurant, idx) => (
          // Outer Animated.View drives the promote fly-up translateY (flyAnims).
          // Inner PickRow drives the entrance opacity + translateY (enterAnim / cardAnims).
          // Separating the two allows independent animation without re-architecting PickRow.
          <Animated.View
            key={restaurant.id}
            style={{ transform: [{ translateY: flyAnims[idx] ?? new Animated.Value(0) }] }}
          >
            <PickRow
              restaurant={restaurant}
              selected={checked.has(restaurant.id)}
              onToggle={() => handleToggle(restaurant.id)}
              enterAnim={cardAnims[idx] ?? new Animated.Value(1)}
            />
          </Animated.View>
        ))}

        {/* All-deselected state helper copy */}
        {allDeselected && (
          <Text style={[styles.allDeselectedHelper, { color: Colors.textSecondary }]}>
            No worries — your picks are always a swipe away.
          </Text>
        )}
      </ScrollView>

      {/* CrumbParticles burst — absolute overlay */}
      <CrumbParticles bursts={crumbBursts} />

      {/* CTA group */}
      <View style={styles.ctaGroup}>
        <NibbleFeedback
          onPress={handlePromote}
          disabled={promoting}
          style={[styles.promotePill, { backgroundColor: Colors.primary }]}
          accessibilityLabel={primaryLabel}
        >
          <View ref={promoteButtonRef} testID="review-picks-promote" style={styles.promotePillInner}>
            <Text style={styles.promotePillText}>{primaryLabel}</Text>
          </View>
        </NibbleFeedback>

        {/* Skip link — only shown when there are items to skip (hide if all deselected — pill already says "Skip for now") */}
        {!allDeselected && (
          <Pressable onPress={handleSkip} testID="review-picks-skip" style={styles.skipBtn} accessibilityLabel={skipLabel}>
            <Text style={[styles.skipText, { color: Colors.textSecondary }]}>{skipLabel}</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  header: {
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingBottom: 16,
    gap: 8,
  },
  badgeWrap: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: Colors.text,
    textAlign: 'center',
  },
  subCopy: {
    fontSize: 15,
    fontWeight: '400',
    color: Colors.textSecondary,
    textAlign: 'center',
    lineHeight: 22,
    paddingHorizontal: 8,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingVertical: 8,
    paddingBottom: 16,
  },
  allDeselectedHelper: {
    fontSize: 14,
    fontWeight: '400',
    color: Colors.textSecondary,
    textAlign: 'center',
    marginTop: 16,
    paddingHorizontal: 32,
  },
  ctaGroup: {
    paddingHorizontal: 24,
    paddingBottom: 40,
    paddingTop: 16,
    gap: 12,
    alignItems: 'center',
  },
  promotePill: {
    width: '100%',
    borderRadius: 16,
    backgroundColor: Colors.primary,
    overflow: 'hidden',
  },
  promotePillInner: {
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  promotePillText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFF',
  },
  skipBtn: {
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  skipText: {
    fontSize: 15,
    fontWeight: '500',
    color: Colors.textSecondary,
  },
});
