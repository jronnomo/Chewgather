import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  LayoutAnimation,
  PanResponder,
  Platform,
  Pressable,
  StyleSheet,
  UIManager,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import Svg, { Defs, LinearGradient as SvgLinearGradient, Mask, Path, Rect, Stop } from 'react-native-svg';
import * as Haptics from 'expo-haptics';
import {
  Sandwich,
  ClipboardList,
  Cookie,
  Wine,
  Coffee,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  Sparkles,
  ArrowLeft,
  type LucideIcon,
} from 'lucide-react-native';
import StaticColors from '@/constants/colors';
import { useColors } from '@/context/ThemeContext';
import AppText from '@/components/AppText';
import CrumbParticles, {
  animateBurst,
  createBurst,
  type CrumbBurst,
} from '@/components/CrumbParticles';
import { pickCurveball } from '@/lib/curveballPick';
import { getSpecialHoursStatus, formatHour12, type SpecialHoursStatus } from '@/lib/restaurantHours';
import type { Restaurant } from '@/types';

const Colors = StaticColors;

const TENT_WIDTH = 320;
// Tent height grows with Happy Hour content so the empty state doesn't leave
// a gaping gap, but the flip footer never overflows. Both faces use the same
// height so the flip animation doesn't morph mid-rotation.
//
// Sizing math (approximate):
//   - padding 14 top/bottom              =  28
//   - MENU header                        =  32
//   - 3 menu rows (~54pt each)           = 162
//   - Happy Hour section                 = varies
//   - footer divider + margins           =  25
//   - flip footer pressable              =  52
//   Total non-HH                         = 299
//
// Empty HH state (~64pt): 299 + 64 = ~363   → 380 with breathing room
// 4 HH rows (~230pt):     299 + 230 = ~530  → 560 with breathing room
const TENT_HEIGHT_COMPACT = 350;
const TENT_HEIGHT_EXPANDED = 505;
const SCRATCH_AREA_HEIGHT = 220;
const SCRATCH_BRUSH_WIDTH = 38;
const SCRATCH_GRID_COLS = 8;
const SCRATCH_GRID_ROWS = 6;
const REVEAL_THRESHOLD = 0.4;
const HAPTIC_DISTANCE = 18;

interface MenuTentProps {
  /** Pool of restaurants to draw the scratch reveal from. */
  restaurants: readonly Restaurant[];
  /** User cuisines for off-cuisine bias on the scratch reveal. */
  userCuisines?: readonly string[];
  onPickSpot: () => void;
  onPlanFeast: () => void;
  onGroupChomp: () => void;
  /** Called when user taps a Happy Hour OR Brunch row to open that restaurant's detail. */
  onSpecialTap?: (restaurant: Restaurant) => void;
  /** Called when user confirms the scratched restaurant (e.g. opens detail). */
  onRevealConfirm?: (restaurant: Restaurant) => void;
  /**
   * Fired when the user starts scratching. Parent should disable its
   * ScrollView's scrollEnabled — otherwise the ScrollView captures the
   * vertical drag and the scratch never fires.
   */
  onScratchStart?: () => void;
  /** Fired when the scratch gesture ends. Parent should re-enable scroll. */
  onScratchEnd?: () => void;
  /**
   * Fired when the reveal threshold is hit — parent should render full-screen
   * confetti at the root layer so it can rain past the tent's bounds.
   */
  onCelebrate?: () => void;
  testID?: string;
}

interface MenuRowSpec {
  key: 'pick' | 'feast' | 'chomp';
  icon: LucideIcon;
  label: string;
  subtitle: string;
  onPress: () => void;
  testID: string;
}

interface SpecialItem {
  restaurant: Restaurant;
  status: SpecialHoursStatus;
}

type SpecialKind = 'happyHour' | 'brunch';

const MAX_HAPPY_HOUR_ITEMS = 3;
const MAX_BRUNCH_ITEMS = 3;
const DEFAULT_VISIBLE_PER_SECTION = 1;
// Minimum tent height when the scratch reveal is showing a restaurant card.
// Reveal content (eyebrow + image card + Pick + Try Another + back to menu)
// needs ~380pt with breathing room; below this, the "back to menu" link
// would clip out the bottom of the card.
const TENT_HEIGHT_REVEAL_MIN = 370;

if (Platform.OS === 'android') {
  UIManager.setLayoutAnimationEnabledExperimental?.(true);
}
// Height grows by this amount per special-section row (HH + brunch combined).
// Tuned so 4 HH items (1 section) → TENT_HEIGHT_EXPANDED (≈ 505).
const HEIGHT_PER_SPECIAL_ROW = 39;
// When a second section is active (e.g. both HH and Brunch render), add
// overhead for its header rule (the per-row constant alone doesn't cover it).
const SECOND_SECTION_HEADER_OVERHEAD = 32;

