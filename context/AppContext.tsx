import { useEffect, useState, useCallback, useRef } from 'react';
import { AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import createContextHook from '@nkzw/create-context-hook';
import * as Location from 'expo-location';
import { UserPreferences, DiningPlan, Restaurant, FriendEngagement, TrendingApiResponse } from '../types';

import { useAuth } from './AuthContext';
import { updateProfile } from '../services/auth';
import { getPlans } from '../services/plans';
import {
  searchNearby,
  searchText,
  buildSearchNearbyParams,
  CUISINE_TYPE_MAP,
  Coords,
  circleToRect,
  getPlaceDetails,
} from '../services/googlePlaces';
import { mapToRestaurant, vibeAffinity } from '../lib/placesMapper';
import { isOpenAt } from '../lib/restaurantHours';
import { clearGuestFunnelState } from '../lib/guestFunnel';
import { PENDING_PICKS_KEY } from '../lib/pendingPicks';
import { registerRestaurants, getRegisteredRestaurant } from '../lib/restaurantRegistry';
import { api } from '../services/api';

const PREFS_KEY = 'chewabl_preferences';
const ONBOARDED_KEY = 'chewabl_onboarded';
const PLANS_KEY = 'chewabl_plans';
const FAVORITES_KEY = 'chewabl_favorites';
const FAVORITE_RESTAURANTS_KEY = 'chewabl_favorite_restaurants';
const AVATAR_KEY = 'chewabl_avatar_uri';
const GUEST_KEY = 'chewabl_guest_mode';

const BUDGET_MAP: Record<string, string[]> = {
  '$': ['PRICE_LEVEL_INEXPENSIVE'],
  '$$': ['PRICE_LEVEL_MODERATE'],
  '$$$': ['PRICE_LEVEL_EXPENSIVE'],
  '$$$$': ['PRICE_LEVEL_VERY_EXPENSIVE'],
};

export const [AppProvider, useApp] = createContextHook(() => {
  const queryClient = useQueryClient();
  const { isAuthenticated, isLoading: authLoading, user, updateUser } = useAuth();
  const [isOnboarded, setIsOnboarded] = useState<boolean>(false);
  const [preferences, setPreferences] = useState<UserPreferences>({
    name: '',
    cuisines: [],
    budget: ['$$'],
    dietary: [],
    atmosphere: ['Moderate'],
    groupSize: ['2'],
    distance: '5',
  });
  const [localPlans, setLocalPlans] = useState<DiningPlan[]>([]);
  const [favorites, setFavorites] = useState<string[]>([]);
  const [favoritedRestaurants, setFavoritedRestaurants] = useState<Restaurant[]>([]);
  const [localAvatarUri, setLocalAvatarUri] = useState<string | null>(null);
  const [userLocation, setUserLocation] = useState<Coords | null>(null);
  const [isGuest, setIsGuestState] = useState<boolean>(false);
  const [newlyAddedFavoriteIds, setNewlyAddedFavoriteIds] = useState<Set<string>>(new Set());
  const newFavTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const [locationPermission, setLocationPermission] = useState<
    'undetermined' | 'granted' | 'denied'
  >('undetermined');
  const [locationSource, setLocationSource] = useState<'gps' | 'manual' | null>(null);
  const [manualLocationLabel, setManualLocationLabel] = useState<string | null>(null);

  const onboardedQuery = useQuery({
    queryKey: ['onboarded'],
    queryFn: async () => {
      const val = await AsyncStorage.getItem(ONBOARDED_KEY);
      return val === 'true';
    },
  });

  const prefsQuery = useQuery({
    queryKey: ['preferences'],
    queryFn: async () => {
      const stored = await AsyncStorage.getItem(PREFS_KEY);
      return stored ? (JSON.parse(stored) as UserPreferences) : null;
    },
  });

  const favoritesQuery = useQuery({
    queryKey: ['favorites'],
    queryFn: async () => {
      const stored = await AsyncStorage.getItem(FAVORITES_KEY);
      return stored ? (JSON.parse(stored) as string[]) : [];
    },
  });

  const favoritedRestaurantsQuery = useQuery({
    queryKey: ['favoritedRestaurants'],
    queryFn: async () => {
      const stored = await AsyncStorage.getItem(FAVORITE_RESTAURANTS_KEY);
      return stored ? (JSON.parse(stored) as Restaurant[]) : [];
    },
  });

  const avatarQuery = useQuery({
    queryKey: ['avatarUri'],
    queryFn: async () => {
      const stored = await AsyncStorage.getItem(AVATAR_KEY);
      return stored ?? null;
    },
  });

  const guestQuery = useQuery({
    queryKey: ['guestMode'],
    queryFn: async () => {
      const val = await AsyncStorage.getItem(GUEST_KEY);
      return val === 'true';
    },
  });

  useEffect(() => {
    if (onboardedQuery.data !== undefined) {
      setIsOnboarded(onboardedQuery.data);
    }
  }, [onboardedQuery.data]);

  useEffect(() => {
    if (guestQuery.data !== undefined) {
      setIsGuestState(guestQuery.data);
    }
  }, [guestQuery.data]);

  // Clear guest mode when user authenticates
  useEffect(() => {
    if (isAuthenticated && isGuest) {
      setIsGuestState(false);
      AsyncStorage.removeItem(GUEST_KEY).catch(() => {});
    }
  }, [isAuthenticated, isGuest]);

  // Clear ALL user-specific state on sign-out to prevent data leaking to the next user/guest
  const prevAuthRef = useRef(isAuthenticated);
  useEffect(() => {
    if (prevAuthRef.current && !isAuthenticated) {
      setFavorites([]);
      setFavoritedRestaurants([]);
      setPreferences({ name: '', cuisines: [], budget: ['$$'], dietary: [], atmosphere: ['Moderate'], groupSize: ['2'], distance: '5' });
      setLocalAvatarUri(null);
      setIsOnboarded(false);
      AsyncStorage.multiRemove([
        FAVORITES_KEY,
        FAVORITE_RESTAURANTS_KEY,
        PREFS_KEY,
        ONBOARDED_KEY,
        AVATAR_KEY,
        PENDING_PICKS_KEY,
      ]).catch(() => {});
      clearGuestFunnelState().catch(() => {}); // D-2 fix: clear guest funnel state on sign-out
    }
    prevAuthRef.current = isAuthenticated;
  }, [isAuthenticated]);

  // Migrate old string preference values to arrays for backward compatibility
  function migratePreferences(raw: Partial<UserPreferences>): UserPreferences {
    return {
      name: raw.name ?? '',
      cuisines: raw.cuisines ?? [],
      budget: Array.isArray(raw.budget) ? raw.budget : (raw.budget ? [raw.budget as string] : ['$$']),
      dietary: raw.dietary ?? [],
      atmosphere: Array.isArray(raw.atmosphere) ? raw.atmosphere : (raw.atmosphere ? [raw.atmosphere as string] : ['Moderate']),
      groupSize: Array.isArray(raw.groupSize) ? raw.groupSize : (raw.groupSize ? [raw.groupSize as string] : ['2']),
      distance: raw.distance ?? '5',
      isDarkMode: raw.isDarkMode,
      notificationsEnabled: raw.notificationsEnabled,
    };
  }

  // Auto-onboard when an authenticated user already has preferences on the backend
  useEffect(() => {
    if (isAuthenticated && user?.preferences && !isOnboarded) {
      setIsOnboarded(true);
      AsyncStorage.setItem(ONBOARDED_KEY, 'true').catch(() => {});
    }
  }, [isAuthenticated, user?.preferences, isOnboarded]);

  // Hydrate preferences from server when authenticated, otherwise from AsyncStorage
  useEffect(() => {
    if (isAuthenticated && user?.preferences) {
      setPreferences(prev => migratePreferences({ ...prev, ...user.preferences }));
    } else if (!isAuthenticated && prefsQuery.data) {
      setPreferences(prev => migratePreferences({ ...prev, ...prefsQuery.data }));
    }
  }, [isAuthenticated, user, prefsQuery.data]);

  // Hydrate favorites from server when authenticated, otherwise from AsyncStorage
  useEffect(() => {
    if (isAuthenticated && user?.favorites) {
      setFavorites(user.favorites);
      // When authenticated, only show restaurants matching server-side favorite IDs
      // This prevents stale AsyncStorage data from a previous user leaking through
      if (favoritedRestaurantsQuery.data) {
        const serverIds = new Set(user.favorites);
        setFavoritedRestaurants(favoritedRestaurantsQuery.data.filter(r => serverIds.has(r.id)));
      } else {
        setFavoritedRestaurants([]);
      }
    } else if (isGuest) {
      // Guests cannot persist favorites (#152 lockdown) — never hydrate from
      // FAVORITES_KEY. On a shared device that key may still hold a previous
      // signed-in user's favorites: the sign-out cleanup's multiRemove is
      // fire-and-forget and loses the race against this query's refetch, so a
      // guest would otherwise inherit a stranger's Bites.
      setFavorites([]);
      setFavoritedRestaurants([]);
    } else if (!isAuthenticated && favoritesQuery.data) {
      setFavorites(favoritesQuery.data);
      if (favoritedRestaurantsQuery.data) {
        setFavoritedRestaurants(favoritedRestaurantsQuery.data);
      }
    }
  }, [isAuthenticated, isGuest, user, favoritesQuery.data, favoritedRestaurantsQuery.data]);

  useEffect(() => {
    if (avatarQuery.data !== undefined) {
      setLocalAvatarUri(avatarQuery.data);
    }
  }, [avatarQuery.data]);

  // Sync avatar from backend user when authenticated (survives cache clears / reinstalls)
  useEffect(() => {
    if (isAuthenticated && user?.avatarUri) {
      setLocalAvatarUri(user.avatarUri);
      AsyncStorage.setItem(AVATAR_KEY, user.avatarUri).catch(() => {});
    }
  }, [isAuthenticated, user?.avatarUri]);

  // Fetch plans from backend when authenticated
  const plansQuery = useQuery({
    queryKey: ['plans'],
    queryFn: getPlans,
    enabled: isAuthenticated,
    staleTime: 60 * 1000,
  });

  const plans = isAuthenticated
    ? (plansQuery.data ?? [])
    : [];

  const requestLocation = useCallback(async (): Promise<boolean> => {
    let permissionGranted = false;
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setLocationPermission(status === 'denied' ? 'denied' : 'undetermined');
        return false;
      }
      permissionGranted = true;
      setLocationPermission('granted');

      // Fast path: a cached fix returns instantly; fall back to a fresh read.
      const known = await Location.getLastKnownPositionAsync();
      const coords =
        known?.coords ??
        (await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced })).coords;

      setUserLocation({ latitude: coords.latitude, longitude: coords.longitude });
      setLocationSource('gps');
      setManualLocationLabel(null);
      return true;
    } catch (err) {
      // A position-fetch failure is NOT a permission denial. Only report
      // 'denied' when the permission request itself was rejected — otherwise
      // the user is sent to Settings to fix a permission that is already granted.
      console.warn('[location] requestLocation failed:', err);
      if (!permissionGranted) setLocationPermission('denied');
      return false;
    }
  }, []);

  const setManualLocation = useCallback((coords: Coords, label?: string | null) => {
    setUserLocation(coords);
    setLocationPermission('granted');
    setLocationSource('manual');
    if (label !== undefined) setManualLocationLabel(label?.trim() || null);
  }, []);

  const clearManualLocation = useCallback(async () => {
    setUserLocation(null);
    setLocationSource(null);
    setManualLocationLabel(null);
    // Re-sync OS permission state — setManualLocation forced it to 'granted',
    // so without this the post-clear empty state could mis-report denied as granted.
    try {
      const { status } = await Location.getForegroundPermissionsAsync();
      if (status === 'granted') setLocationPermission('granted');
      else if (status === 'denied') setLocationPermission('denied');
      else setLocationPermission('undetermined');
    } catch {
      setLocationPermission('undetermined');
    }
  }, []);

  // Sync permission state with the OS on mount and when returning from Settings
  useEffect(() => {
    const check = async () => {
      // Don't overwrite manually-set location (e.g. from zip code)
      if (locationSource === 'manual') return;
      const { status } = await Location.getForegroundPermissionsAsync();
      if (status === 'granted') {
        setLocationPermission('granted');
        if (!userLocation) {
          try {
            const pos = await Location.getLastKnownPositionAsync();
            if (pos) {
              setUserLocation({
                latitude: pos.coords.latitude,
                longitude: pos.coords.longitude,
              });
              return;
            }
            const fresh = await Location.getCurrentPositionAsync({
              accuracy: Location.Accuracy.Low,
            });
            setUserLocation({
              latitude: fresh.coords.latitude,
              longitude: fresh.coords.longitude,
            });
          } catch (err) {
            // Permission is still granted — only the position fetch failed.
            // Leave locationPermission as 'granted' (so the UI does not lie
            // about a permission problem) and surface the real error.
            console.warn('[location] check() position fetch failed:', err);
          }
        }
      } else if (status === 'denied') {
        setLocationPermission('denied');
      } else {
        setLocationPermission('undetermined');
      }
    };
    check();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') check();
    });
    return () => sub.remove();
  }, [locationSource]);

  // Request location once after onboarding is confirmed
  useEffect(() => {
    if (isOnboarded && !userLocation && locationPermission === 'undetermined') {
      requestLocation();
    }
  }, [isOnboarded, userLocation, locationPermission, requestLocation]);

  const saveOnboarding = useMutation({
    mutationFn: async (prefs: UserPreferences) => {
      await AsyncStorage.setItem(ONBOARDED_KEY, 'true');
      await AsyncStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
      if (isAuthenticated) {
        await updateProfile({ preferences: prefs });
      }
      return prefs;
    },
    onSuccess: (prefs) => {
      setIsOnboarded(true);
      setPreferences(prefs);
      queryClient.invalidateQueries({ queryKey: ['onboarded'] });
      queryClient.invalidateQueries({ queryKey: ['preferences'] });
    },
  });

  const updatePreferences = useMutation({
    mutationFn: async (prefs: UserPreferences) => {
      await AsyncStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
      if (isAuthenticated) {
        await updateProfile({ preferences: prefs });
      }
      return prefs;
    },
    onMutate: (newPrefs) => {
      // [DA-FIX-8] Optimistic update: flip local state synchronously before
      // the async mutationFn completes. This ensures theme changes (isDarkMode)
      // take effect within the 150ms COMMIT_DELAY window during Chomp animation.
      setPreferences(newPrefs);
    },
    onSuccess: (prefs) => {
      setPreferences(prefs);
    },
  });

  const clearNewlyAddedFavorite = useCallback((id: string) => {
    setNewlyAddedFavoriteIds(prev => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    const timer = newFavTimersRef.current.get(id);
    if (timer) {
      clearTimeout(timer);
      newFavTimersRef.current.delete(id);
    }
  }, []);

  const promotePicks = useCallback(async (restaurants: Restaurant[]) => {
    if (restaurants.length === 0) return;

    // 1. Deduplicate: only add restaurants not already in favorites
    const newRestaurants = restaurants.filter(r => !favorites.includes(r.id));
    if (newRestaurants.length === 0) return;

    const newIds = newRestaurants.map(r => r.id);

    // 2. Build merged favorites arrays
    const mergedIds = [...favorites, ...newIds];
    const mergedRestaurants = [
      ...favoritedRestaurants.filter(r => !newIds.includes(r.id)),
      ...newRestaurants,
    ];

    // 3. Update newlyAddedFavoriteIds for each new pick (triggers BiteCard glow)
    setNewlyAddedFavoriteIds(prev => {
      const next = new Set(prev);
      newIds.forEach(id => next.add(id));
      return next;
    });

    // 4. Set 30s auto-clear timers per ID (mirrors toggleFavorite pattern exactly)
    newIds.forEach(id => {
      const existingTimer = newFavTimersRef.current.get(id);
      if (existingTimer) clearTimeout(existingTimer);
      newFavTimersRef.current.set(id, setTimeout(() => {
        setNewlyAddedFavoriteIds(prev => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
        newFavTimersRef.current.delete(id);
      }, 30_000));
    });

    // 5. Sync the in-memory auth user FIRST. The favorites-hydration effect
    //    reads `user.favorites` (not the query data) in its authenticated
    //    branch — if `user.favorites` is stale (the empty array from a fresh
    //    signup), the effect would clobber `favorites` back to []. Updating
    //    `user` here keeps that effect correct whenever it next fires.
    updateUser({ favorites: mergedIds });

    // 6. Update React state synchronously
    setFavorites(mergedIds);
    setFavoritedRestaurants(mergedRestaurants);

    // 7. Persist to AsyncStorage
    try {
      await AsyncStorage.setItem(FAVORITES_KEY, JSON.stringify(mergedIds));
      await AsyncStorage.setItem(FAVORITE_RESTAURANTS_KEY, JSON.stringify(mergedRestaurants));
    } catch (err) {
      console.error('[promotePicks] AsyncStorage write failed:', err);
    }

    // 8. Synchronize the React Query cache so the hydration effect's
    //    favoritedRestaurants filter has the promoted restaurant objects.
    queryClient.setQueryData<string[]>(['favorites'], mergedIds);
    queryClient.setQueryData<Restaurant[]>(['favoritedRestaurants'], mergedRestaurants);

    // 9. ONE backend write (isAuthenticated is always true when review-picks mounts)
    if (isAuthenticated) {
      try {
        await updateProfile({ favorites: mergedIds });
      } catch (err) {
        console.error('[promotePicks] Backend sync failed:', err);
      }
    }
  }, [isAuthenticated, favorites, favoritedRestaurants, queryClient, updateUser]);

  const toggleFavorite = useCallback((restaurant: Restaurant) => {
    // Defense in depth (#174 / #152): guests never persist favorites. Known
    // callers (swipe save, swipe save-all, restaurant-detail heart) already
    // intercept and open ConversionPrompt instead of calling this. Guarding
    // here means any *new* caller that forgets that contract gets a silent
    // no-op rather than silently writing to FAVORITES_KEY — that's how the
    // original cross-user favorites leak manifested.
    if (isGuest) {
      if (__DEV__) {
        console.warn('[toggleFavorite] called in guest mode — caller should intercept and open ConversionPrompt');
      }
      return;
    }
    const restaurantId = restaurant.id;
    const isRemoving = favorites.includes(restaurantId);
    const updated = isRemoving
      ? favorites.filter(id => id !== restaurantId)
      : [...favorites, restaurantId];

    // Track newly added favorite BEFORE state update (DC-5)
    if (!isRemoving) {
      setNewlyAddedFavoriteIds(prev => new Set(prev).add(restaurantId));
      // Auto-clear after 30 seconds per ID (DC-3)
      const existingTimer = newFavTimersRef.current.get(restaurantId);
      if (existingTimer) clearTimeout(existingTimer);
      newFavTimersRef.current.set(restaurantId, setTimeout(() => {
        setNewlyAddedFavoriteIds(prev => {
          const next = new Set(prev);
          next.delete(restaurantId);
          return next;
        });
        newFavTimersRef.current.delete(restaurantId);
      }, 30_000));
    }

    // Sync the in-memory auth user so the favorites-hydration effect (which
    // reads user.favorites, not query data) can't silently revert this
    // toggle on a later re-fire. Same pattern as promotePicks — see #252.
    if (isAuthenticated) {
      updateUser({ favorites: updated });
    }

    setFavorites(updated);

    // Compute the next favoritedRestaurants list eagerly (instead of inside
    // the setter callback) so we can mirror it into the React Query cache.
    const updatedRestaurants = isRemoving
      ? favoritedRestaurants.filter(r => r.id !== restaurantId)
      : [...favoritedRestaurants.filter(r => r.id !== restaurantId), restaurant];

    setFavoritedRestaurants(updatedRestaurants);
    AsyncStorage.setItem(FAVORITE_RESTAURANTS_KEY, JSON.stringify(updatedRestaurants)).catch(err =>
      console.error('[FavoritedRestaurants] AsyncStorage write failed:', err)
    );

    // Sync the React Query cache so the favorites-hydration effect (which
    // filters favoritedRestaurantsQuery.data by user.favorites) sees the new
    // restaurant when it fires after updateUser. Without this, the effect
    // intersects user.favorites with a stale cache and clobbers the
    // optimistic update — Your Bites stays empty even though the heart
    // animates filled. Same pattern as promotePicks (#252).
    queryClient.setQueryData<string[]>(['favorites'], updated);
    queryClient.setQueryData<Restaurant[]>(['favoritedRestaurants'], updatedRestaurants);

    (async () => {
      try {
        await AsyncStorage.setItem(FAVORITES_KEY, JSON.stringify(updated));
      } catch (err) {
        console.error('[Favorites] AsyncStorage write failed:', err);
      }
      if (isAuthenticated) {
        try {
          await updateProfile({ favorites: updated });
        } catch (err) {
          console.error('[Favorites] Backend sync failed:', err);
        }
      }
    })();
  }, [isAuthenticated, isGuest, favorites, favoritedRestaurants, queryClient, updateUser]);

  const addPlan = useCallback((plan: DiningPlan) => {
    if (isAuthenticated) {
      // Optimistic update: add plan to cache immediately, then refetch
      queryClient.setQueryData<DiningPlan[]>(['plans'], old => [plan, ...(old ?? [])]);
      queryClient.invalidateQueries({ queryKey: ['plans'] });
    } else {
      setLocalPlans(prev => [plan, ...prev]);
    }
  }, [isAuthenticated, queryClient]);

  const setLocalAvatar = useCallback(async (uri: string) => {
    await AsyncStorage.setItem(AVATAR_KEY, uri);
    setLocalAvatarUri(uri);
  }, []);

  const setGuestMode = useCallback(async (value: boolean) => {
    setIsGuestState(value);
    if (value) {
      await AsyncStorage.setItem(GUEST_KEY, 'true');
    } else {
      await AsyncStorage.removeItem(GUEST_KEY);
    }
  }, []);

  const isLoading = authLoading || onboardedQuery.isLoading || prefsQuery.isLoading
    || (isAuthenticated && plansQuery.isLoading);

  return {
    isOnboarded,
    isGuest,
    setGuestMode,
    isLoading,
    preferences,
    plans,
    favorites,
    favoritedRestaurants,
    localAvatarUri,
    setLocalAvatar,
    userLocation,
    locationPermission,
    locationSource,
    manualLocationLabel,
    setManualLocation,
    clearManualLocation,
    saveOnboarding,
    updatePreferences,
    toggleFavorite,
    promotePicks,
    newlyAddedFavoriteIds,
    clearNewlyAddedFavorite,
    addPlan,
    requestLocation,
  };
});

