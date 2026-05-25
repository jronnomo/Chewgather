import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  Pressable,
  FlatList,
  Animated,
  ActivityIndicator,
  Linking,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Search, SlidersHorizontal, X, Flame, ArrowLeft, MapPin } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import RestaurantCard from '../../../components/RestaurantCard';
import { CUISINES, BUDGET_OPTIONS, DISTANCE_OPTIONS } from '../../../mocks/restaurants';
import * as Location from 'expo-location';
import { useSearchRestaurants, useApp } from '../../../context/AppContext';
import StaticColors from '../../../constants/colors';
import { useColors } from '../../../context/ThemeContext';

const Colors = StaticColors;

export default function DiscoverScreen() {
  const Colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { filter } = useLocalSearchParams<{ filter?: string }>();
  const dealsMode = filter === 'deals';
  const { preferences, userLocation, locationPermission, requestLocation } = useApp();
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [debouncedQuery, setDebouncedQuery] = useState<string>('');
  const [selectedCuisines, setSelectedCuisines] = useState<string[]>(
    preferences.cuisines.length > 0 ? [...preferences.cuisines] : []
  );
  const [selectedBudgets, setSelectedBudgets] = useState<string[]>(
    preferences.budget.length > 0 ? [...preferences.budget] : []
  );
  const [selectedDistance, setSelectedDistance] = useState<string>(preferences.distance || '5');
  const [locationQuery, setLocationQuery] = useState<string>('');
  const [customLocation, setCustomLocation] = useState<{ latitude: number; longitude: number } | null>(null);
  const [isGeocodingLocation, setIsGeocodingLocation] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [showFilters, setShowFilters] = useState<boolean>(false);
  const filterHeight = useRef(new Animated.Value(0)).current;
  const userChangedFilters = useRef(false);

  // Sync filters when preferences change (e.g. user edits profile and comes back)
  useEffect(() => {
    if (userChangedFilters.current) return; // Don't overwrite manual filter changes
    setSelectedCuisines(preferences.cuisines.length > 0 ? [...preferences.cuisines] : []);
    setSelectedBudgets(preferences.budget.length > 0 ? [...preferences.budget] : []);
    setSelectedDistance(preferences.distance || '5');
  }, [preferences.cuisines, preferences.budget, preferences.distance]);

  // Debounce search query by 300ms
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(searchQuery), 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const { data: rawRestaurants = [], isFetching } = useSearchRestaurants(
    debouncedQuery,
    selectedCuisines,
    selectedBudgets,
    selectedDistance,
    customLocation,
  );
  const filteredRestaurants = dealsMode
    ? rawRestaurants.filter(r => r.lastCallDeal)
    : rawRestaurants;

  const toggleFilters = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (showFilters) {
      // Closing: use timing (not spring) to avoid overshoot flicker
      Animated.timing(filterHeight, {
        toValue: 0,
        duration: 250,
        useNativeDriver: false,
      }).start(({ finished }) => {
        if (finished) setShowFilters(false);
      });
    } else {
      // Opening: update state immediately, then animate with spring for bounce
      setShowFilters(true);
      Animated.spring(filterHeight, {
        toValue: 1,
        useNativeDriver: false,
        friction: 8,
      }).start();
    }
  }, [showFilters, filterHeight]);

  const handleLocationSearch = useCallback(async () => {
    const q = locationQuery.trim();
    if (!q) {
      setCustomLocation(null);
      setLocationError(null);
      return;
    }
    setIsGeocodingLocation(true);
    setLocationError(null);
    try {
      // Try the query as-is first, then with ", USA" suffix for zip codes
      let results = await Location.geocodeAsync(q);
      if (results.length === 0 && /^\d{5}$/.test(q)) {
        results = await Location.geocodeAsync(`${q}, USA`);
      }
      if (results.length > 0) {
        setCustomLocation({ latitude: results[0].latitude, longitude: results[0].longitude });
        userChangedFilters.current = true;
      } else {
        setLocationError('Location not found — try "City, State" format');
        setCustomLocation(null);
      }
    } catch {
      setLocationError('Could not search location');
      setCustomLocation(null);
    } finally {
      setIsGeocodingLocation(false);
    }
  }, [locationQuery]);

  // #171: debounced live geocode — auto-fire 500ms after user stops typing
  // Keeps existing onSubmitEditing as a faster path for explicit Search-key taps.
  useEffect(() => {
    const trimmed = locationQuery.trim();
    if (trimmed.length < 3) return;
    const timer = setTimeout(() => { handleLocationSearch(); }, 500);
    return () => clearTimeout(timer);
  }, [locationQuery, handleLocationSearch]);

  const filterContainerHeight = filterHeight.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 320],
  });

  const activeFilterCount = selectedCuisines.length + selectedBudgets.length
    + (selectedDistance !== (preferences.distance || '5') ? 1 : 0)
    + (customLocation ? 1 : 0);

  return (
    <View style={[styles.container, { paddingTop: insets.top, backgroundColor: Colors.background }]}>
      <View style={styles.header}>
        {dealsMode ? (
          <View style={styles.dealsTitleRow}>
            <Pressable onPress={() => router.back()} style={styles.dealsBackBtn} accessibilityLabel="Go back" accessibilityRole="button">
              <ArrowLeft size={20} color={Colors.text} />
            </Pressable>
            <Flame size={22} color={Colors.error} />
            <Text style={[styles.headerTitle, { color: Colors.text }]}>Last Call Deals</Text>
          </View>
        ) : (
          <Text style={[styles.headerTitle, { color: Colors.text }]}>Discover</Text>
        )}
      </View>

      <View style={styles.searchRow}>
        <View style={[styles.searchBar, { backgroundColor: Colors.card, borderColor: Colors.border }]}>
          <Search size={18} color={Colors.textTertiary} />
          <TextInput
            style={[styles.searchInput, { color: Colors.text }]}
            placeholder="Search restaurants, cuisines..."
            placeholderTextColor={Colors.textTertiary}
            value={searchQuery}
            onChangeText={setSearchQuery}
            testID="search-input"
          />
          {searchQuery !== '' && (
            <Pressable onPress={() => setSearchQuery('')} accessibilityLabel="Clear search" accessibilityRole="button">
              <X size={16} color={Colors.textTertiary} />
            </Pressable>
          )}
        </View>
        <Pressable
          style={[
            styles.filterBtn,
            { backgroundColor: Colors.card, borderColor: Colors.border },
            showFilters && { backgroundColor: Colors.primary, borderColor: Colors.primary },
          ]}
          onPress={toggleFilters}
          testID="filter-btn"
          accessibilityLabel="Toggle filters"
          accessibilityRole="button"
        >
          <SlidersHorizontal size={18} color={showFilters ? '#FFF' : Colors.text} />
          {activeFilterCount > 0 && (
            <View style={styles.filterBadge}>
              <Text style={styles.filterBadgeText}>{activeFilterCount}</Text>
            </View>
          )}
        </Pressable>
      </View>

      {customLocation && (
        <View style={[styles.locationBanner, { backgroundColor: Colors.card, borderColor: Colors.border }]}>
          <MapPin size={14} color={Colors.primary} />
          <Text style={[styles.locationBannerText, { color: Colors.text }]} numberOfLines={1}>
            Showing results near <Text style={styles.locationBannerEmphasis}>{locationQuery.trim()}</Text>
          </Text>
          <Pressable
            onPress={() => {
              Haptics.selectionAsync();
              if (!showFilters) toggleFilters();
            }}
            accessibilityRole="button"
            accessibilityLabel="Change location"
          >
            <Text style={[styles.locationBannerAction, { color: Colors.primary }]}>Change</Text>
          </Pressable>
          <Pressable
            onPress={() => {
              Haptics.selectionAsync();
              setLocationQuery('');
              setCustomLocation(null);
              setLocationError(null);
              userChangedFilters.current = true;
            }}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Clear custom location"
          >
            <X size={16} color={Colors.textSecondary} />
          </Pressable>
        </View>
      )}

      <Animated.View style={[styles.filterContainer, { height: filterContainerHeight, overflow: 'hidden' }]}>
        <View style={styles.filterSection}>
          <Text style={[styles.filterLabel, { color: Colors.textSecondary }]}>Cuisine</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View style={styles.chipRow}>
              <Pressable
                testID="cuisine-chip-all"
                style={[
                  styles.chip,
                  { backgroundColor: Colors.card, borderColor: Colors.border },
                  selectedCuisines.length === 0 && { backgroundColor: Colors.primary, borderColor: Colors.primary },
                ]}
                onPress={() => {
                  Haptics.selectionAsync();
                  userChangedFilters.current = true;
                  setSelectedCuisines([]);
                }}
              >
                <Text style={[
                  styles.chipText,
                  { color: Colors.text },
                  selectedCuisines.length === 0 && styles.chipTextActive,
                ]}>All</Text>
              </Pressable>
              {CUISINES.map(c => {
                const isSelected = selectedCuisines.includes(c);
                return (
                  <Pressable
                    key={c}
                    testID={`cuisine-chip-${c}`}
                    style={[
                      styles.chip,
                      { backgroundColor: Colors.card, borderColor: Colors.border },
                      isSelected && { backgroundColor: Colors.primary, borderColor: Colors.primary },
                    ]}
                    onPress={() => {
                      Haptics.selectionAsync();
                      userChangedFilters.current = true;
                      setSelectedCuisines(prev =>
                        prev.includes(c) ? prev.filter(x => x !== c) : [...prev, c]
                      );
                    }}
                  >
                    <Text style={[
                      styles.chipText,
                      { color: Colors.text },
                      isSelected && styles.chipTextActive,
                    ]}>{c}</Text>
                  </Pressable>
                );
              })}
            </View>
          </ScrollView>
        </View>
        <View style={styles.filterSection}>
          <Text style={[styles.filterLabel, { color: Colors.textSecondary }]}>Budget</Text>
          <View style={styles.chipRow}>
            <Pressable
              testID="budget-chip-all"
              style={[
                styles.chip,
                { backgroundColor: Colors.card, borderColor: Colors.border },
                selectedBudgets.length === 0 && { backgroundColor: Colors.primary, borderColor: Colors.primary },
              ]}
              onPress={() => {
                Haptics.selectionAsync();
                userChangedFilters.current = true;
                setSelectedBudgets([]);
              }}
            >
              <Text style={[
                styles.chipText,
                { color: Colors.text },
                selectedBudgets.length === 0 && styles.chipTextActive,
              ]}>All</Text>
            </Pressable>
            {BUDGET_OPTIONS.map((b, i) => {
              const isSelected = selectedBudgets.includes(b);
              return (
                <Pressable
                  key={b}
                  testID={`budget-chip-${i}`}
                  style={[
                    styles.chip,
                    { backgroundColor: Colors.card, borderColor: Colors.border },
                    isSelected && { backgroundColor: Colors.primary, borderColor: Colors.primary },
                  ]}
                  onPress={() => {
                    Haptics.selectionAsync();
                    userChangedFilters.current = true;
                    setSelectedBudgets(prev =>
                      prev.includes(b) ? prev.filter(x => x !== b) : [...prev, b]
                    );
                  }}
                >
                  <Text style={[
                    styles.chipText,
                    { color: Colors.text },
                    isSelected && styles.chipTextActive,
                  ]}>{b}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        {/* Distance section */}
        <View style={styles.filterSection}>
          <Text style={[styles.filterLabel, { color: Colors.textSecondary }]}>Distance</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View style={styles.chipRow}>
              {DISTANCE_OPTIONS.map(d => (
                <Pressable
                  key={d}
                  style={[
                    styles.chip,
                    { backgroundColor: Colors.card, borderColor: Colors.border },
                    selectedDistance === d && { backgroundColor: Colors.primary, borderColor: Colors.primary },
                  ]}
                  onPress={() => {
                    Haptics.selectionAsync();
                    userChangedFilters.current = true;
                    setSelectedDistance(d);
                  }}
                >
                  <Text style={[
                    styles.chipText,
                    { color: Colors.text },
                    selectedDistance === d && styles.chipTextActive,
                  ]}>{d} mi</Text>
                </Pressable>
              ))}
            </View>
          </ScrollView>
        </View>

        {/* Location override section */}
        <View style={styles.filterSection}>
          <Text style={[styles.filterLabel, { color: Colors.textSecondary }]}>Location</Text>
          <View style={styles.locationRow}>
            <TextInput
              style={[
                styles.locationInput,
                { backgroundColor: Colors.card, borderColor: Colors.border, color: Colors.text },
              ]}
              value={locationQuery}
              onChangeText={(text) => {
                setLocationQuery(text);
                if (!text.trim()) {
                  setCustomLocation(null);
                  setLocationError(null);
                }
              }}
              onSubmitEditing={handleLocationSearch}
              placeholder="City, State or Zip Code"
              placeholderTextColor={Colors.textTertiary}
              returnKeyType="search"
            />
            {locationQuery.trim().length > 0 && (
              <Pressable
                style={styles.locationClearBtn}
                onPress={() => {
                  setLocationQuery('');
                  setCustomLocation(null);
                  setLocationError(null);
                  userChangedFilters.current = true;
                }}
              >
                <X size={16} color={Colors.textTertiary} />
              </Pressable>
            )}
          </View>
          {customLocation && (
            <View style={styles.locationActiveRow}>
              <MapPin size={14} color={Colors.success} />
              <Text style={[styles.locationActiveText, { color: Colors.success }]}>
                Searching near {locationQuery.trim()}
              </Text>
            </View>
          )}
          {locationError && (
            <Text style={[styles.locationErrorText, { color: Colors.error }]}>{locationError}</Text>
          )}
        </View>
      </Animated.View>

      {isFetching && (
        <View style={styles.loadingRow}>
          <ActivityIndicator size="small" color={Colors.primary} />
        </View>
      )}

      <FlatList
        data={filteredRestaurants}
        keyExtractor={item => item.id}
        renderItem={({ item }) => <RestaurantCard restaurant={item} variant="vertical" />}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={
          isFetching ? null : !userLocation && !customLocation && !debouncedQuery.trim() ? (
            <View style={styles.emptyState}>
              <Text style={styles.emptyEmoji}>📍</Text>
              <Text style={[styles.emptyTitle, { color: Colors.text }]}>
                {locationPermission === 'denied' ? 'Location is turned off' : 'We need your location'}
              </Text>
              <Text style={[styles.emptySubtext, { color: Colors.textSecondary }]}>
                {locationPermission === 'denied'
                  ? 'Enable location access in Settings to find restaurants near you.'
                  : 'Allow location access so we can find restaurants near you.'}
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
          ) : (
            <View style={styles.emptyState}>
              <Text style={styles.emptyEmoji}>{dealsMode ? '🔥' : '🍽️'}</Text>
              <Text style={[styles.emptyTitle, { color: Colors.text }]}>{dealsMode ? 'No deals right now' : 'No restaurants found'}</Text>
              <Text style={[styles.emptySubtext, { color: Colors.textSecondary }]}>
                {dealsMode
                  ? 'Check back closer to closing time'
                  : activeFilterCount > 0 || searchQuery.trim()
                    ? 'Try adjusting your search or filters'
                    : 'Try searching for a cuisine or restaurant name'}
              </Text>
            </View>
          )
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
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 4,
  },
  dealsTitleRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 8,
  },
  dealsBackBtn: {
    marginRight: 4,
  },
  headerTitle: {
    fontSize: 28,
    fontWeight: '800' as const,
    color: Colors.text,
  },
  searchRow: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    paddingVertical: 12,
    gap: 10,
  },
  searchBar: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.card,
    borderRadius: 12,
    paddingHorizontal: 14,
    height: 44,
    gap: 10,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    color: Colors.text,
    height: 44,
  },
  filterBtn: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: Colors.card,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: Colors.border,
  },
  filterBtnActive: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  filterBadge: {
    position: 'absolute',
    top: -4,
    right: -4,
    backgroundColor: Colors.error,
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterBadgeText: {
    fontSize: 10,
    fontWeight: '700' as const,
    color: '#FFF',
  },
  filterContainer: {
    paddingHorizontal: 20,
  },
  filterSection: {
    marginBottom: 12,
  },
  filterLabel: {
    fontSize: 13,
    fontWeight: '600' as const,
    color: Colors.textSecondary,
    marginBottom: 8,
  },
  chipRow: {
    flexDirection: 'row',
    gap: 8,
    flexWrap: 'wrap',
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 20,
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  chipActive: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  chipText: {
    fontSize: 13,
    fontWeight: '600' as const,
    color: Colors.text,
  },
  chipTextActive: {
    color: '#FFF',
  },
  loadingRow: {
    alignItems: 'center',
    paddingVertical: 8,
  },
  listContent: {
    paddingHorizontal: 20,
    paddingBottom: 30,
  },
  emptyState: {
    alignItems: 'center',
    paddingTop: 60,
  },
  emptyEmoji: {
    fontSize: 48,
    marginBottom: 12,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '700' as const,
    color: Colors.text,
  },
  emptySubtext: {
    fontSize: 14,
    color: Colors.textSecondary,
    marginTop: 4,
    textAlign: 'center',
    paddingHorizontal: 32,
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
  locationBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 16,
    marginBottom: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
  },
  locationBannerText: {
    flex: 1,
    fontSize: 13,
  },
  locationBannerEmphasis: {
    fontWeight: '700' as const,
  },
  locationBannerAction: {
    fontSize: 13,
    fontWeight: '700' as const,
    paddingHorizontal: 4,
  },
  locationRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  locationInput: {
    flex: 1,
    height: 38,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    fontSize: 14,
  },
  locationClearBtn: {
    marginLeft: 8,
    padding: 6,
  },
  locationActiveRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 6,
  },
  locationActiveText: {
    fontSize: 12,
    fontWeight: '500' as const,
  },
  locationErrorText: {
    fontSize: 12,
    marginTop: 4,
  },
});
