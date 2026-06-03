import React from 'react';
import { View, Pressable, StyleSheet } from 'react-native';
import AppText from '@/components/AppText';
import { Image } from 'expo-image';
import StaticColors from '../constants/colors';
import { useColors } from '../context/ThemeContext';
import { DEFAULT_AVATAR_URI } from '../constants/images';

const Colors = StaticColors;

export interface FriendPlansEmptyStateProps {
  firstName: string;
  avatarUri?: string;
  onPlanPress: () => void;
}

export default function FriendPlansEmptyState({
  firstName,
  avatarUri,
  onPlanPress,
}: FriendPlansEmptyStateProps) {
  const Colors = useColors();

  return (
    <View style={styles.outer}>
      <View style={[styles.card, { backgroundColor: Colors.card }]}>
        <View style={[styles.ring, { borderColor: Colors.border }]}>
          <Image
            source={avatarUri ? { uri: avatarUri } : DEFAULT_AVATAR_URI}
            style={styles.avatar}
            contentFit="cover"
          />
        </View>
        <AppText variant="dense" style={[styles.headline, { color: Colors.text }]}>
          {`No plans with ${firstName} yet`}
        </AppText>
        <AppText variant="body" style={[styles.body, { color: Colors.textSecondary }]}>
          {'Your first one is just a tap away.'}
        </AppText>
        <Pressable
          onPress={onPlanPress}
          style={[styles.cta, { backgroundColor: Colors.primary }]}
          accessibilityRole="button"
          accessibilityLabel={`Plan with ${firstName}`}
        >
          <AppText variant="dense" numberOfLines={1} style={styles.ctaText}>{`Plan with ${firstName}`}</AppText>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  outer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  card: {
    width: '100%',
    borderRadius: 20,
    padding: 28,
    alignItems: 'center',
    gap: 12,
    backgroundColor: Colors.card,
  },
  ring: {
    width: 88,
    height: 88,
    borderRadius: 44,
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
  },
  headline: {
    fontSize: 20,
    fontWeight: '800',
    textAlign: 'center',
    color: Colors.text,
    marginTop: 4,
  },
  body: {
    fontSize: 14,
    textAlign: 'center',
    color: Colors.textSecondary,
  },
  cta: {
    borderRadius: 24,
    paddingHorizontal: 24,
    paddingVertical: 12,
    minHeight: 48,
    marginTop: 8,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#FFFFFF',
  },
});
