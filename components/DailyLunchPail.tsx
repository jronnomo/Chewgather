/**
 * Daily Lunch Pail — currently UNUSED in production.
 *
 * Originally built as the Home action surface (hinge-open pail with 4 food-token
 * tiles). Replaced by the Lazy Susan Carousel after round-1 failures: hid quick-
 * access actions, "Today's Surprise" wasn't actually surprising, notifications
 * disappeared when open. See issue #283 for the full postmortem.
 *
 * PRESERVED for repurpose as "Today's Pail" — a daily-rotating handpicked
 * restaurant-picks widget where the pail metaphor (a container holding today's
 * food) actually fits the content. See #283 for the proposed reuse design.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  LayoutAnimation,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  UIManager,
  View,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';
import {
  Sandwich,
  ClipboardList,
  Cookie,
  Dices,
  Sparkles,
  type LucideIcon,
} from 'lucide-react-native';
import StaticColors from '@/constants/colors';
import { useColors } from '@/context/ThemeContext';
import CrumbParticles, {
  animateBurst,
  createBurst,
  type CrumbBurst,
} from '@/components/CrumbParticles';
import type { TodaysSurprise } from '@/lib/todaysSurprise';

const Colors = StaticColors;

const HAS_OPENED_KEY = 'chewabl:pail-opened-once';

const PAIL_WIDTH = 320;
const LID_HEIGHT = 18;
const HANDLE_HEIGHT = 18;
const HANDLE_WIDTH = 88;
const CLOSED_BODY_HEIGHT = 130;
const OPEN_BODY_HEIGHT = 280;

if (Platform.OS === 'android') {
  UIManager.setLayoutAnimationEnabledExperimental?.(true);
}

interface DailyLunchPailProps {
  surprise: TodaysSurprise;
  unreadNotifications?: number;
  onPickSpot: () => void;
  onPlanFeast: () => void;
  onGroupChomp: () => void;
  onSurprise: () => void;
  onOpenNotifications?: () => void;
  testID?: string;
}

interface TokenSpec {
  key: 'pick' | 'feast' | 'chomp' | 'surprise';
  icon: LucideIcon;
  label: string;
  subtitle: string;
  onPress: () => void;
  testID: string;
  secondaryIcon?: LucideIcon;
}

export default function DailyLunchPail({
  surprise,
  unreadNotifications = 0,
  onPickSpot,
  onPlanFeast,
  onGroupChomp,
  onSurprise,
  onOpenNotifications,
  testID,
}: DailyLunchPailProps) {
  const Colors = useColors();
  const [isOpen, setIsOpen] = useState(false);
  const [hasOpenedBefore, setHasOpenedBefore] = useState<boolean | null>(null);
  const [reduceMotion, setReduceMotion] = useState(false);
  const [bursts, setBursts] = useState<CrumbBurst[]>([]);

  const lidTranslateY = useRef(new Animated.Value(0)).current;
  const lidOpacity = useRef(new Animated.Value(1)).current;
  const wobble = useRef(new Animated.Value(0)).current;
  const closedEmojiScale = useRef(new Animated.Value(1)).current;
  const tokenAnims = useRef(
    [0, 1, 2, 3].map(() => ({
      translateY: new Animated.Value(-20),
      opacity: new Animated.Value(0),
    })),
  ).current;

  // Reduced motion detection
  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion);
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => sub.remove();
  }, []);

  // Load first-open flag
  useEffect(() => {
    AsyncStorage.getItem(HAS_OPENED_KEY)
      .then(val => setHasOpenedBefore(val === 'true'))
      .catch(() => setHasOpenedBefore(true));
  }, []);

  // When reduced motion is on, render open immediately
  useEffect(() => {
    if (reduceMotion && !isOpen) {
      setIsOpen(true);
      lidTranslateY.setValue(-(LID_HEIGHT + HANDLE_HEIGHT + 20));
      lidOpacity.setValue(0);
      tokenAnims.forEach(t => {
        t.translateY.setValue(0);
        t.opacity.setValue(1);
      });
    }
  }, [reduceMotion, isOpen, lidTranslateY, lidOpacity, tokenAnims]);

  // Idle wobble on the closed pail (skipped under reduced motion)
  useEffect(() => {
    if (isOpen || reduceMotion) return;
    let cancelled = false;
    const loop = () => {
      if (cancelled) return;
      Animated.sequence([
        Animated.delay(6000),
        Animated.timing(wobble, {
          toValue: 1,
          duration: 180,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(wobble, {
          toValue: -1,
          duration: 320,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(wobble, {
          toValue: 0,
          duration: 180,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ]).start(({ finished }) => {
        if (finished && !cancelled) loop();
      });
    };
    loop();
    return () => {
      cancelled = true;
      wobble.stopAnimation();
    };
  }, [isOpen, reduceMotion, wobble]);

  // Gentle pulse on the closed-state emoji
  useEffect(() => {
    if (isOpen || reduceMotion) return;
    let cancelled = false;
    const loop = () => {
      if (cancelled) return;
      Animated.sequence([
        Animated.timing(closedEmojiScale, {
          toValue: 1.08,
          duration: 900,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(closedEmojiScale, {
          toValue: 1,
          duration: 900,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ]).start(({ finished }) => {
        if (finished && !cancelled) loop();
      });
    };
    loop();
    return () => {
      cancelled = true;
      closedEmojiScale.stopAnimation();
    };
  }, [isOpen, reduceMotion, closedEmojiScale]);

  const fireCrumbBurst = useCallback((color: string) => {
    const seed = Date.now() % 100000;
    const cx = PAIL_WIDTH / 2;
    const cy = LID_HEIGHT + HANDLE_HEIGHT + 6;
    const burst = createBurst(cx, cy, 16, color, seed);
    setBursts(prev => [...prev, burst]);
    animateBurst(burst, seed);
    setTimeout(() => {
      setBursts(prev => prev.filter(b => b.key !== burst.key));
    }, 700);
  }, []);

  const open = useCallback(() => {
    if (isOpen) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    if (!hasOpenedBefore) {
      AsyncStorage.setItem(HAS_OPENED_KEY, 'true').catch(() => {});
      setHasOpenedBefore(true);
    }

    // Animate height change with LayoutAnimation
    LayoutAnimation.configureNext({
      duration: 320,
      create: { type: 'easeOut', property: 'opacity' },
      update: { type: 'spring', springDamping: 0.75 },
    });
    setIsOpen(true);

    // Lid pops off: slides up + fades
    Animated.parallel([
      Animated.timing(lidTranslateY, {
        toValue: -(LID_HEIGHT + HANDLE_HEIGHT + 20),
        duration: 320,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(lidOpacity, {
        toValue: 0,
        duration: 280,
        useNativeDriver: true,
      }),
    ]).start();

    // Crumb burst at the seam
    setTimeout(() => fireCrumbBurst(Colors.primary), 80);

    // Tokens fade + slide in, staggered
    tokenAnims.forEach((t, i) => {
      t.translateY.setValue(-20);
      t.opacity.setValue(0);
      Animated.parallel([
        Animated.spring(t.translateY, {
          toValue: 0,
          tension: 80,
          friction: 7,
          delay: 180 + i * 60,
          useNativeDriver: true,
        }),
        Animated.timing(t.opacity, {
          toValue: 1,
          duration: 200,
          delay: 180 + i * 60,
          useNativeDriver: true,
        }),
      ]).start();
    });
  }, [
    isOpen,
    hasOpenedBefore,
    lidTranslateY,
    lidOpacity,
    tokenAnims,
    fireCrumbBurst,
    Colors.primary,
  ]);

  const collapse = useCallback(() => {
    if (!isOpen || reduceMotion) return;
    Haptics.selectionAsync();
    LayoutAnimation.configureNext({
      duration: 280,
      update: { type: 'easeInEaseOut' },
    });
    Animated.parallel([
      Animated.timing(lidTranslateY, { toValue: 0, duration: 280, useNativeDriver: true }),
      Animated.timing(lidOpacity, { toValue: 1, duration: 280, useNativeDriver: true }),
      ...tokenAnims.map(t =>
        Animated.timing(t.opacity, { toValue: 0, duration: 150, useNativeDriver: true }),
      ),
    ]).start();
    setIsOpen(false);
  }, [isOpen, reduceMotion, lidTranslateY, lidOpacity, tokenAnims]);

  const surpriseLabel = surprise.mode === 'curveball' ? 'Curveball' : 'Surprise';
  const surpriseSubtitle = surprise.label;

  const tokens: TokenSpec[] = useMemo(
    () => [
      {
        key: 'pick',
        icon: Sandwich,
        label: 'Pick a Spot',
        subtitle: 'Swipe for restaurants',
        onPress: onPickSpot,
        testID: 'pail-token-pick',
      },
      {
        key: 'feast',
        icon: ClipboardList,
        label: 'Plan a Feast',
        subtitle: 'Pick a date & place',
        onPress: onPlanFeast,
        testID: 'pail-token-feast',
      },
      {
        key: 'chomp',
        icon: Cookie,
        label: 'Group Chomp',
        subtitle: 'Decide with friends',
        onPress: onGroupChomp,
        testID: 'pail-token-chomp',
      },
      {
        key: 'surprise',
        icon: Dices,
        secondaryIcon: Sparkles,
        label: surpriseLabel,
        subtitle: surpriseSubtitle,
        onPress: onSurprise,
        testID: 'pail-token-surprise',
      },
    ],
    [onPickSpot, onPlanFeast, onGroupChomp, onSurprise, surpriseLabel, surpriseSubtitle],
  );

  const wobbleRotate = wobble.interpolate({
    inputRange: [-1, 0, 1],
    outputRange: ['-2deg', '0deg', '2deg'],
  });

  const showMicrocopy = !isOpen && hasOpenedBefore === false;
  const bodyHeight = isOpen ? OPEN_BODY_HEIGHT : CLOSED_BODY_HEIGHT;

  return (
    <View style={styles.container} testID={testID}>
      <Animated.View
        style={[
          styles.pailWrapper,
          { transform: [{ rotate: wobbleRotate }] },
        ]}
      >
        {/* Sticky note for unread notifications — tucked under the lid, right side */}
        {!isOpen && unreadNotifications > 0 && onOpenNotifications ? (
          <Animated.View
            style={[
              styles.stickyNoteWrapper,
              { opacity: lidOpacity },
            ]}
            pointerEvents="box-none"
          >
            <Pressable
              onPress={() => {
                Haptics.selectionAsync();
                onOpenNotifications();
              }}
              accessibilityRole="button"
              accessibilityLabel={`${unreadNotifications} unread notification${unreadNotifications === 1 ? '' : 's'}`}
              testID="pail-sticky-note"
              style={[
                styles.stickyNote,
                {
                  backgroundColor: Colors.secondaryLight,
                  borderColor: Colors.secondary,
                },
              ]}
            >
              <Text style={[styles.stickyNoteCount, { color: Colors.text }]}>
                {unreadNotifications > 99 ? '99+' : unreadNotifications}
              </Text>
              <Text style={[styles.stickyNoteLabel, { color: Colors.textSecondary }]}>
                {unreadNotifications === 1 ? 'note' : 'notes'}
              </Text>
            </Pressable>
          </Animated.View>
        ) : null}

        <Pressable
          onPress={!isOpen ? open : undefined}
          onLongPress={isOpen ? collapse : undefined}
          accessibilityRole="button"
          accessibilityLabel={
            isOpen
              ? "Today's Pail, open. Long-press to close."
              : "Today's Pail, tap to open."
          }
          accessibilityState={{ expanded: isOpen }}
        >
          {/* Lid (handle + lid stripe) — sits on top of body. Slides up + fades on open. */}
          <Animated.View
            style={[
              styles.lidStack,
              {
                transform: [{ translateY: lidTranslateY }],
                opacity: lidOpacity,
              },
            ]}
            pointerEvents="none"
          >
            {/* Chunky grip handle — solid, rounded top, flat bottom sits flush on lid bar */}
            <View
              style={[
                styles.handle,
                { backgroundColor: Colors.primary },
              ]}
            >
              <View style={[styles.handleHighlight, { backgroundColor: Colors.primaryLight }]} />
            </View>
            {/* Lid bar with latch dots */}
            <View
              style={[
                styles.lidBar,
                { backgroundColor: Colors.primary },
              ]}
            >
              <View style={[styles.latchDot, { backgroundColor: Colors.primaryDark }]} />
              <View style={[styles.latchDot, { backgroundColor: Colors.primaryDark }]} />
            </View>
          </Animated.View>

          {/* Pail body */}
          <View
            style={[
              styles.body,
              {
                height: bodyHeight,
                backgroundColor: Colors.card,
                borderColor: Colors.border,
              },
            ]}
          >
            {/* Top inset shadow (gives the lid-just-popped-off look) */}
            <View
              style={[
                styles.bodyTopInset,
                { backgroundColor: Colors.background },
              ]}
            />

            {!isOpen ? (
              <View style={styles.closedContent}>
                <Text style={[styles.pailHeader, { color: Colors.textSecondary }]}>
                  TODAY'S PAIL
                </Text>
                <Animated.Text
                  style={[
                    styles.closedEmoji,
                    { transform: [{ scale: closedEmojiScale }] },
                  ]}
                >
                  🍱
                </Animated.Text>
                <Text style={[styles.closedHint, { color: Colors.textSecondary }]}>
                  {showMicrocopy ? 'tap to open' : "what's today's bite?"}
                </Text>
              </View>
            ) : (
              <View style={styles.openContent}>
                <View style={styles.tokenGrid}>
                  {tokens.map((tok, i) => (
                    <TokenTile
                      key={tok.key}
                      spec={tok}
                      anim={tokenAnims[i]}
                      reduceMotion={reduceMotion}
                    />
                  ))}
                </View>
              </View>
            )}
          </View>
        </Pressable>
      </Animated.View>

      {/* Crumb particles overlay (positioned absolutely so it doesn't affect layout) */}
      <View style={styles.crumbLayer} pointerEvents="none">
        <CrumbParticles bursts={bursts} />
      </View>
    </View>
  );
}

