import React, { useCallback } from 'react';
import { View, StyleSheet, FlatList, Pressable, Alert, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Image } from 'expo-image';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, UserX } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import AppText from '@/components/AppText';
import { getBlockedUsers, unblockUser, BlockedUser } from '../../../services/moderation';
import { DEFAULT_AVATAR_URI } from '../../../constants/images';
import StaticColors from '../../../constants/colors';
import { useColors } from '../../../context/ThemeContext';

const Colors = StaticColors;

// #321: blocked-users management — Apple's Guideline 1.2 blocking requirement
// includes the ability to see and reverse blocks.
export default function BlockedUsersScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const Colors = useColors();
  const queryClient = useQueryClient();

  const blockedQuery = useQuery({ queryKey: ['blockedUsers'], queryFn: getBlockedUsers });

  const unblockMutation = useMutation({
    mutationFn: (userId: string) => unblockUser(userId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['blockedUsers'] });
      queryClient.invalidateQueries({ queryKey: ['friends'] });
      queryClient.invalidateQueries({ queryKey: ['discoverFeed'] });
    },
    onError: (err: Error) => Alert.alert('Could Not Unblock', err.message || 'Something went wrong.'),
  });

  const handleUnblock = useCallback((user: BlockedUser) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    Alert.alert(
      `Unblock ${user.name}?`,
      'They will be able to send you friend requests and invites again.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Unblock', onPress: () => unblockMutation.mutate(user.id ?? user._id ?? '') },
      ],
    );
  }, [unblockMutation]);

  return (
    <View style={[styles.container, { backgroundColor: Colors.background, paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable
          onPress={() => router.back()}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Go back"
          testID="blocked-back-btn"
        >
          <ArrowLeft size={24} color={Colors.text} />
        </Pressable>
        <AppText style={[styles.title, { color: Colors.text }]}>Blocked Users</AppText>
        <View style={{ width: 24 }} />
      </View>

      {blockedQuery.isLoading ? (
        <View style={styles.centered}>
          <ActivityIndicator color={Colors.primary} />
        </View>
      ) : blockedQuery.isError ? (
        <View style={styles.centered}>
          <AppText style={[styles.emptyText, { color: Colors.textSecondary }]}>
            Couldn’t load your blocked list.
          </AppText>
          <Pressable
            style={[styles.retryBtn, { backgroundColor: Colors.primary }]}
            onPress={() => blockedQuery.refetch()}
            accessibilityRole="button"
            accessibilityLabel="Try again"
          >
            <AppText style={styles.retryText}>Try Again</AppText>
          </Pressable>
        </View>
      ) : (blockedQuery.data?.length ?? 0) === 0 ? (
        <View style={styles.centered}>
          <UserX size={40} color={Colors.textTertiary} />
          <AppText style={[styles.emptyTitle, { color: Colors.text }]}>No blocked users</AppText>
          <AppText style={[styles.emptyText, { color: Colors.textSecondary }]}>
            People you block will appear here. Blocked users can’t send you friend requests or invites.
          </AppText>
        </View>
      ) : (
        <FlatList
          data={blockedQuery.data}
          keyExtractor={(item) => item.id ?? item._id ?? item.name}
          contentContainerStyle={styles.listContent}
          renderItem={({ item }) => (
            <View style={[styles.row, { backgroundColor: Colors.card }]}>
              <Image source={item.avatarUri || DEFAULT_AVATAR_URI} style={styles.avatar} contentFit="cover" />
              <AppText style={[styles.name, { color: Colors.text }]} numberOfLines={1}>
                {item.name}
              </AppText>
              <Pressable
                style={[styles.unblockBtn, { borderColor: Colors.primary }]}
                onPress={() => handleUnblock(item)}
                accessibilityRole="button"
                accessibilityLabel={`Unblock ${item.name}`}
              >
                <AppText variant="dense" style={[styles.unblockText, { color: Colors.primary }]}>
                  Unblock
                </AppText>
              </Pressable>
            </View>
          )}
        />
      )}
    </View>
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
  title: {
    fontSize: 18,
    fontWeight: '700' as const,
    color: Colors.text,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 40,
    gap: 10,
  },
  emptyTitle: {
    fontSize: 17,
    fontWeight: '700' as const,
    color: Colors.text,
    marginTop: 6,
  },
  emptyText: {
    fontSize: 14,
    color: Colors.textSecondary,
    textAlign: 'center',
  },
  retryBtn: {
    marginTop: 8,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 20,
    backgroundColor: Colors.primary,
  },
  retryText: {
    color: '#FFF',
    fontWeight: '600' as const,
    fontSize: 14,
  },
  listContent: {
    paddingHorizontal: 20,
    paddingBottom: 30,
    gap: 10,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: Colors.card,
    borderRadius: 14,
    padding: 12,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
  },
  name: {
    flex: 1,
    fontSize: 15,
    fontWeight: '600' as const,
    color: Colors.text,
  },
  unblockBtn: {
    borderWidth: 1.5,
    borderColor: Colors.primary,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 6,
  },
  unblockText: {
    fontSize: 13,
    fontWeight: '600' as const,
    color: Colors.primary,
  },
});
