import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Animated,
  Dimensions,
  ActivityIndicator,
  ScrollView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Image } from 'expo-image';
import { X, Heart, ArrowLeft, RotateCcw, Star, MapPin, CheckCircle, Bookmark, Check } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import SwipeCard from '@/components/SwipeCard';
import RestaurantCountSlider from '@/components/RestaurantCountSlider';
import Snackbar from '@/components/Snackbar';
import { useApp, useNearbyRestaurants } from '@/context/AppContext';
import { Restaurant } from '@/types';
import StaticColors from '@/constants/colors';
import { useColors } from '@/context/ThemeContext';

const Colors = StaticColors;
const { width: SCREEN_WIDTH } = Dimensions.get('window');

export default function SwipeScreen() {
  const Colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { preferences, toggleFavorite, favorites, locationPermission, requestLocation } = useApp();
  const [restaurantCount, setRestaurantCount] = useState<number>(10);
  const [hasStarted, setHasStarted] = useState(false);
  const { data: restaurantData = [], isFetching } = useNearbyRestaurants(restaurantCount);

  const sortedRestaurants = React.useMemo(() => {
    return [...restaurantData].sort((a, b) => {
      let scoreA = 0;
      let scoreB = 0;
      if (preferences.cuisines.includes(a.cuisine)) scoreA += 2;
      if (preferences.cuisines.includes(b.cuisine)) scoreB += 2;
      if (a.isOpenNow) scoreA += 1;
      if (b.isOpenNow) scoreB += 1;
      return scoreB - scoreA;
    });
  }, [restaurantData, preferences.cuisines]);

  const [currentIndex, setCurrentIndex] = useState<number>(0);
  const [liked, setLiked] = useState<Restaurant[]>([]);
  const [passed, setPassed] = useState<Restaurant[]>([]);
  const [showResults, setShowResults] = useState<boolean>(false);
  const [lastSwiped, setLastSwiped] = useState<{ restaurant: Restaurant; direction: 'left' | 'right' } | null>(null);
  const [snackbar, setSnackbar] = useState<{ message: string; actionLabel?: string; onAction?: () => void } | null>(null);

  const resultsOpacity = useRef(new Animated.Value(0)).current;
  const counterScale = useRef(new Animated.Value(1)).current;
  const showResultsTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // `toggleFavorite` is recreated each render and reads `favorites` from its
  // closure. Snackbar `onAction` callbacks are stored in state and persist
  // across renders, so a captured copy goes stale — making Undo re-add a
  // favorite instead of removing it. Route Undo through a ref to the latest.
  const toggleFavoriteRef = useRef(toggleFavorite);
  useEffect(() => {
    toggleFavoriteRef.current = toggleFavorite;
  }, [toggleFavorite]);

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (showResultsTimer.current) clearTimeout(showResultsTimer.current);
    };
  }, []);

  const animateCounter = useCallback(() => {
    Animated.sequence([
      Animated.timing(counterScale, { toValue: 1.3, duration: 100, useNativeDriver: true }),
      Animated.spring(counterScale, { toValue: 1, friction: 3, useNativeDriver: true }),
    ]).start();
  }, [counterScale]);

  const handleSwipeRight = useCallback((restaurant: Restaurant) => {
    // Swipe right is a SESSION interest signal only — it shortlists the
    // restaurant into `liked` and never writes to favorites (issue #29).
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setLiked(prev => [...prev, restaurant]);
    setLastSwiped({ restaurant, direction: 'right' });
    animateCounter();
    setCurrentIndex(prev => {
      const next = prev + 1;
      if (next >= sortedRestaurants.length) {
        setShowResults(true);
      }
      return next;
    });
  }, [sortedRestaurants.length, animateCounter]);

  const handleSwipeLeft = useCallback((restaurant: Restaurant) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setPassed(prev => [...prev, restaurant]);
    setLastSwiped({ restaurant, direction: 'left' });
    setCurrentIndex(prev => {
      const next = prev + 1;
      if (next >= sortedRestaurants.length) {
        setShowResults(true);
      }
      return next;
    });
  }, [sortedRestaurants.length]);

  const handleUndo = useCallback(() => {
    if (!lastSwiped || currentIndex <= 0) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const { restaurant, direction } = lastSwiped;
    if (direction === 'right') {
      setLiked(prev => prev.filter(r => r.id !== restaurant.id));
    } else {
      setPassed(prev => prev.filter(r => r.id !== restaurant.id));
    }
    setCurrentIndex(prev => prev - 1);
    setShowResults(false);
    setLastSwiped(null);
  }, [lastSwiped, currentIndex]);

  const handleChooseThis = useCallback(() => {
    if (currentIndex >= sortedRestaurants.length) return;
    const restaurant = sortedRestaurants[currentIndex];
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    // Session pick only — favoriting happens via explicit Save on the results screen.
    setLiked([restaurant]);
    setShowResults(true);
  }, [currentIndex, sortedRestaurants]);

  const handleToggleSave = useCallback((restaurant: Restaurant) => {
    const wasSaved = favorites.includes(restaurant.id);
    toggleFavorite(restaurant);
    setSnackbar({
      message: wasSaved ? 'Removed from Saved' : 'Added to Saved',
      actionLabel: 'Undo',
      onAction: () => {
        toggleFavoriteRef.current(restaurant);
        setSnackbar(null);
      },
    });
  }, [favorites, toggleFavorite]);

  const handleSaveAll = useCallback(() => {
    const unsaved = liked.filter(r => !favorites.includes(r.id));
    if (unsaved.length === 0) {
      setSnackbar({ message: "Everything's already saved" });
      return;
    }
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    unsaved.forEach(r => toggleFavorite(r));
    const alreadySaved = liked.length - unsaved.length;
    const savedLabel = `Saved ${unsaved.length} spot${unsaved.length !== 1 ? 's' : ''}`;
    setSnackbar({
      message: alreadySaved > 0 ? `${savedLabel} · ${alreadySaved} already saved` : savedLabel,
      actionLabel: 'Undo',
      onAction: () => {
        unsaved.forEach(r => toggleFavoriteRef.current(r));
        setSnackbar(null);
      },
    });
  }, [liked, favorites, toggleFavorite]);

  const handleReset = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    setCurrentIndex(0);
    setLiked([]);
    setPassed([]);
    setShowResults(false);
    setLastSwiped(null);
  }, []);

  useEffect(() => {
    if (showResults) {
      Animated.timing(resultsOpacity, {
        toValue: 1,
        duration: 400,
        useNativeDriver: true,
      }).start();
    } else {
      resultsOpacity.setValue(0);
    }
  }, [showResults, resultsOpacity]);

  const progress = sortedRestaurants.length > 0
    ? currentIndex / sortedRestaurants.length
    : 0;

  const allPicksSaved = liked.length > 0 && liked.every(r => favorites.includes(r.id));

  // Pre-swipe setup — let user pick restaurant count
  if (!hasStarted) {
    return (
      <View style={[styles.container, styles.centeredState, { paddingTop: insets.top, backgroundColor: Colors.background }]}>
        <View style={styles.setupContent}>
          <Text style={[styles.setupTitle, { color: Colors.text }]}>Quick Setup</Text>
          <Text style={[styles.setupSub, { color: Colors.textSecondary }]}>
            How many restaurants do you want to swipe through?
          </Text>
          <View style={[styles.setupSliderWrap, { backgroundColor: Colors.card, borderColor: Colors.border }]}>
            <RestaurantCountSlider value={restaurantCount} onValueChange={setRestaurantCount} />
          </View>
          <Pressable
            style={styles.setupStartBtn}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
              setHasStarted(true);
            }}
          >
            <Text style={styles.setupStartBtnText}>Start Swiping</Text>
          </Pressable>
          <Pressable style={[styles.setupBackBtn, { borderColor: Colors.border }]} onPress={() => router.back()}>
            <Text style={[styles.setupBackBtnText, { color: Colors.textSecondary }]}>Go Back</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  // Loading state — differentiate from empty stack
  if (isFetching && sortedRestaurants.length === 0) {
    return (
      <View style={[styles.container, styles.centeredState, { paddingTop: insets.top, backgroundColor: Colors.background }]}>
        <ActivityIndicator size="large" color={Colors.primary} />
        <Text style={[styles.loadingText, { color: Colors.textSecondary }]}>Finding restaurants near you…</Text>
      </View>
    );
  }

  // No restaurants at all (not loading)
  if (!isFetching && sortedRestaurants.length === 0) {
    return (
      <View style={[styles.container, styles.centeredState, { paddingTop: insets.top, backgroundColor: Colors.background }]}>
        <Text style={styles.emptyStackEmoji}>🍽</Text>
        <Text style={[styles.emptyStackText, { color: Colors.textSecondary }]}>No restaurants found nearby</Text>
        <Pressable style={styles.retryBtn} onPress={() => router.back()}>
          <Text style={styles.retryBtnText}>Go Back</Text>
        </Pressable>
      </View>
    );
  }

  if (showResults) {
    return (
      <View style={[styles.container, { paddingTop: insets.top, backgroundColor: Colors.background }]}>
        <Animated.View style={[styles.resultsContainer, { opacity: resultsOpacity }]}>
          <View style={styles.resultsHeader}>
            <Pressable style={[styles.backBtn, { backgroundColor: Colors.card, borderColor: Colors.border }]} onPress={() => router.back()} accessibilityLabel="Go back" accessibilityRole="button">
              <ArrowLeft size={20} color={Colors.text} />
            </Pressable>
            <Text style={[styles.resultsTitle, { color: Colors.text }]}>Your Picks</Text>
            <Pressable style={[styles.resetBtn, { backgroundColor: Colors.primaryLight }]} onPress={handleReset} accessibilityLabel="Reset swipes" accessibilityRole="button">
              <RotateCcw size={18} color={Colors.primary} />
            </Pressable>
          </View>

          {liked.length === 0 ? (
            <View style={styles.emptyResults}>
              <Text style={styles.emptyEmoji}>🤷</Text>
              <Text style={[styles.emptyTitle, { color: Colors.text }]}>Nothing caught your eye?</Text>
              <Text style={[styles.emptySub, { color: Colors.textSecondary }]}>Try swiping again with fresh eyes</Text>
              <Pressable style={styles.retryBtn} onPress={handleReset}>
                <Text style={styles.retryBtnText}>Try Again</Text>
              </Pressable>
            </View>
          ) : (
            <ScrollView style={styles.resultsList} contentContainerStyle={styles.resultsListContent}>
              <View style={styles.countRow}>
                <Text style={[styles.resultsCount, { color: Colors.textSecondary }]}>
                  {liked.length === 1 ? '1 spot made the cut' : `${liked.length} spots made the cut`}
                </Text>
                <Pressable
                  style={[
                    styles.saveAllPill,
                    { backgroundColor: allPicksSaved ? Colors.primaryLight : Colors.primary },
                  ]}
                  onPress={handleSaveAll}
                  disabled={allPicksSaved}
                  testID="swipe-save-all"
                  accessibilityRole="button"
                  accessibilityLabel={allPicksSaved ? 'All picks saved' : `Save all ${liked.length} picks to favorites`}
                >
                  {allPicksSaved
                    ? <Check size={15} color={Colors.primary} />
                    : <Bookmark size={15} color="#FFF" />}
                  <Text style={[styles.saveAllPillText, { color: allPicksSaved ? Colors.primary : '#FFF' }]}>
                    {allPicksSaved ? 'All saved' : `Save all ${liked.length}`}
                  </Text>
                </Pressable>
              </View>
              {liked.map((r, i) => (
                <ResultCard
                  key={r.id}
                  restaurant={r}
                  rank={i + 1}
                  isSaved={favorites.includes(r.id)}
                  onToggleSave={handleToggleSave}
                  onOpen={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    router.push(`/restaurant/${r.id}` as never);
                  }}
                />
              ))}
            </ScrollView>
          )}
        </Animated.View>
        <Snackbar
          visible={snackbar !== null}
          message={snackbar?.message ?? ''}
          actionLabel={snackbar?.actionLabel}
          onAction={snackbar?.onAction}
          onDismiss={() => setSnackbar(null)}
        />
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top, backgroundColor: Colors.background }]}>
      <View style={styles.header}>
        <Pressable style={[styles.backBtn, { backgroundColor: Colors.card, borderColor: Colors.border }]} onPress={() => router.back()} testID="swipe-back" accessibilityLabel="Go back" accessibilityRole="button">
          <ArrowLeft size={20} color={Colors.text} />
        </Pressable>
        <View style={styles.headerCenter}>
          <Text style={[styles.headerTitle, { color: Colors.text }]}>Discover</Text>
          <Text style={[styles.headerSub, { color: Colors.textTertiary }]}>
            {currentIndex} / {sortedRestaurants.length}
          </Text>
        </View>
        <Animated.View style={[styles.likeCounter, { backgroundColor: Colors.primaryLight, transform: [{ scale: counterScale }] }]}>
          <Heart size={14} color={Colors.primary} fill={liked.length > 0 ? Colors.primary : 'transparent'} />
          <Text style={[styles.likeCountText, { color: Colors.primary }]}>{liked.length}</Text>
        </Animated.View>
      </View>

      <View style={[styles.progressBarContainer, { backgroundColor: Colors.border }]}>
        <View style={[styles.progressBar, { width: `${progress * 100}%` }]} />
      </View>

      {locationPermission === 'denied' && (
        <Pressable style={[styles.locationBanner, { backgroundColor: Colors.primaryLight }]} onPress={requestLocation}>
          <MapPin size={14} color={Colors.primary} />
          <Text style={[styles.locationBannerText, { color: Colors.primary }]}>
            Enable location for nearby restaurants
          </Text>
        </Pressable>
      )}

      <View style={styles.cardStack}>
        {sortedRestaurants.slice(currentIndex, currentIndex + 2).reverse().map((restaurant, i) => {
          const isTop = i === (Math.min(2, sortedRestaurants.length - currentIndex) - 1);
          return (
            <SwipeCard
              key={restaurant.id}
              restaurant={restaurant}
              onSwipeLeft={handleSwipeLeft}
              onSwipeRight={handleSwipeRight}
              onTap={(r) => router.push(`/restaurant/${r.id}` as never)}
              isTop={isTop}
            />
          );
        })}

        {currentIndex >= sortedRestaurants.length && !showResults && (
          <View style={styles.emptyStack}>
            <Text style={styles.emptyStackEmoji}>🍽</Text>
            <Text style={[styles.emptyStackText, { color: Colors.textSecondary }]}>That's all for now!</Text>
          </View>
        )}

        {lastSwiped && currentIndex > 0 && (
          <Pressable
            style={[styles.undoBtnFloating, { backgroundColor: Colors.card, borderColor: Colors.border }]}
            onPress={handleUndo}
            testID="swipe-undo-btn"
            accessibilityLabel="Undo last swipe"
            accessibilityRole="button"
          >
            <RotateCcw size={16} color={Colors.textSecondary} />
          </Pressable>
        )}
      </View>

      <View style={[styles.actionBar, { paddingBottom: insets.bottom + 16 }]}>
        <Pressable
          style={[styles.actionBtn, styles.actionBtnNo, { backgroundColor: Colors.card }]}
          onPress={() => {
            if (currentIndex < sortedRestaurants.length) {
              handleSwipeLeft(sortedRestaurants[currentIndex]);
            }
          }}
          testID="swipe-no-btn"
          accessibilityLabel="Pass on restaurant"
          accessibilityRole="button"
        >
          <X size={28} color={Colors.error} />
        </Pressable>

        <Pressable
          style={[styles.chooseBtn, { backgroundColor: Colors.card, borderColor: Colors.primary }]}
          onPress={handleChooseThis}
          testID="swipe-choose-btn"
          accessibilityLabel="Choose this restaurant"
          accessibilityRole="button"
        >
          <CheckCircle size={20} color={Colors.primary} />
          <Text style={[styles.chooseBtnText, { color: Colors.primary }]}>Choose This!</Text>
        </Pressable>

        <Pressable
          style={[styles.actionBtn, styles.actionBtnYes]}
          onPress={() => {
            if (currentIndex < sortedRestaurants.length) {
              handleSwipeRight(sortedRestaurants[currentIndex]);
            }
          }}
          testID="swipe-yes-btn"
          accessibilityLabel="Like restaurant"
          accessibilityRole="button"
        >
          <Heart size={28} color="#FFF" fill="#FFF" />
        </Pressable>
      </View>
    </View>
  );
}

