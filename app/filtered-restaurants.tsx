import React from 'react';
import { View, Text, FlatList, StyleSheet, ActivityIndicator, Pressable } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ArrowLeft, Sparkles, Flame, TrendingUp } from 'lucide-react-native';
import RestaurantCard from '../components/RestaurantCard';
import { useApp, useNearbyRestaurants, useTrendingWithFriends, TrendingRestaurant } from '../context/AppContext';
import StaticColors from '../constants/colors';
import { useColors } from '../context/ThemeContext';
import { Restaurant } from '../types';

const Colors = StaticColors;

// delta D-10d: 'popular' entry removed — Home no longer links to it
type SectionType = 'tonight' | 'deals' | 'picks' | 'trending';

const SECTION_CONFIG: Record<SectionType, { title: string; icon: 'sparkles' | 'flame' | 'trending' }> = {
  tonight: { title: 'Tonight Near You', icon: 'sparkles' },
  deals: { title: 'Closing Soon', icon: 'flame' },
  picks: { title: 'From Your Cuisines', icon: 'sparkles' },
  trending: { title: 'Trending with Friends', icon: 'trending' },
};

export default function FilteredRestaurantsScreen() {
  const Colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { preferences } = useApp();
  const { section } = useLocalSearchParams<{ section?: string }>();
  const sectionType = (section as SectionType) || 'tonight';
  const config = SECTION_CONFIG[sectionType] || SECTION_CONFIG.tonight;

  // Hooks called unconditionally per React rules; gated via enabled per section
  const { data: nearbyData = [], isFetching: isFetchingNearby } = useNearbyRestaurants(
    20,
    undefined,
    undefined,
    { enabled: sectionType !== 'trending' },
  );
  const { data: trendingData, isFetching: isFetchingTrending } = useTrendingWithFriends({
    limit: 30,
    enabled: sectionType === 'trending',
  });

  const isFetching = sectionType === 'trending' ? isFetchingTrending : isFetchingNearby;
  const friendCount = trendingData?.friendCount ?? 0;

  const lastCallDeals = nearbyData.filter(r => r.lastCallDeal);
  const lastCallIds = new Set(lastCallDeals.map(r => r.id));

  let restaurants: Restaurant[] | TrendingRestaurant[];
  if (sectionType === 'trending') {
    restaurants = trendingData?.restaurants ?? [];
  } else if (sectionType === 'tonight') {
    restaurants = nearbyData.filter(r => r.isOpenNow && !lastCallIds.has(r.id));
  } else if (sectionType === 'deals') {
    restaurants = lastCallDeals;
  } else if (sectionType === 'picks') {
    restaurants = preferences.cuisines.length > 0
      ? nearbyData.filter(r => preferences.cuisines.includes(r.cuisine))
      : [];
  } else {
    restaurants = nearbyData;
  }

  const IconComponent = config.icon === 'flame' ? Flame
    : config.icon === 'trending' ? TrendingUp
    : Sparkles;

  // delta D-10d: trending icon uses Colors.primary (not Colors.success)
  const iconColor = config.icon === 'flame' ? Colors.error
    : config.icon === 'trending' ? Colors.primary
    : Colors.primary;

  // Empty state for 'picks' when user has no cuisine preferences set
  const PicksEmptyState = () => {
    const Colors = useColors();
    return (
      <View style={[styles.trendingEmpty, { backgroundColor: Colors.background }]}>
        <Text style={[styles.trendingEmptyHeadline, { color: Colors.text }]}>Tell us what you love</Text>
        <Text style={[styles.trendingEmptyBody, { color: Colors.textSecondary }]}>
          Pick a few cuisines and we'll surface restaurants tailored to you.
        </Text>
        <Pressable
          style={[styles.invitePill, { backgroundColor: Colors.primary }]}
          onPress={() => router.push('/(tabs)/profile/edit' as never)}
          accessibilityRole="button"
          accessibilityLabel="Set preferences"
        >
          <Text style={styles.invitePillText}>Set preferences</Text>
        </Pressable>
      </View>
    );
  };

  // Conditional empty state for trending (REQ-009, delta D-4, D-9, D-10d)
  const TrendingEmptyState = () => {
    const Colors = useColors();
    const headline = friendCount === 0
      ? "Your circle hasn't dropped any pins yet"
      : 'No trending picks yet';
    const body = friendCount === 0
      ? "Save spots together or invite friends — their picks will show up here as they save spots."
      : "Your friends haven't saved or planned anywhere new lately. Check back soon!";
    return (
      <View style={[styles.trendingEmpty, { backgroundColor: Colors.background }]}>
        {/* Hero: 3 placeholder avatar circles */}
        <View style={styles.placeholderAvatarRow}>
          {[0, 1, 2].map(i => (
            <View
              key={i}
              style={[
                styles.placeholderAvatar,
                {
                  backgroundColor: Colors.border,
                  marginLeft: i === 0 ? 0 : -10,
                },
              ]}
            >
              <Text style={{ color: Colors.textSecondary, fontSize: 14, fontWeight: '600', opacity: 0.6 }}>?</Text>
            </View>
          ))}
        </View>
        <Text style={[styles.trendingEmptyHeadline, { color: Colors.text }]}>{headline}</Text>
        <Text style={[styles.trendingEmptyBody, { color: Colors.textSecondary }]}>{body}</Text>
        {/* Primary CTA */}
        <Pressable
          style={[styles.invitePill, { backgroundColor: Colors.primary }]}
          onPress={() => router.push('/(tabs)/friends?tab=add' as never)}
          accessibilityRole="button"
          accessibilityLabel="Invite Friends"
        >
          <Text style={styles.invitePillText}>Invite Friends →</Text>
        </Pressable>
        {/* Secondary CTA */}
        <Pressable
          onPress={() => router.push('/filtered-restaurants?section=tonight' as never)}
          accessibilityRole="button"
          accessibilityLabel="Browse all nearby"
        >
          <Text style={[styles.browseLink, { color: Colors.primary }]}>Browse all nearby</Text>
        </Pressable>
      </View>
    );
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top, backgroundColor: Colors.background }]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backBtn} accessibilityLabel="Go back">
          <ArrowLeft size={20} color={Colors.text} />
        </Pressable>
        <IconComponent size={22} color={iconColor} />
        <Text style={[styles.headerTitle, { color: Colors.text }]}>{config.title}</Text>
      </View>

      {isFetching && restaurants.length === 0 && (
        <View style={styles.loadingRow}>
          <ActivityIndicator size="small" color={Colors.primary} />
        </View>
      )}

      <FlatList
        data={restaurants}
        keyExtractor={item => item.id}
        renderItem={({ item }) => {
          if (sectionType === 'trending') {
            const trendingItem = item as TrendingRestaurant;
            return (
              <RestaurantCard
                restaurant={trendingItem}
                variant="vertical"
                friendEngagement={trendingItem.friendEngagement}
                disableSocialAnim={true}
              />
            );
          }
          return <RestaurantCard restaurant={item} variant="vertical" />;
        }}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={
          !isFetching ? (
            sectionType === 'trending' ? (
              <TrendingEmptyState />
            ) : sectionType === 'picks' && preferences.cuisines.length === 0 ? (
              <PicksEmptyState />
            ) : (
              <View style={styles.emptyState}>
                <Text style={[styles.emptyTitle, { color: Colors.text }]}>No restaurants found</Text>
                <Text style={[styles.emptySubtext, { color: Colors.textSecondary }]}>
                  Try adjusting your preferences in your profile
                </Text>
              </View>
            )
          ) : undefined
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  header: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 12,
    gap: 8,
  },
  backBtn: {
    marginRight: 4,
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: '700' as const,
    color: Colors.text,
  },
  loadingRow: {
    paddingVertical: 20,
    alignItems: 'center' as const,
  },
  listContent: {
    paddingHorizontal: 20,
    paddingBottom: 40,
    gap: 12,
  },
  emptyState: {
    alignItems: 'center' as const,
    paddingTop: 60,
    gap: 8,
  },
  emptyTitle: {
    fontSize: 17,
    fontWeight: '600' as const,
    color: Colors.text,
  },
  emptySubtext: {
    fontSize: 14,
    color: Colors.textSecondary,
    textAlign: 'center' as const,
  },
  // Trending empty state styles
  trendingEmpty: {
    alignItems: 'center' as const,
    paddingTop: 60,
    paddingHorizontal: 32,
    gap: 12,
  },
  placeholderAvatarRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    marginBottom: 8,
  },
  placeholderAvatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  trendingEmptyHeadline: {
    fontSize: 17,
    fontWeight: '700' as const,
    color: Colors.text,
    textAlign: 'center' as const,
  },
  trendingEmptyBody: {
    fontSize: 14,
    color: Colors.textSecondary,
    textAlign: 'center' as const,
    lineHeight: 20,
  },
  invitePill: {
    height: 48,
    paddingHorizontal: 28,
    borderRadius: 24,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    marginTop: 4,
  },
  invitePillText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700' as const,
  },
  browseLink: {
    fontSize: 13,
    fontWeight: '600' as const,
    color: Colors.primary,
    marginTop: 4,
  },
});
