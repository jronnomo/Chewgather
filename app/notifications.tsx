import React, { useCallback, useEffect } from 'react';
import {
  View,
  StyleSheet,
  FlatList,
  Pressable,
  ActivityIndicator,
} from 'react-native';
import AppText from '@/components/AppText';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Bell, CheckCheck } from 'lucide-react-native';
import StaticColors from '../constants/colors';
import { useColors } from '../context/ThemeContext';
import {
  useNotifications,
  useMarkRead,
  useMarkAllRead,
  useDeleteNotification,
} from '../hooks/useNotifications';
import NotificationItem from '../components/NotificationItem';
import { clearBadgeCount } from '../services/notifications';
import { AppNotification } from '../types';

const Colors = StaticColors;

export default function NotificationsScreen() {
  const Colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const queryClient = useQueryClient();

  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading,
    refetch,
    isRefetching,
  } = useNotifications();

  const markRead = useMarkRead();
  const markAllRead = useMarkAllRead();
  const deleteNotification = useDeleteNotification();

  const notifications = data?.pages.flatMap((page) => page.notifications) ?? [];

  // Clear the OS app-icon badge when the user opens the notification center.
  useEffect(() => {
    clearBadgeCount();
  }, []);

  const handleItemPress = useCallback(
    (notification: AppNotification) => {
      // Mark as read if unread
      if (!notification.read) {
        markRead.mutate(notification.id);
      }

      // Navigate based on type — invalidate relevant caches first so
      // the destination screen fetches fresh data instead of showing stale results.
      const notifData = notification.data;
      switch (notification.type) {
        case 'plan_invite':
        case 'rsvp_response':
        case 'group_swipe_result':
        case 'swipe_completed':
        case 'plan_reminder':
        case 'plan_cancelled':
        case 'organizer_delegated':
        case 'organizer_changed':
        case 'participant_left':
        case 'plan_auto_cancelled':
          queryClient.invalidateQueries({ queryKey: ['plans'] });
          if (notifData?.planId) {
            router.push(`/(tabs)/plans?planId=${notifData.planId}&from=notifications` as never);
          } else {
            router.push('/(tabs)/plans?from=notifications' as never);
          }
          break;
        case 'group_swipe_invite':
          queryClient.invalidateQueries({ queryKey: ['plans'] });
          router.push('/group-session' as never);
          break;
        case 'friend_request':
          queryClient.invalidateQueries({ queryKey: ['friendRequests'] });
          router.push('/(tabs)/friends?tab=requests&from=notifications' as never);
          break;
        case 'friend_accepted':
          queryClient.invalidateQueries({ queryKey: ['friends'] });
          router.push('/(tabs)/friends?from=notifications' as never);
          break;
        // REQ-008: Closed-winner resolution notification types.
        // plan_winner_closed → owner: navigate into the plan's results so the
        //   ClosedWinnerSheet auto-opens (winnerClosedAt set + !dismissed).
        // plan_rescheduled / plan_restaurant_changed / plan_kept_despite_hours →
        //   members: open the plan so they see the updated state.
        // Fallback (no planId): land on Plans tab, consistent with existing pattern.
        case 'plan_winner_closed':
          queryClient.invalidateQueries({ queryKey: ['plans'] });
          if (notifData?.planId) {
            router.push(`/group-session?planId=${notifData.planId}` as never);
          } else {
            router.push('/(tabs)/plans?from=notifications' as never);
          }
          break;
        case 'plan_rescheduled':
        case 'plan_restaurant_changed':
        case 'plan_kept_despite_hours':
          queryClient.invalidateQueries({ queryKey: ['plans'] });
          if (notifData?.planId) {
            router.push(`/(tabs)/plans?planId=${notifData.planId}&from=notifications` as never);
          } else {
            router.push('/(tabs)/plans?from=notifications' as never);
          }
          break;
        // #309 request-to-join: open the plan detail so the owner sees the
        //   Requests section (received) and the requester sees their updated
        //   status (approved → now a participant; denied → "Ask again").
        case 'join_request_received':
        case 'join_request_approved':
        case 'join_request_denied':
          queryClient.invalidateQueries({ queryKey: ['plans'] });
          if (notifData?.planId) {
            queryClient.invalidateQueries({ queryKey: ['plan', notifData.planId] });
            router.push(`/plan-detail?id=${notifData.planId}` as never);
          } else {
            router.push('/(tabs)/plans?from=notifications' as never);
          }
          break;
        default:
          break;
      }
    },
    [markRead, router, queryClient],
  );

  const handleDelete = useCallback(
    (id: string) => {
      if (deleteNotification.isPending) return;
      deleteNotification.mutate(id);
    },
    [deleteNotification],
  );

  // The id currently being deleted, so its row can show in-flight feedback.
  const deletingId = deleteNotification.isPending
    ? (deleteNotification.variables as string | undefined)
    : undefined;

  const handleMarkAllRead = useCallback(() => {
    markAllRead.mutate();
  }, [markAllRead]);

  const handleLoadMore = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) {
      fetchNextPage();
    }
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const renderItem = useCallback(
    ({ item }: { item: AppNotification }) => (
      <NotificationItem
        notification={item}
        onPress={handleItemPress}
        onDelete={handleDelete}
        isDeleting={item.id === deletingId}
      />
    ),
    [handleItemPress, handleDelete, deletingId],
  );

  const renderFooter = useCallback(() => {
    if (!isFetchingNextPage) return null;
    return (
      <View style={styles.footer}>
        <ActivityIndicator size="small" color={Colors.primary} />
      </View>
    );
  }, [isFetchingNextPage, Colors.primary]);

  const renderEmpty = useCallback(() => {
    if (isLoading) return null;
    return (
      <View style={styles.emptyContainer}>
        <View
          style={[
            styles.emptyIconContainer,
            { backgroundColor: Colors.borderLight },
          ]}
        >
          <Bell size={40} color={Colors.textTertiary} />
        </View>
        <AppText variant="display" style={[styles.emptyTitle, { color: Colors.text }]}>
          No notifications yet
        </AppText>
        <AppText variant="body" style={[styles.emptySubtext, { color: Colors.textSecondary }]}>
          We'll let you know when something happens with your plans, friends,
          and group sessions.
        </AppText>
      </View>
    );
  }, [isLoading, Colors]);

  return (
    <View
      style={[
        styles.container,
        { paddingTop: insets.top, backgroundColor: Colors.background },
      ]}
    >
      {/* Header */}
      <View
        style={[
          styles.header,
          { backgroundColor: Colors.background, borderBottomColor: Colors.border },
        ]}
      >
        <Pressable
          onPress={() =>
            router.canGoBack()
              ? router.back()
              : router.push('/(tabs)/(home)' as never)
          }
          style={styles.backBtn}
          accessibilityLabel="Go back"
          accessibilityRole="button"
        >
          <ArrowLeft size={24} color={Colors.text} />
        </Pressable>
        <AppText variant="display" style={[styles.headerTitle, { color: Colors.text }]}>
          Notifications
        </AppText>
        {notifications.length > 0 && (
          <Pressable
            onPress={handleMarkAllRead}
            disabled={markAllRead.isPending}
            style={[styles.markAllBtn, markAllRead.isPending && styles.markAllBtnPending]}
            accessibilityLabel="Mark all as read"
            accessibilityRole="button"
            accessibilityState={{ disabled: markAllRead.isPending }}
          >
            {markAllRead.isPending ? (
              <ActivityIndicator size="small" color={Colors.primary} />
            ) : (
              <CheckCheck size={20} color={Colors.primary} />
            )}
          </Pressable>
        )}
      </View>

      {/* Loading state */}
      {isLoading ? (
        <View style={[styles.container, styles.centered]}>
          <ActivityIndicator size="large" color={Colors.primary} />
        </View>
      ) : (
        <FlatList
          data={notifications}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          ListEmptyComponent={renderEmpty}
          ListFooterComponent={renderFooter}
          onEndReached={handleLoadMore}
          onEndReachedThreshold={0.3}
          onRefresh={() => refetch()}
          refreshing={isRefetching && !isFetchingNextPage}
          contentContainerStyle={
            notifications.length === 0 ? styles.emptyListContent : undefined
          }
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
  centered: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.border,
  },
  backBtn: {
    padding: 4,
    marginRight: 12,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '700' as const,
    color: Colors.text,
    flex: 1,
  },
  markAllBtn: {
    padding: 6,
  },
  markAllBtnPending: {
    opacity: 0.6,
  },
  footer: {
    paddingVertical: 20,
    alignItems: 'center',
  },
  emptyListContent: {
    flex: 1,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 40,
    paddingBottom: 80,
  },
  emptyIconContainer: {
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '700' as const,
    color: Colors.text,
    marginBottom: 8,
    textAlign: 'center',
  },
  emptySubtext: {
    fontSize: 14,
    color: Colors.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
  },
});
