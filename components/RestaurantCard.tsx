import React, { useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Animated,
} from 'react-native';
import { Image } from 'expo-image';
import { Star, Clock, MapPin, Flame } from 'lucide-react-native';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { Restaurant } from '../types';
import StaticColors from '../constants/colors';
import { useColors } from '../context/ThemeContext';
import SizzleShimmer from './SizzleShimmer';

const Colors = StaticColors;

interface RestaurantCardProps {
  restaurant: Restaurant;
  variant?: 'horizontal' | 'vertical' | 'compact';
}

export default React.memo(function RestaurantCard({ restaurant, variant = 'vertical' }: RestaurantCardProps) {
  const Colors = useColors();
  const router = useRouter();
  const scaleAnim = useRef(new Animated.Value(1)).current;

  const handlePressIn = useCallback(() => {
    Animated.spring(scaleAnim, {
      toValue: 0.96,
      useNativeDriver: true,
    }).start();
  }, [scaleAnim]);

  const handlePressOut = useCallback(() => {
    Animated.spring(scaleAnim, {
      toValue: 1,
      friction: 3,
      useNativeDriver: true,
    }).start();
  }, [scaleAnim]);

  const handlePress = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push(`/restaurant/${restaurant.id}` as never);
  }, [router, restaurant.id]);

  const priceString = '$'.repeat(restaurant.priceLevel);
  const a11yLabel = `${restaurant.name}, ${restaurant.cuisine}, ${priceString}, ${restaurant.distance}`;

  if (variant === 'compact') {
    return (
      <View
        testID={`restaurant-card-compact-${restaurant.id}`}
        accessibilityLabel={a11yLabel}
        accessibilityRole="button"
      >
        <Pressable
          onPress={handlePress}
          onPressIn={handlePressIn}
          onPressOut={handlePressOut}
        >
          <SizzleShimmer>
          <Animated.View style={[styles.compactCard, { backgroundColor: Colors.card, transform: [{ scale: scaleAnim }] }]}>
            <Image source={{ uri: restaurant.imageUrl }} style={styles.compactImage} contentFit="cover" />
            <View style={styles.compactInfo}>
              <Text style={[styles.compactName, { color: Colors.text }]} numberOfLines={1}>{restaurant.name}</Text>
              <Text style={[styles.compactCuisine, { color: Colors.textSecondary }]}>{restaurant.cuisine} · {priceString}</Text>
              <View style={styles.ratingRow}>
                <Star size={12} color={Colors.star} fill={Colors.star} />
                <Text style={[styles.ratingText, { color: Colors.text }]}>{restaurant.rating}</Text>
                <Text style={[styles.distanceText, { color: Colors.textTertiary }]}>{restaurant.distance}</Text>
              </View>
            </View>
          </Animated.View>
          </SizzleShimmer>
        </Pressable>
      </View>
    );
  }

  if (variant === 'horizontal') {
    return (
      <View
        testID={`restaurant-card-horizontal-${restaurant.id}`}
        accessibilityLabel={a11yLabel}
        accessibilityRole="button"
      >
        <Pressable
          onPress={handlePress}
          onPressIn={handlePressIn}
          onPressOut={handlePressOut}
        >
          <SizzleShimmer>
          <Animated.View style={[styles.horizontalCard, { backgroundColor: Colors.card, transform: [{ scale: scaleAnim }] }]}>
            <Image source={{ uri: restaurant.imageUrl }} style={styles.horizontalImage} contentFit="cover" />
            {restaurant.lastCallDeal && (
              <View style={[styles.dealBadge, { backgroundColor: Colors.primary }]}>
                <Flame size={10} color="#FFF" />
                <Text style={styles.dealText} numberOfLines={1}>{restaurant.lastCallDeal}</Text>
              </View>
            )}
            <View style={styles.horizontalInfo}>
              <Text style={[styles.horizontalName, { color: Colors.text }]} numberOfLines={1}>{restaurant.name}</Text>
              <Text style={[styles.horizontalCuisine, { color: Colors.textSecondary }]}>{restaurant.cuisine} · {priceString}</Text>
              <View style={styles.ratingRow}>
                <Star size={13} color={Colors.star} fill={Colors.star} />
                <Text style={[styles.ratingText, { color: Colors.text }]}>{restaurant.rating}</Text>
                <View style={styles.dot} />
                <MapPin size={11} color={Colors.textTertiary} />
                <Text style={[styles.distanceText, { color: Colors.textTertiary }]}>{restaurant.distance}</Text>
              </View>
              {restaurant.isOpenNow && (
                <View style={styles.openBadge}>
                  <View style={[styles.openDot, { backgroundColor: Colors.success }]} />
                  <Text style={[styles.openText, { color: Colors.success }]}>Open Now</Text>
                </View>
              )}
            </View>
          </Animated.View>
          </SizzleShimmer>
        </Pressable>
      </View>
    );
  }

  return (
    <View
      testID={`restaurant-card-${restaurant.id}`}
      accessibilityLabel={a11yLabel}
      accessibilityRole="button"
    >
      <Pressable
        onPress={handlePress}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
      >
        <SizzleShimmer>
        <Animated.View style={[styles.verticalCard, { backgroundColor: Colors.card, transform: [{ scale: scaleAnim }] }]}>
          <Image source={{ uri: restaurant.imageUrl }} style={styles.verticalImage} contentFit="cover" />
          {restaurant.lastCallDeal && (
            <View style={[styles.dealBadgeVertical, { backgroundColor: Colors.primary }]}>
              <Flame size={11} color="#FFF" />
              <Text style={styles.dealTextVertical}>{restaurant.lastCallDeal}</Text>
            </View>
          )}
          <View style={styles.verticalInfo}>
            <View style={styles.verticalHeader}>
              <Text style={[styles.verticalName, { color: Colors.text }]} numberOfLines={1}>{restaurant.name}</Text>
              <View style={[styles.ratingBadge, { backgroundColor: Colors.secondaryLight }]}>
                <Star size={12} color={Colors.star} fill={Colors.star} />
                <Text style={[styles.ratingBadgeText, { color: Colors.secondary }]}>{restaurant.rating}</Text>
              </View>
            </View>
            <Text style={[styles.verticalCuisine, { color: Colors.textSecondary }]}>{restaurant.cuisine} · {priceString} · {restaurant.distance}</Text>
            <View style={styles.tagsRow}>
              {restaurant.tags.slice(0, 3).map(tag => (
                <View key={tag} style={[styles.tag, { backgroundColor: Colors.primaryLight }]}>
                  <Text style={[styles.tagText, { color: Colors.primary }]}>{tag}</Text>
                </View>
              ))}
            </View>
            {restaurant.isOpenNow && (
              <View style={styles.bottomRow}>
                <View style={styles.openBadge}>
                  <View style={[styles.openDot, { backgroundColor: Colors.success }]} />
                  <Text style={[styles.openText, { color: Colors.success }]}>Open</Text>
                </View>
                <View style={styles.busyBadge}>
                  <Clock size={11} color={Colors.textTertiary} />
                  <Text style={[styles.busyText, { color: Colors.textTertiary }]}>{restaurant.busyLevel} traffic</Text>
                </View>
              </View>
            )}
          </View>
        </Animated.View>
        </SizzleShimmer>
      </Pressable>
    </View>
  );
});

