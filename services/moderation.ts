import { api } from './api';

// #321 — UGC safety: blocking + reporting.

export interface BlockedUser {
  id: string;
  _id?: string;
  name: string;
  avatarUri?: string;
}

export type ReportTargetType = 'user' | 'plan';
export type ReportReason =
  | 'inappropriate_content'
  | 'harassment'
  | 'spam'
  | 'impersonation'
  | 'other';

export const REPORT_REASON_LABELS: { value: ReportReason; label: string }[] = [
  { value: 'inappropriate_content', label: 'Inappropriate content' },
  { value: 'harassment', label: 'Harassment or bullying' },
  { value: 'spam', label: 'Spam' },
  { value: 'impersonation', label: 'Impersonation' },
  { value: 'other', label: 'Something else' },
];

export async function blockUser(userId: string): Promise<{ ok: boolean }> {
  return api.post<{ ok: boolean }>(`/users/${userId}/block`, {});
}

export async function unblockUser(userId: string): Promise<{ ok: boolean }> {
  return api.delete<{ ok: boolean }>(`/users/${userId}/block`);
}

export async function getBlockedUsers(): Promise<BlockedUser[]> {
  return api.get<BlockedUser[]>('/users/me/blocked');
}

export async function reportTarget(
  targetType: ReportTargetType,
  targetId: string,
  reason: ReportReason,
  detail?: string,
): Promise<{ ok: boolean; duplicate?: boolean }> {
  return api.post<{ ok: boolean; duplicate?: boolean }>('/reports', {
    targetType,
    targetId,
    reason,
    detail,
  });
}
