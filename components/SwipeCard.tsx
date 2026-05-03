import React, { useRef, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Dimensions,
  Animated,
  Easing,
  PanResponder,
} from 'react-native';
import { Image } from 'expo-image';
import Svg, { Circle, Path } from 'react-native-svg';
import { Star, MapPin, DollarSign, Volume2, Flame, Dices } from 'lucide-react-native';
import { Restaurant } from '@/types';
import StaticColors from '@/constants/colors';
import { useColors } from '@/context/ThemeContext';
import { starPath, SPARKLES } from '@/lib/sparkleUtils';

const Colors = StaticColors;
const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const SWIPE_THRESHOLD = SCREEN_WIDTH * 0.25;
const CARD_WIDTH = SCREEN_WIDTH - 40;
const CARD_HEIGHT = SCREEN_HEIGHT * 0.58;

interface SwipeCardProps {
  restaurant: Restaurant;
  onSwipeLeft: (restaurant: Restaurant) => void;
  onSwipeRight: (restaurant: Restaurant) => void;
  onTap?: (restaurant: Restaurant) => void;
  isTop: boolean;
  isCurveball?: boolean;
  isOutsideRadius?: boolean;
}

export default React.memo(function SwipeCard({
  restaurant,
  onSwipeLeft,
  onSwipeRight,
  onTap,
  isTop,
  isCurveball,
  isOutsideRadius,
}: SwipeCardProps) {
  const Colors = useColors();
  const position = useRef(new Animated.ValueXY()).current;
  const opacityYes = useRef(new Animated.Value(0)).current;
  const opacityNo = useRef(new Animated.Value(0)).current;
  const isTopRef = useRef(isTop);
  isTopRef.current = isTop;
  const onTapRef = useRef(onTap);
  onTapRef.current = onTap;
  const gestureStartTime = useRef(0);
  const gleamAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (isTop && isCurveball) {
      gleamAnim.setValue(0);
      const timeout = setTimeout(() => {
        Animated.timing(gleamAnim, {
          toValue: 1,
          duration: 1200,
          easing: Easing.out(Easing.ease),
          useNativeDriver: true,
        }).start();
      }, 300);
      return () => clearTimeout(timeout);
    }
  }, [isTop, isCurveball]);

  const resetPosition = useCallback(() => {
    Animated.spring(position, {
      toValue: { x: 0, y: 0 },
      friction: 5,
      useNativeDriver: true,
    }).start();
    Animated.timing(opacityYes, { toValue: 0, duration: 100, useNativeDriver: true }).start();
    Animated.timing(opacityNo, { toValue: 0, duration: 100, useNativeDriver: true }).start();
  }, [position, opacityYes, opacityNo]);

  const swipeOffScreen = useCallback((direction: 'left' | 'right') => {
    const x = direction === 'right' ? SCREEN_WIDTH + 100 : -SCREEN_WIDTH - 100;
    Animated.timing(position, {
      toValue: { x, y: 0 },
      duration: 250,
      useNativeDriver: true,
    }).start(() => {
      if (direction === 'right') {
        onSwipeRight(restaurant);
      } else {
        onSwipeLeft(restaurant);
      }
    });
  }, [position, onSwipeRight, onSwipeLeft, restaurant]);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => isTopRef.current,
      onMoveShouldSetPanResponder: (_, gesture) => {
        return isTopRef.current && (Math.abs(gesture.dx) > 5 || Math.abs(gesture.dy) > 5);
      },
      onPanResponderGrant: () => {
        gestureStartTime.current = Date.now();
      },
      onPanResponderMove: (_, gesture) => {
        position.setValue({ x: gesture.dx, y: gesture.dy * 0.3 });
        if (gesture.dx > 30) {
          opacityYes.setValue(Math.min(gesture.dx / SWIPE_THRESHOLD, 1));
          opacityNo.setValue(0);
        } else if (gesture.dx < -30) {
          opacityNo.setValue(Math.min(Math.abs(gesture.dx) / SWIPE_THRESHOLD, 1));
          opacityYes.setValue(0);
        } else {
          opacityYes.setValue(0);
          opacityNo.setValue(0);
        }
      },
      onPanResponderRelease: (_, gesture) => {
        const elapsed = Date.now() - gestureStartTime.current;
        if (gesture.dx > SWIPE_THRESHOLD) {
          swipeOffScreen('right');
        } else if (gesture.dx < -SWIPE_THRESHOLD) {
          swipeOffScreen('left');
        } else if (Math.abs(gesture.dx) < 10 && Math.abs(gesture.dy) < 10 && elapsed < 300) {
          // Tap detected
          resetPosition();
          onTapRef.current?.(restaurant);
        } else {
          resetPosition();
        }
      },
    })
  ).current;

  const rotate = position.x.interpolate({
    inputRange: [-SCREEN_WIDTH, 0, SCREEN_WIDTH],
    outputRange: ['-12deg', '0deg', '12deg'],
  });

  const priceString = '$'.repeat(restaurant.priceLevel);
  const noiseLabelMap: Record<string, string> = {
    quiet: 'Quiet',
    moderate: 'Moderate',
    lively: 'Lively',
  };

  return (
    <View
      testID={`swipe-card-${restaurant.id}`}
      accessibilityRole="button"
      pointerEvents="box-none"
      style={[
        styles.cardContainer,
        { zIndex: isTop ? 10 : 5 },
        !isTop && styles.cardBehind,
      ]}
    >
      <Animated.View
        {...(isTop ? panResponder.panHandlers : {})}
        style={[
          StyleSheet.absoluteFillObject,
          {
            transform: [
              { translateX: position.x },
              { translateY: position.y },
              { rotate },
            ],
          },
        ]}
      >
      <View style={styles.card}>
        <Image
          source={{ uri: restaurant.imageUrl }}
          style={styles.cardImage}
          contentFit="cover"
        />

        <View style={styles.gradientOverlay} />

        {isCurveball && SPARKLES.map((sp, i) => {
          const start = sp.x * 0.45;
          const fadeIn = start + 0.12;
          const holdEnd = start + 0.35;
          const fadeOut = Math.min(start + 0.55, 1);
          const spOpacity = gleamAnim.interpolate({
            inputRange: [start, fadeIn, holdEnd, fadeOut],
            outputRange: [0, 1, 0.8, 0],
            extrapolate: 'clamp',
          });
          const spScale = gleamAnim.interpolate({
            inputRange: [start, fadeIn, holdEnd, fadeOut],
            outputRange: [0, 1.3, 1, 0],
            extrapolate: 'clamp',
          });
          const dim = sp.size * 4;
          return (
            <Animated.View
              key={i}
              pointerEvents="none"
              style={{
                position: 'absolute',
                left: sp.x * CARD_WIDTH - dim / 2,
                top: sp.y * CARD_HEIGHT - dim / 2,
                width: dim,
                height: dim,
                zIndex: 12,
                opacity: spOpacity,
                transform: [{ scale: spScale }],
              }}
            >
              <Svg width={dim} height={dim}>
                {/* Soft glow halo */}
                <Circle
                  cx={dim / 2}
                  cy={dim / 2}
                  r={sp.size * 1.6}
                  fill="rgba(255,215,80,0.12)"
                />
                {sp.type === 'star' ? (
                  <Path
                    d={starPath(dim / 2, dim / 2, sp.size)}
                    fill="rgba(255,225,120,0.9)"
                  />
                ) : (
                  <Circle
                    cx={dim / 2}
                    cy={dim / 2}
                    r={sp.size * 0.5}
                    fill="rgba(255,235,160,0.85)"
                  />
                )}
              </Svg>
            </Animated.View>
          );
        })}

        <Animated.View style={[styles.stampYes, { opacity: opacityYes }]}>
          <Text style={styles.stampYesText}>YUM!</Text>
        </Animated.View>

        <Animated.View style={[styles.stampNo, { opacity: opacityNo }]}>
          <Text style={styles.stampNoText}>NOPE</Text>
        </Animated.View>

        {restaurant.lastCallDeal && (
          <View style={[styles.dealTag, { backgroundColor: Colors.primary }]}>
            <Flame size={12} color="#FFF" />
            <Text style={styles.dealTagText}>{restaurant.lastCallDeal}</Text>
          </View>
        )}

        {isCurveball && (
          <View style={[styles.curveballTag, !restaurant.lastCallDeal && styles.curveballTagTop]}>
            <Dices size={12} color="#FFF" />
            <Text style={styles.curveballTagText}>Curveball!</Text>
          </View>
        )}

        {isOutsideRadius && (
          <View style={styles.outsideRadiusTag}>
            <MapPin size={12} color="#FFF" />
            <Text style={styles.outsideRadiusTagText}>Farther out</Text>
          </View>
        )}

        <View style={styles.cardContent}>
          <View style={styles.cardHeader}>
            <View style={styles.cardTitleArea}>
              <Text style={styles.cardName} numberOfLines={1}>{restaurant.name}</Text>
              <Text style={styles.cardCuisine}>{restaurant.cuisine}</Text>
            </View>
            <View style={styles.ratingPill}>
              <Star size={14} color="#FFB800" fill="#FFB800" />
              <Text style={styles.ratingValue}>{restaurant.rating}</Text>
            </View>
          </View>

          <View style={styles.cardMeta}>
            <View style={styles.metaItem}>
              <MapPin size={13} color="rgba(255,255,255,0.7)" />
              <Text style={styles.metaText}>{restaurant.distance}</Text>
            </View>
            <View style={styles.metaDot} />
            <View style={styles.metaItem}>
              <DollarSign size={13} color="rgba(255,255,255,0.7)" />
              <Text style={styles.metaText}>{priceString}</Text>
            </View>
            <View style={styles.metaDot} />
            <View style={styles.metaItem}>
              <Volume2 size={13} color="rgba(255,255,255,0.7)" />
              <Text style={styles.metaText}>{noiseLabelMap[restaurant.noiseLevel]}</Text>
            </View>
          </View>

          <View style={styles.tagRow}>
            {restaurant.tags.slice(0, 3).map((tag, i) => (
              <View key={`${tag}-${i}`} style={styles.cardTag}>
                <Text style={styles.cardTagText}>{tag}</Text>
              </View>
            ))}
          </View>

          {restaurant.isOpenNow && (
            <View style={styles.openIndicator}>
              <View style={styles.openDotLive} />
              <Text style={styles.openLiveText}>Open Now</Text>
            </View>
          )}
        </View>
      </View>
      </Animated.View>
    </View>
  );
});