interface TokenTileProps {
  spec: TokenSpec;
  anim: {
    translateY: Animated.Value;
    opacity: Animated.Value;
  };
  reduceMotion: boolean;
}

function TokenTile({ spec, anim, reduceMotion }: TokenTileProps) {
  const Colors = useColors();
  const scale = useRef(new Animated.Value(1)).current;
  const Icon = spec.icon;
  const SecondaryIcon = spec.secondaryIcon;

  const handlePress = () => {
    Haptics.selectionAsync();
    if (reduceMotion) {
      spec.onPress();
      return;
    }
    Animated.sequence([
      Animated.timing(scale, { toValue: 0.88, duration: 90, useNativeDriver: true }),
      Animated.timing(scale, { toValue: 0, duration: 110, useNativeDriver: true }),
    ]).start(() => {
      spec.onPress();
      scale.setValue(1);
    });
  };

  const isSurprise = spec.key === 'surprise';

  return (
    <Animated.View
      style={[
        styles.tokenWrapper,
        {
          opacity: anim.opacity,
          transform: [{ translateY: anim.translateY }, { scale }],
        },
      ]}
    >
      <Pressable
        onPress={handlePress}
        accessibilityRole="button"
        accessibilityLabel={`${spec.label}. ${spec.subtitle}`}
        testID={spec.testID}
        style={[
          styles.token,
          {
            backgroundColor: isSurprise ? Colors.primaryLight : Colors.background,
            borderColor: isSurprise ? Colors.primary : Colors.border,
          },
        ]}
      >
        <View style={styles.tokenIconRow}>
          <Icon size={26} color={isSurprise ? Colors.primary : Colors.text} />
          {SecondaryIcon ? (
            <SecondaryIcon size={14} color={Colors.secondary} style={styles.secondaryIcon} />
          ) : null}
        </View>
        <Text
          style={[styles.tokenLabel, { color: Colors.text }]}
          numberOfLines={1}
        >
          {spec.label}
        </Text>
        <Text
          style={[styles.tokenSubtitle, { color: Colors.textSecondary }]}
          numberOfLines={1}
        >
          {spec.subtitle}
        </Text>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
    alignItems: 'center',
    marginBottom: 16,
  },
  pailWrapper: {
    width: PAIL_WIDTH,
    alignItems: 'center',
  },
  crumbLayer: {
    ...StyleSheet.absoluteFillObject,
  },
  stickyNoteWrapper: {
    position: 'absolute',
    top: -28,
    right: 16,
    zIndex: 3,
    transform: [{ rotate: '8deg' }],
  },
  stickyNote: {
    width: 56,
    height: 56,
    borderRadius: 4,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.18,
    shadowRadius: 4,
    elevation: 4,
  },
  stickyNoteCount: {
    fontSize: 20,
    fontWeight: '800' as const,
    lineHeight: 22,
  },
  stickyNoteLabel: {
    fontSize: 9,
    fontWeight: '600' as const,
    letterSpacing: 0.5,
    textTransform: 'uppercase' as const,
    marginTop: -1,
  },
  lidStack: {
    width: PAIL_WIDTH,
    alignItems: 'center',
    marginBottom: 0,
    zIndex: 2,
  },
  handle: {
    width: HANDLE_WIDTH,
    height: HANDLE_HEIGHT,
    borderTopLeftRadius: 10,
    borderTopRightRadius: 10,
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
    marginBottom: 0,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 2,
    elevation: 2,
  },
  handleHighlight: {
    position: 'absolute',
    top: 3,
    left: 8,
    right: 8,
    height: 3,
    borderRadius: 2,
    opacity: 0.6,
  },
  lidBar: {
    width: '100%',
    height: LID_HEIGHT + 6,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 28,
  },
  latchDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  body: {
    width: PAIL_WIDTH,
    borderTopLeftRadius: 0,
    borderTopRightRadius: 0,
    borderBottomLeftRadius: 20,
    borderBottomRightRadius: 20,
    borderWidth: 2,
    borderTopWidth: 0,
    paddingHorizontal: 14,
    paddingTop: 14,
    paddingBottom: 14,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
  },
  bodyTopInset: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 4,
    opacity: 0.6,
  },
  closedContent: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 4,
  },
  pailHeader: {
    fontSize: 11,
    fontWeight: '700' as const,
    letterSpacing: 1.5,
  },
  closedEmoji: {
    fontSize: 56,
  },
  closedHint: {
    fontSize: 12,
    fontStyle: 'italic' as const,
  },
  openContent: {
    flex: 1,
    paddingTop: 4,
  },
  tokenGrid: {
    flex: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    alignContent: 'space-between',
  },
  tokenWrapper: {
    width: '48.5%',
    height: '48%',
  },
  token: {
    flex: 1,
    borderRadius: 14,
    borderWidth: 1.5,
    padding: 10,
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  tokenIconRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 4,
  },
  secondaryIcon: {
    marginTop: -2,
  },
  tokenLabel: {
    fontSize: 14,
    fontWeight: '700' as const,
  },
  tokenSubtitle: {
    fontSize: 11,
    fontWeight: '500' as const,
  },
});