// ---------------------------------------------------------------------------
// Standalone React Query hooks – call these inside AppProvider children
// ---------------------------------------------------------------------------

export function useNearbyRestaurants(
  maxResultCount: number = 10,
  planCuisine?: string,
  planBudget?: string,
  options?: { enabled?: boolean; planEventDateTime?: Date | null },
) {
  const { preferences, userLocation } = useApp();

  // When plan filters are provided, override user preferences for the query
  const effectiveCuisines = planCuisine && planCuisine !== 'Any'
    ? planCuisine.split(', ').map(c => c.trim())
    : preferences.cuisines;
  const effectiveBudget = planBudget ? [planBudget] : preferences.budget;

  const hasCuisineFilter = !!(planCuisine && planCuisine !== 'Any');
  const preferredRadiusMiles = parseFloat(preferences.distance) || 5;

  return useQuery<Restaurant[]>({
    queryKey: [
      'nearbyRestaurants',
      effectiveCuisines,
      effectiveBudget,
      preferences.atmosphere,
      preferences.distance,
      userLocation?.latitude,
      userLocation?.longitude,
      maxResultCount,
      planCuisine ?? null,
      options?.planEventDateTime?.getTime() ?? null,
    ],
    queryFn: async () => {
      if (!userLocation) {
        return [];
      }
      const overriddenPrefs = {
        ...preferences,
        cuisines: effectiveCuisines,
        budget: effectiveBudget,
      };
      const baseParams = buildSearchNearbyParams(overriddenPrefs, userLocation, maxResultCount);
      // Always include at least 'restaurant' so the query is meaningful
      if (!baseParams.includedTypes || baseParams.includedTypes.length === 0) {
        baseParams.includedTypes = ['restaurant'];
      }

      const baseRadiusMeters = baseParams.radiusMeters;
      const maxRadiusMeters = 80467; // ~50 miles
      const multipliers = [1, 2, 3];
      const seenIds = new Set<string>();
      const collected: Restaurant[] = [];

      // Determine if we have a budget filter
      const hasBudget = effectiveBudget.length > 0 && effectiveBudget.some(b => !!BUDGET_MAP[b]);
      // Split into individual price levels for separate API calls —
      // combining them in one call lets $$$ crowd out $$$$ in the 20-result cap
      const priceLevelGroups = effectiveBudget
        .map(b => BUDGET_MAP[b])
        .filter((pl): pl is string[] => !!pl && pl.length > 0);

      // Build text query from cuisine preferences
      const textQuery = effectiveCuisines.length > 0 && effectiveCuisines.length <= 3
        ? effectiveCuisines.map(c => `${c} restaurant`).join(' OR ')
        : 'restaurants';

      for (const mult of multipliers) {
        const radius = Math.min(baseRadiusMeters * mult, maxRadiusMeters);

        let places: import('../services/googlePlaces').Place[];
        if (hasBudget) {
          // Fire separate searchText calls per price level so each tier
          // gets its own 20-result slot ($$$ won't crowd out $$$$)
          const rect = circleToRect(userLocation, radius);
          const allPlaces = await Promise.all(
            priceLevelGroups.map(pl =>
              searchText({
                textQuery,
                locationRestriction: rect,
                priceLevels: pl,
                maxResultCount: 20,
              })
            )
          );
          places = allPlaces.flat();
        } else {
          // No budget filter — searchNearby works fine
          baseParams.radiusMeters = radius;
          places = await searchNearby(baseParams);
        }

        const mapped = places.map(p => mapToRestaurant(p, userLocation));

        // Strict cuisine filter when plan cuisine is specified
        const filtered = hasCuisineFilter
          ? mapped.filter(r => effectiveCuisines.includes(r.cuisine))
          : mapped;

        for (const r of filtered) {
          if (!seenIds.has(r.id)) {
            seenIds.add(r.id);
            const distMiles = parseFloat(r.distance) || 0;
            collected.push({
              ...r,
              isOutsidePreferredRadius: distMiles > preferredRadiusMiles,
            });
          }
        }

        if (collected.length >= maxResultCount) break;
        if (radius >= maxRadiusMeters) break;
      }

      // Prefer in-radius results; top up with farther-out results to reach
      // maxResultCount so the deck isn't sparse when the preferred radius is
      // thin on matches (especially with a strict cuisine filter).
      const within = collected.filter(r => !r.isOutsidePreferredRadius);
      const outside = collected.filter(r => r.isOutsidePreferredRadius);
      const result = [...within, ...outside].slice(0, maxResultCount);

      // Sort by rating (desc) then proximity (asc), with vibe affinity as tiebreaker
      result.sort((a, b) => {
        const ratingDiff = b.rating - a.rating;
        if (Math.abs(ratingDiff) >= 0.3) return ratingDiff;
        const distA = parseFloat(a.distance) || 0;
        const distB = parseFloat(b.distance) || 0;
        const distDiff = distA - distB;
        if (Math.abs(distDiff) >= 0.5) return distDiff;
        return vibeAffinity(b.vibeScore ?? 0, preferences.atmosphere) - vibeAffinity(a.vibeScore ?? 0, preferences.atmosphere);
      });

      const eventDt = options?.planEventDateTime ?? null;
      const finalResult = eventDt
        ? result.filter(r => isOpenAt(r.openingPeriods, eventDt))
        : result;

      registerRestaurants(finalResult);
      return finalResult;
    },
    staleTime: 5 * 60 * 1000,
    enabled: options?.enabled ?? true,
  });
}

