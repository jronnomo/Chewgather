import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  Alert,
  Switch,
  ActivityIndicator,
  Linking,
  Animated,
  Easing,
  LayoutAnimation,
  Platform,
  UIManager,
  Dimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useIsFocused } from '@react-navigation/core';
import { Image } from 'expo-image';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Svg, { Defs, Mask, Rect, Circle, Path } from 'react-native-svg';
import {
  Heart,
  UtensilsCrossed,
  DollarSign,
  Leaf,
  Volume2,
  Users,
  Bell,
  Moon,
  ChevronRight,
  LogOut,
  MapPin,
  Edit3,
  UserPlus,
  Camera,
  Star,
  X,
  Flame,
} from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import * as ImageManipulator from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { useApp } from '../../../context/AppContext';
import { useAuth } from '../../../context/AuthContext';
import { api } from '../../../services/api';
import { requestNotificationPermissions, registerForPushNotifications } from '../../../services/notifications';
import StaticColors from '../../../constants/colors';
import { DEFAULT_AVATAR_URI } from '../../../constants/images';
import { useColors } from '../../../context/ThemeContext';
import { useThemeTransition, buildSignOutChompConfig } from '../../../context/ThemeTransitionContext';
import { starPath, SPARKLES } from '../../../lib/sparkleUtils';
import { generateScallops } from '../../../lib/scallopUtils';
import { Restaurant } from '../../../types';
import LockedTabScreen from '../../../components/LockedTabScreen';

// Android requires explicit opt-in for LayoutAnimation
if (Platform.OS === 'android') {
  UIManager.setLayoutAnimationEnabledExperimental?.(true);
}

const Colors = StaticColors;

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const BITES_PAGE_SIZE = 5;
// Bite-mark SVG dimensions (corner cutout on photo thumbnail)
const BITE_SVG_SIZE = 32; // px — the corner overlay square
const BITE_SCALLOP_BASE_R = 7; // px — scallop circle radius for card-size bites

// ─── Props Types ────────────────────────────────────────────────

interface TasteDNAProps {
  restaurants: Restaurant[];
  triggerReanimation: number;
}

interface BiteMarkSvgProps {
  restaurantId: string;
}

interface BiteSparkleProps {
  isGolden: boolean;
  gleamAnim: Animated.Value;
  cardWidth: number;
  cardHeight: number;
}

interface BiteCardProps {
  restaurant: Restaurant;
  rank: number;
  isNew: boolean;
  isGoldenBite: boolean;
  onRemove: (restaurant: Restaurant) => void;
  onClearNew: (id: string) => void;
}

// ─── Module-Level Sub-Components ────────────────────────────────

function TasteDNA({ restaurants, triggerReanimation }: TasteDNAProps) {
  const Colors = useColors();
  const [insightIndex, setInsightIndex] = useState(0);

  // Cuisine distribution
  const cuisineData = useMemo(() => {
    const map: Record<string, number> = {};
    for (const r of restaurants) {
      map[r.cuisine] = (map[r.cuisine] ?? 0) + 1;
    }
    return Object.entries(map)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)
      .map(([cuisine, count]) => ({ cuisine, count }));
  }, [restaurants]);

  const maxCount = cuisineData[0]?.count ?? 1;

  // Rotating insights
  const insights = useMemo(() => {
    if (restaurants.length === 0) return [];

    const cuisineMap: Record<string, number> = {};
    for (const r of restaurants) {
      cuisineMap[r.cuisine] = (cuisineMap[r.cuisine] ?? 0) + 1;
    }
    const topCuisine = Object.entries(cuisineMap).sort((a, b) => b[1] - a[1])[0];

    // [v2 FIX: SUG-1] Handle 1-favorite edge case
    const cuisineInsight = restaurants.length === 1
      ? `Your first Bite — ${topCuisine[0]}!`
      : `You love ${topCuisine[0]}! ${topCuisine[1]} of ${restaurants.length} bites`;

    const avgRating = (
      restaurants.reduce((s, r) => s + r.rating, 0) / restaurants.length
    ).toFixed(1);
    const ratingInsight = `Your picks average ${avgRating} ⭐`;

    const budgetMap: Record<number, number> = {};
    for (const r of restaurants) {
      budgetMap[r.priceLevel] = (budgetMap[r.priceLevel] ?? 0) + 1;
    }
    const topBudget = Object.entries(budgetMap).sort((a, b) => b[1] - a[1])[0];
    const priceStr = '$'.repeat(Number(topBudget[0]));
    const budgetInsight = `Budget sweet spot: ${priceStr}`;

    return [cuisineInsight, ratingInsight, budgetInsight];
  }, [restaurants]);

  // Bar animations — one Animated.Value per bar
  const barAnims = useMemo(
    () => cuisineData.map(() => new Animated.Value(0)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cuisineData.length, triggerReanimation],
  );

  // [v2 FIX: CRIT-3] Dep is [barAnims] — correct and exhaustive
  useEffect(() => {
    barAnims.forEach(a => a.setValue(0));
    const animations = barAnims.map((anim, i) =>
      Animated.timing(anim, {
        toValue: 1,
        duration: 500,
        delay: i * 60,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: false,
      })
    );
    Animated.stagger(60, animations).start();
  }, [barAnims]);

  // Rotate insights every 5 seconds
  useEffect(() => {
    if (insights.length <= 1) return;
    const id = setInterval(() => {
      setInsightIndex(i => (i + 1) % insights.length);
    }, 5000);
    return () => clearInterval(id);
  }, [insights.length]);

  if (cuisineData.length === 0) return null;

  return (
    <View style={[styles.dnaContainer, { backgroundColor: Colors.card }]}>
      {cuisineData.map((item, i) => (
        <View key={item.cuisine} style={styles.dnaBarRow}>
          <Text style={[styles.dnaCuisineLabel, { color: Colors.textSecondary }]}>
            {item.cuisine}
          </Text>
          <View style={[styles.dnaBarTrack, { backgroundColor: Colors.border }]}>
            <Animated.View
              style={[
                styles.dnaBarFill,
                {
                  backgroundColor: Colors.primary,
                  width: barAnims[i].interpolate({
                    inputRange: [0, 1],
                    outputRange: ['0%', `${(item.count / maxCount) * 100}%`],
                  }),
                },
              ]}
            />
          </View>
          <Text style={[styles.dnaCountLabel, { color: Colors.textTertiary }]}>
            {item.count}
          </Text>
        </View>
      ))}
      {insights.length > 0 && (
        <Text style={[styles.dnaInsight, { color: Colors.textSecondary }]}>
          {insights[insightIndex]}
        </Text>
      )}
    </View>
  );
}

