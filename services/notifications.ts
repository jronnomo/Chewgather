import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { registerPushToken } from './auth';
import { api } from './api';
import { AppNotification } from '../types';

// ── Push permission & registration (existing) ──────────────────

export async function requestNotificationPermissions(): Promise<boolean> {
  if (Platform.OS === 'web') return false;

  const { status: existing } = await Notifications.getPermissionsAsync();
  if (existing === 'granted') return true;

  const { status } = await Notifications.requestPermissionsAsync();
  return status === 'granted';
}

/**
 * Read the current OS notification-permission state WITHOUT prompting.
 * Used to detect when the in-app toggle diverges from the device setting.
 */
export async function getNotificationPermissionStatus(): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  const { status } = await Notifications.getPermissionsAsync();
  return status === 'granted';
}

export async function registerForPushNotifications(): Promise<string | null> {
  const granted = await requestNotificationPermissions();
  if (!granted) return null;

  const projectId = process.env.EXPO_PUBLIC_PROJECT_ID;
  if (!projectId) {
    console.warn('[Push] EXPO_PUBLIC_PROJECT_ID not set — skipping push token registration');
    return null;
  }

  try {
    const token = await Notifications.getExpoPushTokenAsync({ projectId });
    // Token obtained — try to register with backend (non-critical)
    try {
      await registerPushToken(token.data);
    } catch {
      // Backend unavailable — token saved locally, will sync on next launch
    }
    return token.data;
  } catch (err) {
    // Push tokens unavailable (e.g., simulator, no network to Expo servers)
    console.warn('[Push] Push token unavailable:', err);
    return null;
  }
}

export function configurePushHandler(): void {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldPlaySound: true,
      shouldSetBadge: true,
      shouldShowBanner: true,
      shouldShowList: true,
    }),
  });
}

/**
 * Reset the OS app-icon badge count to zero. Call this when the user views
 * the notification center — the badge increments via `shouldSetBadge` but is
 * never otherwise cleared.
 */
export async function clearBadgeCount(): Promise<void> {
  if (Platform.OS === 'web') return;
  try {
    await Notifications.setBadgeCountAsync(0);
  } catch (err) {
    console.warn('[Push] Failed to clear badge count:', err);
  }
}

// ── Notification API calls ──────────────────────────────────────

interface NotificationListResponse {
  notifications: AppNotification[];
  total: number;
  page: number;
  totalPages: number;
}

export async function getNotifications(page = 1, limit = 20): Promise<NotificationListResponse> {
  return api.get<NotificationListResponse>(`/notifications?page=${page}&limit=${limit}`);
}

export async function getUnreadCount(): Promise<{ count: number }> {
  return api.get<{ count: number }>('/notifications/unread-count');
}

export async function markNotificationRead(id: string): Promise<AppNotification> {
  return api.put<AppNotification>(`/notifications/${id}/read`, {});
}

export async function markAllNotificationsRead(): Promise<{ ok: boolean; modifiedCount: number }> {
  return api.put<{ ok: boolean; modifiedCount: number }>('/notifications/read-all', {});
}

export async function deleteNotification(id: string): Promise<{ ok: boolean }> {
  return api.delete<{ ok: boolean }>(`/notifications/${id}`);
}

// ── Local plan reminder scheduling ──────────────────────────────

const REMINDER_KEY_PREFIX = 'chewabl_plan_reminder_';

export async function scheduleLocalPlanReminder(
  planId: string,
  planTitle: string,
  planDateTime: Date,
): Promise<void> {
  const triggerDate = new Date(planDateTime.getTime() - 60 * 60 * 1000); // 1 hour before
  if (triggerDate.getTime() <= Date.now()) return; // Already past

  const id = await Notifications.scheduleNotificationAsync({
    content: {
      title: 'Plan Reminder',
      body: `"${planTitle}" is in 1 hour!`,
      data: { type: 'plan_reminder', planId },
    },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: triggerDate },
  });

  await AsyncStorage.setItem(`${REMINDER_KEY_PREFIX}${planId}`, id);
}

export async function cancelLocalPlanReminder(planId: string): Promise<void> {
  const id = await AsyncStorage.getItem(`${REMINDER_KEY_PREFIX}${planId}`);
  if (id) {
    await Notifications.cancelScheduledNotificationAsync(id);
    await AsyncStorage.removeItem(`${REMINDER_KEY_PREFIX}${planId}`);
  }
}