export function useSearchRestaurants(
  query: string,
  cuisines: string[],
  budgets: string[],
  distanceOverride?: string,
  locationOverride?: { latitude: number; longitude: number } | null,
) {
  const { preferences, userLocation } = useApp();

  const effectiveLocation = locationOverride ?? userLocation;
  const distanceMiles = parseFloat(distanceOverride || preferences.distance || '5');
  const baseRadiusMeters = Math.round(distanceMiles * 1609.34);

  return useQuery<Restaurant[]>({
    queryKey: ['searchRestaurants', query, cuisines, budgets, distanceOverride, effectiveLocation?.latitude, effectiveLocation?.longitude],
    queryFn: async () => {
      if (!effectiveLocation && !query.trim()) return [];

      // Build text queries — one per cuisine for comprehensive results,
      // or the user's typed query, or a generic "restaurants" fallback.
      const textQueries: string[] = query.trim()
        ? [query.trim()]
        : cuisines.length > 0
          ? cuisines.map(c => `${c} restaurant`)
          : ['restaurants'];

      // Build price level groups for per-tier API calls.
      // When budget is filtered, only search those tiers.
      // When "All", don't pass priceLevels (let Google return everything).
      const priceLevelGroups: string[][] | null = budgets.length > 0
        ? budgets.map(b => BUDGET_MAP[b]).filter((pl): pl is string[] => !!pl && pl.length > 0)
        : null;

      const maxRadiusMeters = 80467; // ~50 miles
      const seenIds = new Set<string>();
      const collected: Restaurant[] = [];

      // Use locationRestriction (rectangle) which has no radius limit,
      // unlike searchNearby which caps at 50,000m.
      const rect = effectiveLocation
        ? circleToRect(effectiveLocation, Math.min(baseRadiusMeters, maxRadiusMeters))
        : undefined;

      // Fire parallel calls: one per text query × one per price tier
      const calls: Promise<import('../services/googlePlaces').Place[]>[] = [];

      for (const tq of textQueries) {
        if (priceLevelGroups) {
          // Per-price-level calls so each tier gets its own 20-result slot
          for (const pl of priceLevelGroups) {
            calls.push(
              searchText({
                textQuery: tq,
                locationRestriction: rect,
                priceLevels: pl,
                maxResultCount: 20,
              }).catch(() => [] as import('../services/googlePlaces').Place[])
            );
          }
        } else {
          // No budget filter — single call per query, all price levels
          calls.push(
            searchText({
              textQuery: tq,
              locationRestriction: rect,
              maxResultCount: 20,
            }).catch(() => [] as import('../services/googlePlaces').Place[])
          );
        }
      }

      const results = await Promise.all(calls);
      const allPlaces = results.flat();
      const mapped = allPlaces.map(p => mapToRestaurant(p, effectiveLocation || undefined));

      for (const r of mapped) {
        if (seenIds.has(r.id)) continue;
        seenIds.add(r.id);

        // Client-side cuisine filter — only when user typed a search query.
        // When browsing with cuisine chips, the per-cuisine text queries
        // ("Italian restaurant", etc.) already filter at the API level.
        // Filtering again here would reject restaurants whose primaryType
        // doesn't match our cuisine map (e.g. steak_house → "Restaurant").
        if (query.trim() && cuisines.length > 0 && !cuisines.includes(r.cuisine)) continue;

        // Client-side budget filter
        if (budgets.length > 0) {
          const priceStr = '$'.repeat(r.priceLevel);
          if (!budgets.includes(priceStr)) continue;
        }

        // Client-side distance filter
        if (effectiveLocation) {
          const dist = parseFloat(r.distance) || 0;
          if (dist > distanceMiles) continue;
        }

        collected.push(r);
      }

      // Sort by rating (desc), then distance (asc)
      collected.sort((a, b) => {
        if (b.rating !== a.rating) return b.rating - a.rating;
        return (parseFloat(a.distance) || 0) - (parseFloat(b.distance) || 0);
      });

      registerRestaurants(collected);
      return collected;
    },
    enabled: !!(effectiveLocation || query.trim()),
    staleTime: 5 * 60 * 1000,
  });
}

