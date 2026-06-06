import React, { useState, useCallback, useRef, useMemo, useEffect } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  TextInput,
  Pressable,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Switch,
  Animated,
  LayoutAnimation,
  UIManager,
} from 'react-native';
import AppText from '@/components/AppText';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Image } from 'expo-image';
import { X, CalendarDays, Clock, UtensilsCrossed, DollarSign, Sparkles, UserCheck, Timer, Check, Flame, ChevronDown, Lock } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useApp, useNearbyRestaurants } from '../context/AppContext';
import RestaurantCountSlider from '../components/RestaurantCountSlider';
import BudgetSegmentedControl from '../components/BudgetSegmentedControl';
import VisibilitySegmentedControl, { VisibilityValue } from '../components/VisibilitySegmentedControl';
import FriendAvatarRow from '../components/FriendAvatarRow';
import { useAuth } from '../context/AuthContext';
import { CUISINES, BUDGET_OPTIONS, restaurants } from '../mocks/restaurants';
import { getRegisteredRestaurant } from '../lib/restaurantRegistry';
import { DiningPlan } from '../types';
import { getFriends } from '../services/friends';
import { createPlan, updatePlan } from '../services/plans';
import StaticColors from '../constants/colors';
import { DEFAULT_AVATAR_URI } from '../constants/images';
import { useColors } from '../context/ThemeContext';
import { useThemeTransition, buildPlanSuccessChompConfig } from '../context/ThemeTransitionContext';
import PlanSuccessOverlay from '../components/PlanSuccessOverlay';
import TimeGrid from '../components/TimeGrid';
import CalendarSheet from '../components/CalendarSheet';
import { MEAL_PERIODS, parseTimeToMinutes } from '../constants/mealPeriods';
import { SPARKLES } from '../lib/sparkleUtils';
import { isOpenAt } from '../lib/restaurantHours';

const Colors = StaticColors;

/** Format a Date to YYYY-MM-DD in local time (avoids UTC shift from toISOString) */
function localDateStr(d: Date): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// Enable LayoutAnimation on Android
if (Platform.OS === 'android') {
  UIManager.setLayoutAnimationEnabledExperimental?.(true);
}

const RSVP_OPTIONS = [
  { label: '1h before', hoursBefore: 1 },
  { label: '3h before', hoursBefore: 3 },
  { label: '12h before', hoursBefore: 12 },
  { label: '1 day before', hoursBefore: 24 },
  { label: '2 days before', hoursBefore: 48 },
  { label: '3 days before', hoursBefore: 72 },
];

/**
 * Reconstruct the saved RSVP-deadline selection (hours-before-event) from a plan.
 * Plans persist an absolute `rsvpDeadline` ISO string, not the relative choice, so
 * edit mode has to derive it back and snap to the nearest available RSVP option.
 * Falls back to 24h if the plan lacks the data needed to reconstruct it.
 */
function deriveRsvpHoursBefore(plan: DiningPlan | undefined): number {
  if (!plan?.date || !plan.time || !plan.rsvpDeadline) return 24;
  const [year, month, day] = plan.date.split('-').map(Number);
  const timeMatch = plan.time.match(/^(\d+):(\d+)\s*(AM|PM)$/i);
  if (!timeMatch) return 24;
  let h = parseInt(timeMatch[1], 10);
  const m = parseInt(timeMatch[2], 10);
  const isPM = timeMatch[3].toUpperCase() === 'PM';
  if (isPM && h !== 12) h += 12;
  if (!isPM && h === 12) h = 0;
  const eventMs = new Date(year, month - 1, day, h, m).getTime();
  const hours = (eventMs - new Date(plan.rsvpDeadline).getTime()) / 3600000;
  return RSVP_OPTIONS.reduce(
    (best, opt) => (Math.abs(opt.hoursBefore - hours) < Math.abs(best - hours) ? opt.hoursBefore : best),
    RSVP_OPTIONS[0].hoursBefore,
  );
}

const CUISINE_EMOJIS: Record<string, string> = {
  Italian: '\u{1F35D}',
  Mexican: '\u{1F32E}',
  Japanese: '\u{1F363}',
  Chinese: '\u{1F961}',
  Indian: '\u{1F35B}',
  Thai: '\u{1F35C}',
  American: '\u{1F354}',
  Mediterranean: '\u{1F957}',
  Korean: '\u{1F371}',
  Vietnamese: '\u{1F372}',
  French: '\u{1F950}',
  Ethiopian: '\u{1FAD3}',
};

