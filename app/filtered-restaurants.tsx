import React from 'react';
import { View, Text, FlatList, StyleSheet, ActivityIndicator, Pressable } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ArrowLeft, Sparkles, Flame, TrendingUp } from 'lucide-react-native';
import RestaurantCard from '../components/RestaurantCard';
import { useApp, useNearbyRestaurants } from '../context/AppContext';
import StaticColors from '../constants/colors';
import { useColors } from '../context/ThemeContext';

const Colors = StaticColors;

type SectionType = 'tonight' | 'deals' | 'popular' | 'picks';

const SECTION_CONFIG: Record<SectionType, { title: string; icon: 'sparkles' | 'flame' | 'trending' }> = {
  tonight: { title: 'Tonight Near You', icon: 'sparkles' },
  deals: { title: 'Last Call Deals', icon: 'flame' },
  popular: { title: 'Popular Nearby', icon: 'trending' },
  picks: { title: 'Based on Your Picks', icon: 'sparkles' },
};

export default function FilteredRestaurantsScreen() {
  const Colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { preferences } = useApp();
  const { section } = useLocalSearchParams<{ section?: string }>();
  const sectionType = (section as SectionType) || 'tonight';
  const config = SECTION_CONFIG[sectionType] || SECTION_CONFIG.tonight;

  const { data: allRestaurants = [], isFetching } = useNearbyRestaurants(20);

  const lastCallDeals = allRestaurants.filter(r => r.lastCallDeal);
  const lastCallIds = new Set(lastCallDeals.map(r => r.id));

  let restaurants = allRestaurants;
  if (sectionType === 'tonight') {
    restaurants = allRestaurants.filter(r => r.isOpenNow && !lastCallIds.has(r.id));
  } else if (sectionType === 'deals') {
    restaurants = lastCallDeals;
  } else if (sectionType === 'popular') {
    restaurants = allRestaurants.filter(r => r.rating >= 4.5);
  } else if (sectionType === 'picks') {
    restaurants = preferences.cuisines.length > 0
      ? allRestaurants.filter(r => preferences.cuisines.includes(r.cuisine))
      : allRestaurants;
  }

  const IconComponent = config.icon === 'flame' ? Flame
    : config.icon === 'trending' ? TrendingUp
    : Sparkles;

  const iconColor = config.icon === 'flame' ? Colors.error
    : config.icon === 'trending' ? Colors.success
    : Colors.primary;

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
        renderItem={({ item }) => <RestaurantCard restaurant={item} variant="vertical" />}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={
          !isFetching ? (
            <View style={styles.emptyState}>
              <Text style={[styles.emptyTitle, { color: Colors.text }]}>No restaurants found</Text>
              <Text style={[styles.emptySubtext, { color: Colors.textSecondary }]}>
                Try adjusting your preferences in your profile
              </Text>
            </View>
          ) : null
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
});
