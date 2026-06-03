import { api, setToken, clearToken } from './api';
import { BackendUser, UserPreferences } from '../types';

interface InvitedByInfo {
  id: string;
  name: string;
  avatarUri?: string;
}

interface AuthResponse {
  token: string;
  user: BackendUser;
  invitedBy?: InvitedByInfo | null;
}

export type { AuthResponse, InvitedByInfo };

export async function register(
  name: string,
  email: string,
  password: string,
  phone?: string,
  inviteCode?: string
): Promise<AuthResponse> {
  const res = await api.post<AuthResponse>(
    '/auth/register',
    { name, email, password, phone, ...(inviteCode ? { inviteCode } : {}) },
    { skipSessionExpiry: true }
  );
  await setToken(res.token);
  return res;
}

export async function login(email: string, password: string): Promise<AuthResponse> {
  const res = await api.post<AuthResponse>(
    '/auth/login',
    { email, password },
    { skipSessionExpiry: true }
  );
  await setToken(res.token);
  return res;
}

export async function logout(): Promise<void> {
  await clearToken();
  // NOTE: React Query cache should be cleared by the caller (e.g. AuthContext.signOut)
  // to avoid a circular dependency between services and context layers.
}

export async function getMe(): Promise<BackendUser> {
  return api.get<BackendUser>('/users/me');
}

export async function updateProfile(updates: {
  name?: string;
  phone?: string;
  avatarUri?: string;
  preferences?: UserPreferences;
  favorites?: string[];
}): Promise<BackendUser> {
  return api.put<BackendUser>('/users/me', updates);
}

export async function registerPushToken(pushToken: string): Promise<void> {
  await api.post('/users/push-token', { pushToken });
}

/** POST /auth/forgot-password — requests an OTP for the given email */
export async function requestPasswordReset(email: string): Promise<{ ok: boolean }> {
  return api.post<{ ok: boolean }>(
    '/auth/forgot-password',
    { email },
    { skipSessionExpiry: true }
  );
}

/** POST /auth/reset-password — submits the OTP + new password */
export async function resetPassword(
  email: string,
  code: string,
  newPassword: string
): Promise<{ ok: boolean }> {
  return api.post<{ ok: boolean }>(
    '/auth/reset-password',
    { email, code, newPassword },
    { skipSessionExpiry: true }
  );
}
