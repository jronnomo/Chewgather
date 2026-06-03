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
  Linking,
} from 'react-native';
import AppText from '@/components/AppText';
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
import { useThemeTransition, buildSignUpChompConfig } from '@/context/ThemeTransitionContext';
import ConversionPrompt from '@/components/ConversionPrompt';
import PickConfirmSheet from '@/components/PickConfirmSheet';
import { wasTriggerDismissed, markTriggerDismissed } from '@/lib/guestFunnel';
import type { FunnelTrigger } from '@/lib/guestFunnel';
import { savePendingPicks } from '@/lib/pendingPicks';
import { registerRestaurants } from '@/lib/restaurantRegistry';
import DecisiveResultView from '@/components/DecisiveResultView';

const Colors = StaticColors;
const { width: SCREEN_WIDTH } = Dimensions.get('window');

export default function SwipeScreen() {
  const Colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { preferences, toggleFavorite, favorites, locationPermission, requestLocation, isGuest } = useApp();
  const { requestChomp, isAnimating } = useThemeTransition();

  // Guest conversion prompt state
  const [conversionVisible, setConversionVisible] = useState(false);
  const [conversionTrigger, setConversionTrigger] = useState<FunnelTrigger>('save');

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
  const [arrivedVia, setArrivedVia] = useState<'swipe' | 'decisive'>('swipe');
  const [lastSwiped, setLastSwiped] = useState<{ restaurant: Restaurant; direction: 'left' | 'right' } | null>(null);
  const [snackbar, setSnackbar] = useState<{ message: string; actionLabel?: string; onAction?: () => void } | null>(null);
  const [pickConfirmVisible, setPickConfirmVisible] = useState(false);

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
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setPickConfirmVisible(true);
  }, [currentIndex, sortedRestaurants.length]);

  const handlePickConfirmed = useCallback(() => {
    if (currentIndex >= sortedRestaurants.length) return;
    const restaurant = sortedRestaurants[currentIndex];
    // Session pick only — favoriting happens via explicit Save on the results screen.
    setLiked([restaurant]);
    setArrivedVia('decisive');
    setPickConfirmVisible(false);
    setShowResults(true);
  }, [currentIndex, sortedRestaurants]);

  const handleToggleSave = useCallback((restaurant: Restaurant) => {
    // Guests never mutate favorites — intercept and open conversion prompt instead
    if (isGuest) {
      if (!wasTriggerDismissed('save')) {
        setConversionTrigger('save');
        setConversionVisible(true);
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      }
      return;
    }
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
  }, [isGuest, favorites, toggleFavorite]);

  const handleSaveAll = useCallback(() => {
    // Guests never mutate favorites — intercept and open end-of-swipe prompt instead
    if (isGuest) {
      if (liked.length === 0) return; // M-4 guard: no picks, no prompt
      if (!wasTriggerDismissed('end-of-swipe')) {
        setConversionTrigger('end-of-swipe');
        setConversionVisible(true);
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      }
      return;
    }
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
  }, [isGuest, liked, favorites, toggleFavorite]);

  const handleReset = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    setCurrentIndex(0);
    setLiked([]);
    setPassed([]);
    setShowResults(false);
    setLastSwiped(null);
    setArrivedVia('swipe');
  }, []);

  // ── Guest conversion handlers ────────────────────────────────────────────
  const handleConversionAccept = useCallback(async () => {
    await savePendingPicks(liked);   // merge-write BEFORE setConversionVisible (write lands first)
    setConversionVisible(false);
    // D-1 guard: if a chomp animation is already running, fall back to direct push
    if (!isAnimating) {
      requestChomp(buildSignUpChompConfig(Colors.primary), () => {
        router.push('/auth?intent=signup' as never);
      });
    } else {
      router.push('/auth?intent=signup' as never);
    }
  }, [liked, isAnimating, requestChomp, Colors.primary, router]);

  const handleConversionDismiss = useCallback(() => {
    markTriggerDismissed(conversionTrigger);
    setConversionVisible(false);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, [conversionTrigger]);

  useEffect(() => {
    if (showResults) {
      // Success haptic at the celebratory moment — results screen arrival —
      // rather than on the decisive "Pick" tap (which is Medium impact). Covers
      // all three paths into results: end-of-deck swipe right, end-of-deck swipe
      // left, and Pick & Finish confirm.
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
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
    const isDecisiveSinglePick = arrivedVia === 'decisive' && liked.length === 1;

    if (isDecisiveSinglePick) {
      const picked = liked[0];
      const directionsUrl = picked.address
        ? picked.placeId
          ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(picked.address)}&destination_place_id=${picked.placeId}`
          : `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(picked.address)}`
        : `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(picked.name)}`;

      return (
        <View style={[styles.container, { paddingTop: insets.top, backgroundColor: Colors.background }]}>
          <DecisiveResultView
            restaurant={picked}
            isSaved={favorites.includes(picked.id)}
            onToggleSave={handleToggleSave}
            onPlanDinner={() => {
              if (isGuest) {
                setConversionTrigger('plan-dinner');
                setConversionVisible(true);
                return;
              }
              registerRestaurants([picked]);
              router.push(`/plan-event?restaurantId=${picked.id}` as never);
            }}
            onOpenDetail={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              router.push(`/restaurant/${picked.id}` as never);
            }}
            onDirections={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              Linking.openURL(directionsUrl).catch(() => {});
            }}
            onSwipeAgain={handleReset}
            onBack={() => router.back()}
          />
          <Snackbar
            visible={snackbar !== null}
            message={snackbar?.message ?? ''}
            actionLabel={snackbar?.actionLabel}
            onAction={snackbar?.onAction}
            onDismiss={() => setSnackbar(null)}
          />
          <ConversionPrompt
            visible={conversionVisible}
            trigger={conversionTrigger}
            pickCount={liked.length}
            onAccept={handleConversionAccept}
            onDismiss={handleConversionDismiss}
          />
        </View>
      );
    }

    return (
      <View style={[styles.container, { paddingTop: insets.top, backgroundColor: Colors.background }]}>
        <Animated.View style={[styles.resultsContainer, { opacity: resultsOpacity }]}>
          <View style={styles.resultsHeader}>
            <Pressable style={[styles.backBtn, { backgroundColor: Colors.card, borderColor: Colors.border }]} onPress={() => router.back()} accessibilityLabel="Go back" accessibilityRole="button">
              <ArrowLeft size={20} color={Colors.text} />
            </Pressable>
            <AppText variant="display" numberOfLines={1} style={[styles.resultsTitle, { color: Colors.text }]}>Your Picks</AppText>
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
                  accessibilityLabel={
                    allPicksSaved
                      ? 'All picks saved'
                      : isGuest
                        ? `Keep these ${liked.length} picks`
                        : `Save all ${liked.length} picks to favorites`
                  }
                >
                  {allPicksSaved
                    ? <Check size={15} color={Colors.primary} />
                    : <Bookmark size={15} color="#FFF" />}
                  <Text style={[styles.saveAllPillText, { color: allPicksSaved ? Colors.primary : '#FFF' }]}>
                    {allPicksSaved ? 'All saved' : isGuest ? 'Keep these picks' : `Save all ${liked.length}`}
                  </Text>
                </Pressable>
              </View>
              {/* Guest-only banner — always visible when guest has picks */}
              {isGuest && liked.length > 0 && <GuestBanner count={liked.length} />}
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
        {/* Single ConversionPrompt — mounted once; controls both 'save' and 'end-of-swipe' triggers */}
        <ConversionPrompt
          visible={conversionVisible}
          trigger={conversionTrigger}
          pickCount={liked.length}
          onAccept={handleConversionAccept}
          onDismiss={handleConversionDismiss}
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
          accessibilityLabel="This is the one — pick and finish"
          accessibilityRole="button"
        >
          <CheckCircle size={20} color={Colors.primary} />
          <AppText variant="dense" style={[styles.chooseBtnText, { color: Colors.primary }]}>{'This is the one'}</AppText>
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

      {/* Single ConversionPrompt — mounted once on the swipe screen for the 'save' trigger */}
      <ConversionPrompt
        visible={conversionVisible}
        trigger={conversionTrigger}
        pickCount={liked.length}
        onAccept={handleConversionAccept}
        onDismiss={handleConversionDismiss}
      />
      <PickConfirmSheet
        visible={pickConfirmVisible}
        restaurant={currentIndex < sortedRestaurants.length ? sortedRestaurants[currentIndex] : null}
        onConfirm={handlePickConfirmed}
        onCancel={() => setPickConfirmVisible(false)}
      />
    </View>
  );
}

// Module-level helper — declares its own useColors() per project convention (Decision 7).
function GuestBanner({ count }: { count: number }) {
  const Colors = useColors(); // mandatory: module-level helper must declare its own
  return (
    <View
      style={[styles.guestBanner, { backgroundColor: Colors.primaryLight }]}
      accessibilityRole="text"
      accessibilityLabel={`${count} picks ready to take home`}
    >
      <Text style={[styles.guestBannerText, { color: Colors.primary }]}>
        {`🥡 ${count} pick${count !== 1 ? 's' : ''} ready to take home`}
      </Text>
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
        <AppText variant="dense" style={[styles.resultRankText, { color: Colors.primary }]}>{rank}</AppText>
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
    minHeight: 48,
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
  guestBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginHorizontal: 20,
    marginBottom: 12,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 12,
  },
  guestBannerText: {
    fontSize: 14,
    fontWeight: '600' as const,
    textAlign: 'center',
  },
});
