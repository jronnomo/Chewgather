import { useEffect, useState, useCallback, useRef } from 'react';
import { AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import createContextHook from '@nkzw/create-context-hook';
import * as Location from 'expo-location';
import { UserPreferences, DiningPlan, Restaurant } from '../types';

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
} from '../services/googlePlaces';
import { mapToRestaurant, vibeAffinity } from '../lib/placesMapper';
import { registerRestaurants } from '../lib/restaurantRegistry';

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
  const { isAuthenticated, isLoading: authLoading, user } = useAuth();
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
      ]).catch(() => {});
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
    } else if (!isAuthenticated && favoritesQuery.data) {
      setFavorites(favoritesQuery.data);
      if (favoritedRestaurantsQuery.data) {
        setFavoritedRestaurants(favoritedRestaurantsQuery.data);
      }
    }
  }, [isAuthenticated, user, favoritesQuery.data, favoritedRestaurantsQuery.data]);

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

  const requestLocation = useCallback(async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setLocationPermission('denied');
        return;
      }
      setLocationPermission('granted');
      const pos = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      setUserLocation({
        latitude: pos.coords.latitude,
        longitude: pos.coords.longitude,
      });
      setLocationSource('gps');
    } catch {
      setLocationPermission('denied');
    }
  }, []);

  const setManualLocation = useCallback((coords: Coords) => {
    setUserLocation(coords);
    setLocationPermission('granted');
    setLocationSource('manual');
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
          } catch {
            // Location fetch failed — permission is still granted,
            // requestLocation will retry with the full flow later
          }
        }
      } else if (status === 'denied') {
        setLocationPermission('denied');
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

  const toggleFavorite = useCallback((restaurant: Restaurant) => {
    const restaurantId = restaurant.id;
    const isRemoving = favorites.includes(restaurantId);

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

    setFavorites(prev => {
      const updated = isRemoving
        ? prev.filter(id => id !== restaurantId)
        : [...prev, restaurantId];

      // Update cached restaurant objects
      setFavoritedRestaurants(prevRestaurants => {
        const updatedRestaurants = isRemoving
          ? prevRestaurants.filter(r => r.id !== restaurantId)
          : [...prevRestaurants.filter(r => r.id !== restaurantId), restaurant];
        AsyncStorage.setItem(FAVORITE_RESTAURANTS_KEY, JSON.stringify(updatedRestaurants)).catch(err =>
          console.error('[FavoritedRestaurants] AsyncStorage write failed:', err)
        );
        return updatedRestaurants;
      });

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
      return updated;
    });
  }, [isAuthenticated, favorites]);

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
    setManualLocation,
    saveOnboarding,
    updatePreferences,
    toggleFavorite,
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
            // Enforce preferred radius — don't include restaurants beyond it
            if (distMiles > preferredRadiusMiles) continue;
            collected.push(r);
          }
        }

        if (collected.length >= maxResultCount) break;
        if (radius >= maxRadiusMeters) break;
      }

      const result = collected.slice(0, maxResultCount);

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

      registerRestaurants(result);
      return result;
    },
    staleTime: 5 * 60 * 1000,
  });
}

export function useSearchRestaurants(
  query: string,
  cuisine: string,
  budget: string
) {
  const { preferences, userLocation } = useApp();

  return useQuery<Restaurant[]>({
    queryKey: ['searchRestaurants', query, cuisine, budget, userLocation?.latitude, userLocation?.longitude],
    queryFn: async () => {
      const distanceMiles = parseFloat(preferences.distance || '5');
      const radiusMeters = Math.min(Math.round(distanceMiles * 1609.34), 50000);
      const priceLevels = budget !== 'All' ? (BUDGET_MAP[budget] || []) : [];

      // Build text query: use typed query, or cuisine filter, or generic fallback
      let textQuery = query.trim();
      if (!textQuery) {
        textQuery = cuisine !== 'All' ? `${cuisine} restaurant` : 'restaurant';
      }

      // Map selected cuisine chip to an includedType for the API
      // Only use includedType when the cuisine maps to a single type;
      // when multiple types exist, rely on the text query for filtering
      const cuisineTypes =
        cuisine !== 'All' && CUISINE_TYPE_MAP[cuisine]
          ? CUISINE_TYPE_MAP[cuisine]
          : [];
      const includedType = cuisineTypes.length === 1 ? cuisineTypes[0] : undefined;

      const places = await searchText({
        textQuery,
        location: userLocation || undefined,
        radiusMeters: userLocation ? radiusMeters : undefined,
        priceLevels: priceLevels.length > 0 ? priceLevels : undefined,
        includedType,
        maxResultCount: 20,
      });

      // Return actual results — empty array for zero results, not mock data
      if (places.length === 0) return [];
      const mapped = places.map(p => mapToRestaurant(p, userLocation || undefined));
      registerRestaurants(mapped);
      return mapped;
    },
    // Only fire when we have a location or a search query
    enabled: !!(userLocation || query.trim()),
    staleTime: 5 * 60 * 1000,
  });
}
