import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import { ArrowLeft, Utensils } from 'lucide-react-native';
import StaticColors from '../constants/colors';
import { useColors } from '../context/ThemeContext';
import ScallopDivider from './ScallopDivider';
import { DEFAULT_AVATAR_URI } from '../constants/images';

const Colors = StaticColors;

export interface FriendPlansHeaderProps {
  name: string;
  avatarUri?: string;
  mutualCount: number;
  onBack: () => void;
}

export default function FriendPlansHeader({
  name,
  avatarUri,
  mutualCount,
  onBack,
}: FriendPlansHeaderProps) {
  const Colors = useColors();

  const planLabel =
    mutualCount === 1 ? '1 plan together' : `${mutualCount} plans together`;

  return (
    <View style={[styles.wrapper, { backgroundColor: Colors.card }]}>
      <View style={styles.topRow}>
        <Pressable
          onPress={onBack}
          style={styles.backButton}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <ArrowLeft size={18} color={Colors.text} />
        </Pressable>
        <Image
          source={avatarUri ? { uri: avatarUri } : DEFAULT_AVATAR_URI}
          style={[styles.avatar, { borderColor: Colors.card }]}
          contentFit="cover"
        />
        <View style={styles.nameBlock}>
          <Text style={[styles.name, { color: Colors.text }]}>{name}</Text>
          {mutualCount > 0 && (
            <View style={[styles.chip, { backgroundColor: Colors.primaryLight }]}>
              <Utensils size={12} color={Colors.primary} />
              <Text style={[styles.chipText, { color: Colors.primary }]}>
                {planLabel}
              </Text>
            </View>
          )}
        </View>
      </View>
      <ScallopDivider color={Colors.background} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    backgroundColor: Colors.card,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 8,
    gap: 12,
  },
  backButton: {
    padding: 4,
  },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    borderWidth: 2,
    borderColor: Colors.card,
  },
  nameBlock: {
    flex: 1,
    gap: 6,
  },
  name: {
    fontSize: 22,
    fontWeight: '800',
    color: Colors.text,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 4,
    gap: 4,
    backgroundColor: Colors.primaryLight,
  },
  chipText: {
    fontSize: 12,
    fontWeight: '700',
    color: Colors.primary,
  },
});
