import React, { useRef, useEffect, useCallback, useState, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  Animated,
  FlatList,
  Platform,
  Switch,
  LayoutAnimation,
  UIManager,
  AccessibilityInfo,
  Linking,
} from 'react-native';
import Svg, { Defs, Mask, Rect, Circle } from 'react-native-svg';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, Redirect } from 'expo-router';
import { CalendarPlus, Flame, TrendingUp, Sparkles, ChevronRight, Users, Bell, Compass, UserPlus, MapPin, X } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useApp, useNearbyRestaurants, useTrendingWithFriends } from '../../../context/AppContext';
import { useAuth } from '../../../context/AuthContext';
import RestaurantCard from '../../../components/RestaurantCard';
import RestaurantCardSkeleton from '../../../components/RestaurantCardSkeleton';
import { useUnreadCount } from '../../../hooks/useNotifications';
import StaticColors from '../../../constants/colors';
import { useColors } from '../../../context/ThemeContext';
import { useThemeTransition, buildGuestEntryChompConfig, buildSignUpChompConfig } from '../../../context/ThemeTransitionContext';
import { recordGuestAppOpen, hasNudgeBeenShown, markNudgeShown, markTriggerDismissed } from '../../../lib/guestFunnel';
import ConversionPrompt from '../../../components/ConversionPrompt';
import CrumbTrail from '../../../components/CrumbTrail';
import { generateScallops } from '../../../lib/scallopUtils';
import LocationPermissionModal from '../../../components/LocationPermissionModal';
import Snackbar from '../../../components/Snackbar';

const Colors = StaticColors;

const SHOW_RECS_KEY = 'chewabl_show_recommendations';

if (Platform.OS === 'android') {
  UIManager.setLayoutAnimationEnabledExperimental?.(true);
}

const BITE_SIZE = 44;

function ChompBiteMark({ bgColor }: { bgColor: string }) {
  const scallops = useMemo(
    () => generateScallops(0, BITE_SIZE * 0.8, -Math.PI * 0.25, Math.PI * 0.75, BITE_SIZE * 0.22, 0.6),
    [],
  );
  const cx = 0;
  const cy = 0;
  const mainR = BITE_SIZE * 0.8;

  return (
    <View style={{ position: 'absolute', top: -BITE_SIZE * 0.35, left: -BITE_SIZE * 0.35, zIndex: 1 }}>
      <Svg width={BITE_SIZE} height={BITE_SIZE}>
        <Defs>
          <Mask id="heroBiteMask">
            <Rect width={BITE_SIZE} height={BITE_SIZE} fill="black" />
            <Circle cx={cx} cy={cy} r={mainR * 0.85} fill="white" />
            {scallops.map((sc, i) => (
              <Circle
                key={i}
                cx={cx + mainR * Math.cos(sc.angle)}
                cy={cy + mainR * Math.sin(sc.angle)}
                r={sc.radius}
                fill="white"
              />
            ))}
          </Mask>
        </Defs>
        <Rect width={BITE_SIZE} height={BITE_SIZE} fill={bgColor} mask="url(#heroBiteMask)" />
      </Svg>
    </View>
  );
}

