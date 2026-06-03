import React, { useRef, useCallback } from 'react';
import {
  View,
  StyleSheet,
  Pressable,
  Animated,
} from 'react-native';
import AppText from '@/components/AppText';
import { Image } from 'expo-image';
import { Star, Clock, MapPin, Flame } from 'lucide-react-native';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { Restaurant, FriendEngagement } from '../types';
import StaticColors from '../constants/colors';
import { useColors } from '../context/ThemeContext';
import SizzleShimmer from './SizzleShimmer';
import AvatarStack from './AvatarStack';

const Colors = StaticColors;

// Deterministic caption heuristic — delta D-8, extended for source tracking (issue #281)
function formatCaption(friends: FriendEngagement['friends'], count: number): string {
  const first = friends[0]?.name?.trim();
  if (!first || count === 0) return '';

  // §6.1 — Determine collective source
  const sources = friends.map(f => f.source ?? 'favorite');
  const allSame = sources.every(s => s === sources[0]);
  type CollectiveSource = 'favorite' | 'plan' | 'both' | 'mixed';
  const collectiveSource: CollectiveSource = allSame ? sources[0] : 'mixed';

  // §6.3 — count === 1
  if (count === 1) {
    const name = first.length > 18 ? `${first.slice(0, 16)}…` : first;
    switch (collectiveSource) {
      case 'favorite': return `${name} saved this`;
      case 'plan':     return `${name}'s pick`;
      case 'both':     return `${name}'s go-to`;
      default:         return `${name} saved this`;
    }
  }

  // §6.4 — count === 2
  if (count === 2) {
    const second = friends[1]?.name?.trim() ?? '';
    const firstDisplay = first.length > 12 ? `${first.slice(0, 10)}…` : first;
    const secondDisplay = second.length > 10 ? `${second.slice(0, 8)}…` : second;
    const names = `${firstDisplay} & ${secondDisplay}`;
    switch (collectiveSource) {
      case 'favorite': return `${names} saved this`;
      case 'plan':     return `${names}'s pick`;
      case 'both':     return `${names}'s go-to`;
      case 'mixed':    return `${names} like this`;
      default:         return `${names} saved this`;
    }
  }

  // §6.5 — count >= 3
  const firstDisplay = first.length > 12 ? `${first.slice(0, 10)}…` : first;

  // §6.5 (HIGH-3): count >= 4 always collapses to neutral "love this"
  if (count >= 4) {
    return `${firstDisplay} + ${count - 1} friends love this`;
  }

  // count === 3
  const namePortion = `${firstDisplay} + 2 friends`;
  switch (collectiveSource) {
    case 'favorite': return `${namePortion} saved this`;
    case 'plan':     return `${namePortion}' pick`;
    case 'both':     return `${namePortion}' go-to`;
    case 'mixed':    return `${namePortion} like this`;
    default:         return `${namePortion} saved this`;
  }
}

interface RestaurantCardProps {
  restaurant: Restaurant;
  variant?: 'horizontal' | 'vertical' | 'compact';
  friendEngagement?: FriendEngagement;
  disableSocialAnim?: boolean;
}

