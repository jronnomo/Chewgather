import React, { useRef, useState, useCallback, useEffect } from 'react';
import { View, Pressable, Animated, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import { Check } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import StaticColors from '../constants/colors';
import { useColors } from '../context/ThemeContext';
import { DEFAULT_AVATAR_URI } from '../constants/images';
import AppText from '@/components/AppText';

const Colors = StaticColors;

interface Friend {
  id: string;
  name: string;
  avatarUri?: string;
  mutualPlans?: number;
}

interface FriendAvatarRowProps {
  friends: Friend[];
  selectedIds: string[];
  onToggle: (id: string) => void;
  maxVisible?: number; // default 8
}

/* ------------------------------------------------------------------ */
/*  Module-level helper: AvatarItem                                    */
/* ------------------------------------------------------------------ */
function AvatarItem({
  friend,
  isSelected,
  onPress,
  onLongPress,
  isFirst,
}: {
  friend: Friend;
  isSelected: boolean;
  onPress: () => void;
  onLongPress: () => void;
  isFirst: boolean;
}) {
  const Colors = useColors(); // module-level helper MUST call useColors()
  const scaleAnim = useRef(new Animated.Value(isSelected ? 1.05 : 1)).current;

  useEffect(() => {
    Animated.spring(scaleAnim, {
      toValue: isSelected ? 1.05 : 1,
      tension: 300,
      friction: 12,
      useNativeDriver: true,
    }).start();
  }, [isSelected, scaleAnim]);

  return (
    <Animated.View
      style={[
        styles.avatarWrapper,
        !isFirst && styles.avatarOverlap,
        {
          transform: [{ scale: scaleAnim }],
          opacity: isSelected ? 1 : 0.6,
        },
      ]}
    >
      <Pressable
        onPress={onPress}
        onLongPress={onLongPress}
        accessibilityRole="button"
        accessibilityLabel={`${friend.name}${isSelected ? ', selected' : ''}`}
      >
        <Image
          source={{ uri: friend.avatarUri || DEFAULT_AVATAR_URI }}
          style={[styles.avatar, { borderColor: Colors.card }]}
        />
        {isSelected && (
          <View style={[styles.checkBadge, { backgroundColor: Colors.success, borderColor: Colors.card }]}>
            <Check size={10} color="#FFFFFF" strokeWidth={3} />
          </View>
        )}
      </Pressable>
    </Animated.View>
  );
}

/* ------------------------------------------------------------------ */
/*  Main component                                                     */
/* ------------------------------------------------------------------ */
export default function FriendAvatarRow({
  friends,
  selectedIds,
  onToggle,
  maxVisible = 8,
}: FriendAvatarRowProps) {
  const Colors = useColors();

  const [tooltip, setTooltip] = useState<{ id: string } | null>(null);
  const tooltipTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Clean up tooltip timer on unmount
  useEffect(() => {
    return () => {
      if (tooltipTimer.current) {
        clearTimeout(tooltipTimer.current);
      }
    };
  }, []);

  const handlePress = useCallback(
    (id: string) => {
      Haptics.selectionAsync();
      onToggle(id);
    },
    [onToggle],
  );

  const handleLongPress = useCallback((id: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setTooltip({ id });

    if (tooltipTimer.current) {
      clearTimeout(tooltipTimer.current);
    }
    tooltipTimer.current = setTimeout(() => {
      setTooltip(null);
    }, 2000);
  }, []);

  const visibleFriends = friends.slice(0, maxVisible);
  const overflowCount = friends.length - maxVisible;
  const selectedSet = new Set(selectedIds);

  const tooltipFriend = tooltip ? friends.find((f) => f.id === tooltip.id) : null;

  return (
    <View style={styles.container}>
      <View style={styles.row}>
        {visibleFriends.map((friend, index) => (
          <View key={friend.id} style={styles.avatarContainer}>
            {/* Tooltip */}
            {tooltip?.id === friend.id && tooltipFriend && (
              <View style={[styles.tooltip, { backgroundColor: Colors.text }]}>
                <AppText
                  variant="dense"
                  numberOfLines={1}
                  ellipsizeMode="tail"
                  style={[styles.tooltipName, { color: Colors.background }]}
                >
                  {tooltipFriend.name}
                </AppText>
                {tooltipFriend.mutualPlans != null && tooltipFriend.mutualPlans > 0 && (
                  <AppText variant="dense" style={[styles.tooltipDetail, { color: Colors.background }]}>
                    {tooltipFriend.mutualPlans} plan{tooltipFriend.mutualPlans !== 1 ? 's' : ''} together
                  </AppText>
                )}
                <View style={[styles.tooltipArrow, { borderTopColor: Colors.text }]} />
              </View>
            )}

            <AvatarItem
              friend={friend}
              isSelected={selectedSet.has(friend.id)}
              onPress={() => handlePress(friend.id)}
              onLongPress={() => handleLongPress(friend.id)}
              isFirst={index === 0}
            />
          </View>
        ))}

        {overflowCount > 0 && (
          <View style={[styles.overflowPill, styles.avatarOverlap, { backgroundColor: Colors.border }]}>
            <AppText variant="dense" style={[styles.overflowText, { color: Colors.textSecondary }]}>
              +{overflowCount}
            </AppText>
          </View>
        )}
      </View>
    </View>
  );
}

const AVATAR_SIZE = 40;
const BADGE_SIZE = 16;

const styles = StyleSheet.create({
  container: {
    paddingVertical: 4,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  avatarContainer: {
    position: 'relative',
  },
  avatarWrapper: {
    // wrapper for scale animation
  },
  avatarOverlap: {
    marginLeft: -8,
  },
  avatar: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    borderRadius: AVATAR_SIZE / 2,
    borderWidth: 2,
  },
  checkBadge: {
    position: 'absolute',
    bottom: -1,
    right: -1,
    width: BADGE_SIZE,
    height: BADGE_SIZE,
    borderRadius: BADGE_SIZE / 2,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  overflowPill: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    borderRadius: AVATAR_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  overflowText: {
    fontSize: 13,
    fontWeight: '700',
  },
  tooltip: {
    position: 'absolute',
    bottom: AVATAR_SIZE + 8,
    left: -20,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    alignItems: 'center',
    zIndex: 10,
    minWidth: 100,
  },
  tooltipName: {
    fontSize: 13,
    fontWeight: '700',
  },
  tooltipDetail: {
    fontSize: 11,
    fontWeight: '400',
    marginTop: 2,
  },
  tooltipArrow: {
    position: 'absolute',
    bottom: -6,
    left: '50%',
    marginLeft: -6,
    width: 0,
    height: 0,
    borderLeftWidth: 6,
    borderRightWidth: 6,
    borderTopWidth: 6,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
  },
});