// ---------------------------------------------------------------------------
// useTrendingWithFriends — REQ-004 (delta D-5: limit option, max 10 default)
// ---------------------------------------------------------------------------

function haversineDistanceMiles(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 3958.8;
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * (Math.PI / 180)) *
      Math.cos(lat2 * (Math.PI / 180)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export type TrendingRestaurant = Restaurant & { friendEngagement: FriendEngagement };

export type TrendingResult = {
  friendCount: number;
  restaurants: TrendingRestaurant[];
};

export function useTrendingWithFriends(opts?: { limit?: number; enabled?: boolean }): {
  data: TrendingResult | undefined;
  isFetching: boolean;
  isError: boolean;
} {
  const { preferences, userLocation } = useApp();
  const { user } = useAuth();
  const limit = opts?.limit ?? 10;

  return useQuery<TrendingResult>({
    queryKey: [
      'trendingWithFriends',
      user?.id,
      userLocation?.latitude,
      userLocation?.longitude,
      preferences.distance,
      limit,
    ],
    queryFn: async (): Promise<TrendingResult> => {
      if (!userLocation || !user) {
        return { friendCount: 0, restaurants: [] };
      }

      const response = await api.get<TrendingApiResponse>('/restaurants/trending-with-friends');
      const { friendCount, items } = response;

      if (!items || items.length === 0) {
        return { friendCount, restaurants: [] };
      }

      // Hydrate top `limit` items in batches of 5 (delta D-5)
      const toHydrate = items.slice(0, limit);
      const BATCH_SIZE = 5;
      const hydrated: Array<{ item: typeof toHydrate[0]; restaurant: Restaurant } | null> = [];

      for (let i = 0; i < toHydrate.length; i += BATCH_SIZE) {
        const batch = toHydrate.slice(i, i + BATCH_SIZE);
        const results = await Promise.allSettled(
          batch.map(async (item) => {
            // Cache lookup first
            const cached = getRegisteredRestaurant(item.placeId);
            if (cached) {
              return { item, restaurant: cached };
            }
            // Google Places fallback
            const place = await getPlaceDetails(item.placeId);
            if (!place) throw new Error(`No place details for ${item.placeId}`);
            const restaurant = mapToRestaurant(place, userLocation);
            return { item, restaurant };
          })
        );

        for (const result of results) {
          if (result.status === 'fulfilled') {
            hydrated.push(result.value);
          }
          // Dropped on rejection (delta D-5: keep going)
        }
      }

      // Register hydrated restaurants so the detail screen (which resolves a
      // restaurant by id via the registry) can find them when a card is tapped.
      // Without this, freshly-fetched trending restaurants that aren't also in
      // the nearby cache hit the "Restaurant Not Found" page.
      registerRestaurants(hydrated.flatMap(e => (e ? [e.restaurant] : [])));

      // Geo filter: drop restaurants outside preferences.distance (delta D-1)
      const preferredRadiusMiles = parseFloat(preferences.distance) || 5;
      const filtered: TrendingRestaurant[] = [];

      for (const entry of hydrated) {
        if (!entry) continue;
        const { item, restaurant } = entry;

        // Distance check using persisted coords (delta D-1) or parsed distance string as fallback
        let distMiles: number;
        if (restaurant.latitude !== undefined && restaurant.longitude !== undefined) {
          distMiles = haversineDistanceMiles(
            userLocation.latitude,
            userLocation.longitude,
            restaurant.latitude,
            restaurant.longitude
          );
        } else {
          distMiles = parseFloat(restaurant.distance) || 0;
        }

        if (distMiles > preferredRadiusMiles) continue;

        const friendEngagement: FriendEngagement = {
          friends: item.friends.map(f => ({ id: f.id, name: f.name, avatarUri: f.avatarUri })),
          count: item.friendCount,
          lastActivityAt: item.lastActivityAt,
        };

        filtered.push({ ...restaurant, friendEngagement });
      }

      return { friendCount, restaurants: filtered };
    },
    enabled: (opts?.enabled ?? true) && !!user && !!userLocation,
    staleTime: 5 * 60 * 1000,
  });
}