/**
 * MenuTent — Home action surface as a printed restaurant menu.
 *
 * Front face: 4 menu rows (Pick / Feast / Chomp / Curveball) always visible
 * as tappable lines + a "flip for today's bite" footer.
 *
 * Back face (after flip): a silver foil scratch panel. User physically drags
 * a finger across — SVG path mask tracks the drag, selection haptic every
 * ~18pt of distance. At ~40% reveal, foil shatters into crumb particles,
 * confetti fires, and a Curveball restaurant card emerges.
 *
 * Reduced motion: no flip, no scratch — tap the surprise footer to
 * instantly reveal.
 */
export default function MenuTent({
  restaurants,
  userCuisines,
  onPickSpot,
  onPlanFeast,
  onGroupChomp,
  onSpecialTap,
  onRevealConfirm,
  onScratchStart,
  onScratchEnd,
  onCelebrate,
  testID,
}: MenuTentProps) {
  const Colors = useColors();
  const [reduceMotion, setReduceMotion] = useState(false);
  const [isFlipped, setIsFlipped] = useState(false);
  const [isRevealed, setIsRevealed] = useState(false);
  const [revealedRestaurant, setRevealedRestaurant] = useState<Restaurant | null>(null);
  const [scratchPath, setScratchPath] = useState('');
  const [scratchedCells, setScratchedCells] = useState<Set<number>>(new Set());
  const [bursts, setBursts] = useState<CrumbBurst[]>([]);

  const flipAnim = useRef(new Animated.Value(0)).current;
  const footerPulse = useRef(new Animated.Value(1)).current;

  const lastHapticPointRef = useRef<{ x: number; y: number } | null>(null);
  const scratchedCellsRef = useRef<Set<number>>(new Set());
  const revealFiredRef = useRef(false);
  // Accumulating history of all restaurant IDs shown this scratch session.
  // Reset on flipToFront / resetScratch so a new session starts fresh.
  const revealHistoryRef = useRef<string[]>([]);

  // Independent expand/collapse for each specials section.
  const [happyHourExpanded, setHappyHourExpanded] = useState(false);
  const [brunchExpanded, setBrunchExpanded] = useState(false);

  // Reduced motion detection
  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion);
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => sub.remove();
  }, []);

  // Pulse on the "flip" footer to draw attention
  useEffect(() => {
    if (isFlipped || reduceMotion) return;
    let cancelled = false;
    const loop = () => {
      if (cancelled) return;
      Animated.sequence([
        Animated.timing(footerPulse, {
          toValue: 1.06,
          duration: 900,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(footerPulse, {
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
      footerPulse.stopAnimation();
    };
  }, [isFlipped, reduceMotion, footerPulse]);

  const fireCrumbBurst = useCallback((cx: number, cy: number, color: string, count: number) => {
    const seed = Date.now() % 100000;
    const burst = createBurst(cx, cy, count, color, seed);
    setBursts(prev => [...prev, burst]);
    animateBurst(burst, seed);
    setTimeout(() => {
      setBursts(prev => prev.filter(b => b.key !== burst.key));
    }, 900);
  }, []);

  const resetScratch = useCallback(() => {
    setScratchPath('');
    setScratchedCells(new Set());
    scratchedCellsRef.current = new Set();
    lastHapticPointRef.current = null;
    revealFiredRef.current = false;
    revealHistoryRef.current = [];
    setIsRevealed(false);
    setRevealedRestaurant(null);
  }, []);

  const flipToBack = useCallback(() => {
    if (isFlipped) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    // Lock parent scroll IMMEDIATELY on flip — before any scratch gesture
    // can race against ScrollView's native pan recognizer. (Previously fired
    // inside the scratch PanResponder grant, which lagged one frame.)
    onScratchStart?.();
    resetScratch();
    setIsFlipped(true);
    if (reduceMotion) {
      flipAnim.setValue(1);
      return;
    }
    Animated.timing(flipAnim, {
      toValue: 1,
      duration: 460,
      easing: Easing.inOut(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [isFlipped, reduceMotion, flipAnim, resetScratch, onScratchStart]);

  const flipToFront = useCallback(() => {
    if (!isFlipped) return;
    Haptics.selectionAsync();
    // Defensive: any in-flight gesture is being abandoned by the flip — release
    // the scroll lock so the parent ScrollView isn't stuck disabled.
    onScratchEnd?.();
    if (reduceMotion) {
      flipAnim.setValue(0);
      setIsFlipped(false);
      resetScratch();
      return;
    }
    Animated.timing(flipAnim, {
      toValue: 0,
      duration: 380,
      easing: Easing.inOut(Easing.cubic),
      useNativeDriver: true,
    }).start(() => {
      setIsFlipped(false);
      resetScratch();
    });
  }, [isFlipped, reduceMotion, flipAnim, resetScratch, onScratchEnd]);

  const fireReveal = useCallback(() => {
    if (revealFiredRef.current) return;
    revealFiredRef.current = true;
    const picked = pickCurveball(restaurants, { userCuisines });
    if (picked) revealHistoryRef.current = [picked.id];
    // Smoothly animate the tent height growing to fit the reveal card.
    LayoutAnimation.configureNext(LayoutAnimation.create(
      280,
      LayoutAnimation.Types.easeOut,
      LayoutAnimation.Properties.opacity,
    ));
    setRevealedRestaurant(picked);
    setIsRevealed(true);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    fireCrumbBurst(TENT_WIDTH / 2, SCRATCH_AREA_HEIGHT / 2, Colors.secondary, 22);
    // Hand celebration off to the parent so it can render confetti at the
    // screen root, raining past the tent's bounds.
    onCelebrate?.();
    // Scroll stays locked through the reveal — released on flipToFront.
  }, [restaurants, userCuisines, Colors.secondary, fireCrumbBurst, onCelebrate]);

  // Map a touch point to a grid cell index
  const cellIndexFor = useCallback((x: number, y: number): number | null => {
    if (x < 0 || x >= TENT_WIDTH || y < 0 || y >= SCRATCH_AREA_HEIGHT) return null;
    const col = Math.floor((x / TENT_WIDTH) * SCRATCH_GRID_COLS);
    const row = Math.floor((y / SCRATCH_AREA_HEIGHT) * SCRATCH_GRID_ROWS);
    return row * SCRATCH_GRID_COLS + col;
  }, []);

  const scratchPanResponder = useMemo(
    () =>
      PanResponder.create({
        // Claim on touch START in both capture + bubble phases so parent
        // ScrollView can't steal the gesture mid-drag.
        onStartShouldSetPanResponder: () => isFlipped && !isRevealed && !reduceMotion,
        onStartShouldSetPanResponderCapture: () => isFlipped && !isRevealed && !reduceMotion,
        onMoveShouldSetPanResponder: () => isFlipped && !isRevealed && !reduceMotion,
        onMoveShouldSetPanResponderCapture: () => isFlipped && !isRevealed && !reduceMotion,
        // Hold onto the gesture even if ScrollView asks for it.
        onPanResponderTerminationRequest: () => false,
        onShouldBlockNativeResponder: () => true,
        onPanResponderGrant: (evt) => {
          const { locationX, locationY } = evt.nativeEvent;
          // Scroll lock is already engaged from flipToBack — no need here.
          lastHapticPointRef.current = { x: locationX, y: locationY };
          setScratchPath(`M ${locationX} ${locationY}`);
          const cellIdx = cellIndexFor(locationX, locationY);
          if (cellIdx !== null && !scratchedCellsRef.current.has(cellIdx)) {
            scratchedCellsRef.current.add(cellIdx);
            setScratchedCells(new Set(scratchedCellsRef.current));
          }
        },
        onPanResponderMove: (evt) => {
          const { locationX, locationY } = evt.nativeEvent;
          setScratchPath(prev => `${prev} L ${locationX} ${locationY}`);

          // Haptic every HAPTIC_DISTANCE pixels of drag
          const last = lastHapticPointRef.current;
          if (last) {
            const dx = locationX - last.x;
            const dy = locationY - last.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist >= HAPTIC_DISTANCE) {
              Haptics.selectionAsync();
              lastHapticPointRef.current = { x: locationX, y: locationY };
            }
          }

          // Track cell coverage
          const cellIdx = cellIndexFor(locationX, locationY);
          if (cellIdx !== null && !scratchedCellsRef.current.has(cellIdx)) {
            scratchedCellsRef.current.add(cellIdx);
            setScratchedCells(new Set(scratchedCellsRef.current));

            // Check reveal threshold
            const totalCells = SCRATCH_GRID_COLS * SCRATCH_GRID_ROWS;
            const coverage = scratchedCellsRef.current.size / totalCells;
            if (coverage >= REVEAL_THRESHOLD) {
              fireReveal();
            }
          }
        },
        onPanResponderRelease: () => {
          lastHapticPointRef.current = null;
          // Scroll stays locked until flipToFront — user is still on back face.
        },
        onPanResponderTerminate: () => {
          lastHapticPointRef.current = null;
        },
      }),
    [isFlipped, isRevealed, reduceMotion, cellIndexFor, fireReveal],
  );

  const handleTapToReveal = useCallback(() => {
    // Reduced-motion + accessibility shortcut: skip scratching, reveal immediately
    fireReveal();
  }, [fireReveal]);

  const handleConfirmReveal = useCallback(() => {
    if (!revealedRestaurant) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    onRevealConfirm?.(revealedRestaurant);
    flipToFront();
  }, [revealedRestaurant, onRevealConfirm, flipToFront]);

  const handleShuffleReveal = useCallback(() => {
    Haptics.selectionAsync();
    const picked = pickCurveball(restaurants, {
      excludeIds: revealHistoryRef.current,
      userCuisines,
    });
    if (!picked) {
      // Every nearby curveball has been shown this session.
      setRevealedRestaurant(null);
      return;
    }
    revealHistoryRef.current = [...revealHistoryRef.current, picked.id];
    setRevealedRestaurant(picked);
  }, [restaurants, userCuisines]);

  const rows: MenuRowSpec[] = useMemo(
    () => [
      { key: 'pick', icon: Sandwich, label: 'Pick a Spot', subtitle: 'Swipe for restaurants', onPress: onPickSpot, testID: 'menu-tent-pick' },
      { key: 'feast', icon: ClipboardList, label: 'Plan a Feast', subtitle: 'Pick a date & place', onPress: onPlanFeast, testID: 'menu-tent-feast' },
      { key: 'chomp', icon: Cookie, label: 'Group Chomp', subtitle: 'Decide with friends', onPress: onGroupChomp, testID: 'menu-tent-chomp' },
    ],
    [onPickSpot, onPlanFeast, onGroupChomp],
  );

  // Compute Happy Hour + Brunch items from nearby restaurants. Each section
  // is hidden cleanly when no qualifying restaurants exist.
  const { happyHourItems, brunchItems } = useMemo(() => {
    const now = new Date();
    return {
      happyHourItems: collectSpecialItems(restaurants, 'happyHour', now, MAX_HAPPY_HOUR_ITEMS),
      brunchItems: collectSpecialItems(restaurants, 'brunch', now, MAX_BRUNCH_ITEMS),
    };
  }, [restaurants]);

  // Flip rotations: front rotates 0 → 180, back rotates -180 → 0 (so it lands face-up)
  const frontRotate = flipAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '180deg'],
  });
  const backRotate = flipAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['180deg', '360deg'],
  });
  // Front opacity: fully visible 0–0.5, then 0 (don't show back-of-front-face)
  const frontOpacity = flipAnim.interpolate({
    inputRange: [0, 0.5, 0.51, 1],
    outputRange: [1, 1, 0, 0],
  });
  const backOpacity = flipAnim.interpolate({
    inputRange: [0, 0.49, 0.5, 1],
    outputRange: [0, 0, 1, 1],
  });

  // Visible counts respect expansion state. Default = 1 per section, expanded
  // = full (capped by MAX_*_ITEMS).
  const visibleHHCount = happyHourExpanded
    ? happyHourItems.length
    : Math.min(DEFAULT_VISIBLE_PER_SECTION, happyHourItems.length);
  const visibleBrunchCount = brunchExpanded
    ? brunchItems.length
    : Math.min(DEFAULT_VISIBLE_PER_SECTION, brunchItems.length);
  const visibleHappyHour = happyHourItems.slice(0, visibleHHCount);
  const visibleBrunch = brunchItems.slice(0, visibleBrunchCount);

  const happyHourHasMore = happyHourItems.length > DEFAULT_VISIBLE_PER_SECTION;
  const brunchHasMore = brunchItems.length > DEFAULT_VISIBLE_PER_SECTION;

  const totalVisibleRows = visibleHHCount + visibleBrunchCount;
  const sectionsActive =
    (happyHourItems.length > 0 ? 1 : 0) + (brunchItems.length > 0 ? 1 : 0);
  const expandButtonsVisible =
    (happyHourHasMore ? 1 : 0) + (brunchHasMore ? 1 : 0);

  const baseTentHeight =
    totalVisibleRows === 0
      ? TENT_HEIGHT_COMPACT
      : TENT_HEIGHT_COMPACT +
        totalVisibleRows * HEIGHT_PER_SPECIAL_ROW +
        Math.max(0, sectionsActive - 1) * SECOND_SECTION_HEADER_OVERHEAD +
        expandButtonsVisible * 30;
  // When the back face is showing the revealed restaurant card, ensure the
  // tent is tall enough that "back to menu" doesn't clip off the bottom.
  const tentHeight = isRevealed
    ? Math.max(baseTentHeight, TENT_HEIGHT_REVEAL_MIN)
    : baseTentHeight;

  const toggleHappyHour = useCallback(() => {
    LayoutAnimation.configureNext(LayoutAnimation.create(
      220,
      LayoutAnimation.Types.easeInEaseOut,
      LayoutAnimation.Properties.opacity,
    ));
    Haptics.selectionAsync();
    setHappyHourExpanded(prev => !prev);
  }, []);

  const toggleBrunch = useCallback(() => {
    LayoutAnimation.configureNext(LayoutAnimation.create(
      220,
      LayoutAnimation.Types.easeInEaseOut,
      LayoutAnimation.Properties.opacity,
    ));
    Haptics.selectionAsync();
    setBrunchExpanded(prev => !prev);
  }, []);

  return (
    <View style={styles.container} testID={testID}>
      <View style={[styles.tentWrapper, { width: TENT_WIDTH, height: tentHeight }]}>
        {/* FRONT FACE — menu */}
        <Animated.View
          style={[
            styles.face,
            { height: tentHeight },
            {
              backgroundColor: Colors.card,
              borderColor: Colors.border,
              opacity: frontOpacity,
              transform: [{ perspective: 1000 }, { rotateY: frontRotate }],
            },
          ]}
          pointerEvents={isFlipped ? 'none' : 'auto'}
        >
          <View style={styles.menuHeader}>
            <View style={[styles.menuRule, { backgroundColor: Colors.primary, opacity: 0.4 }]} />
            <AppText variant="dense" style={[styles.menuTitle, { color: Colors.primary }]}>MENU</AppText>
            <View style={[styles.menuRule, { backgroundColor: Colors.primary, opacity: 0.4 }]} />
          </View>

          {rows.map((row, i) => (
            <MenuRow key={row.key} spec={row} isLast={i === rows.length - 1} />
          ))}

          {happyHourItems.length > 0 && (
            <SpecialSection
              title="HAPPY HOUR"
              icon={Wine}
              items={visibleHappyHour}
              onTapItem={r => onSpecialTap?.(r)}
              hasMore={happyHourHasMore}
              isExpanded={happyHourExpanded}
              hiddenCount={happyHourItems.length - visibleHHCount}
              onToggle={toggleHappyHour}
            />
          )}
          {brunchItems.length > 0 && (
            <SpecialSection
              title="BRUNCH"
              icon={Coffee}
              items={visibleBrunch}
              onTapItem={r => onSpecialTap?.(r)}
              hasMore={brunchHasMore}
              isExpanded={brunchExpanded}
              hiddenCount={brunchItems.length - visibleBrunchCount}
              onToggle={toggleBrunch}
            />
          )}

          <View style={[styles.footerDivider, { backgroundColor: Colors.border }]} />

          <Animated.View style={{ transform: [{ scale: footerPulse }] }}>
            <Pressable
              onPress={flipToBack}
              accessibilityRole="button"
              accessibilityLabel="Flip menu to scratch for today's bite"
              testID="menu-tent-flip"
              style={[
                styles.flipFooter,
                {
                  backgroundColor: Colors.primaryLight,
                  borderColor: Colors.primary,
                },
              ]}
            >
              <Sparkles size={14} color={Colors.primary} />
              <AppText variant="dense" style={[styles.flipFooterText, { color: Colors.primary }]}>
                flip for today's bite
              </AppText>
              <Sparkles size={14} color={Colors.primary} />
            </Pressable>
          </Animated.View>
        </Animated.View>

        {/* BACK FACE — scratch / reveal. Only mounted while flipped to prevent
            leak-through (iOS doesn't always respect backfaceVisibility +
            opacity 0 when both faces are absolute-positioned at same coords). */}
        {isFlipped && (
        <Animated.View
          style={[
            styles.face,
            styles.faceBack,
            { height: tentHeight },
            {
              backgroundColor: Colors.card,
              borderColor: Colors.border,
              opacity: backOpacity,
              transform: [{ perspective: 1000 }, { rotateY: backRotate }],
            },
          ]}
          pointerEvents={isFlipped ? 'auto' : 'none'}
        >
          {!isRevealed ? (
            <View style={styles.scratchHost}>
              <AppText variant="dense" style={[styles.scratchHint, { color: Colors.textSecondary }]}>
                {reduceMotion ? "TAP TO REVEAL TODAY'S BITE" : "SCRATCH TO REVEAL"}
              </AppText>

              <View
                {...scratchPanResponder.panHandlers}
                style={[styles.scratchPanel, { borderColor: Colors.border }]}
              >
                {/* What's underneath (revealed by scratch) */}
                <View style={[styles.underPanel, { backgroundColor: Colors.background }]}>
                  <AppText variant="body" style={[styles.underHint, { color: Colors.textSecondary }]}>
                    today's bite is in here…
                  </AppText>
                </View>

                {/* Silver foil with scratch mask */}
                <Svg
                  width={TENT_WIDTH - 28}
                  height={SCRATCH_AREA_HEIGHT}
                  style={StyleSheet.absoluteFill}
                  pointerEvents="none"
                >
                  <Defs>
                    <SvgLinearGradient id="foil" x1="0" y1="0" x2="1" y2="1">
                      <Stop offset="0" stopColor="#C9CDD3" />
                      <Stop offset="0.5" stopColor="#9CA3AF" />
                      <Stop offset="1" stopColor="#6B7280" />
                    </SvgLinearGradient>
                    <Mask id="scratchMask">
                      <Rect width="100%" height="100%" fill="white" />
                      {scratchPath !== '' && (
                        <Path
                          d={scratchPath}
                          stroke="black"
                          strokeWidth={SCRATCH_BRUSH_WIDTH}
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          fill="none"
                        />
                      )}
                    </Mask>
                  </Defs>
                  <Rect
                    width="100%"
                    height="100%"
                    fill="url(#foil)"
                    mask="url(#scratchMask)"
                  />
                </Svg>
              </View>

              {/* Tap-to-reveal shortcut (always available, more emphasized under reduced motion) */}
              <Pressable
                onPress={handleTapToReveal}
                accessibilityRole="button"
                accessibilityLabel="Reveal today's bite immediately"
                style={[
                  styles.tapToRevealBtn,
                  reduceMotion ? styles.tapToRevealBtnPrimary : null,
                  { borderColor: Colors.border, backgroundColor: reduceMotion ? Colors.primary : 'transparent' },
                ]}
              >
                <AppText
                  variant="dense"
                  style={[
                    styles.tapToRevealText,
                    { color: reduceMotion ? '#FFFFFF' : Colors.textSecondary },
                  ]}
                >
                  {reduceMotion ? '🎲 Reveal' : 'or tap to skip the scratching'}
                </AppText>
              </Pressable>
            </View>
          ) : (
            <View style={styles.revealHost}>
              <AppText variant="dense" style={[styles.revealEyebrow, { color: Colors.primary }]}>
                TODAY'S BITE
              </AppText>
              {revealedRestaurant ? (
                <View style={[styles.revealCard, { backgroundColor: Colors.background, borderColor: Colors.border }]}>
                  {revealedRestaurant.imageUrl ? (
                    <Image
                      source={{ uri: revealedRestaurant.imageUrl }}
                      style={styles.revealImage}
                      contentFit="cover"
                    />
                  ) : (
                    <View style={[styles.revealImage, { backgroundColor: Colors.border }]} />
                  )}
                  <AppText variant="dense" style={[styles.revealName, { color: Colors.text }]} numberOfLines={1}>
                    {revealedRestaurant.name}
                  </AppText>
                  <AppText variant="dense" style={[styles.revealMeta, { color: Colors.textSecondary }]} numberOfLines={1}>
                    {revealedRestaurant.cuisine}
                    {revealedRestaurant.rating ? `  ·  ★ ${revealedRestaurant.rating.toFixed(1)}` : ''}
                    {revealedRestaurant.distance ? `  ·  ${revealedRestaurant.distance}` : ''}
                  </AppText>
                </View>
              ) : (
                <AppText variant="body" style={[styles.revealEmpty, { color: Colors.textSecondary }]}>
                  No nearby curveballs right now. Widen your filters?
                </AppText>
              )}

              {revealedRestaurant ? (
                <>
                  <Pressable
                    onPress={handleConfirmReveal}
                    accessibilityRole="button"
                    accessibilityLabel={`Go to ${revealedRestaurant.name}`}
                    style={[styles.revealPrimary, { backgroundColor: Colors.primary }]}
                  >
                    <AppText variant="dense" style={styles.revealPrimaryText}>{`Pick ${revealedRestaurant.name}`}</AppText>
                  </Pressable>

                  <Pressable
                    onPress={handleShuffleReveal}
                    accessibilityRole="button"
                    accessibilityLabel="Try a different surprise"
                    style={[styles.revealSecondary, { borderColor: Colors.border }]}
                  >
                    <AppText variant="dense" style={[styles.revealSecondaryText, { color: Colors.text }]}>
                      🎲 Try another
                    </AppText>
                  </Pressable>
                </>
              ) : null}

              <Pressable
                onPress={flipToFront}
                accessibilityRole="button"
                accessibilityLabel="Back to menu"
                style={styles.revealTertiary}
              >
                <ArrowLeft size={14} color={Colors.textSecondary} />
                <AppText variant="dense" style={[styles.revealTertiaryText, { color: Colors.textSecondary }]}>
                  back to menu
                </AppText>
              </Pressable>
            </View>
          )}
        </Animated.View>
        )}
      </View>

      <CrumbParticles bursts={bursts} />
    </View>
  );
}

interface MenuRowProps {
  spec: MenuRowSpec;
  isLast: boolean;
}

function MenuRow({ spec, isLast }: MenuRowProps) {
  const Colors = useColors();
  const Icon = spec.icon;
  const scale = useRef(new Animated.Value(1)).current;

  const handlePress = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    Animated.sequence([
      Animated.timing(scale, { toValue: 0.97, duration: 80, useNativeDriver: true }),
      Animated.timing(scale, { toValue: 1, duration: 120, useNativeDriver: true }),
    ]).start();
    spec.onPress();
  };

  return (
    <Animated.View style={{ transform: [{ scale }] }}>
      <Pressable
        onPress={handlePress}
        accessibilityRole="button"
        accessibilityLabel={`${spec.label}. ${spec.subtitle}`}
        testID={spec.testID}
        style={[
          styles.menuRow,
          !isLast && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: Colors.border },
        ]}
      >
        <Icon size={22} color={Colors.primary} />
        <View style={styles.menuRowText}>
          <AppText variant="dense" numberOfLines={1} style={[styles.menuRowLabel, { color: Colors.text }]}>{spec.label}</AppText>
          <AppText variant="dense" style={[styles.menuRowSubtitle, { color: Colors.textSecondary }]}>{spec.subtitle}</AppText>
        </View>
        <ChevronRight size={18} color={Colors.textTertiary} />
      </Pressable>
    </Animated.View>
  );
}

interface SpecialSectionProps {
  title: string;
  icon: LucideIcon;
  items: SpecialItem[];
  onTapItem: (restaurant: Restaurant) => void;
  hasMore: boolean;
  isExpanded: boolean;
  hiddenCount: number;
  onToggle: () => void;
}

function SpecialSection({
  title,
  icon,
  items,
  onTapItem,
  hasMore,
  isExpanded,
  hiddenCount,
  onToggle,
}: SpecialSectionProps) {
  const Colors = useColors();
  return (
    <View style={styles.happyHourSection}>
      <View style={styles.menuHeader}>
        <View style={[styles.menuRule, { backgroundColor: Colors.border }]} />
        <AppText variant="dense" style={[styles.menuSubheading, { color: Colors.textSecondary }]}>{title}</AppText>
        <View style={[styles.menuRule, { backgroundColor: Colors.border }]} />
      </View>
      {items.map((item, i) => (
        <SpecialRow
          key={item.restaurant.id}
          item={item}
          icon={icon}
          isLast={i === items.length - 1 && !hasMore}
          onPress={() => onTapItem(item.restaurant)}
        />
      ))}
      {hasMore && (
        <Pressable
          onPress={onToggle}
          accessibilityRole="button"
          accessibilityLabel={isExpanded ? `Collapse ${title.toLowerCase()} list` : `Show ${hiddenCount} more ${title.toLowerCase()} options`}
          style={styles.expandToggle}
        >
          <AppText variant="dense" style={[styles.expandToggleText, { color: Colors.primary }]}>
            {isExpanded ? 'show less' : `show ${hiddenCount} more`}
          </AppText>
          {isExpanded ? (
            <ChevronUp size={14} color={Colors.primary} />
          ) : (
            <ChevronDown size={14} color={Colors.primary} />
          )}
        </Pressable>
      )}
    </View>
  );
}

interface SpecialRowProps {
  item: SpecialItem;
  icon: LucideIcon;
  isLast: boolean;
  onPress: () => void;
}

function SpecialRow({ item, icon: Icon, isLast, onPress }: SpecialRowProps) {
  const Colors = useColors();
  const { restaurant, status } = item;

  const timeText =
    status.state === 'active'
      ? `Active until ${formatHour12(status.endHour24, status.endMinute)}`
      : `Starts in ${formatStartIn(status.minutesUntilStart ?? 0)}`;

  const accent =
    status.state === 'active' ? Colors.primary : Colors.textSecondary;

  return (
    <Pressable
      onPress={() => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        onPress();
      }}
      accessibilityRole="button"
      accessibilityLabel={`${restaurant.name} — ${timeText}`}
      style={[
        styles.happyHourRow,
        !isLast && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: Colors.border },
      ]}
    >
      <Icon size={18} color={accent} />
      <View style={styles.happyHourText}>
        <AppText variant="dense" style={[styles.happyHourName, { color: Colors.text }]} numberOfLines={1}>
          {restaurant.name}
        </AppText>
        <AppText variant="dense" style={[styles.happyHourMeta, { color: accent }]} numberOfLines={1}>
          {timeText}
          {' · '}
          {formatHour12(status.startHour24, status.startMinute)}
          {'–'}
          {formatHour12(status.endHour24, status.endMinute)}
        </AppText>
      </View>
      <ChevronRight size={16} color={Colors.textTertiary} />
    </Pressable>
  );
}