const styles = StyleSheet.create({
  cardContainer: {
    position: 'absolute',
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
    alignSelf: 'center',
  },
  cardBehind: {
    transform: [{ scale: 0.95 }, { translateY: 10 }],
    opacity: 0.7,
  },
  card: {
    flex: 1,
    borderRadius: 24,
    overflow: 'hidden',
    backgroundColor: '#1A1A1A',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.3,
    shadowRadius: 16,
    elevation: 10,
  },
  cardImage: {
    width: '100%',
    height: '100%',
    position: 'absolute',
  },
  gradientOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: '65%',
    backgroundColor: 'transparent',
  },
  stampYes: {
    position: 'absolute',
    top: 40,
    left: 20,
    borderWidth: 4,
    borderColor: '#4CD964',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 8,
    transform: [{ rotate: '-15deg' }],
    zIndex: 20,
  },
  stampYesText: {
    fontSize: 32,
    fontWeight: '900' as const,
    color: '#4CD964',
    letterSpacing: 2,
  },
  stampNo: {
    position: 'absolute',
    top: 40,
    right: 20,
    borderWidth: 4,
    borderColor: '#FF3B30',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 8,
    transform: [{ rotate: '15deg' }],
    zIndex: 20,
  },
  stampNoText: {
    fontSize: 32,
    fontWeight: '900' as const,
    color: '#FF3B30',
    letterSpacing: 2,
  },
  dealTag: {
    position: 'absolute',
    top: 20,
    alignSelf: 'center',
    backgroundColor: Colors.primary,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 20,
    gap: 5,
    zIndex: 15,
  },
  dealTagText: {
    fontSize: 12,
    fontWeight: '700' as const,
    color: '#FFF',
  },
  curveballTag: {
    position: 'absolute',
    top: 52,
    alignSelf: 'center',
    backgroundColor: '#8B5CF6',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 20,
    gap: 5,
    zIndex: 15,
  },
  curveballTagTop: {
    top: 20,
  },
  curveballTagText: {
    fontSize: 12,
    fontWeight: '700' as const,
    color: '#FFF',
  },
  outsideRadiusTag: {
    position: 'absolute',
    top: 20,
    right: 16,
    backgroundColor: 'rgba(234,118,0,0.9)',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 16,
    gap: 4,
    zIndex: 15,
  },
  outsideRadiusTagText: {
    fontSize: 11,
    fontWeight: '700' as const,
    color: '#FFF',
  },
  cardContent: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    padding: 20,
    paddingBottom: 24,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  cardTitleArea: {
    flex: 1,
    marginRight: 12,
  },
  cardName: {
    fontSize: 26,
    fontWeight: '800' as const,
    color: '#FFF',
    letterSpacing: -0.5,
  },
  cardCuisine: {
    fontSize: 15,
    color: 'rgba(255,255,255,0.75)',
    marginTop: 2,
    fontWeight: '500' as const,
  },
  ratingPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.15)',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 12,
    gap: 4,
  },
  ratingValue: {
    fontSize: 15,
    fontWeight: '800' as const,
    color: '#FFF',
  },
  cardMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 10,
    gap: 6,
  },
  metaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  metaText: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.8)',
    fontWeight: '500' as const,
  },
  metaDot: {
    width: 3,
    height: 3,
    borderRadius: 1.5,
    backgroundColor: 'rgba(255,255,255,0.4)',
  },
  tagRow: {
    flexDirection: 'row',
    marginTop: 12,
    gap: 6,
  },
  cardTag: {
    backgroundColor: 'rgba(255,255,255,0.18)',
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 16,
  },
  cardTagText: {
    fontSize: 12,
    fontWeight: '600' as const,
    color: 'rgba(255,255,255,0.9)',
  },
  openIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 10,
    gap: 5,
  },
  openDotLive: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
    backgroundColor: '#4CD964',
  },
  openLiveText: {
    fontSize: 12,
    fontWeight: '700' as const,
    color: '#4CD964',
  },
});