function ActionGridButton({
  icon: Icon,
  iconColor,
  iconBgColor,
  label,
  subtitle,
  onPress,
  staggerDelay = 0,
  testID,
}: {
  icon: React.ComponentType<{ size: number; color: string }>;
  iconColor: string;
  iconBgColor: string;
  label: string;
  subtitle: string;
  onPress: () => void;
  staggerDelay?: number;
  testID?: string;
}) {
  const Colors = useColors();
  const scaleAnim = useRef(new Animated.Value(1)).current;
  const entryOpacity = useRef(new Animated.Value(0)).current;
  const entrySlide = useRef(new Animated.Value(20)).current;

  // Staggered fade+slide entrance
  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then((reduced) => {
      if (reduced) {
        entryOpacity.setValue(1);
        entrySlide.setValue(0);
        return;
      }
      const timer = setTimeout(() => {
        Animated.parallel([
          Animated.timing(entryOpacity, { toValue: 1, duration: 400, useNativeDriver: true }),
          Animated.spring(entrySlide, { toValue: 0, damping: 24, stiffness: 160, useNativeDriver: true }),
        ]).start();
      }, staggerDelay);
      return () => clearTimeout(timer);
    });
  }, [staggerDelay, entryOpacity, entrySlide]);

  return (
    <Pressable
      onPressIn={() => {
        Animated.spring(scaleAnim, { toValue: 0.96, useNativeDriver: true }).start();
      }}
      onPressOut={() => {
        Animated.spring(scaleAnim, { toValue: 1, useNativeDriver: true }).start();
      }}
      onPress={onPress}
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={`${label}, ${subtitle}`}
      style={{ flex: 1 }}
    >
      <Animated.View
        style={[
          styles.actionCard,
          {
            flex: 1,
            backgroundColor: Colors.card,
            borderColor: Colors.border,
            transform: [{ scale: scaleAnim }, { translateY: entrySlide }],
            opacity: entryOpacity,
          },
        ]}
      >
        <View style={[styles.iconCircle, { backgroundColor: iconBgColor }]}>
          <Icon size={24} color={iconColor} />
        </View>
        <Text style={[styles.actionLabel, { color: Colors.text }]}>{label}</Text>
        <Text style={[styles.actionSubtitle, { color: Colors.textSecondary }]}>{subtitle}</Text>
      </Animated.View>
    </Pressable>
  );
}