export default function PlanEventScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const Colors = useColors();
  const { addPlan, plans } = useApp();
  const queryClient = useQueryClient();
  const { isAuthenticated } = useAuth();
  const { restaurantId, planId, preselectFriendId } =
    useLocalSearchParams<{ restaurantId?: string; planId?: string; preselectFriendId?: string }>();

  const existingPlan = planId ? plans.find(p => p.id === planId) : undefined;

  const pinnedRestaurant = restaurantId
    ? (getRegisteredRestaurant(restaurantId) ?? restaurants.find(r => r.id === restaurantId))
    : undefined;

  const submittingRef = useRef(false);

  const didPreselectRef = useRef(false);

  // #284: set when the user chooses "Schedule anyway" past the closed-hours warning,
  // so the re-entered submit skips the warning. Consumed once per submit.
  const bypassHoursWarningRef = useRef(false);

  const [title, setTitle] = useState<string>(existingPlan?.title ?? '');
  const [selectedDate, setSelectedDate] = useState<string>(
    existingPlan?.date ?? localDateStr(new Date())
  );
  const [allowCurveball, setAllowCurveball] = useState(false);
  const [selectedTime, setSelectedTime] = useState<string | null>(existingPlan?.time ?? null);
  const [selectedCuisines, setSelectedCuisines] = useState<string[]>(
    existingPlan?.cuisine && existingPlan.cuisine !== 'Any' ? existingPlan.cuisine.split(', ') : []
  );
  const [selectedBudget, setSelectedBudget] = useState<string>(existingPlan?.budget ?? '$$');
  const [selectedFriendIds, setSelectedFriendIds] = useState<string[]>(
    existingPlan?.invites?.map(i => i.userId) ?? []
  );
  const [rsvpHoursBefore, setRsvpHoursBefore] = useState<number>(() => deriveRsvpHoursBefore(existingPlan));
  const [restaurantCount, setRestaurantCount] = useState<number>(existingPlan?.restaurantCount ?? 10);
  const [selectedVisibility, setSelectedVisibility] = useState<VisibilityValue>(
    existingPlan?.visibility ?? 'private'
  );
  // Edit mode hydrates rsvpHoursBefore from the saved plan; skip the first smart-default
  // pass so it doesn't immediately overwrite the user's previously-chosen deadline.
  const skipSmartRsvpRef = useRef(!!existingPlan);
  const [loading, setLoading] = useState(false);
  const [calendarVisible, setCalendarVisible] = useState(false);
  const [isExtraSpiceExpanded, setIsExtraSpiceExpanded] = useState(false);
  const [successOverlayVisible, setSuccessOverlayVisible] = useState(false);
  const [successVariant, setSuccessVariant] = useState<'voting' | 'pinned'>('voting');
  const pendingPlanIdRef = useRef<string | null>(null);
  const isEditMode = !!existingPlan;

  const { requestChomp } = useThemeTransition();

  // Parse event date+time into a Date object (must be above useNearbyRestaurants)
  const eventDateTime = useMemo(() => {
    if (!selectedDate || !selectedTime) return null;
    const [year, month, day] = selectedDate.split('-').map(Number);
    const timeMatch = selectedTime.match(/^(\d+):(\d+)\s*(AM|PM)$/i);
    if (!timeMatch) return null;
    let h = parseInt(timeMatch[1], 10);
    const m = parseInt(timeMatch[2], 10);
    const isPM = timeMatch[3].toUpperCase() === 'PM';
    if (isPM && h !== 12) h += 12;
    if (!isPM && h === 12) h = 0;
    return new Date(year, month - 1, day, h, m);
  }, [selectedDate, selectedTime]);

  // Pre-fetch restaurants with owner's location + selected filters so they're
  // baked into the plan at creation time (all participants see the same deck).
  const planCuisine = selectedCuisines.length > 0 ? selectedCuisines.join(', ') : undefined;
  const { data: ownerRestaurants = [] } = useNearbyRestaurants(
    restaurantCount,
    planCuisine,
    selectedBudget,
    { planEventDateTime: eventDateTime },
  );

  // ── Feature 2: Form Progress ──
  const formProgress = useMemo(() => {
    const filled: boolean[] = [
      title.trim().length > 0,
      selectedDate !== null,
      selectedTime !== null,
      selectedCuisines.length > 0,
      selectedBudget !== null, // always has default, so always filled
      selectedFriendIds.length > 0,
    ];
    return filled;
  }, [title, selectedDate, selectedTime, selectedCuisines, selectedBudget, selectedFriendIds]);

  const filledCount = useMemo(() => formProgress.filter(Boolean).length, [formProgress]);

  // Progress dot animations (Feature 2)
  const dotScales = useRef(formProgress.map(() => new Animated.Value(1))).current;
  const prevProgressRef = useRef(formProgress.map(() => false));

  useEffect(() => {
    formProgress.forEach((filled, i) => {
      if (filled && !prevProgressRef.current[i]) {
        Animated.spring(dotScales[i], {
          toValue: 1.4,
          tension: 300,
          friction: 8,
          useNativeDriver: true,
        }).start(() => {
          Animated.spring(dotScales[i], {
            toValue: 1,
            tension: 200,
            friction: 10,
            useNativeDriver: true,
          }).start();
        });
      }
      prevProgressRef.current[i] = filled;
    });
  }, [formProgress, dotScales]);

  // ── Feature 3: Create Button Charge-Up ──
  const buttonGlowAnim = useRef(new Animated.Value(0)).current;
  const buttonPulseAnim = useRef(new Animated.Value(1)).current;
  const pulseAnimRef = useRef<ReturnType<typeof Animated.timing> | null>(null);
  const [showSparkles, setShowSparkles] = useState(false);
  const sparkleAnims = useRef(
    SPARKLES.slice(0, 6).map(() => ({
      scale: new Animated.Value(0),
      opacity: new Animated.Value(0),
    }))
  ).current;

  // Update glow based on form progress
  useEffect(() => {
    const targetGlow = filledCount / 6;
    Animated.timing(buttonGlowAnim, {
      toValue: targetGlow,
      duration: 400,
      useNativeDriver: false,
    }).start();
  }, [filledCount, buttonGlowAnim]);

  // Breathing pulse when all fields filled
  useEffect(() => {
    if (filledCount === 6) {
      const pulse = Animated.loop(
        Animated.sequence([
          Animated.timing(buttonPulseAnim, {
            toValue: 1.03,
            duration: 750,
            useNativeDriver: true,
          }),
          Animated.timing(buttonPulseAnim, {
            toValue: 1,
            duration: 750,
            useNativeDriver: true,
          }),
        ])
      );
      pulseAnimRef.current = pulse;
      pulse.start();
    } else {
      pulseAnimRef.current?.stop();
      buttonPulseAnim.setValue(1);
    }
    return () => {
      pulseAnimRef.current?.stop();
    };
  }, [filledCount, buttonPulseAnim]);

  const triggerSparkles = useCallback(() => {
    setShowSparkles(true);
    sparkleAnims.forEach((anim, i) => {
      anim.scale.setValue(0);
      anim.opacity.setValue(1);
      Animated.sequence([
        Animated.delay(i * 50),
        Animated.parallel([
          Animated.spring(anim.scale, {
            toValue: 1,
            tension: 200,
            friction: 6,
            useNativeDriver: true,
          }),
          Animated.timing(anim.opacity, {
            toValue: 0,
            duration: 600,
            delay: 200,
            useNativeDriver: true,
          }),
        ]),
      ]).start();
    });
    setTimeout(() => setShowSparkles(false), 1000);
  }, [sparkleAnims]);

  // ── Feature 4: Extra Spice Collapsible ──
  const chiliRotateAnim = useRef(new Animated.Value(0)).current;

  const toggleExtraSpice = useCallback(() => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setIsExtraSpiceExpanded(prev => {
      const newVal = !prev;
      Animated.spring(chiliRotateAnim, {
        toValue: newVal ? 1 : 0,
        tension: 200,
        friction: 12,
        useNativeDriver: true,
      }).start();
      return newVal;
    });
  }, [chiliRotateAnim]);

  const chiliRotation = chiliRotateAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '180deg'],
  });

  // ── Feature 5: Curveball Dice Animation ──
  const diceRotateAnim = useRef(new Animated.Value(0)).current;
  const diceSparkleAnims = useRef(
    [0, 1, 2, 3].map(() => ({
      scale: new Animated.Value(0),
      opacity: new Animated.Value(0),
    }))
  ).current;

  const handleCurveballToggle = useCallback((v: boolean) => {
    Haptics.selectionAsync();
    setAllowCurveball(v);
    if (v) {
      diceRotateAnim.setValue(0);
      Animated.timing(diceRotateAnim, {
        toValue: 1,
        duration: 600,
        useNativeDriver: true,
      }).start();
      // Sparkle burst on dice
      diceSparkleAnims.forEach((anim, i) => {
        anim.scale.setValue(0);
        anim.opacity.setValue(1);
        Animated.sequence([
          Animated.delay(i * 80),
          Animated.parallel([
            Animated.spring(anim.scale, {
              toValue: 1,
              tension: 250,
              friction: 6,
              useNativeDriver: true,
            }),
            Animated.timing(anim.opacity, {
              toValue: 0,
              duration: 500,
              delay: 150,
              useNativeDriver: true,
            }),
          ]),
        ]).start();
      });
    } else {
      diceRotateAnim.setValue(0);
    }
  }, [diceRotateAnim, diceSparkleAnims]);

  const diceRotation = diceRotateAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '720deg'],
  });

  // ── Feature 6: Cuisine Chip Animations ──
  const cuisineChipScales = useRef<Record<string, Animated.Value>>({}).current;
  const getCuisineScale = useCallback((cuisine: string) => {
    if (!cuisineChipScales[cuisine]) {
      cuisineChipScales[cuisine] = new Animated.Value(1);
    }
    return cuisineChipScales[cuisine];
  }, [cuisineChipScales]);

  // RSVP shake animation for invalid taps
  const rsvpShakeAnim = useRef(new Animated.Value(0)).current;

  const handleInvalidRsvpTap = useCallback(() => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    Animated.sequence([
      Animated.timing(rsvpShakeAnim, { toValue: -3, duration: 75, useNativeDriver: true }),
      Animated.timing(rsvpShakeAnim, { toValue: 3, duration: 75, useNativeDriver: true }),
      Animated.timing(rsvpShakeAnim, { toValue: -3, duration: 75, useNativeDriver: true }),
      Animated.timing(rsvpShakeAnim, { toValue: 0, duration: 75, useNativeDriver: true }),
    ]).start();
  }, [rsvpShakeAnim]);

  // Computed date strings
  const todayStr = localDateStr(new Date());
  const tomorrowStr = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return localDateStr(d);
  }, []);

  // Hide "Today" chip when all time slots have passed (e.g. after 9pm with 2h buffer)
  const todayAvailable = useMemo(() => {
    const now = new Date();
    const currentMinutes = now.getHours() * 60 + now.getMinutes();
    const allPeriodTimes = MEAL_PERIODS.flatMap(p => p.times);
    return allPeriodTimes.some(t => parseTimeToMinutes(t) > currentMinutes + 120);
  }, []);

  const isCustomDate = selectedDate !== todayStr && selectedDate !== tomorrowStr;

  const formattedCustomDate = useMemo(() => {
    if (!isCustomDate) return '';
    const d = new Date(selectedDate + 'T00:00:00');
    return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  }, [selectedDate, isCustomDate]);

  // Compute valid RSVP options
  const validRsvpOptions = useMemo(() => {
    const now = new Date();
    const oneHourFromNow = new Date(now.getTime() + 3600000);
    return RSVP_OPTIONS.map(opt => {
      if (!eventDateTime) return { ...opt, valid: true };
      const deadline = new Date(eventDateTime.getTime() - opt.hoursBefore * 3600000);
      return { ...opt, valid: deadline > oneHourFromNow };
    });
  }, [eventDateTime]);

  // Computed deadline string for preview
  const computedDeadlineStr = useMemo(() => {
    if (!eventDateTime) return '';
    const deadline = new Date(eventDateTime.getTime() - rsvpHoursBefore * 3600000);
    return deadline.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) +
      ' at ' + deadline.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  }, [eventDateTime, rsvpHoursBefore]);

  // Auto-select RSVP when date/time changes
  useEffect(() => {
    const currentValid = validRsvpOptions.find(o => o.hoursBefore === rsvpHoursBefore);
    if (currentValid && !currentValid.valid) {
      const largestValid = [...validRsvpOptions].reverse().find(o => o.valid);
      if (largestValid) {
        setRsvpHoursBefore(largestValid.hoursBefore);
      }
    }
  }, [validRsvpOptions, rsvpHoursBefore]);

  // Smart RSVP defaults when date or time changes
  useEffect(() => {
    if (!eventDateTime) return;
    // In edit mode, preserve the deadline hydrated from the saved plan on first run.
    if (skipSmartRsvpRef.current) {
      skipSmartRsvpRef.current = false;
      return;
    }
    const now = new Date();
    const hoursUntilEvent = (eventDateTime.getTime() - now.getTime()) / 3600000;
    // Pick the largest RSVP option that's still valid (deadline > 1h from now)
    const candidates = [...RSVP_OPTIONS].reverse();
    const oneHourFromNow = new Date(now.getTime() + 3600000);
    let picked = candidates[candidates.length - 1].hoursBefore; // fallback: smallest option
    for (const opt of candidates) {
      const deadline = new Date(eventDateTime.getTime() - opt.hoursBefore * 3600000);
      if (deadline > oneHourFromNow) {
        picked = opt.hoursBefore;
        break;
      }
    }
    // For events far out, prefer reasonable defaults instead of always picking the largest
    if (hoursUntilEvent > 120) picked = Math.min(picked, 72);      // 5+ days: cap at 3 days before
    else if (hoursUntilEvent > 48) picked = Math.min(picked, 48);   // 2-5 days: cap at 2 days before
    else if (hoursUntilEvent > 24) picked = Math.min(picked, 24);   // 1-2 days: cap at 1 day before
    setRsvpHoursBefore(picked);
  }, [eventDateTime]);

  // Auto-migrate to tomorrow when all today's times passed
  useEffect(() => {
    const todayDateStr = localDateStr(new Date());
    if (selectedDate !== todayDateStr) return;
    const now = new Date();
    const currentMinutes = now.getHours() * 60 + now.getMinutes();
    const allPeriodTimes = MEAL_PERIODS.flatMap(p => p.times);
    const allPassed = allPeriodTimes.every(t => parseTimeToMinutes(t) <= currentMinutes + 120);
    if (allPassed) {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      setSelectedDate(localDateStr(tomorrow));
    }
  }, [selectedDate]);

  const { data: friends = [] } = useQuery({
    queryKey: ['friends'],
    queryFn: getFriends,
    enabled: isAuthenticated,
    staleTime: 0,
  });

  useEffect(() => {
    if (!preselectFriendId) return;
    if (didPreselectRef.current) return;
    if (friends.length === 0) return; // cache not yet populated — effect re-fires when friends updates
    const match = friends.find(f => f.id === preselectFriendId);
    if (!match) return; // invalid id — no-op per PRD edge-case table
    setSelectedFriendIds(prev =>
      prev.includes(preselectFriendId) ? prev : [...prev, preselectFriendId]
    );
    didPreselectRef.current = true;
  }, [preselectFriendId, friends]);

  const toggleCuisine = useCallback((cuisine: string) => {
    Haptics.selectionAsync();
    const isSelected = selectedCuisines.includes(cuisine);
    if (!isSelected) {
      // Bounce animation on selection (Feature 6)
      const scale = getCuisineScale(cuisine);
      Animated.sequence([
        Animated.spring(scale, {
          toValue: 1.1,
          tension: 300,
          friction: 10,
          useNativeDriver: true,
        }),
        Animated.spring(scale, {
          toValue: 1,
          tension: 200,
          friction: 10,
          useNativeDriver: true,
        }),
      ]).start();
    }
    setSelectedCuisines(prev =>
      prev.includes(cuisine) ? prev.filter(c => c !== cuisine) : [...prev, cuisine]
    );
  }, [selectedCuisines, getCuisineScale]);

  const toggleFriend = useCallback((id: string) => {
    Haptics.selectionAsync();
    setSelectedFriendIds(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  }, []);

  const handleCreate = useCallback(async () => {
    if (submittingRef.current) return;
    if (!title.trim()) {
      Alert.alert('Missing title', 'Give your dining plan a name');
      return;
    }

    if (!isEditMode && selectedFriendIds.length === 0) {
      Alert.alert('Invite a friend', 'Plans need at least one other person');
      return;
    }

    if (!isEditMode && eventDateTime) {
      const rsvpDeadline = new Date(eventDateTime.getTime() - rsvpHoursBefore * 3600000);
      if (rsvpDeadline <= new Date()) {
        Alert.alert('RSVP deadline passed', 'Move the event later or pick a shorter RSVP window');
        return;
      }
    }

    // #284: for pinned-restaurant plans, validate the chosen time against the
    // restaurant's hours. Permanently-closed is a hard block; otherwise warn + allow
    // (Google hours data is occasionally wrong). Voting plans have no single venue.
    if (pinnedRestaurant && eventDateTime) {
      const bypass = bypassHoursWarningRef.current;
      bypassHoursWarningRef.current = false;
      const periods = pinnedRestaurant.openingPeriods;
      if (periods && periods.length === 0) {
        Alert.alert(
          `${pinnedRestaurant.name} is permanently closed`,
          'Google lists this spot as permanently closed. Pick a different restaurant for this plan.',
        );
        return;
      }
      if (!bypass && !isOpenAt(periods, eventDateTime)) {
        Alert.alert(
          `${pinnedRestaurant.name} may be closed then`,
          'The time you picked is outside this restaurant’s listed hours. Schedule it anyway?',
          [
            { text: 'Pick another time', style: 'cancel' },
            {
              text: 'Schedule anyway',
              onPress: () => {
                bypassHoursWarningRef.current = true;
                handleCreate();
              },
            },
          ],
        );
        return;
      }
    }

    // Trigger sparkle burst on press (Feature 3)
    triggerSparkles();

    submittingRef.current = true;
    setLoading(true);

    try {
      const effectiveCuisine = pinnedRestaurant
        ? pinnedRestaurant.cuisine
        : selectedCuisines.length > 0 ? selectedCuisines.join(', ') : 'Any';
      const effectiveBudget = pinnedRestaurant ? '$'.repeat(pinnedRestaurant.priceLevel) : selectedBudget;

      const suggestedOptions = pinnedRestaurant
        ? [pinnedRestaurant]
        : ownerRestaurants.slice(0, restaurantCount);

      const rsvpDeadline = eventDateTime
        ? new Date(eventDateTime.getTime() - rsvpHoursBefore * 3600000).toISOString()
        : new Date(Date.now() + rsvpHoursBefore * 3600000).toISOString();

      let resultPlanId: string;
      if (isAuthenticated) {
        const restaurantPayload = pinnedRestaurant ? {
          id: pinnedRestaurant.id,
          name: pinnedRestaurant.name,
          imageUrl: pinnedRestaurant.imageUrl,
          address: pinnedRestaurant.address,
          cuisine: pinnedRestaurant.cuisine,
          priceLevel: pinnedRestaurant.priceLevel,
          rating: pinnedRestaurant.rating,
        } : undefined;
        const payload = {
          title: title.trim(),
          date: selectedDate,
          time: selectedTime ?? undefined,
          cuisine: effectiveCuisine,
          budget: effectiveBudget,
          restaurant: restaurantPayload,
          inviteeIds: selectedFriendIds,
          rsvpDeadline,
          options: suggestedOptions.map(r => r.id),
          restaurantOptions: suggestedOptions,
          restaurantCount,
          allowCurveball,
          visibility: selectedVisibility,
        };
        let plan: DiningPlan;
        if (isEditMode && existingPlan) {
          plan = await updatePlan(existingPlan.id, payload);
        } else {
          plan = await createPlan(payload);
        }
        const localPlan: DiningPlan = {
          ...plan,
          invitees: [],
          options: suggestedOptions,
        };
        if (!isEditMode) {
          addPlan(localPlan);
        }
        resultPlanId = plan.id;
      } else {
        const newPlan: DiningPlan = {
          id: `p${Date.now()}`,
          title: title.trim(),
          date: selectedDate,
          time: selectedTime ?? undefined,
          status: pinnedRestaurant ? 'confirmed' : 'voting',
          restaurant: pinnedRestaurant ?? undefined,
          cuisine: effectiveCuisine,
          budget: effectiveBudget,
          invitees: [],
          invites: [],
          rsvpDeadline,
          options: suggestedOptions,
          votes: {},
          createdAt: localDateStr(new Date()),
          visibility: selectedVisibility,
        };
        addPlan(newPlan);
        resultPlanId = newPlan.id;
      }

      if (isEditMode) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        queryClient.invalidateQueries({ queryKey: ['plans'] });
        router.back();
      } else {
        // Show branded overlay — haptics come from chomp animation
        pendingPlanIdRef.current = resultPlanId;
        setSuccessVariant(pinnedRestaurant ? 'pinned' : 'voting');
        setSuccessOverlayVisible(true);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to create plan';
      Alert.alert('Error', msg);
    } finally {
      submittingRef.current = false;
      setLoading(false);
    }
  }, [title, selectedDate, selectedTime, selectedCuisines, selectedBudget, selectedFriendIds, rsvpHoursBefore, restaurantCount, isAuthenticated, isEditMode, existingPlan, addPlan, router, allowCurveball, pinnedRestaurant, eventDateTime, triggerSparkles, queryClient, ownerRestaurants, selectedVisibility]);

  // ── Feast Finale: overlay → chomp → navigate ──
  const handleFeastConfirm = useCallback(() => {
    setSuccessOverlayVisible(false);
    const planId = pendingPlanIdRef.current;

    requestChomp(buildPlanSuccessChompConfig(Colors.primary), () => {
      if (successVariant === 'pinned' && planId) {
        router.replace(`/group-session?planId=${planId}&autoStart=true` as never);
      } else {
        router.back();
      }
    });
  }, [Colors.primary, successVariant, requestChomp, router]);

  // ── Glow color interpolation (Feature 3) ──
  const glowOpacity = buttonGlowAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 0.6],
  });

  // Dice sparkle positions around the dice emoji
  const diceSparklePositions = [
    { top: -6, left: -6 },
    { top: -6, right: -6 },
    { bottom: -6, left: -6 },
    { bottom: -6, right: -6 },
  ];

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={[styles.container, { paddingTop: insets.top, backgroundColor: Colors.background }]}>
        <View style={styles.header}>
          <View style={[styles.headerHandle, { backgroundColor: Colors.border }]} />
          <View style={styles.headerRow}>
            <AppText variant="display" numberOfLines={1} ellipsizeMode="tail" style={[styles.headerTitle, { color: Colors.text }]}>
              {isEditMode ? 'Tweak the Recipe' : 'Cook Up a Plan'}
            </AppText>
            <Pressable
              style={[styles.closeBtn, { backgroundColor: Colors.card, borderColor: Colors.border }]}
              onPress={() => router.back()}
              accessibilityLabel="Close"
              accessibilityRole="button"
            >
              <X size={20} color={Colors.text} />
            </Pressable>
          </View>

          {/* Feature 2: Progress Dots */}
          <View style={styles.progressDots}>
            {formProgress.map((filled, i) => (
              <Animated.View
                key={i}
                style={[
                  styles.progressDot,
                  {
                    backgroundColor: filled ? Colors.primary : Colors.border,
                    transform: [{ scale: dotScales[i] }],
                  },
                ]}
              />
            ))}
          </View>
        </View>

        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          {/* Plan Name */}
          <View style={styles.inputGroup}>
            <AppText variant="dense" style={[styles.label, { color: Colors.text }]}>Plan Name</AppText>
            <TextInput
              style={[styles.input, { backgroundColor: Colors.card, borderColor: Colors.border, color: Colors.text }]}
              placeholder="e.g. Friday Night Dinner"
              placeholderTextColor={Colors.textTertiary}
              value={title}
              onChangeText={setTitle}
              testID="plan-title-input"
            />
          </View>

          {/* Date section */}
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <CalendarDays size={18} color={Colors.primary} />
              <AppText variant="dense" style={[styles.sectionTitle, { color: Colors.text }]}>Date</AppText>
            </View>
            <View style={[styles.chipRow, { flexWrap: 'wrap' }]}>
              {/* Today chip — hidden when all time slots have passed */}
              {todayAvailable && (
                <Pressable
                  style={[
                    styles.dateChip,
                    { backgroundColor: Colors.card, borderColor: Colors.border },
                    selectedDate === todayStr && [
                      styles.chipActive,
                      { backgroundColor: Colors.primary, borderColor: Colors.primary },
                    ],
                  ]}
                  onPress={() => {
                    Haptics.selectionAsync();
                    setSelectedDate(todayStr);
                  }}
                >
                  <AppText
                    variant="dense"
                    numberOfLines={1}
                    style={[
                      styles.dateChipText,
                      { color: Colors.text },
                      selectedDate === todayStr && styles.chipTextActive,
                    ]}
                  >
                    Today
                  </AppText>
                </Pressable>
              )}

              {/* Tomorrow chip */}
              <Pressable
                style={[
                  styles.dateChip,
                  { backgroundColor: Colors.card, borderColor: Colors.border },
                  selectedDate === tomorrowStr && [
                    styles.chipActive,
                    { backgroundColor: Colors.primary, borderColor: Colors.primary },
                  ],
                ]}
                onPress={() => {
                  Haptics.selectionAsync();
                  setSelectedDate(tomorrowStr);
                }}
              >
                <AppText
                  variant="dense"
                  numberOfLines={1}
                  style={[
                    styles.dateChipText,
                    { color: Colors.text },
                    selectedDate === tomorrowStr && styles.chipTextActive,
                  ]}
                >
                  Tomorrow
                </AppText>
              </Pressable>

              {/* Pick Date / Selected Date chip */}
              <Pressable
                style={[
                  styles.dateChip,
                  { backgroundColor: Colors.card, borderColor: Colors.border },
                  isCustomDate && [
                    styles.chipActive,
                    { backgroundColor: Colors.primary, borderColor: Colors.primary },
                  ],
                  !isCustomDate && { borderStyle: 'dashed' as const },
                ]}
                onPress={() => {
                  Haptics.selectionAsync();
                  setCalendarVisible(true);
                }}
              >
                {isCustomDate ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                    <Check size={14} color="#FFF" />
                    <AppText variant="dense" numberOfLines={1} style={[styles.dateChipText, styles.chipTextActive]}>
                      {formattedCustomDate}
                    </AppText>
                  </View>
                ) : (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                    <CalendarDays size={14} color={Colors.textTertiary} />
                    <AppText variant="dense" numberOfLines={1} style={[styles.dateChipText, { color: Colors.textTertiary }]}>
                      Pick Date...
                    </AppText>
                  </View>
                )}
              </Pressable>
            </View>
          </View>

          {/* Time section */}
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Clock size={18} color={Colors.primary} />
              <AppText variant="dense" style={[styles.sectionTitle, { color: Colors.text }]}>Time</AppText>
            </View>
            <TimeGrid
              selectedTime={selectedTime}
              onSelectTime={setSelectedTime}
              selectedDate={selectedDate}
            />
          </View>

          {pinnedRestaurant ? (
            <View style={[styles.pinnedCard, { backgroundColor: Colors.card, borderColor: Colors.primary }]}>
              <Image source={{ uri: pinnedRestaurant.imageUrl }} style={styles.pinnedImage} contentFit="cover" />
              <View style={styles.pinnedInfo}>
                <AppText variant="dense" numberOfLines={1} style={[styles.pinnedLabel, { color: Colors.primary }]}>Restaurant</AppText>
                <AppText variant="display" numberOfLines={1} ellipsizeMode="tail" style={[styles.pinnedName, { color: Colors.text }]}>{pinnedRestaurant.name}</AppText>
                <AppText variant="dense" numberOfLines={1} ellipsizeMode="tail" style={[styles.pinnedMeta, { color: Colors.textSecondary }]}>
                  {pinnedRestaurant.cuisine} · {'$'.repeat(pinnedRestaurant.priceLevel)} · {pinnedRestaurant.distance}
                </AppText>
              </View>
            </View>
          ) : (
            <>
              {/* Cuisine section (Feature 1 + 6) */}
              <View style={styles.inputGroup}>
                <View style={styles.labelRow}>
                  <UtensilsCrossed size={16} color={Colors.primary} />
                  <AppText variant="dense" style={[styles.label, { color: Colors.text }]}>What sounds good?</AppText>
                </View>
                <View style={styles.wrapRow}>
                  <Pressable
                    style={[styles.cuisineChip, { backgroundColor: Colors.card, borderColor: Colors.border }, selectedCuisines.length === 0 && [styles.chipActive, { backgroundColor: Colors.primary, borderColor: Colors.primary }]]}
                    onPress={() => { Haptics.selectionAsync(); setSelectedCuisines([]); }}
                    testID="cuisine-chip-any"
                  >
                    <AppText variant="dense" numberOfLines={1} style={[styles.cuisineChipText, { color: Colors.text }, selectedCuisines.length === 0 && styles.chipTextActive]}>Any</AppText>
                  </Pressable>
                  {CUISINES.slice(0, 8).map(c => {
                    const isSelected = selectedCuisines.includes(c);
                    const chipScale = getCuisineScale(c);
                    return (
                      <Animated.View key={c} style={{ transform: [{ scale: chipScale }] }}>
                        <Pressable
                          style={[
                            styles.cuisineChip,
                            { backgroundColor: Colors.card, borderColor: Colors.border },
                            isSelected && [styles.chipActive, { backgroundColor: Colors.primary, borderColor: Colors.primary }],
                          ]}
                          onPress={() => toggleCuisine(c)}
                          testID={`cuisine-chip-${c.toLowerCase()}`}
                        >
                          <AppText variant="dense" numberOfLines={1} style={[styles.cuisineChipText, { color: Colors.text }, isSelected && styles.chipTextActive]}>
                            {CUISINE_EMOJIS[c] || '\u{1F37D}\u{FE0F}'} {c}
                          </AppText>
                        </Pressable>
                      </Animated.View>
                    );
                  })}
                </View>
              </View>

              {/* Budget section (Feature 3: BudgetSegmentedControl) */}
              <View style={styles.inputGroup}>
                <View style={styles.labelRow}>
                  <DollarSign size={16} color={Colors.primary} />
                  <AppText variant="dense" style={[styles.label, { color: Colors.text }]}>How fancy?</AppText>
                </View>
                <BudgetSegmentedControl
                  options={BUDGET_OPTIONS}
                  selected={selectedBudget}
                  onSelect={setSelectedBudget}
                />
              </View>

              {/* Feature 4: Extra Spice Collapsible Section */}
              <View style={[styles.extraSpiceSection, { backgroundColor: Colors.primaryLight, borderColor: Colors.border }]}>
                <Pressable
                  style={styles.extraSpiceHeader}
                  onPress={toggleExtraSpice}
                  accessibilityRole="button"
                  accessibilityLabel="Toggle Extra Spice options"
                >
                  <View style={styles.extraSpiceHeaderLeft}>
                    <Flame size={18} color={Colors.primary} />
                    <AppText variant="dense" style={[styles.extraSpiceTitle, { color: Colors.text }]}>Extra Spice</AppText>
                  </View>
                  <Animated.View style={{ transform: [{ rotate: chiliRotation }] }}>
                    <ChevronDown size={20} color={Colors.textSecondary} />
                  </Animated.View>
                </Pressable>

                {isExtraSpiceExpanded && (
                  <View style={styles.extraSpiceContent}>
                    {/* Curveball toggle (Feature 5) */}
                    <View style={styles.inputGroup}>
                      <View style={[styles.labelRow, { justifyContent: 'space-between' }]}>
                        <View style={styles.labelRow}>
                          <Sparkles size={16} color={Colors.secondary} />
                          <AppText variant="dense" style={[styles.label, { color: Colors.text }]}>
                            Allow Curveball Deals{' '}
                          </AppText>
                          <View style={{ position: 'relative' }}>
                            <Animated.View style={{ transform: [{ rotate: diceRotation }] }}>
                              <AppText variant="dense" style={{ fontSize: 16 }}>{'\u{1F3B2}'}</AppText>
                            </Animated.View>
                            {/* Dice sparkle dots (Feature 5) */}
                            {diceSparkleAnims.map((anim, i) => (
                              <Animated.View
                                key={i}
                                style={[
                                  styles.diceSparkle,
                                  diceSparklePositions[i],
                                  {
                                    transform: [{ scale: anim.scale }],
                                    opacity: anim.opacity,
                                    backgroundColor: Colors.secondary,
                                  },
                                ]}
                              />
                            ))}
                          </View>
                        </View>
                        <Switch
                          value={allowCurveball}
                          onValueChange={handleCurveballToggle}
                          trackColor={{ false: StaticColors.border, true: Colors.secondary }}
                          thumbColor="#FFF"
                        />
                      </View>
                      <AppText variant="body" style={{ fontSize: 12, color: Colors.textSecondary, marginTop: 4 }}>
                        Include off-cuisine restaurants with active deals
                      </AppText>
                    </View>

                    {/* Restaurant Count Slider (Feature 7) */}
                    <View style={styles.inputGroup}>
                      <RestaurantCountSlider
                        value={restaurantCount}
                        onValueChange={setRestaurantCount}
                        label="How many spots?"
                      />
                    </View>
                  </View>
                )}
              </View>
            </>
          )}

          {/* Friends section (Feature 1) */}
          {friends.length > 0 && (
            <>
              <View style={styles.inputGroup}>
                <View style={styles.labelRow}>
                  <UserCheck size={16} color={Colors.primary} />
                  <AppText variant="dense" style={[styles.label, { color: Colors.text }]}>Who's coming?</AppText>
                </View>
                <FriendAvatarRow
                  friends={friends}
                  selectedIds={selectedFriendIds}
                  onToggle={toggleFriend}
                />
              </View>
            </>
          )}

          {/* Visibility section (REQ-011) */}
          <View style={styles.inputGroup}>
            <View style={styles.labelRow}>
              <Lock size={16} color={Colors.primary} />
              <AppText variant="dense" style={[styles.label, { color: Colors.text }]}>Who can pull up a chair?</AppText>
            </View>
            <VisibilitySegmentedControl
              value={selectedVisibility}
              onSelect={setSelectedVisibility}
            />
          </View>

          {/* RSVP Deadline section */}
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Timer size={18} color={Colors.primary} />
              <AppText variant="dense" style={[styles.sectionTitle, { color: Colors.text }]}>RSVP Deadline</AppText>
            </View>
            <View style={[styles.chipRow, { flexWrap: 'wrap' }]}>
              {validRsvpOptions.map((opt) => (
                <Animated.View
                  key={opt.hoursBefore}
                  style={{ transform: [{ translateX: !opt.valid ? rsvpShakeAnim : 0 }] }}
                >
                  <Pressable
                    style={[
                      styles.dateChip,
                      { backgroundColor: Colors.card, borderColor: Colors.border },
                      rsvpHoursBefore === opt.hoursBefore && opt.valid && [
                        styles.chipActive,
                        { backgroundColor: Colors.primary, borderColor: Colors.primary },
                      ],
                      !opt.valid && { opacity: 0.4 },
                    ]}
                    onPress={() => {
                      if (!opt.valid) {
                        handleInvalidRsvpTap();
                        return;
                      }
                      Haptics.selectionAsync();
                      setRsvpHoursBefore(opt.hoursBefore);
                    }}
                    disabled={false}
                  >
                    <AppText
                      variant="dense"
                      numberOfLines={1}
                      style={[
                        styles.dateChipText,
                        { color: Colors.text },
                        rsvpHoursBefore === opt.hoursBefore && opt.valid && styles.chipTextActive,
                      ]}
                    >
                      {opt.label}
                    </AppText>
                  </Pressable>
                </Animated.View>
              ))}
            </View>
            {computedDeadlineStr ? (
              <AppText variant="dense" style={{ fontSize: 13, color: Colors.textSecondary, marginTop: 8 }}>
                RSVP closes: {computedDeadlineStr}
              </AppText>
            ) : null}
          </View>

          <View style={{ height: 20 }} />
        </ScrollView>

        {/* Bottom bar with create button (Feature 3: Charge-Up) */}
        <View style={[styles.bottomBar, { paddingBottom: insets.bottom + 12, backgroundColor: Colors.card, borderTopColor: Colors.borderLight }]}>
          <View style={styles.createBtnWrapper}>
            {/* Glow layer behind button */}
            <Animated.View
              style={[
                styles.buttonGlow,
                {
                  backgroundColor: Colors.primary,
                  opacity: glowOpacity,
                },
              ]}
            />
            <Animated.View style={{ transform: [{ scale: buttonPulseAnim }], width: '100%' }}>
              <Pressable
                style={[styles.createBtn, { backgroundColor: Colors.primary, shadowColor: Colors.primary }, (!title.trim() || loading || (!isEditMode && selectedFriendIds.length === 0)) && styles.createBtnDisabled]}
                onPress={handleCreate}
                disabled={!title.trim() || loading || (!isEditMode && selectedFriendIds.length === 0)}
                testID="create-plan-btn"
              >
                {loading ? (
                  <ActivityIndicator color="#FFF" />
                ) : (
                  <AppText variant="dense" style={styles.createBtnText}>
                    {isEditMode ? 'Update the Recipe' : 'Cook Up This Plan'}
                  </AppText>
                )}
              </Pressable>
            </Animated.View>

            {/* Sparkle burst on press (Feature 3) */}
            {showSparkles && sparkleAnims.map((anim, i) => {
              const sparkle = SPARKLES[i];
              return (
                <Animated.View
                  key={i}
                  style={[
                    styles.sparkleParticle,
                    {
                      left: `${sparkle.x * 100}%`,
                      top: sparkle.y * 50 - 10,
                      backgroundColor: Colors.secondary,
                      transform: [{ scale: anim.scale }],
                      opacity: anim.opacity,
                    },
                  ]}
                />
              );
            })}
          </View>
        </View>
      </View>

      <CalendarSheet
        visible={calendarVisible}
        onClose={() => setCalendarVisible(false)}
        onSelectDate={(date) => {
          setSelectedDate(date);
          setCalendarVisible(false);
        }}
        selectedDate={selectedDate}
      />

      <PlanSuccessOverlay
        visible={successOverlayVisible}
        variant={successVariant}
        onConfirm={handleFeastConfirm}
      />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  header: {
    paddingHorizontal: 20,
    paddingBottom: 8,
    alignItems: 'center',
  },
  headerHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: Colors.border,
    marginTop: 8,
    marginBottom: 16,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    width: '100%',
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: '800' as const,
    color: Colors.text,
  },
  closeBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: Colors.card,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: Colors.border,
  },
  progressDots: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 12,
    alignSelf: 'center',
  },
  progressDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 20,
  },
  inputGroup: {
    marginBottom: 24,
  },
  section: {
    marginBottom: 24,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 10,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '700' as const,
    color: Colors.text,
  },
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 10,
  },
  label: {
    fontSize: 15,
    fontWeight: '700' as const,
    color: Colors.text,
    marginBottom: 0,
  },
  input: {
    backgroundColor: Colors.card,
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    color: Colors.text,
    borderWidth: 1.5,
    borderColor: Colors.border,
    marginTop: 8,
  },
  chipRow: {
    flexDirection: 'row',
    gap: 8,
  },
  wrapRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  dateChip: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    minHeight: 42,
    borderRadius: 14,
    backgroundColor: Colors.card,
    borderWidth: 1.5,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dateChipText: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: Colors.text,
  },
  cuisineChip: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    minHeight: 42,
    borderRadius: 22,
    backgroundColor: Colors.card,
    borderWidth: 1.5,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cuisineChipText: {
    fontSize: 13,
    fontWeight: '600' as const,
    color: Colors.text,
  },
  cuisineChipGlow: {
    borderRadius: 24,
    borderWidth: 2,
    borderColor: Colors.primary,
    opacity: 0.5,
    padding: 1,
  },
  budgetRow: {
    flexDirection: 'row',
    gap: 10,
  },
  budgetChip: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 14,
    backgroundColor: Colors.card,
    borderWidth: 1.5,
    borderColor: Colors.border,
    alignItems: 'center',
  },
  budgetChipText: {
    fontSize: 15,
    fontWeight: '700' as const,
    color: Colors.text,
  },
  chipActive: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  chipTextActive: {
    color: '#FFF',
  },
  // Extra Spice section (Feature 4)
  extraSpiceSection: {
    marginBottom: 24,
    borderRadius: 16,
    borderWidth: 1,
    overflow: 'hidden',
  },
  extraSpiceHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  extraSpiceHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  extraSpiceTitle: {
    fontSize: 15,
    fontWeight: '700' as const,
  },
  extraSpiceContent: {
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  // Dice sparkle dots (Feature 5)
  diceSparkle: {
    position: 'absolute',
    width: 5,
    height: 5,
    borderRadius: 2.5,
  },
  friendChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 22,
    backgroundColor: Colors.card,
    borderWidth: 1.5,
    borderColor: Colors.border,
  },
  friendChipAvatar: {
    width: 22,
    height: 22,
    borderRadius: 11,
  },
  friendChipText: {
    fontSize: 13,
    fontWeight: '600' as const,
    color: Colors.text,
  },
  pinnedCard: {
    flexDirection: 'row',
    backgroundColor: Colors.card,
    borderRadius: 16,
    overflow: 'hidden',
    marginBottom: 24,
    borderWidth: 1.5,
    borderColor: Colors.primary,
  },
  pinnedImage: {
    width: 90,
    height: 90,
  },
  pinnedInfo: {
    flex: 1,
    padding: 12,
    justifyContent: 'center',
    gap: 2,
  },
  pinnedLabel: {
    fontSize: 11,
    fontWeight: '700' as const,
    color: Colors.primary,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.5,
  },
  pinnedName: {
    fontSize: 16,
    fontWeight: '800' as const,
    color: Colors.text,
  },
  pinnedMeta: {
    fontSize: 13,
    color: Colors.textSecondary,
    marginTop: 2,
  },
  infoCard: {
    flexDirection: 'row',
    backgroundColor: Colors.secondaryLight,
    borderRadius: 16,
    padding: 16,
    gap: 12,
    alignItems: 'flex-start',
  },
  infoCardContent: {
    flex: 1,
  },
  infoCardTitle: {
    fontSize: 14,
    fontWeight: '700' as const,
    color: Colors.text,
    marginBottom: 4,
  },
  infoCardText: {
    fontSize: 13,
    color: Colors.textSecondary,
    lineHeight: 18,
  },
  bottomBar: {
    paddingHorizontal: 20,
    paddingTop: 12,
    backgroundColor: Colors.card,
    borderTopWidth: 1,
    borderTopColor: Colors.borderLight,
  },
  createBtnWrapper: {
    position: 'relative',
    alignItems: 'center',
  },
  buttonGlow: {
    position: 'absolute',
    top: -4,
    left: -4,
    right: -4,
    bottom: -4,
    borderRadius: 32,
  },
  createBtn: {
    backgroundColor: Colors.primary,
    minHeight: 56,
    paddingVertical: 16,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: Colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  createBtnDisabled: {
    opacity: 0.5,
  },
  createBtnText: {
    fontSize: 16,
    fontWeight: '700' as const,
    color: '#FFF',
  },
  sparkleParticle: {
    position: 'absolute',
    width: 6,
    height: 6,
    borderRadius: 3,
  },
});