const BiteMarkSvg = React.memo(function BiteMarkSvg({ restaurantId }: BiteMarkSvgProps) {
  const Colors = useColors();

  const scallops = useMemo(
    () => generateScallops(
      restaurantId.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0) % 1000,
      BITE_SVG_SIZE * 0.9,
      -0.4,
      1.8,
      BITE_SCALLOP_BASE_R,
    ),
    [restaurantId],
  );

  const maskId = `biteMask_${restaurantId}`;
  const cx = BITE_SVG_SIZE;
  const cy = 0;

  return (
    <Svg
      width={BITE_SVG_SIZE}
      height={BITE_SVG_SIZE}
      style={{ position: 'absolute', top: 0, right: 0 }}
      pointerEvents="none"
    >
      <Defs>
        <Mask id={maskId}>
          <Rect x={0} y={0} width={BITE_SVG_SIZE} height={BITE_SVG_SIZE} fill="white" />
          <Circle cx={cx} cy={cy} r={BITE_SVG_SIZE * 0.82} fill="black" />
          {scallops.map((sc, j) => (
            <Circle
              key={j}
              cx={cx + BITE_SVG_SIZE * 0.82 * Math.cos(sc.angle)}
              cy={cy + BITE_SVG_SIZE * 0.82 * Math.sin(sc.angle)}
              r={sc.radius}
              fill="black"
            />
          ))}
        </Mask>
      </Defs>
      <Rect
        x={0}
        y={0}
        width={BITE_SVG_SIZE}
        height={BITE_SVG_SIZE}
        fill={Colors.background}
        mask={`url(#${maskId})`}
      />
    </Svg>
  );
});

function BiteSparkle({ isGolden, gleamAnim, cardWidth, cardHeight }: BiteSparkleProps) {
  // Full sparkle set across the card — matches curveball swipe density
  const sparkleSet = isGolden ? SPARKLES : SPARKLES.slice(0, 14);

  return (
    <>
      {sparkleSet.map((sp, i) => {
        const start = sp.x * 0.45;
        const fadeIn = start + 0.12;
        const holdEnd = start + 0.35;
        const fadeOut = Math.min(start + 0.55, 1);

        const spOpacity = gleamAnim.interpolate({
          inputRange: [start, fadeIn, holdEnd, fadeOut],
          outputRange: [0, 1, 0.8, 0],
          extrapolate: 'clamp',
        });
        const spScale = gleamAnim.interpolate({
          inputRange: [start, fadeIn, holdEnd, fadeOut],
          outputRange: [0, 1.3, 1, 0],
          extrapolate: 'clamp',
        });

        const dim = sp.size * 4;
        return (
          <Animated.View
            key={i}
            pointerEvents="none"
            style={{
              position: 'absolute',
              left: sp.x * cardWidth - dim / 2,
              top: sp.y * cardHeight - dim / 2,
              width: dim,
              height: dim,
              zIndex: 20,
              opacity: spOpacity,
              transform: [{ scale: spScale }],
            }}
          >
            <Svg width={dim} height={dim}>
              <Circle
                cx={dim / 2}
                cy={dim / 2}
                r={sp.size * 1.6}
                fill="rgba(255,215,80,0.12)"
              />
              {sp.type === 'star' ? (
                <Path
                  d={starPath(dim / 2, dim / 2, sp.size)}
                  fill="rgba(255,225,120,0.9)"
                />
              ) : (
                <Circle
                  cx={dim / 2}
                  cy={dim / 2}
                  r={sp.size * 0.5}
                  fill="rgba(255,235,160,0.85)"
                />
              )}
            </Svg>
          </Animated.View>
        );
      })}
    </>
  );
}

