import React, { useRef, useEffect, useCallback, useState } from 'react';
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
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, Redirect } from 'expo-router';
import { CalendarPlus, Flame, TrendingUp, Sparkles, ChevronRight, Users, Bell, Search, UserPlus } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useApp, useNearbyRestaurants } from '../../../context/AppContext';
import { useAuth } from '../../../context/AuthContext';
import RestaurantCard from '../../../components/RestaurantCard';
import { useUnreadCount } from '../../../hooks/useNotifications';
import StaticColors from '../../../constants/colors';
import { useColors } from '../../../context/ThemeContext';
import CrumbTrail from '../../../components/CrumbTrail';
import LocationPermissionModal from '../../../components/LocationPermissionModal';

const Colors = StaticColors;

const SHOW_RECS_KEY = 'chewabl_show_recommendations';

if (Platform.OS === 'android') {
  UIManager.setLayoutAnimationEnabledExperimental?.(true);
}

function ActionGridButton({
  icon: Icon,
  iconColor,
  iconBgColor,
  label,
  subtitle,
  onPress,
}: {
  icon: React.ComponentType<{ size: number; color: string }>;
  iconColor: string;
  iconBgColor: string;
  label: string;
  subtitle: string;
  onPress: () => void;
}) {
  const Colors = useColors();
  const scaleAnim = useRef(new Animated.Value(1)).current;

  return (
    <Pressable
      onPressIn={() => {
        Animated.spring(scaleAnim, { toValue: 0.96, useNativeDriver: true }).start();
      }}
      onPressOut={() => {
        Animated.spring(scaleAnim, { toValue: 1, useNativeDriver: true }).start();
      }}
      onPress={onPress}
      style={{ flex: 1 }}
    >
      <Animated.View
        style={[
          styles.actionCard,
          {
            backgroundColor: Colors.card,
            borderColor: Colors.border,
            transform: [{ scale: scaleAnim }],
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
  } = useApp();
  const { user, isAuthenticated } = useAuth();
  const { data: allRestaurants = [] } = useNearbyRestaurants();
  const showFullUI = isAuthenticated && !isGuest;
  const { data: unreadData } = useUnreadCount(showFullUI);
  const unreadCount = unreadData?.count ?? 0;

  const [showLocationModal, setShowLocationModal] = useState(false);
  const [pendingRoute, setPendingRoute] = useState<string | null>(null);
  const [showRecommendations, setShowRecommendations] = useState(true);

  const lastCallDeals = allRestaurants.filter(r => r.lastCallDeal);
  const lastCallIds = new Set(lastCallDeals.map(r => r.id));
  const tonightNearYou = allRestaurants
    .filter(r => r.isOpenNow && !lastCallIds.has(r.id))
    .slice(0, 5);
  const trendingWithFriends = allRestaurants.filter(r => r.rating >= 4.5).slice(0, 5);
  const basedOnPastPicks = preferences.cuisines.length > 0
    ? allRestaurants.filter(r => preferences.cuisines.includes(r.cuisine)).slice(0, 5)
    : allRestaurants.slice(0, 5);

  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(30)).current;

  // Hydrate showRecommendations from AsyncStorage on mount
  useEffect(() => {
    AsyncStorage.getItem(SHOW_RECS_KEY).then(val => {
      if (val === 'false') setShowRecommendations(false);
    });
  }, []);

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

  const handleLocationGranted = useCallback((coords: { latitude: number; longitude: number }) => {
    setManualLocation(coords);
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
    : 'there';

  return (
    <View style={[styles.container, { paddingTop: insets.top, backgroundColor: Colors.background }]}>
      <Animated.View style={{ opacity: fadeAnim, transform: [{ translateY: slideAnim }], flex: 1 }}>
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.scrollContent}
        >
          <View style={styles.greeting}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.greetingText, { color: Colors.text }]}>Hey {firstName} 👋</Text>
              <Text style={[styles.greetingSubtext, { color: Colors.textSecondary }]}>Where are we eating?</Text>
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

          {/* 2x2 Action Grid */}
          <View style={styles.actionGrid}>
            <View style={styles.actionRow}>
              <ActionGridButton
                icon={Search}
                iconColor="#E85D3A"
                iconBgColor="rgba(232,93,58,0.12)"
                label="Find a Spot"
                subtitle="Swipe to discover"
                onPress={() => navigateWithLocationCheck('/swipe')}
              />
              {showFullUI && (
                <ActionGridButton
                  icon={CalendarPlus}
                  iconColor="#F5A623"
                  iconBgColor="rgba(245,166,35,0.12)"
                  label="Plan an Outing"
                  subtitle="Schedule dining"
                  onPress={() => navigateWithLocationCheck('/plan-event')}
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
                  subtitle="Swipe with friends"
                  onPress={() => navigateWithLocationCheck('/group-session')}
                />
                <ActionGridButton
                  icon={UserPlus}
                  iconColor="#5AC8FA"
                  iconBgColor="rgba(90,200,250,0.12)"
                  label="Invite Friends"
                  subtitle="Grow your crew"
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    router.push('/(tabs)/friends?tab=add' as never);
                  }}
                />
              </View>
            )}
          </View>

          {/* Recommendations toggle */}
          <View style={styles.toggleRow}>
            <Text style={[styles.toggleLabel, { color: Colors.text }]}>Recommendations</Text>
            <Switch
              value={showRecommendations}
              onValueChange={handleToggleRecommendations}
              trackColor={{ false: Colors.border, true: Colors.primary }}
              thumbColor="#FFFFFF"
            />
          </View>

          {showRecommendations && (
            <>
              <View style={styles.section}>
                <View style={styles.sectionHeader}>
                  <View style={styles.sectionTitleRow}>
                    <Sparkles size={18} color={Colors.primary} />
                    <Text style={[styles.sectionTitle, { color: Colors.text }]}>Tonight Near You</Text>
                  </View>
                  <Pressable style={styles.seeAllBtn} onPress={() => router.push('/(tabs)/discover')}>
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
                  <Text style={[styles.emptyText, { color: Colors.textSecondary }]}>No restaurants found nearby</Text>
                )}
              </View>

              <View style={styles.section}>
                <View style={styles.sectionHeader}>
                  <View style={styles.sectionTitleRow}>
                    <Flame size={18} color={Colors.error} />
                    <Text style={[styles.sectionTitle, { color: Colors.text }]}>Last Call Deals</Text>
                  </View>
                  <Pressable style={styles.seeAllBtn} onPress={() => router.push('/(tabs)/discover?filter=deals' as never)}>
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
                  <Text style={[styles.emptyText, { color: Colors.textSecondary }]}>No deals right now</Text>
                )}
              </View>

              <View style={styles.section}>
                <View style={styles.sectionHeader}>
                  <View style={styles.sectionTitleRow}>
                    <TrendingUp size={18} color={Colors.success} />
                    <Text style={[styles.sectionTitle, { color: Colors.text }]}>Popular Nearby</Text>
                  </View>
                </View>
                {trendingWithFriends.length > 0 ? (
                  trendingWithFriends.map(r => (
                    <RestaurantCard key={r.id} restaurant={r} variant="compact" />
                  ))
                ) : (
                  <Text style={[styles.emptyText, { color: Colors.textSecondary }]}>No popular spots found</Text>
                )}
              </View>

              {showFullUI && (
                <View style={styles.section}>
                  <View style={styles.sectionHeader}>
                    <View style={styles.sectionTitleRow}>
                      <Sparkles size={18} color={Colors.secondary} />
                      <Text style={[styles.sectionTitle, { color: Colors.text }]}>Based on Your Picks</Text>
                    </View>
                  </View>
                  {basedOnPastPicks.length > 0 ? (
                    basedOnPastPicks.map(r => (
                      <RestaurantCard key={r.id} restaurant={r} variant="compact" />
                    ))
                  ) : (
                    <Text style={[styles.emptyText, { color: Colors.textSecondary }]}>No recommendations yet</Text>
                  )}
                </View>
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
  greeting: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 16,
    marginBottom: 20,
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
