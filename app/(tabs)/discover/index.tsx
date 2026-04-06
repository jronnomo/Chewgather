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
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Search, SlidersHorizontal, X, Flame, ArrowLeft } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import RestaurantCard from '../../../components/RestaurantCard';
import { CUISINES, BUDGET_OPTIONS } from '../../../mocks/restaurants';
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
  const { preferences } = useApp();
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [debouncedQuery, setDebouncedQuery] = useState<string>('');
  const [selectedCuisines, setSelectedCuisines] = useState<string[]>(
    preferences.cuisines.length > 0 ? [...preferences.cuisines] : []
  );
  const [selectedBudgets, setSelectedBudgets] = useState<string[]>(
    preferences.budget.length > 0 ? [...preferences.budget] : []
  );
  const [showFilters, setShowFilters] = useState<boolean>(false);
  const filterHeight = useRef(new Animated.Value(0)).current;
  const userChangedFilters = useRef(false);

  // Sync filters when preferences change (e.g. user edits profile and comes back)
  useEffect(() => {
    if (userChangedFilters.current) return; // Don't overwrite manual filter changes
    setSelectedCuisines(preferences.cuisines.length > 0 ? [...preferences.cuisines] : []);
    setSelectedBudgets(preferences.budget.length > 0 ? [...preferences.budget] : []);
  }, [preferences.cuisines, preferences.budget]);

  // Debounce search query by 300ms
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(searchQuery), 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const { data: rawRestaurants = [], isFetching } = useSearchRestaurants(
    debouncedQuery,
    selectedCuisines,
    selectedBudgets
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

  const filterContainerHeight = filterHeight.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 160],
  });

  const activeFilterCount = selectedCuisines.length + selectedBudgets.length;

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
          !isFetching ? (
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
  },
});