export default React.memo(function RestaurantCard({
  restaurant,
  variant = 'vertical',
  friendEngagement,
  disableSocialAnim = false,
}: RestaurantCardProps) {
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
    const showSocial = !!(friendEngagement && friendEngagement.count > 0);
    const caption = showSocial ? formatCaption(friendEngagement!.friends, friendEngagement!.count) : '';

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
              <AppText variant="display" style={[styles.compactName, { color: Colors.text }]} numberOfLines={1} ellipsizeMode="tail">{restaurant.name}</AppText>
              <AppText variant="dense" style={[styles.compactCuisine, { color: Colors.textSecondary }]}>{restaurant.cuisine} · {priceString}</AppText>
              <View style={styles.ratingRow}>
                <Star size={12} color={Colors.star} fill={Colors.star} />
                <AppText variant="dense" style={[styles.ratingText, { color: Colors.text }]}>{restaurant.rating}</AppText>
                <AppText variant="dense" style={[styles.distanceText, { color: Colors.textTertiary }]}>{restaurant.distance}</AppText>
              </View>
            </View>
            {showSocial && (
              <View style={styles.compactSocialSlot}>
                <AvatarStack
                  friends={friendEngagement!.friends}
                  count={friendEngagement!.count}
                  size={28}
                  animateOnMount={!disableSocialAnim}
                  accessibilityLabel={caption}
                />
                <AppText
                  variant="dense"
                  style={[styles.captionText, { color: Colors.textSecondary }]}
                  numberOfLines={2}
                  ellipsizeMode="tail"
                >
                  {caption}
                </AppText>
              </View>
            )}
          </Animated.View>
          </SizzleShimmer>
        </Pressable>
      </View>
    );
  }

  if (variant === 'horizontal') {
    const showSocial = !!(friendEngagement && friendEngagement.count > 0);
    const caption = showSocial ? formatCaption(friendEngagement!.friends, friendEngagement!.count) : '';

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
                <AppText variant="dense" style={styles.dealText} numberOfLines={1} ellipsizeMode="tail">{restaurant.lastCallDeal}</AppText>
              </View>
            )}
            <View style={styles.horizontalInfo}>
              <AppText variant="display" style={[styles.horizontalName, { color: Colors.text }]} numberOfLines={1} ellipsizeMode="tail">{restaurant.name}</AppText>
              <AppText variant="dense" style={[styles.horizontalCuisine, { color: Colors.textSecondary }]}>{restaurant.cuisine} · {priceString}</AppText>
              <View style={styles.ratingRow}>
                <Star size={13} color={Colors.star} fill={Colors.star} />
                <AppText variant="dense" style={[styles.ratingText, { color: Colors.text }]}>{restaurant.rating}</AppText>
                <View style={styles.dot} />
                <MapPin size={11} color={Colors.textTertiary} />
                <AppText variant="dense" style={[styles.distanceText, { color: Colors.textTertiary }]}>{restaurant.distance}</AppText>
              </View>
              {restaurant.isOpenNow && (
                <View style={styles.openBadge}>
                  <View style={[styles.openDot, { backgroundColor: Colors.success }]} />
                  <AppText variant="dense" style={[styles.openText, { color: Colors.success }]}>Open Now</AppText>
                </View>
              )}
              {showSocial && (
                <View style={styles.horizontalSocialSlot}>
                  <AvatarStack
                    friends={friendEngagement!.friends}
                    count={friendEngagement!.count}
                    size={28}
                    animateOnMount={!disableSocialAnim}
                    accessibilityLabel={caption}
                  />
                  <AppText
                    variant="dense"
                    style={[styles.captionText, { color: Colors.textSecondary }]}
                    numberOfLines={2}
                    ellipsizeMode="tail"
                  >
                    {caption}
                  </AppText>
                </View>
              )}
            </View>
          </Animated.View>
          </SizzleShimmer>
        </Pressable>
      </View>
    );
  }

  // Vertical variant (default)
  const showSocialVertical = !!(friendEngagement && friendEngagement.count > 0);
  const captionVerticalBase = showSocialVertical
    ? formatCaption(friendEngagement!.friends, friendEngagement!.count)
    : '';
  // LOW-8: append ✨ on vertical variant only when collective source is 'both'
  // Suppressed at count >= 4 — at that scale the caption is the "love this"
  // warmth-aggregate (not source-specific), so the sparkle no longer marks
  // the "saved AND planned" moment.
  const verticalCollectiveSources = friendEngagement?.friends.map(f => f.source ?? 'favorite') ?? [];
  const verticalAllSame = verticalCollectiveSources.length > 0 && verticalCollectiveSources.every(s => s === verticalCollectiveSources[0]);
  const verticalCollectiveSource = verticalAllSame ? verticalCollectiveSources[0] : 'mixed';
  const verticalCount = friendEngagement?.count ?? 0;
  const captionVertical =
    verticalCollectiveSource === 'both' && verticalCount < 4 && captionVerticalBase.length > 0
      ? `${captionVerticalBase} ✨`
      : captionVerticalBase;

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
              <AppText variant="dense" style={styles.dealTextVertical}>{restaurant.lastCallDeal}</AppText>
            </View>
          )}
          <View style={styles.verticalInfo}>
            <View style={styles.verticalHeader}>
              <AppText variant="display" style={[styles.verticalName, { color: Colors.text }]} numberOfLines={1} ellipsizeMode="tail">{restaurant.name}</AppText>
              <View style={[styles.ratingBadge, { backgroundColor: Colors.secondaryLight }]}>
                <Star size={12} color={Colors.star} fill={Colors.star} />
                <AppText variant="dense" style={[styles.ratingBadgeText, { color: Colors.secondary }]}>{restaurant.rating}</AppText>
              </View>
            </View>
            <AppText variant="dense" style={[styles.verticalCuisine, { color: Colors.textSecondary }]}>{restaurant.cuisine} · {priceString} · {restaurant.distance}</AppText>
            {showSocialVertical && (
              <View style={styles.verticalSocialSlot}>
                <AvatarStack
                  friends={friendEngagement!.friends}
                  count={friendEngagement!.count}
                  size={32}
                  animateOnMount={!disableSocialAnim}
                  accessibilityLabel={captionVertical}
                />
                <AppText
                  variant="dense"
                  style={[styles.captionText, styles.captionTextVertical, { color: Colors.textSecondary }]}
                  numberOfLines={2}
                  ellipsizeMode="tail"
                >
                  {captionVertical}
                </AppText>
              </View>
            )}
            <View style={styles.tagsRow}>
              {restaurant.tags.slice(0, 3).map(tag => (
                <View key={tag} style={[styles.tag, { backgroundColor: Colors.primaryLight }]}>
                  <AppText variant="dense" style={[styles.tagText, { color: Colors.primary }]}>{tag}</AppText>
                </View>
              ))}
            </View>
            {restaurant.isOpenNow && (
              <View style={styles.bottomRow}>
                <View style={styles.openBadge}>
                  <View style={[styles.openDot, { backgroundColor: Colors.success }]} />
                  <AppText variant="dense" style={[styles.openText, { color: Colors.success }]}>Open</AppText>
                </View>
                {restaurant.busyLevel && (
                  <View style={styles.busyBadge}>
                    <Clock size={11} color={Colors.textTertiary} />
                    <AppText variant="dense" style={[styles.busyText, { color: Colors.textTertiary }]}>{restaurant.busyLevel} traffic</AppText>
                  </View>
                )}
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
  // Social-proof slots
  compactSocialSlot: {
    alignItems: 'flex-end',
    justifyContent: 'center',
    paddingRight: 10,
    paddingVertical: 10,
    maxWidth: 110,
    gap: 4,
  },
  horizontalSocialSlot: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 6,
    gap: 6,
    flexWrap: 'wrap',
  },
  verticalSocialSlot: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 10,
    gap: 8,
  },
  captionText: {
    fontSize: 11,
    fontWeight: '600' as const,
    color: Colors.textSecondary,
    textAlign: 'right',
    maxWidth: 110,
  },
  captionTextVertical: {
    textAlign: 'left',
    flex: 1,
    maxWidth: undefined,
  },
});