export default function HomeScreen() {
  const Colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const {
    preferences,
    isOnboarded,
    isGuest,
    setGuestMode,
    isLoading,
    locationPermission,
    requestLocation,
    userLocation,
    setManualLocation,
    locationSource,
    manualLocationLabel,
    clearManualLocation,
  } = useApp();
  const { user, isAuthenticated } = useAuth();
  const { requestChomp, isAnimating } = useThemeTransition();
  const { data: allRestaurants = [], isLoading: isRestaurantsLoading } = useNearbyRestaurants(20);
  const { data: trendingData } = useTrendingWithFriends({ limit: 10 });
  const showFullUI = isAuthenticated && !isGuest;
  const { data: unreadData } = useUnreadCount(showFullUI);
  const unreadCount = unreadData?.count ?? 0;

  const [showLocationModal, setShowLocationModal] = useState(false);
  const [pendingRoute, setPendingRoute] = useState<string | null>(null);
  const [showRecommendations, setShowRecommendations] = useState(true);
  const [nudgeVisible, setNudgeVisible] = useState(false);
  const [welcomeSnackbar, setWelcomeSnackbar] = useState<{
    inviterId: string;
    firstName: string;
    avatarUri?: string;
  } | null>(null);
  const guestChompFired = useRef(false);
  // D-3 fix: guards double-count across effect re-runs within the same mount
  const hasIncrementedRef = useRef(false);

  const { lastCallDeals, tonightNearYou, trending, basedOnPastPicks } = useMemo(() => {
    const claimed = new Set<string>();

    // Dedup claim order: Last Call → Trending → Tonight → Picks (delta D-7)
    const lastCallDeals = allRestaurants.filter(r => r.lastCallDeal);
    lastCallDeals.forEach(r => claimed.add(r.id));

    // Trending claims before Tonight (delta D-7)
    const trendingList = trendingData?.restaurants ?? [];
    const trendingFiltered = trendingList.filter(r => !claimed.has(r.id));
    trendingFiltered.forEach(r => claimed.add(r.id));
    // Per delta D-10c: return null when empty so JSX uses one truthiness check
    const trending = trendingFiltered.length > 0 ? trendingFiltered : null;

    const tonightNearYou = allRestaurants.filter(r => r.isOpenNow && !claimed.has(r.id));
    tonightNearYou.forEach(r => claimed.add(r.id));

    const picksPool = preferences.cuisines.length > 0
      ? allRestaurants.filter(r => preferences.cuisines.includes(r.cuisine))
      : allRestaurants;
    const basedOnPastPicks = picksPool.filter(r => !claimed.has(r.id));

    return { lastCallDeals, tonightNearYou, trending, basedOnPastPicks };
  }, [allRestaurants, trendingData, preferences.cuisines]);

  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(30)).current;

  // Fire a mini-Chomp welcome animation for guests on first visit
  useEffect(() => {
    if (isGuest && !isLoading && isOnboarded && !guestChompFired.current) {
      guestChompFired.current = true;
      requestChomp(buildGuestEntryChompConfig(Colors.primary), () => {});
    }
  }, [isGuest, isLoading, isOnboarded, requestChomp, Colors.primary]);

  // REQ-007: increment guest app-open counter on mount; show nudge at count=3
  // D-3 fix: depend on [isGuest, isLoading, isOnboarded] — mirrors guestChompFired pattern
  useEffect(() => {
    if (!isGuest || isLoading || !isOnboarded) return;
    if (hasIncrementedRef.current) return;
    hasIncrementedRef.current = true;

    (async () => {
      const count = await recordGuestAppOpen();
      if (count < 3) return;
      const alreadyShown = await hasNudgeBeenShown();
      if (alreadyShown) return;
      await markNudgeShown();
      setNudgeVisible(true);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    })();
  }, [isGuest, isLoading, isOnboarded]);

  // D-1 fix: guard requestChomp with isAnimating; fall back to direct push
  const handleNudgeAccept = useCallback(() => {
    setNudgeVisible(false);
    if (!isAnimating) {
      requestChomp(buildSignUpChompConfig(Colors.primary), () => {
        router.push('/auth?intent=signup' as never);
      });
    } else {
      router.push('/auth?intent=signup' as never);
    }
  }, [isAnimating, requestChomp, Colors.primary, router]);

  const handleNudgeDismiss = useCallback(() => {
    markTriggerDismissed('nudge');
    setNudgeVisible(false);
  }, []);

  // Hydrate showRecommendations from AsyncStorage on mount
  useEffect(() => {
    AsyncStorage.getItem(SHOW_RECS_KEY).then(val => {
      if (val === 'false') setShowRecommendations(false);
    });
  }, []);

  // Read welcome snackbar state written by AuthContext.signUp on successful invite-code signup
  useEffect(() => {
    if (!isAuthenticated || !user?.id) return;
    const key = `chewabl:welcome-snackbar-pending:${user.id}`;
    AsyncStorage.getItem(key).then(raw => {
      if (!raw) return;
      AsyncStorage.removeItem(key);
      const payload = JSON.parse(raw) as { inviterId: string; firstName: string; avatarUri?: string };
      setWelcomeSnackbar({ inviterId: payload.inviterId, firstName: payload.firstName, avatarUri: payload.avatarUri });
    });
  }, [user?.id, isAuthenticated]);

  useEffect(() => {
    if (!isLoading && isOnboarded) {
      Animated.parallel([
        Animated.timing(fadeAnim, { toValue: 1, duration: 600, useNativeDriver: true }),
        Animated.timing(slideAnim, { toValue: 0, duration: 600, useNativeDriver: true }),
      ]).start();
    }
  }, [isOnboarded, isLoading]);

  // Navigate after location is granted via OS permission path
  useEffect(() => {
    if (userLocation && pendingRoute && showLocationModal) {
      router.push(pendingRoute as never);
      setShowLocationModal(false);
      setPendingRoute(null);
    }
  }, [userLocation, pendingRoute, showLocationModal, router]);

  const navigateWithLocationCheck = useCallback((route: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (userLocation) {
      router.push(route as never);
    } else {
      setPendingRoute(route);
      setShowLocationModal(true);
    }
  }, [userLocation, router]);

  const handleLocationGranted = useCallback((coords: { latitude: number; longitude: number }, label?: string) => {
    setManualLocation(coords, label);
    if (pendingRoute) {
      router.push(pendingRoute as never);
    }
    setShowLocationModal(false);
    setPendingRoute(null);
  }, [setManualLocation, pendingRoute, router]);

  const handleLocationModalClose = useCallback(() => {
    setShowLocationModal(false);
    setPendingRoute(null);
  }, []);

  const handleToggleRecommendations = useCallback((value: boolean) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setShowRecommendations(value);
    AsyncStorage.setItem(SHOW_RECS_KEY, String(value));
  }, []);

  if (isLoading) {
    return (
      <View style={[styles.container, styles.centered, { backgroundColor: Colors.background }]}>
        <CrumbTrail size="large" />
      </View>
    );
  }

  if (!isAuthenticated && !isGuest) {
    return <Redirect href={'/auth' as never} />;
  }

  if (!isOnboarded) {
    return <Redirect href={'/onboarding' as never} />;
  }

  const firstName = showFullUI
    ? (user?.name?.split(' ')[0] || preferences.name.split(' ')[0] || 'there')
    : null;

  return (
    <View style={[styles.container, { paddingTop: insets.top, backgroundColor: Colors.background }]}>
      <Animated.View style={{ opacity: fadeAnim, transform: [{ translateY: slideAnim }], flex: 1 }}>
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.scrollContent}
        >
          {/* Gradient hero banner */}
          <LinearGradient
            colors={
              Colors.background === '#1C1917'
                ? ['rgba(232,93,58,0.15)', 'rgba(245,166,35,0.06)', 'transparent']
                : ['rgba(232,93,58,0.10)', 'rgba(245,166,35,0.04)', 'transparent']
            }
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={[styles.heroBanner, { overflow: 'hidden' as const }]}
          >
            {/* Chomp bite mark — reuses scallop shape from theme transition */}
            <ChompBiteMark bgColor={Colors.background} />
            <View style={styles.greeting}>
              <View style={{ flex: 1 }}>
                {firstName ? (
                  <>
                    <Text style={[styles.greetingText, { color: Colors.text }]}>Hey {firstName} 👋</Text>
                    <Text style={[styles.greetingSubtext, { color: Colors.textSecondary }]}>Where are we eating?</Text>
                  </>
                ) : (
                  <>
                    <Text style={[styles.greetingText, { color: Colors.text }]}>Welcome to Chewabl</Text>
                    <Text style={[styles.greetingSubtext, { color: Colors.textSecondary }]}>Find your next favorite spot</Text>
                  </>
                )}
              </View>
              {showFullUI ? (
                <Pressable
                  onPress={() => router.push('/notifications' as never)}
                  style={styles.bellBtn}
                  testID="notifications-bell-btn"
                  accessibilityLabel={`Notifications${unreadCount > 0 ? `, ${unreadCount} unread` : ''}`}
                  accessibilityRole="button"
                >
                  <Bell size={24} color={Colors.text} />
                  {unreadCount > 0 && (
                    <View style={styles.badge}>
                      <Text style={styles.badgeText}>{unreadCount > 99 ? '99+' : unreadCount}</Text>
                    </View>
                  )}
                </Pressable>
              ) : (
                <Pressable
                  onPress={async () => { await setGuestMode(false); router.replace('/auth' as never); }}
                  style={styles.bellBtn}
                  accessibilityLabel="Sign In"
                  accessibilityRole="button"
                >
                  <Text style={{ color: Colors.primary, fontSize: 15, fontWeight: '600' }}>Sign In</Text>
                </Pressable>
              )}
            </View>
          </LinearGradient>

          {/* 2x2 Action Grid */}
          <View style={styles.actionGrid}>
            <View style={styles.actionRow}>
              <ActionGridButton
                icon={Compass}
                iconColor="#E85D3A"
                iconBgColor="rgba(232,93,58,0.12)"
                label="Find a Spot"
                subtitle="Swipe for restaurants"
                onPress={() => navigateWithLocationCheck('/swipe')}
                staggerDelay={0}
                testID="eat-now-btn"
              />
              {showFullUI ? (
                <ActionGridButton
                  icon={CalendarPlus}
                  iconColor="#F5A623"
                  iconBgColor="rgba(245,166,35,0.12)"
                  label="Plan an Outing"
                  subtitle="Pick a date & place"
                  onPress={() => navigateWithLocationCheck('/plan-event')}
                  staggerDelay={100}
                  testID="plan-later-btn"
                />
              ) : (
                <ActionGridButton
                  icon={Sparkles}
                  iconColor="#F5A623"
                  iconBgColor="rgba(245,166,35,0.12)"
                  label="Create account"
                  subtitle="Unlock all features"
                  onPress={async () => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    await setGuestMode(false);
                    router.replace('/auth' as never);
                  }}
                  staggerDelay={100}
                  testID="join-chewabl-btn"
                />
              )}
            </View>
            {showFullUI && (
              <View style={styles.actionRow}>
                <ActionGridButton
                  icon={Users}
                  iconColor="#34C759"
                  iconBgColor="rgba(52,199,89,0.12)"
                  label="Get Together Now"
                  subtitle="Group swipe session"
                  onPress={() => navigateWithLocationCheck('/group-session')}
                  staggerDelay={200}
                  testID="group-swipe-btn"
                />
                <ActionGridButton
                  icon={UserPlus}
                  iconColor="#5AC8FA"
                  iconBgColor="rgba(90,200,250,0.12)"
                  label="Invite Friends"
                  subtitle="Add your crew"
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    router.push('/(tabs)/friends?tab=add' as never);
                  }}
                  staggerDelay={300}
                  testID="invite-friends-btn"
                />
              </View>
            )}
          </View>

          {locationSource === 'manual' && userLocation && (
            <View style={[styles.manualLocationBanner, { backgroundColor: Colors.card, borderColor: Colors.border }]}>
              <MapPin size={14} color={Colors.primary} />
              <Text style={[styles.manualLocationText, { color: Colors.text }]} numberOfLines={1}>
                {manualLocationLabel
                  ? <>Using location for <Text style={styles.manualLocationEmphasis}>{manualLocationLabel}</Text></>
                  : 'Using custom location'}
              </Text>
              <Pressable
                onPress={() => {
                  Haptics.selectionAsync();
                  setShowLocationModal(true);
                }}
                accessibilityRole="button"
                accessibilityLabel="Change location"
              >
                <Text style={[styles.manualLocationAction, { color: Colors.primary }]}>Change</Text>
              </Pressable>
              <Pressable
                onPress={() => {
                  Haptics.selectionAsync();
                  clearManualLocation();
                }}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="Clear custom location"
              >
                <X size={16} color={Colors.textSecondary} />
              </Pressable>
            </View>
          )}

          {/* Recommendations toggle */}
          <View style={styles.toggleRow}>
            <View>
              <Text style={[styles.toggleLabel, { color: Colors.text }]}>Nearby Picks</Text>
              <Text style={[styles.toggleSubtitle, { color: Colors.textTertiary }]}>Restaurants curated for you</Text>
            </View>
            <Switch
              value={showRecommendations}
              onValueChange={handleToggleRecommendations}
              trackColor={{ false: Colors.border, true: Colors.primary }}
              thumbColor="#FFFFFF"
              accessibilityLabel="Show nearby picks"
              accessibilityRole="switch"
            />
          </View>

          {showRecommendations && !userLocation && (
            <View style={styles.locationEmpty}>
              <Text style={styles.locationEmoji}>📍</Text>
              <Text style={[styles.locationTitle, { color: Colors.text }]}>
                {locationPermission === 'denied' ? 'Location is turned off' : 'We need your location'}
              </Text>
              <Text style={[styles.locationSubtitle, { color: Colors.textSecondary }]}>
                {locationPermission === 'denied'
                  ? 'Enable location access in Settings to see your nearby picks.'
                  : 'Allow location access so we can curate restaurants near you.'}
              </Text>
              <Pressable
                style={[styles.locationCta, { backgroundColor: Colors.primary }]}
                onPress={() => {
                  Haptics.selectionAsync();
                  if (locationPermission === 'denied') {
                    Linking.openSettings();
                  } else {
                    requestLocation();
                  }
                }}
              >
                <Text style={styles.locationCtaText}>
                  {locationPermission === 'denied' ? 'Open Settings' : 'Enable location'}
                </Text>
              </Pressable>
            </View>
          )}

          {showRecommendations && userLocation && (
            <>
              {/* #169: only render section when data exists or still loading */}
              {(() => {
                const tonightVisible = tonightNearYou.length > 0 || isRestaurantsLoading;
                const lastCallVisible = lastCallDeals.length > 0 || isRestaurantsLoading;
                return (
                  <>
                    {tonightVisible && (
                      <View style={styles.section}>
                        <View style={styles.sectionHeader}>
                          <View style={styles.sectionTitleRow}>
                            <Sparkles size={18} color={Colors.primary} />
                            <Text style={[styles.sectionTitle, { color: Colors.text }]}>Tonight Near You</Text>
                          </View>
                          <Pressable style={styles.seeAllBtn} onPress={() => router.push('/filtered-restaurants?section=tonight' as never)}>
                            <Text style={[styles.seeAllText, { color: Colors.primary }]}>See all</Text>
                            <ChevronRight size={14} color={Colors.primary} />
                          </Pressable>
                        </View>
                        {tonightNearYou.length > 0 ? (
                          <FlatList
                            horizontal
                            showsHorizontalScrollIndicator={false}
                            data={tonightNearYou}
                            keyExtractor={item => item.id}
                            renderItem={({ item }) => <RestaurantCard restaurant={item} variant="horizontal" />}
                            contentContainerStyle={styles.horizontalList}
                          />
                        ) : (
                          <View style={styles.horizontalList}>
                            {[0, 1, 2].map(i => (
                              <RestaurantCardSkeleton key={i} variant="horizontal" />
                            ))}
                          </View>
                        )}
                      </View>
                    )}

                    {/* Section divider — only when both sections are visible */}
                    {tonightVisible && lastCallVisible && (
                      <LinearGradient
                        colors={['transparent', Colors.primary + '30', 'transparent']}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 1, y: 0 }}
                        style={styles.sectionDivider}
                      />
                    )}

                    {lastCallVisible && (
                      <View style={styles.section}>
                        <View style={styles.sectionHeader}>
                          <View style={styles.sectionTitleRow}>
                            <Flame size={18} color={Colors.error} />
                            <Text style={[styles.sectionTitle, { color: Colors.text }]}>Last Call Deals</Text>
                          </View>
                          <Pressable style={styles.seeAllBtn} onPress={() => router.push('/filtered-restaurants?section=deals' as never)}>
                            <Text style={[styles.seeAllText, { color: Colors.primary }]}>See all</Text>
                            <ChevronRight size={14} color={Colors.primary} />
                          </Pressable>
                        </View>
                        {lastCallDeals.length > 0 ? (
                          <FlatList
                            horizontal
                            showsHorizontalScrollIndicator={false}
                            data={lastCallDeals}
                            keyExtractor={item => item.id}
                            renderItem={({ item }) => <RestaurantCard restaurant={item} variant="horizontal" />}
                            contentContainerStyle={styles.horizontalList}
                          />
                        ) : (
                          <View style={styles.horizontalList}>
                            {[0, 1, 2].map(i => (
                              <RestaurantCardSkeleton key={i} variant="horizontal" />
                            ))}
                          </View>
                        )}
                      </View>
                    )}
                  </>
                );
              })()}

              {/* Trending with Friends section — omitted when empty (delta D-10c) */}
              {trending && (
                <>
                  <LinearGradient
                    colors={['transparent', Colors.primary + '30', 'transparent']}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 0 }}
                    style={styles.sectionDivider}
                  />

                  <View style={styles.section}>
                    <View style={styles.sectionHeader}>
                      <View style={styles.sectionTitleRow}>
                        {/* TrendingUp icon in Colors.primary (delta D-8 / PRD §3.1 #18) */}
                        <TrendingUp size={18} color={Colors.primary} />
                        <Text style={[styles.sectionTitle, { color: Colors.text }]}>Trending with Friends</Text>
                      </View>
                      <Pressable style={styles.seeAllBtn} onPress={() => router.push('/filtered-restaurants?section=trending' as never)}>
                        <Text style={[styles.seeAllText, { color: Colors.primary }]}>See all</Text>
                        <ChevronRight size={14} color={Colors.primary} />
                      </Pressable>
                    </View>
                    {/* v2: first-view haptic — needs parent-ScrollView scroll instrumentation */}
                    {trending.map(r => (
                      <RestaurantCard
                        key={r.id}
                        restaurant={r}
                        variant="compact"
                        friendEngagement={r.friendEngagement}
                      />
                    ))}
                  </View>
                </>
              )}

              {showFullUI && (
                <>
                  {/* Section divider */}
                  <LinearGradient
                    colors={['transparent', Colors.primary + '30', 'transparent']}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 0 }}
                    style={styles.sectionDivider}
                  />

                  <View style={styles.section}>
                    <View style={styles.sectionHeader}>
                      <View style={styles.sectionTitleRow}>
                        <Sparkles size={18} color={Colors.secondary} />
                        <Text style={[styles.sectionTitle, { color: Colors.text }]}>Based on Your Picks</Text>
                      </View>
                      <Pressable style={styles.seeAllBtn} onPress={() => router.push('/filtered-restaurants?section=picks' as never)}>
                        <Text style={[styles.seeAllText, { color: Colors.primary }]}>See all</Text>
                        <ChevronRight size={14} color={Colors.primary} />
                      </Pressable>
                    </View>
                    {basedOnPastPicks.length > 0 ? (
                      basedOnPastPicks.map(r => (
                        <RestaurantCard key={r.id} restaurant={r} variant="compact" />
                      ))
                    ) : isRestaurantsLoading ? (
                      [0, 1, 2].map(i => (
                        <RestaurantCardSkeleton key={i} variant="compact" />
                      ))
                    ) : (
                      <Text style={[styles.emptyText, { color: Colors.textSecondary }]}>No recommendations yet</Text>
                    )}
                  </View>
                </>
              )}
            </>
          )}

          <View style={{ height: 20 }} />
        </ScrollView>
      </Animated.View>

      <LocationPermissionModal
        visible={showLocationModal}
        onClose={handleLocationModalClose}
        onLocationGranted={handleLocationGranted}
        onRequestLocation={requestLocation}
        locationPermission={locationPermission}
        initialZipCode={manualLocationLabel ?? ''}
      />

      {/* REQ-007: soft nudge prompt on 3rd guest app-open */}
      {isGuest && (
        <ConversionPrompt
          visible={nudgeVisible}
          trigger="nudge"
          onAccept={handleNudgeAccept}
          onDismiss={handleNudgeDismiss}
        />
      )}

      {/* Welcome snackbar — shown on first dashboard mount after invite-code signup */}
      <Snackbar
        visible={welcomeSnackbar !== null}
        message={`You're friends with ${welcomeSnackbar?.firstName ?? ''} ✨`}
        onDismiss={() => setWelcomeSnackbar(null)}
        onPress={() => {
          setWelcomeSnackbar(null);
          if (welcomeSnackbar?.inviterId) {
            router.push(`/friend-plans/${welcomeSnackbar.inviterId}` as never);
          }
        }}
        bgColor={Colors.primaryLight}
        textColor={Colors.primary}
        borderColor={Colors.primary + '4D'}
        avatarUri={welcomeSnackbar?.avatarUri}
        avatarLabel={welcomeSnackbar?.firstName}
        autoDismissMs={5000}
        entranceVariant="celebratory"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  centered: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingBottom: 30,
  },
  heroBanner: {
    marginHorizontal: -20,
    paddingHorizontal: 20,
    paddingTop: 4,
    paddingBottom: 8,
    marginBottom: 4,
  },
  greeting: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 16,
    marginBottom: 12,
  },
  greetingText: {
    fontSize: 28,
    fontWeight: '800' as const,
    color: Colors.text,
  },
  greetingSubtext: {
    fontSize: 16,
    color: Colors.textSecondary,
    marginTop: 4,
  },
  actionGrid: {
    gap: 12,
    marginBottom: 20,
  },
  actionRow: {
    flexDirection: 'row',
    gap: 12,
  },
  actionCard: {
    backgroundColor: Colors.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 20,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 140,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 6,
    elevation: 2,
  },
  iconCircle: {
    width: 48,
    height: 48,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  actionLabel: {
    fontSize: 15,
    fontWeight: '700' as const,
    color: Colors.text,
    textAlign: 'center',
  },
  actionSubtitle: {
    fontSize: 12,
    color: Colors.textSecondary,
    marginTop: 2,
    textAlign: 'center',
  },
  toggleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 14,
    marginBottom: 16,
  },
  toggleLabel: {
    fontSize: 16,
    fontWeight: '600' as const,
    color: Colors.text,
  },
  toggleSubtitle: {
    fontSize: 12,
    color: Colors.textTertiary,
    marginTop: 2,
  },
  sectionDivider: {
    height: 1.5,
    marginBottom: 20,
    borderRadius: 1,
  },
  section: {
    marginBottom: 24,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 14,
  },
  sectionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700' as const,
    color: Colors.text,
  },
  seeAllBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  seeAllText: {
    fontSize: 13,
    fontWeight: '600' as const,
    color: Colors.primary,
  },
  horizontalList: {
    paddingRight: 20,
  },
  emptyText: {
    fontSize: 14,
    color: Colors.textSecondary,
    fontStyle: 'italic',
    paddingVertical: 8,
  },
  locationEmpty: {
    alignItems: 'center',
    paddingHorizontal: 32,
    paddingVertical: 32,
  },
  locationEmoji: {
    fontSize: 48,
    marginBottom: 12,
  },
  locationTitle: {
    fontSize: 18,
    fontWeight: '700' as const,
  },
  locationSubtitle: {
    fontSize: 14,
    color: Colors.textSecondary,
    marginTop: 4,
    textAlign: 'center',
  },
  locationCta: {
    marginTop: 20,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 24,
  },
  locationCtaText: {
    color: '#FFF',
    fontWeight: '700' as const,
    fontSize: 15,
  },
  manualLocationBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 16,
    marginTop: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
  },
  manualLocationText: {
    flex: 1,
    fontSize: 13,
  },
  manualLocationEmphasis: {
    fontWeight: '700' as const,
  },
  manualLocationAction: {
    fontSize: 13,
    fontWeight: '700' as const,
    paddingHorizontal: 4,
  },
  bellBtn: {
    position: 'relative',
    padding: 8,
  },
  badge: {
    position: 'absolute',
    top: 2,
    right: 2,
    backgroundColor: '#FF3B30',
    borderRadius: 10,
    minWidth: 20,
    height: 20,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  badgeText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '700',
  },
});
