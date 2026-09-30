import { Expo, ExpoPushMessage, ExpoPushTicket } from 'expo-server-sdk';
import { recordUpstreamCall } from './upstreamHealth';

const expo = new Expo();

// Ticket-level errors like DeviceNotRegistered are per-token, not upstream health;
// only a rate-limit ticket counts as an upstream failure.
async function sendChunk(chunk: ExpoPushMessage[]): Promise<void> {
  let tickets: ExpoPushTicket[];
  try {
    tickets = await expo.sendPushNotificationsAsync(chunk);
  } catch (err) {
    recordUpstreamCall('expoPush', err);
    throw err;
  }
  const rateLimited = tickets.some(t => t.status === 'error' && t.details?.error === 'MessageRateExceeded');
  recordUpstreamCall('expoPush', rateLimited ? '429' : undefined);
}

export async function sendPushNotification(
  pushToken: string,
  title: string,
  body: string,
  data?: Record<string, unknown>
): Promise<void> {
  if (!Expo.isExpoPushToken(pushToken)) {
    console.warn('Invalid Expo push token:', pushToken);
    return;
  }

  const message: ExpoPushMessage = {
    to: pushToken,
    sound: 'default',
    title,
    body,
    data,
  };

  try {
    const chunks = expo.chunkPushNotifications([message]);
    for (const chunk of chunks) {
      await sendChunk(chunk);
    }
  } catch (err) {
    console.error('Push notification error:', err);
  }
}

export async function sendPushToMany(
  tokens: string[],
  title: string,
  body: string,
  data?: Record<string, unknown>
): Promise<void> {
  const validMessages: ExpoPushMessage[] = tokens
    .filter(t => Expo.isExpoPushToken(t))
    .map(to => ({ to, sound: 'default' as const, title, body, data }));

  if (validMessages.length === 0) return;

  try {
    const chunks = expo.chunkPushNotifications(validMessages);
    for (const chunk of chunks) {
      await sendChunk(chunk);
    }
  } catch (err) {
    console.error('Batch push error:', err);
  }
}