function collectSpecialItems(
  restaurants: readonly Restaurant[],
  kind: SpecialKind,
  now: Date,
  limit: number,
): SpecialItem[] {
  const items: SpecialItem[] = [];
  for (const r of restaurants) {
    const periods = kind === 'happyHour' ? r.happyHour : r.brunch;
    const status = getSpecialHoursStatus(periods, now);
    if (status) items.push({ restaurant: r, status });
  }
  // Primary sort: rating descending — best restaurants first.
  // Tiebreaker: active outranks upcoming when equally rated.
  const STATE_ORDER: Record<SpecialHoursStatus['state'], number> = {
    active: 0,
    upcoming: 1,
  };
  items.sort((a, b) => {
    const ratingDiff = (b.restaurant.rating ?? 0) - (a.restaurant.rating ?? 0);
    if (ratingDiff !== 0) return ratingDiff;
    return STATE_ORDER[a.status.state] - STATE_ORDER[b.status.state];
  });
  return items.slice(0, limit);
}

function formatStartIn(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
    alignItems: 'center',
    marginBottom: 16,
  },
  tentWrapper: {
    position: 'relative',
  },
  face: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: TENT_WIDTH,
    // height applied inline (dynamic per content)
    borderRadius: 20,
    borderWidth: 1.5,
    padding: 14,
    backfaceVisibility: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 4,
  },
  faceBack: {
    // Back face renders pre-rotated 180° in interpolation
  },
  menuHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 8,
  },
  menuRule: {
    flex: 1,
    height: 1,
  },
  footerDivider: {
    height: 1,
    width: '100%',
    marginTop: 14,
    marginBottom: 10,
  },
  menuTitle: {
    fontSize: 13,
    fontWeight: '800' as const,
    letterSpacing: 2.5,
  },
  menuSubheading: {
    fontSize: 10,
    fontWeight: '800' as const,
    letterSpacing: 1.8,
  },
  happyHourSection: {
    marginTop: 10,
  },
  happyHourRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 8,
    paddingHorizontal: 4,
  },
  happyHourText: {
    flex: 1,
  },
  happyHourName: {
    fontSize: 13,
    fontWeight: '700' as const,
  },
  happyHourMeta: {
    fontSize: 10,
    fontWeight: '600' as const,
    marginTop: 1,
  },
  expandToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: 6,
    marginTop: 2,
  },
  expandToggleText: {
    fontSize: 11,
    fontWeight: '700' as const,
    letterSpacing: 0.4,
  },
  menuRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 4,
  },
  menuRowText: {
    flex: 1,
  },
  menuRowLabel: {
    fontSize: 15,
    fontWeight: '700' as const,
  },
  menuRowSubtitle: {
    fontSize: 12,
    marginTop: 1,
  },
  flipFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 10,
    borderWidth: 1.5,
    borderStyle: 'dashed' as const,
  },
  flipFooterText: {
    fontSize: 13,
    fontWeight: '700' as const,
    letterSpacing: 0.5,
  },
  // ─── Back face: scratch ───
  scratchHost: {
    flex: 1,
    alignItems: 'center',
  },
  scratchHint: {
    fontSize: 11,
    fontWeight: '700' as const,
    letterSpacing: 1.8,
    marginBottom: 10,
  },
  scratchPanel: {
    width: TENT_WIDTH - 28,
    height: SCRATCH_AREA_HEIGHT,
    borderRadius: 14,
    borderWidth: 1,
    overflow: 'hidden',
    position: 'relative',
  },
  underPanel: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  underHint: {
    fontSize: 12,
    fontStyle: 'italic' as const,
  },
  tapToRevealBtn: {
    marginTop: 12,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 14,
    borderWidth: 1,
  },
  tapToRevealBtnPrimary: {
    borderWidth: 0,
  },
  tapToRevealText: {
    fontSize: 12,
    fontWeight: '600' as const,
  },
  // ─── Back face: reveal ───
  revealHost: {
    flex: 1,
    alignItems: 'center',
    paddingTop: 4,
  },
  revealEyebrow: {
    fontSize: 11,
    fontWeight: '800' as const,
    letterSpacing: 2,
    marginBottom: 10,
  },
  revealCard: {
    width: TENT_WIDTH - 50,
    borderRadius: 14,
    borderWidth: 1,
    padding: 12,
    alignItems: 'center',
    marginBottom: 12,
  },
  revealImage: {
    width: 96,
    height: 96,
    borderRadius: 12,
    marginBottom: 10,
  },
  revealName: {
    fontSize: 18,
    fontWeight: '800' as const,
    textAlign: 'center',
  },
  revealMeta: {
    fontSize: 12,
    marginTop: 4,
    textAlign: 'center',
  },
  revealEmpty: {
    fontSize: 13,
    fontStyle: 'italic' as const,
    textAlign: 'center',
    marginVertical: 24,
  },
  revealPrimary: {
    width: TENT_WIDTH - 50,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  revealPrimaryText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700' as const,
  },
  revealSecondary: {
    width: TENT_WIDTH - 50,
    height: 40,
    borderRadius: 20,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  revealSecondaryText: {
    fontSize: 13,
    fontWeight: '600' as const,
  },
  revealTertiary: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 6,
  },
  revealTertiaryText: {
    fontSize: 12,
    fontWeight: '600' as const,
  },
});