function EmptyBites() {
  const Colors = useColors();
  const router = useRouter();

  const handleStartSwiping = useCallback(() => {
    router.push('/(tabs)' as never);
  }, [router]);

  return (
    <View style={[styles.emptyBitesWrap, { backgroundColor: Colors.card }]}>
      <Text style={[styles.emptyBitesText, { color: Colors.textSecondary }]}>
        No bites yet — swipe right on restaurants you love and they&apos;ll show up here!
      </Text>
      <Pressable
        style={[styles.emptyBitesCta, { backgroundColor: Colors.primary }]}
        onPress={handleStartSwiping}
        accessibilityRole="button"
        accessibilityLabel="Start swiping to discover restaurants"
      >
        <Text style={[styles.emptyBitesCtaText, { color: Colors.textInverse }]}>
          Start Swiping
        </Text>
      </Pressable>
    </View>
  );
}

const BiteCard = React.memo(function BiteCard({
  restaurant,
  rank,
  isNew,
  isGoldenBite,
  onRemove,
  onClearNew,
}: BiteCardProps) {
  const Colors = useColors();
  const router = useRouter();

  const cardRef = useRef<View>(null);
  const isFocused = useIsFocused();

  // Animation values
  const scaleAnim = useRef(new Animated.Value(1)).current;
  const opacityAnim = useRef(new Animated.Value(1)).current;
  const slideAnim = useRef(new Animated.Value(0)).current;
  const glowAnim = useRef(new Animated.Value(0)).current;
  const gleamAnim = useRef(new Animated.Value(0)).current;

  // [v2 FIX: CRIT-1] Track running entrance animation for cancellation on removal
  const animRef = useRef<Animated.CompositeAnimation | null>(null);

  // Local state
  const [isRemoving, setIsRemoving] = useState(false);

  // Celebration plays once when card is visible on the focused tab
  const [animReady, setAnimReady] = useState(false);

  // Card dimensions for sparkle positioning
  const CARD_HEIGHT = 96;

  // --- Visibility gate: wait for tab focus + card in viewport ---
  useEffect(() => {
    if (!isNew || animReady || !isFocused) return;

    const check = () => {
      cardRef.current?.measureInWindow((_x: number, y: number, _w: number, h: number) => {
        if (h === 0) return; // Not laid out yet
        const screenH = Dimensions.get('window').height;
        if (y + h > 0 && y < screenH) {
          setAnimReady(true);
        }
      });
    };

    // Small delay for initial layout, then poll
    const timeout = setTimeout(check, 150);
    const interval = setInterval(check, 200);

    return () => {
      clearTimeout(timeout);
      clearInterval(interval);
    };
  }, [isNew, animReady, isFocused]);

  // --- Celebration Animation (REQ-009) ---
  // Card is always visible — glow, sparkles, and scale pop play in-place
  useEffect(() => {
    if (!animReady) return;

    // 1. Scale pop
    const scaleSequence = Animated.sequence([
      Animated.spring(scaleAnim, {
        toValue: isGoldenBite ? 1.08 : 1.05,
        friction: 4,
        useNativeDriver: true,
      }),
      Animated.spring(scaleAnim, {
        toValue: 1,
        friction: 3,
        useNativeDriver: true,
      }),
    ]);

    // [v2 FIX: CRIT-1] Store composite ref for cancellation in handleRemovePress
    animRef.current = scaleSequence;
    scaleSequence.start();

    // 2. Gold glow pulse
    Animated.sequence([
      Animated.timing(glowAnim, { toValue: 1, duration: 200, useNativeDriver: false }),
      Animated.delay(2800),
      Animated.timing(glowAnim, { toValue: 0, duration: 500, useNativeDriver: false }),
    ]).start(({ finished }) => {
      if (finished) onClearNew(restaurant.id); // [v2 FIX: DC-2] only clear if animation completed naturally
    });

    // 3. Sparkles
    gleamAnim.setValue(0);
    Animated.timing(gleamAnim, {
      toValue: 1,
      duration: isGoldenBite ? 1400 : 1000,
      easing: Easing.out(Easing.ease),
      useNativeDriver: true,
    }).start();

    // 4. Golden Bite haptic
    if (isGoldenBite) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
  }, [animReady]); // eslint-disable-line react-hooks/exhaustive-deps

  // --- Press Animation (REQ-005) ---
  const handlePressIn = useCallback(() => {
    if (isRemoving) return;
    Animated.spring(scaleAnim, { toValue: 0.97, useNativeDriver: true }).start();
  }, [scaleAnim, isRemoving]);

  const handlePressOut = useCallback(() => {
    if (isRemoving) return;
    Animated.spring(scaleAnim, { toValue: 1, friction: 3, useNativeDriver: true }).start();
  }, [scaleAnim, isRemoving]);

  // --- Removal Animation (REQ-006) ---
  const handleRemovePress = useCallback(() => {
    Alert.alert(
      'Remove from Your Bites?',
      `Remove ${restaurant.name} from your bites?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => {
            // [v2 FIX: CRIT-2] Configure layout animation SYNCHRONOUSLY first
            LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);

            // [v2 FIX: CRIT-1] Stop entrance animation before starting removal
            animRef.current?.stop();
            glowAnim.stopAnimation();

            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            setIsRemoving(true);

            Animated.parallel([
              Animated.timing(scaleAnim, {
                toValue: 0,
                duration: 350,
                easing: Easing.in(Easing.cubic),
                useNativeDriver: true,
              }),
              Animated.timing(opacityAnim, {
                toValue: 0,
                duration: 300,
                easing: Easing.in(Easing.ease),
                useNativeDriver: true,
              }),
            ]).start(() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              onRemove(restaurant);
            });
          },
        },
      ]
    );
  }, [restaurant, onRemove, scaleAnim, opacityAnim, glowAnim]);

  // Derived display values
  const priceString = '$'.repeat(restaurant.priceLevel);

  // [v2 FIX: DC-1] Glow border: only interpolate when isNew is true
  const glowBorderColor = isNew
    ? glowAnim.interpolate({
        inputRange: [0, 1],
        outputRange: [Colors.border, '#FFB800'],
      })
    : undefined;

  // Card inner content — shared between isNew and non-isNew branches
  const innerContent = (
    <>
      {/* Pressable row — photo + text */}
      <Pressable
        style={{ flexDirection: 'row', alignItems: 'center', flex: 1, gap: 12 }}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        onPress={() => router.push(`/restaurant/${restaurant.id}` as never)}
      >
        {/* Photo thumbnail with bite-mark overlay */}
        {/* [v2 FIX: DC-4] BiteMarkSvg is INSIDE biteThumbWrap */}
        <View style={styles.biteThumbWrap}>
          <Image
            source={{ uri: restaurant.imageUrl }}
            style={styles.biteThumbImage}
            contentFit="cover"
          />
          <BiteMarkSvg restaurantId={restaurant.id} />
        </View>

        {/* Text content */}
        <View style={styles.biteCardBody}>
          <View style={styles.biteNameRow}>
            <Text
              style={[styles.biteName, { color: Colors.text }]}
              numberOfLines={1}
            >
              {restaurant.name}
            </Text>
            {rank === 1 && <Text style={styles.biteCrown}>👑</Text>}
          </View>

          <Text style={[styles.biteSubLine, { color: Colors.textSecondary }]}>
            {restaurant.cuisine} · {priceString} · {restaurant.distance}
          </Text>

          <View style={styles.biteMetaRow}>
            <View style={styles.biteRatingPill}>
              <Star size={11} color={Colors.star} fill={Colors.star} />
              <Text style={[styles.biteRatingText, { color: Colors.text }]}>
                {restaurant.rating.toFixed(1)}
              </Text>
            </View>

            {restaurant.isOpenNow && (
              <>
                <View style={styles.biteOpenDot} />
                <Text style={styles.biteOpenText}>Open</Text>
              </>
            )}

            {restaurant.lastCallDeal && (
              <View style={styles.biteDealRow}>
                <Flame size={11} color={Colors.warning} />
                <Text style={[styles.biteDealText, { color: Colors.warning }]}>
                  Deal
                </Text>
              </View>
            )}
          </View>
        </View>
      </Pressable>

      {/* Remove button */}
      {/* [v2 FIX: SUG-6] accessibilityLabel and accessibilityRole added */}
      <Pressable
        style={[styles.biteRemoveBtn]}
        onPress={handleRemovePress}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={`Remove ${restaurant.name} from your bites`}
      >
        <X size={16} color={Colors.textTertiary} />
      </Pressable>
    </>
  );

  return (
    <Animated.View
      ref={cardRef}
      style={[
        styles.biteCard,
        {
          transform: [{ scale: scaleAnim }, { translateX: slideAnim }],
          opacity: opacityAnim,
        },
      ]}
    >
      {/* [v2 FIX: DC-1] Use Animated.View only when isNew */}
      {isNew ? (
        <Animated.View
          style={[
            styles.biteCardInner,
            { backgroundColor: Colors.card, borderColor: glowBorderColor },
          ]}
        >
          {innerContent}
        </Animated.View>
      ) : (
        <View
          style={[
            styles.biteCardInner,
            { backgroundColor: Colors.card, borderColor: Colors.border },
          ]}
        >
          {innerContent}
        </View>
      )}

      {/* NEW badge — rendered AFTER biteCardInner so it stacks on top */}
      {isNew && (
        <View style={[styles.biteNewBadge, { backgroundColor: Colors.primary }]}>
          <Text style={styles.biteNewBadgeText}>NEW ✨</Text>
        </View>
      )}

      {/* Sparkle overlay — rendered AFTER card so sparkles appear on top */}
      {isNew && (
        <BiteSparkle
          isGolden={isGoldenBite}
          gleamAnim={gleamAnim}
          cardWidth={SCREEN_WIDTH - 40}
          cardHeight={CARD_HEIGHT}
        />
      )}
    </Animated.View>
  );
});

// ─── Existing Helper Component ──────────────────────────────────

function PrefRow({ icon: Icon, label, value }: { icon: React.ElementType; label: string; value: string }) {
  const Colors = useColors();
  return (
    <View style={styles.prefRow}>
      <View style={[styles.prefIconCircle, { backgroundColor: Colors.primaryLight }]}>
        <Icon size={16} color={Colors.primary} />
      </View>
      <View style={styles.prefContent}>
        <Text style={[styles.prefLabel, { color: Colors.text }]}>{label}</Text>
        <Text style={[styles.prefValue, { color: Colors.textSecondary }]} numberOfLines={1}>{value}</Text>
      </View>
    </View>
  );
}

// ─── Main Screen Component ──────────────────────────────────────

export default function ProfileScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const Colors = useColors();
  const {
    preferences,
    updatePreferences,
    favorites,
    favoritedRestaurants,
    setLocalAvatar,
    localAvatarUri,
    plans,
    setGuestMode,
    toggleFavorite,
    newlyAddedFavoriteIds,
    clearNewlyAddedFavorite,
    isGuest,
  } = useApp();
  const { user, signOut, isAuthenticated, updateUser } = useAuth();
  const { requestThemeToggle, requestChomp, isAnimating } = useThemeTransition();

  const [avatarLoading, setAvatarLoading] = useState(false);

  // Pagination state (REQ-007)
  const [showAllBites, setShowAllBites] = useState(false);

  // Taste DNA animation trigger (REQ-004/009)
  const [dnaAnimTrigger, setDnaAnimTrigger] = useState(0);

  const favoriteRestaurants = favoritedRestaurants;

  // Sort favorites by rating descending — determines crown (#1) placement
  const sortedFavorites = useMemo(
    () => [...favoritedRestaurants].sort((a, b) => b.rating - a.rating),
    [favoritedRestaurants],
  );

  // Paginated slice
  const displayedBites = showAllBites
    ? sortedFavorites
    : sortedFavorites.slice(0, BITES_PAGE_SIZE);

  // Determine if a newly added bite is the highest-rated (golden bite condition)
  const goldenBiteId = useMemo(() => {
    if (newlyAddedFavoriteIds.size === 0 || sortedFavorites.length === 0) return null;
    const topId = sortedFavorites[0].id;
    return newlyAddedFavoriteIds.has(topId) ? topId : null;
  }, [newlyAddedFavoriteIds, sortedFavorites]);

  // Re-trigger DNA bar animation and ensure new bites are visible (REQ-004/REQ-009)
  useEffect(() => {
    if (newlyAddedFavoriteIds.size === 0) return;
    // Expand list if any new bite is beyond current page
    for (const id of newlyAddedFavoriteIds) {
      const idx = sortedFavorites.findIndex(r => r.id === id);
      if (idx >= BITES_PAGE_SIZE && !showAllBites) {
        setShowAllBites(true);
        break;
      }
    }
    // Re-trigger DNA bars
    setDnaAnimTrigger(t => t + 1);
  }, [newlyAddedFavoriteIds]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleRemoveFavorite = useCallback((restaurant: Restaurant) => {
    toggleFavorite(restaurant);
  }, [toggleFavorite]);

  const handleToggleShowAll = useCallback(() => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setShowAllBites(prev => !prev);
  }, []);

  const handlePickAvatar = useCallback(async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission needed', 'Please allow photo library access to set a profile picture.');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: 'images',
      allowsEditing: true,
      aspect: [1, 1],
      // quality + base64 removed — we resize + recompress via expo-image-manipulator below
    });

    if (result.canceled || !result.assets[0]) return;

    const asset = result.assets[0];
    setAvatarLoading(true);
    try {
      // Resize to 512x512 + recompress JPEG @ 0.7 → ~50-100KB payload vs 5-8MB raw (#31)
      // Backend crops to 400x400 via Cloudinary, so smaller upload is pure win.
      const manipulated = await ImageManipulator.manipulateAsync(
        asset.uri,
        [{ resize: { width: 512, height: 512 } }],
        {
          compress: 0.7,
          format: ImageManipulator.SaveFormat.JPEG,
          base64: true,
        },
      );

      // Optimistic: show local preview immediately
      await setLocalAvatar(manipulated.uri);

      if (isAuthenticated && manipulated.base64) {
        // base64 length * 0.75 ≈ raw bytes. Backend body-parser cap is 2MB; allow 1.5MB
        // for the JPEG payload to leave headroom for JSON wrapper + dataUri prefix.
        const approxBytes = manipulated.base64.length * 0.75;
        const MAX_BYTES = 1.5 * 1024 * 1024;
        if (approxBytes > MAX_BYTES) {
          Alert.alert(
            'Image too large',
            'This photo is too large to upload, even after resizing. Try a smaller image.',
          );
          return;
        }

        const dataUri = `data:image/jpeg;base64,${manipulated.base64}`;
        const res = await api.post<{ avatarUri: string }>('/uploads/avatar', { image: dataUri });
        updateUser({ avatarUri: res.avatarUri });
        // Persist Cloudinary URL locally so it survives without network
        await setLocalAvatar(res.avatarUri);
      }
    } catch (err) {
      Alert.alert('Error', 'Failed to upload profile picture. Your local preview is still saved.');
    } finally {
      setAvatarLoading(false);
    }
  }, [setLocalAvatar, isAuthenticated, updateUser]);

  const handleToggleDarkMode = useCallback(() => {
    const fromBgColor = Colors.background;
    requestThemeToggle(fromBgColor, () => {
      updatePreferences.mutate({
        ...preferences,
        isDarkMode: !preferences.isDarkMode,
      });
    });
  }, [Colors.background, preferences, updatePreferences, requestThemeToggle]);

  const handleToggleNotifications = useCallback(async () => {
    Haptics.selectionAsync();
    if (!preferences.notificationsEnabled) {
      const granted = await requestNotificationPermissions();
      if (!granted) {
        Alert.alert(
          'Notifications Disabled',
          'Please enable notifications in your device Settings.',
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Open Settings', onPress: () => Linking.openSettings() },
          ]
        );
        return;
      }
      registerForPushNotifications();
    } else {
      // Disabling — clear push token from backend so notifications stop
      try { await api.delete('/users/push-token'); } catch { /* best-effort */ }
    }
    updatePreferences.mutate({
      ...preferences,
      notificationsEnabled: !preferences.notificationsEnabled,
    });
  }, [preferences, updatePreferences]);

  const handleLogout = useCallback(async () => {
    await setGuestMode(false);
    await signOut();
    requestChomp(buildSignOutChompConfig(Colors.primary), () => {
      router.replace('/auth' as never);
    });
  }, [signOut, setGuestMode, router, requestChomp, Colors.primary]);

  // ── Guest early return — placed AFTER all hooks (React rules of hooks) ──
  if (isGuest) return <LockedTabScreen variant="profile" />;

  const fullName = user?.name || preferences.name || 'Foodie';
  const displayName = fullName.split(' ')[0];
  const avatarUri = localAvatarUri || user?.avatarUri;

  return (
    <View style={[styles.container, { paddingTop: insets.top, backgroundColor: Colors.background }]}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
        <View style={styles.header}>
          <Text style={[styles.headerTitle, { color: Colors.text }]}>Profile</Text>
          {isAuthenticated && (
            <Pressable
              style={[styles.friendsBtn, { backgroundColor: Colors.primaryLight }]}
              onPress={() => router.push('/(tabs)/friends' as never)}
            >
              <UserPlus size={18} color={Colors.primary} />
              <Text style={[styles.friendsBtnText, { color: Colors.primary }]}>Friends</Text>
            </Pressable>
          )}
        </View>

        <View style={[styles.profileCard, { backgroundColor: Colors.card }]}>
          <Pressable style={styles.avatarWrap} onPress={handlePickAvatar} disabled={avatarLoading} accessibilityLabel="Change profile picture" accessibilityRole="button">
            <Image source={avatarUri || DEFAULT_AVATAR_URI} style={styles.avatarImage} contentFit="cover" />
            <View style={[styles.cameraOverlay, { backgroundColor: Colors.primary, borderColor: Colors.card }]}>
              {avatarLoading ? (
                <ActivityIndicator size="small" color="#FFF" />
              ) : (
                <Camera size={14} color="#FFF" />
              )}
            </View>
          </Pressable>
          <Text style={[styles.profileName, { color: Colors.text }]}>{displayName}</Text>
          <Text style={[styles.profileSub, { color: Colors.textSecondary }]}>{user?.email || 'Dining enthusiast'}</Text>
          <View style={styles.statsRow}>
            <View style={styles.stat}>
              <Text style={[styles.statValue, { color: Colors.text }]}>{favoriteRestaurants.length}</Text>
              <Text style={[styles.statLabel, { color: Colors.textSecondary }]}>Bites</Text>
            </View>
            <View style={[styles.statDivider, { backgroundColor: Colors.border }]} />
            <View style={styles.stat}>
              <Text style={[styles.statValue, { color: Colors.text }]}>{plans.length}</Text>
              <Text style={[styles.statLabel, { color: Colors.textSecondary }]}>Plans</Text>
            </View>
          </View>
        </View>

        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={[styles.sectionTitle, { color: Colors.text }]}>Preferences</Text>
            <Pressable
              style={[styles.editBtn, { backgroundColor: Colors.primaryLight }]}
              onPress={() => router.push('/(tabs)/profile/edit')}
            >
              <Edit3 size={14} color={Colors.primary} />
              <Text style={[styles.editBtnText, { color: Colors.primary }]}>Edit</Text>
            </Pressable>
          </View>
          <View style={[styles.prefCard, { backgroundColor: Colors.card }]}>
            <PrefRow icon={UtensilsCrossed} label="Cuisines" value={preferences.cuisines.length > 0 ? preferences.cuisines.join(', ') : 'Not set'} />
            <View style={[styles.prefDivider, { backgroundColor: Colors.borderLight }]} />
            <PrefRow icon={DollarSign} label="Budget" value={preferences.budget.length > 0 ? preferences.budget.join(', ') : 'Not set'} />
            <View style={[styles.prefDivider, { backgroundColor: Colors.borderLight }]} />
            <PrefRow icon={Leaf} label="Dietary" value={preferences.dietary.length > 0 ? preferences.dietary.join(', ') : 'None'} />
            <View style={[styles.prefDivider, { backgroundColor: Colors.borderLight }]} />
            <PrefRow icon={Volume2} label="Atmosphere" value={preferences.atmosphere.length > 0 ? preferences.atmosphere.join(', ') : 'Not set'} />
            <View style={[styles.prefDivider, { backgroundColor: Colors.borderLight }]} />
            <PrefRow icon={Users} label="Group Size" value={preferences.groupSize.length > 0 ? preferences.groupSize.join(', ') : 'Not set'} />
            <View style={[styles.prefDivider, { backgroundColor: Colors.borderLight }]} />
            <PrefRow icon={MapPin} label="Distance" value={preferences.distance ? `${preferences.distance} mi` : 'Not set'} />
          </View>
        </View>

        {/* Your Bites Section — REQ-004 through REQ-010 */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <View style={styles.sectionTitleRow}>
              <Heart size={16} color={Colors.primary} fill={Colors.primary} />
              <Text style={[styles.sectionTitle, { color: Colors.text }]}>Your Bites</Text>
            </View>
          </View>

          {sortedFavorites.length === 0 ? (
            <EmptyBites />
          ) : (
            <>
              <TasteDNA restaurants={sortedFavorites} triggerReanimation={dnaAnimTrigger} />

              {displayedBites.map((restaurant, index) => (
                <BiteCard
                  key={restaurant.id}
                  restaurant={restaurant}
                  rank={index + 1}
                  isNew={newlyAddedFavoriteIds.has(restaurant.id)}
                  isGoldenBite={restaurant.id === goldenBiteId}
                  onRemove={handleRemoveFavorite}
                  onClearNew={clearNewlyAddedFavorite}
                />
              ))}

              {sortedFavorites.length > BITES_PAGE_SIZE && (
                <Pressable
                  style={[styles.showAllBtn, { backgroundColor: Colors.primaryLight }]}
                  onPress={handleToggleShowAll}
                  accessibilityRole="button"
                  accessibilityLabel={showAllBites ? 'Show fewer bites' : `Show all ${sortedFavorites.length} bites`}
                >
                  <Text style={[styles.showAllBtnText, { color: Colors.primary }]}>
                    {showAllBites
                      ? 'Show Less'
                      : `Show All (${sortedFavorites.length})`}
                  </Text>
                </Pressable>
              )}
            </>
          )}
        </View>

        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: Colors.text }]}>Settings</Text>
          <View style={[styles.prefCard, { backgroundColor: Colors.card }]}>
            <View style={styles.prefRow}>
              <View style={[styles.prefIconCircle, { backgroundColor: Colors.primaryLight }]}>
                <Bell size={16} color={Colors.primary} />
              </View>
              <Text style={[styles.prefLabel, { color: Colors.text }]}>Notifications</Text>
              <Switch
                value={!!preferences.notificationsEnabled}
                onValueChange={handleToggleNotifications}
                trackColor={{ false: Colors.border, true: Colors.primary }}
                thumbColor="#FFF"
                style={{ marginLeft: 'auto' }}
              />
            </View>
            <View style={[styles.prefDivider, { backgroundColor: Colors.borderLight }]} />
            <View style={styles.prefRow}>
              <View style={[styles.prefIconCircle, { backgroundColor: Colors.primaryLight }]}>
                <Moon size={16} color={Colors.primary} />
              </View>
              <Text style={[styles.prefLabel, { color: Colors.text }]}>Dark Mode</Text>
              <Switch
                value={!!preferences.isDarkMode}
                onValueChange={handleToggleDarkMode}
                trackColor={{ false: Colors.border, true: Colors.primary }}
                thumbColor="#FFF"
                style={{ marginLeft: 'auto' }}
                disabled={isAnimating}
              />
            </View>
            <View style={[styles.prefDivider, { backgroundColor: Colors.borderLight }]} />
            <Pressable
              style={styles.prefRow}
              onPress={handleLogout}
              testID="profile-sign-out-btn"
              accessibilityRole="button"
              accessibilityLabel="Sign Out"
            >
              <View style={[styles.prefIconCircle, { backgroundColor: `${Colors.error}18` }]}>
                <LogOut size={16} color={Colors.error} />
              </View>
              <Text style={[styles.prefLabel, { color: Colors.error }]}>Sign Out</Text>
              <ChevronRight size={16} color={Colors.error} style={{ marginLeft: 'auto' }} />
            </Pressable>
          </View>
        </View>

        <View style={{ height: 40 }} />
      </ScrollView>
    </View>
  );
}

// ─── Styles ─────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingBottom: 30,
  },
  header: {
    paddingTop: 12,
    paddingBottom: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerTitle: {
    fontSize: 28,
    fontWeight: '800' as const,
    color: Colors.text,
  },
  friendsBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: Colors.primaryLight,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
  },
  friendsBtnText: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: Colors.primary,
  },
  profileCard: {
    backgroundColor: Colors.card,
    borderRadius: 20,
    padding: 24,
    alignItems: 'center',
    marginBottom: 24,
    shadowColor: Colors.shadowColor,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 10,
    elevation: 2,
  },
  avatarWrap: {
    position: 'relative',
    marginBottom: 12,
  },
  avatarImage: {
    width: 72,
    height: 72,
    borderRadius: 36,
  },
  cameraOverlay: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: Colors.card,
  },
  profileName: {
    fontSize: 22,
    fontWeight: '800' as const,
    color: Colors.text,
  },
  profileSub: {
    fontSize: 14,
    color: Colors.textSecondary,
    marginTop: 2,
  },
  statsRow: {
    flexDirection: 'row',
    marginTop: 20,
    gap: 0,
  },
  stat: {
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  statValue: {
    fontSize: 20,
    fontWeight: '800' as const,
    color: Colors.text,
  },
  statLabel: {
    fontSize: 12,
    color: Colors.textSecondary,
    marginTop: 2,
  },
  statDivider: {
    width: 1,
    height: 30,
    backgroundColor: Colors.border,
  },
  section: {
    marginBottom: 24,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 17,
    fontWeight: '700' as const,
    color: Colors.text,
  },
  editBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: Colors.primaryLight,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 14,
  },
  editBtnText: {
    fontSize: 13,
    fontWeight: '600' as const,
    color: Colors.primary,
  },
  prefCard: {
    backgroundColor: Colors.card,
    borderRadius: 16,
    overflow: 'hidden',
  },
  prefRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    gap: 12,
  },
  prefIconCircle: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: Colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  prefContent: {
    flex: 1,
  },
  prefLabel: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: Colors.text,
  },
  prefValue: {
    fontSize: 12,
    color: Colors.textSecondary,
    marginTop: 1,
  },
  prefDivider: {
    height: 1,
    backgroundColor: Colors.borderLight,
    marginLeft: 58,
  },

  // Your Bites section
  sectionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },

  // TasteDNA
  dnaContainer: {
    borderRadius: 16,
    padding: 14,
    marginBottom: 12,
  },
  dnaBarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
    gap: 8,
  },
  dnaCuisineLabel: {
    fontSize: 11,
    fontWeight: '600' as const,
    width: 72,
  },
  dnaBarTrack: {
    flex: 1,
    height: 8,
    borderRadius: 4,
    overflow: 'hidden' as const,
  },
  dnaBarFill: {
    height: 8,
    borderRadius: 4,
  },
  dnaCountLabel: {
    fontSize: 11,
    fontWeight: '600' as const,
    width: 20,
    textAlign: 'right' as const,
  },
  dnaInsight: {
    fontSize: 12,
    marginTop: 6,
    textAlign: 'center' as const,
  },

  // BiteCard
  biteCard: {
    borderRadius: 16,
    marginBottom: 10,
    overflow: 'visible' as const,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
  biteCardInner: {
    borderRadius: 16,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    overflow: 'hidden' as const,
    borderWidth: 1.5,
  },
  biteThumbWrap: {
    width: 72,
    height: 72,
    borderRadius: 12,
    overflow: 'hidden' as const,
    flexShrink: 0,
  },
  biteThumbImage: {
    width: 72,
    height: 72,
  },
  biteCardBody: {
    flex: 1,
  },
  biteNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  biteName: {
    fontSize: 14,
    fontWeight: '700' as const,
    flex: 1,
  },
  biteCrown: {
    fontSize: 14,
  },
  biteSubLine: {
    fontSize: 12,
    marginTop: 2,
  },
  biteMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 6,
    gap: 8,
    flexWrap: 'wrap' as const,
  },
  biteRatingPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  biteRatingText: {
    fontSize: 12,
    fontWeight: '600' as const,
  },
  biteOpenDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#34C759',
  },
  biteOpenText: {
    fontSize: 11,
    fontWeight: '600' as const,
    color: '#34C759',
  },
  biteDealRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  biteDealText: {
    fontSize: 11,
    fontWeight: '600' as const,
  },
  biteNewBadge: {
    position: 'absolute',
    top: -8,
    left: 12,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
    zIndex: 30,
  },
  biteNewBadgeText: {
    fontSize: 11,
    fontWeight: '800' as const,
    color: '#FFFFFF',
  },
  biteRemoveBtn: {
    padding: 6,
    borderRadius: 12,
  },

  // Pagination
  showAllBtn: {
    alignSelf: 'center',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 20,
    marginTop: 4,
  },
  showAllBtnText: {
    fontSize: 13,
    fontWeight: '700' as const,
  },

  // Empty state
  emptyBitesWrap: {
    borderRadius: 16,
    padding: 28,
    alignItems: 'center',
  },
  emptyBitesText: {
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 16,
  },
  emptyBitesCta: {
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 20,
  },
  emptyBitesCtaText: {
    fontSize: 14,
    fontWeight: '700' as const,
  },
});
