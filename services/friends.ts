import { api } from './api';
import { Friend, FriendRequest } from '../types';

interface LookupUser {
  id: string;
  name: string;
  phone?: string;
  avatarUri?: string;
  inviteCode: string;
  mutualPlans?: number;
}

export async function getFriends(): Promise<Friend[]> {
  const users = await api.get<LookupUser[]>('/friends');
  return users.map(u => ({
    id: u.id,
    name: u.name,
    phone: u.phone,
    avatarUri: u.avatarUri,
    mutualPlans: u.mutualPlans,
  }));
}

export async function getFriendRequests(): Promise<FriendRequest[]> {
  return api.get<FriendRequest[]>('/friends/requests');
}

export async function sendFriendRequest(userId: string): Promise<void> {
  await api.post('/friends/request', { userId });
}

export async function respondToRequest(
  friendshipId: string,
  action: 'accept' | 'decline'
): Promise<void> {
  await api.put(`/friends/request/${friendshipId}`, { action });
}

export async function removeFriend(friendshipId: string): Promise<void> {
  await api.delete(`/friends/${friendshipId}`);
}

export async function lookupByPhones(phones: string[]): Promise<LookupUser[]> {
  return api.post<LookupUser[]>('/users/lookup', { phones });
}

export async function lookupByInviteCode(code: string): Promise<LookupUser | null> {
  try {
    return await api.get<LookupUser>(`/users/invite/${code}`);
  } catch (err: unknown) {
    // Only treat "not found" as a null result; re-throw auth/network/server errors
    if (err instanceof Error && err.message === 'Invite code not found') {
      return null;
    }
    throw err;
  }
}
