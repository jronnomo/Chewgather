import React, { useRef } from 'react';
import {
  View,
  StyleSheet,
  Pressable,
  ActivityIndicator,
  Animated as RNAnimated,
} from 'react-native';
import AppText from '@/components/AppText';
import Swipeable from 'react-native-gesture-handler/Swipeable';
import {
  CalendarDays,
  Users,
  UserPlus,
  UserCheck,
  UserMinus,
  MessageSquare,
  Trash2,
  X,
  Crown,
} from 'lucide-react-native';
import StaticColors from '../constants/colors';
import { useColors } from '../context/ThemeContext';
import { AppNotification, NotificationType } from '../types';

const Colors = StaticColors;

// ── Helpers ────────────────────────────────────────────────────

function getIconForType(type: NotificationType, color: string) {
  switch (type) {
    case 'plan_invite':
    case 'plan_reminder':
      return <CalendarDays size={22} color={color} />;
    case 'group_swipe_invite':
    case 'group_swipe_result':
    case 'swipe_completed':
      return <Users size={22} color={color} />;
    case 'friend_request':
      return <UserPlus size={22} color={color} />;
    case 'friend_accepted':
      return <UserCheck size={22} color={color} />;
    case 'rsvp_response':
      return <MessageSquare size={22} color={color} />;
    case 'plan_cancelled':
    case 'plan_auto_cancelled':
      return <X size={22} color={color} />;
    case 'organizer_delegated':
    case 'organizer_changed':
      return <Crown size={22} color={color} />;
    case 'participant_left':
      return <UserMinus size={22} color={color} />;
    default:
      return <CalendarDays size={22} color={color} />;
  }
}

function formatRelativeTime(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;

  if (diffMs < 0) return 'just now';

  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 60) return 'just now';

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days}d ago`;

  const weeks = Math.floor(days / 7);
  if (weeks < 4) return `${weeks}w ago`;

  return new Date(dateStr).toLocaleDateString();
}

// ── Props ──────────────────────────────────────────────────────

interface NotificationItemProps {
  notification: AppNotification;
  onPress: (notification: AppNotification) => void;
  onDelete: (id: string) => void;
  /** True while this notification's delete mutation is in flight. */
  isDeleting?: boolean;
}

// ── Component ──────────────────────────────────────────────────

export default function NotificationItem({
  notification,
  onPress,
  onDelete,
  isDeleting = false,
}: NotificationItemProps) {
  const Colors = useColors();
  const swipeableRef = useRef<Swipeable>(null);

  const renderRightActions = (
    _progress: RNAnimated.AnimatedInterpolation<number>,
    dragX: RNAnimated.AnimatedInterpolation<number>,
  ) => {
    const scale = dragX.interpolate({
      inputRange: [-80, 0],
      outputRange: [1, 0.5],
      extrapolate: 'clamp',
    });

    return (
      <Pressable
        onPress={() => {
          swipeableRef.current?.close();
          onDelete(notification.id);
        }}
        style={styles.deleteAction}
        accessibilityLabel="Delete notification"
        accessibilityRole="button"
      >
        <RNAnimated.View style={{ transform: [{ scale }] }}>
          <Trash2 size={20} color="#FFFFFF" />
        </RNAnimated.View>
      </Pressable>
    );
  };

  const isUnread = !notification.read;

  return (
    <Swipeable
      ref={swipeableRef}
      renderRightActions={renderRightActions}
      rightThreshold={40}
      overshootRight={false}
    >
      <Pressable
        onPress={() => onPress(notification)}
        disabled={isDeleting}
        style={[
          styles.container,
          {
            backgroundColor: isUnread ? Colors.primaryLight : Colors.card,
            borderLeftColor: isUnread ? Colors.primary : 'transparent',
            borderLeftWidth: isUnread ? 3 : 0,
            borderBottomColor: Colors.divider,
            opacity: isDeleting ? 0.5 : 1,
          },
        ]}
        accessibilityLabel={`${notification.title}. ${notification.body}. ${isUnread ? 'Unread' : 'Read'}${isDeleting ? '. Deleting' : ''}`}
        accessibilityRole="button"
      >
        <View
          style={[
            styles.iconContainer,
            { backgroundColor: isUnread ? Colors.primary : Colors.border },
          ]}
        >
          {getIconForType(
            notification.type,
            isUnread ? '#FFFFFF' : Colors.textSecondary,
          )}
        </View>
        <View style={styles.content}>
          <AppText
            variant="dense"
            style={[
              styles.title,
              {
                color: Colors.text,
                fontWeight: isUnread ? '700' : '500',
              },
            ]}
            numberOfLines={1}
            ellipsizeMode="tail"
          >
            {notification.title}
          </AppText>
          <AppText
            variant="dense"
            style={[styles.body, { color: Colors.textSecondary }]}
            numberOfLines={2}
            ellipsizeMode="tail"
          >
            {notification.body}
          </AppText>
          <AppText variant="dense" style={[styles.time, { color: Colors.textTertiary }]}>
            {formatRelativeTime(notification.createdAt)}
          </AppText>
        </View>
        {isDeleting ? (
          <ActivityIndicator size="small" color={Colors.textTertiary} style={styles.trailingSpinner} />
        ) : (
          isUnread && (
            <View style={[styles.unreadDot, { backgroundColor: Colors.primary }]} />
          )
        )}
      </Pressable>
    </Swipeable>
  );
}

// ── Styles ─────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
    backgroundColor: Colors.card,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.divider,
  },
  iconContainer: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  content: {
    flex: 1,
  },
  title: {
    fontSize: 15,
    color: Colors.text,
    marginBottom: 2,
  },
  body: {
    fontSize: 13,
    color: Colors.textSecondary,
    lineHeight: 18,
  },
  time: {
    fontSize: 12,
    color: Colors.textTertiary,
    marginTop: 4,
  },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginLeft: 8,
  },
  trailingSpinner: {
    marginLeft: 8,
  },
  deleteAction: {
    backgroundColor: '#FF3B30',
    justifyContent: 'center',
    alignItems: 'center',
    width: 80,
  },
});