const styles = StyleSheet.create({
  verticalCard: {
    backgroundColor: Colors.card,
    borderRadius: 16,
    overflow: 'hidden',
    marginBottom: 16,
    shadowColor: Colors.shadowColor,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 3,
  },
  verticalImage: {
    width: '100%',
    height: 180,
  },
  verticalInfo: {
    padding: 14,
  },
  verticalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  verticalName: {
    fontSize: 17,
    fontWeight: '700' as const,
    color: Colors.text,
    flex: 1,
    marginRight: 8,
  },
  ratingBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFF8E7',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    gap: 3,
  },
  ratingBadgeText: {
    fontSize: 13,
    fontWeight: '700' as const,
    color: '#B8860B',
  },
  verticalCuisine: {
    fontSize: 13,
    color: Colors.textSecondary,
    marginTop: 4,
  },
  tagsRow: {
    flexDirection: 'row',
    marginTop: 10,
    gap: 6,
  },
  tag: {
    backgroundColor: Colors.primaryLight,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
  },
  tagText: {
    fontSize: 11,
    fontWeight: '600' as const,
    color: Colors.primary,
  },
  bottomRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 10,
    gap: 12,
  },
  openBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  openDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: Colors.success,
  },
  openText: {
    fontSize: 12,
    fontWeight: '600' as const,
    color: Colors.success,
  },
  busyBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  busyText: {
    fontSize: 12,
    color: Colors.textTertiary,
  },
  dealBadgeVertical: {
    position: 'absolute',
    top: 12,
    left: 12,
    backgroundColor: Colors.primary,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 20,
    gap: 4,
  },
  dealTextVertical: {
    fontSize: 11,
    fontWeight: '700' as const,
    color: '#FFF',
  },
  horizontalCard: {
    width: 220,
    backgroundColor: Colors.card,
    borderRadius: 14,
    overflow: 'hidden',
    marginRight: 12,
    shadowColor: Colors.shadowColor,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
  horizontalImage: {
    width: '100%',
    height: 130,
  },
  horizontalInfo: {
    padding: 12,
  },
  horizontalName: {
    fontSize: 15,
    fontWeight: '700' as const,
    color: Colors.text,
  },
  horizontalCuisine: {
    fontSize: 12,
    color: Colors.textSecondary,
    marginTop: 2,
  },
  dealBadge: {
    position: 'absolute',
    top: 8,
    left: 8,
    right: 8,
    backgroundColor: Colors.primary,
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    gap: 4,
    maxWidth: 200,
  },
  dealText: {
    fontSize: 10,
    fontWeight: '700' as const,
    color: '#FFF',
    flexShrink: 1,
  },
  ratingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 6,
    gap: 4,
  },
  ratingText: {
    fontSize: 12,
    fontWeight: '700' as const,
    color: Colors.text,
  },
  dot: {
    width: 3,
    height: 3,
    borderRadius: 1.5,
    backgroundColor: Colors.textTertiary,
  },
  distanceText: {
    fontSize: 12,
    color: Colors.textTertiary,
  },
  compactCard: {
    flexDirection: 'row',
    backgroundColor: Colors.card,
    borderRadius: 12,
    overflow: 'hidden',
    marginBottom: 10,
    shadowColor: Colors.shadowColor,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 6,
    elevation: 1,
  },
  compactImage: {
    width: 80,
    height: 80,
  },
  compactInfo: {
    flex: 1,
    padding: 10,
    justifyContent: 'center',
  },
  compactName: {
    fontSize: 14,
    fontWeight: '700' as const,
    color: Colors.text,
  },
  compactCuisine: {
    fontSize: 12,
    color: Colors.textSecondary,
    marginTop: 2,
  },
});