// Module-level helper — declares its own useColors() per project convention.
function ResultCard({
  restaurant,
  rank,
  isSaved,
  onToggleSave,
  onOpen,
}: {
  restaurant: Restaurant;
  rank: number;
  isSaved: boolean;
  onToggleSave: (r: Restaurant) => void;
  onOpen: () => void;
}) {
  const Colors = useColors();
  const bookmarkScale = useRef(new Animated.Value(1)).current;

  const handleSavePress = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    Animated.sequence([
      Animated.timing(bookmarkScale, { toValue: 0.8, duration: 100, useNativeDriver: true }),
      Animated.spring(bookmarkScale, { toValue: 1, friction: 3, useNativeDriver: true }),
    ]).start();
    onToggleSave(restaurant);
  };

  return (
    <Pressable
      style={[styles.resultCard, { backgroundColor: Colors.card }]}
      onPress={onOpen}
    >
      <View style={[styles.resultRank, { backgroundColor: Colors.primaryLight }]}>
        <Text style={[styles.resultRankText, { color: Colors.primary }]}>{rank}</Text>
      </View>
      <Image source={{ uri: restaurant.imageUrl }} style={styles.resultImage} contentFit="cover" />
      <View style={styles.resultInfo}>
        <Text style={[styles.resultName, { color: Colors.text }]} numberOfLines={1}>{restaurant.name}</Text>
        <Text style={[styles.resultCuisine, { color: Colors.textSecondary }]}>{restaurant.cuisine} · {'$'.repeat(restaurant.priceLevel)}</Text>
        <View style={styles.resultMeta}>
          <Star size={11} color={Colors.star} fill={Colors.star} />
          <Text style={[styles.resultRating, { color: Colors.text }]}>{restaurant.rating}</Text>
          <MapPin size={11} color={Colors.textTertiary} />
          <Text style={[styles.resultDistance, { color: Colors.textTertiary }]}>{restaurant.distance}</Text>
        </View>
      </View>
      <Pressable
        onPress={handleSavePress}
        hitSlop={8}
        testID={`swipe-save-${restaurant.id}`}
        accessibilityRole="button"
        accessibilityLabel={
          isSaved
            ? `Remove ${restaurant.name} from your favorites`
            : `Save ${restaurant.name} to your favorites`
        }
      >
        <Animated.View
          style={[
            styles.saveToggle,
            isSaved && { backgroundColor: Colors.primaryLight },
            { transform: [{ scale: bookmarkScale }] },
          ]}
        >
          <Bookmark
            size={18}
            color={isSaved ? Colors.primary : Colors.textTertiary}
            fill={isSaved ? Colors.primary : 'transparent'}
          />
        </Animated.View>
      </Pressable>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.card,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: Colors.border,
  },
  headerCenter: {
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '800' as const,
    color: Colors.text,
  },
  headerSub: {
    fontSize: 12,
    color: Colors.textTertiary,
    marginTop: 1,
  },
  likeCounter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: Colors.primaryLight,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 16,
  },
  likeCountText: {
    fontSize: 14,
    fontWeight: '700' as const,
    color: Colors.primary,
  },
  progressBarContainer: {
    height: 3,
    backgroundColor: Colors.border,
    marginHorizontal: 20,
    borderRadius: 2,
    overflow: 'hidden',
  },
  progressBar: {
    height: '100%',
    backgroundColor: Colors.primary,
    borderRadius: 2,
  },
  cardStack: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 10,
  },
  emptyStack: {
    alignItems: 'center',
  },
  emptyStackEmoji: {
    fontSize: 48,
    marginBottom: 12,
  },
  emptyStackText: {
    fontSize: 18,
    fontWeight: '600' as const,
    color: Colors.textSecondary,
  },
  actionBar: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 24,
    paddingTop: 16,
  },
  actionBtn: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 5,
  },
  actionBtnNo: {
    backgroundColor: Colors.card,
    borderWidth: 2,
    borderColor: Colors.error,
  },
  actionBtnYes: {
    backgroundColor: Colors.primary,
  },
  chooseBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: 18,
    height: 48,
    borderRadius: 24,
    borderWidth: 2,
    borderColor: Colors.primary,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  chooseBtnText: {
    fontSize: 14,
    fontWeight: '700' as const,
    color: Colors.primary,
  },
  undoBtnFloating: {
    position: 'absolute',
    bottom: 8,
    right: 24,
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  resultsContainer: {
    flex: 1,
  },
  resultsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  resultsTitle: {
    fontSize: 20,
    fontWeight: '800' as const,
    color: Colors.text,
  },
  resetBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  countRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    marginBottom: 16,
    gap: 12,
  },
  resultsCount: {
    flex: 1,
    fontSize: 14,
    color: Colors.textSecondary,
    fontWeight: '600' as const,
  },
  saveAllPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 18,
  },
  saveAllPillText: {
    fontSize: 13,
    fontWeight: '700' as const,
  },
  saveToggle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  resultsList: {
    flex: 1,
  },
  resultsListContent: {
    paddingTop: 8,
    paddingBottom: 30,
  },
  resultCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.card,
    marginHorizontal: 20,
    marginBottom: 10,
    borderRadius: 16,
    padding: 12,
    gap: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
  resultRank: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: Colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  resultRankText: {
    fontSize: 13,
    fontWeight: '800' as const,
    color: Colors.primary,
  },
  resultImage: {
    width: 56,
    height: 56,
    borderRadius: 12,
  },
  resultInfo: {
    flex: 1,
  },
  resultName: {
    fontSize: 15,
    fontWeight: '700' as const,
    color: Colors.text,
  },
  resultCuisine: {
    fontSize: 12,
    color: Colors.textSecondary,
    marginTop: 2,
  },
  resultMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 4,
  },
  resultRating: {
    fontSize: 12,
    fontWeight: '700' as const,
    color: Colors.text,
  },
  resultDistance: {
    fontSize: 12,
    color: Colors.textTertiary,
  },
  emptyResults: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 40,
  },
  emptyEmoji: {
    fontSize: 56,
    marginBottom: 16,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: '800' as const,
    color: Colors.text,
    textAlign: 'center',
  },
  emptySub: {
    fontSize: 14,
    color: Colors.textSecondary,
    marginTop: 6,
    textAlign: 'center',
  },
  retryBtn: {
    marginTop: 24,
    backgroundColor: Colors.primary,
    paddingHorizontal: 28,
    paddingVertical: 14,
    borderRadius: 24,
  },
  retryBtnText: {
    fontSize: 15,
    fontWeight: '700' as const,
    color: '#FFF',
  },
  centeredState: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  loadingText: {
    fontSize: 15,
    color: Colors.textSecondary,
    fontWeight: '500' as const,
  },
  locationBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginHorizontal: 20,
    marginBottom: 8,
    backgroundColor: Colors.primaryLight,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
  },
  locationBannerText: {
    fontSize: 13,
    color: Colors.primary,
    fontWeight: '600' as const,
  },
  setupContent: {
    paddingHorizontal: 32,
    alignItems: 'center',
    width: '100%',
  },
  setupTitle: {
    fontSize: 24,
    fontWeight: '800' as const,
    marginBottom: 8,
  },
  setupSub: {
    fontSize: 15,
    textAlign: 'center',
    marginBottom: 28,
  },
  setupSliderWrap: {
    width: '100%',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    marginBottom: 28,
  },
  setupStartBtn: {
    backgroundColor: Colors.primary,
    paddingHorizontal: 48,
    paddingVertical: 16,
    borderRadius: 28,
    shadowColor: Colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
    marginBottom: 12,
  },
  setupStartBtnText: {
    fontSize: 16,
    fontWeight: '700' as const,
    color: '#FFF',
  },
  setupBackBtn: {
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderRadius: 20,
    borderWidth: 1,
  },
  setupBackBtnText: {
    fontSize: 14,
    fontWeight: '600' as const,
  },
});
