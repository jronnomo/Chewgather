import { api } from './api';
import { DiningPlan, PlanPhase, Restaurant } from '../types';

export interface CreatePlanInput {
  type?: 'planned' | 'group-swipe';
  title: string;
  date?: string;
  time?: string;
  cuisine: string;
  budget: string;
  status?: string;
  restaurant?: { id: string; name: string; imageUrl: string; address: string; cuisine: string; priceLevel: number; rating: number };
  inviteeIds?: string[];
  rsvpDeadline?: string;
  options?: string[];
  restaurantOptions?: Restaurant[];
  restaurantCount?: number;
  allowCurveball?: boolean;
  curveballIds?: string[];
  visibility?: 'public' | 'private' | 'friends_request';
}

export async function getPlans(): Promise<DiningPlan[]> {
  return api.get<DiningPlan[]>('/plans');
}

export async function getPlan(id: string): Promise<DiningPlan> {
  return api.get<DiningPlan>(`/plans/${id}`);
}

export async function createPlan(input: CreatePlanInput): Promise<DiningPlan> {
  return api.post<DiningPlan>('/plans', input);
}

export async function updatePlan(id: string, input: Partial<CreatePlanInput>): Promise<DiningPlan> {
  return api.put<DiningPlan>(`/plans/${id}`, input);
}

export async function rsvpPlan(
  planId: string,
  action: 'accept' | 'decline'
): Promise<void> {
  await api.post(`/plans/${planId}/rsvp`, { action });
}

export async function submitSwipes(
  planId: string,
  votes: string[]
): Promise<DiningPlan> {
  return api.post<DiningPlan>(`/plans/${planId}/swipe`, { votes });
}

/**
 * Derive the current phase of a plan based on its type, status, and RSVP deadline.
 * This is computed (not stored) so it's always up-to-date.
 */
export function derivePlanPhase(plan: DiningPlan): PlanPhase {
  // Terminal states pass through
  if (plan.status === 'confirmed') return 'confirmed';
  if (plan.status === 'completed') return 'completed';
  if (plan.status === 'cancelled') return 'cancelled';

  // Group-swipe plans don't have RSVP phases
  if (plan.type === 'group-swipe') return 'voting_open';

  // Planned events: check RSVP deadline
  if (plan.rsvpDeadline) {
    const deadline = new Date(plan.rsvpDeadline);
    // If all invitees have responded (none pending), skip straight to voting
    const hasPending = plan.invites?.some(i => i.status === 'pending') ?? false;
    if (deadline.getTime() > Date.now() && hasPending) {
      return 'rsvp_open';
    }
    return 'voting_open';
  }

  // No deadline set — treat as voting open
  return 'voting_open';
}

export async function cancelPlan(planId: string): Promise<DiningPlan> {
  return api.put<DiningPlan>(`/plans/${planId}/status`, { status: 'cancelled' });
}

export async function completePlan(planId: string): Promise<DiningPlan> {
  return api.put<DiningPlan>(`/plans/${planId}/status`, { status: 'completed' });
}

/**
 * #323: owner "End Voting" — confirm a voting plan now, tallying whatever
 * votes exist instead of waiting for every participant to finish swiping.
 */
export async function confirmPlan(planId: string): Promise<DiningPlan> {
  return api.put<DiningPlan>(`/plans/${planId}/status`, { status: 'confirmed' });
}

export async function delegateOrganizer(planId: string, newOwnerId: string): Promise<DiningPlan> {
  return api.post<DiningPlan>(`/plans/${planId}/delegate`, { newOwnerId });
}

export async function leavePlan(planId: string): Promise<{ ok: boolean; autoCancelled: boolean }> {
  return api.post<{ ok: boolean; autoCancelled: boolean }>(`/plans/${planId}/leave`, {});
}

export type ResolveWinnerAction = 'reschedule' | 'switch' | 'keep' | 'dismiss';

export interface ResolveWinnerPayload {
  action: ResolveWinnerAction;
  time?: string;          // for 'reschedule' (e.g. "7:00 PM")
  date?: string;          // for 'reschedule' + next-open-day (e.g. "2026-06-07")
  restaurantId?: string;  // for 'switch'
}

export async function resolveWinner(
  planId: string,
  payload: ResolveWinnerPayload,
): Promise<DiningPlan> {
  return api.post<DiningPlan>(`/plans/${planId}/resolve-winner`, payload);
}

export async function requestToJoin(planId: string): Promise<{ ok: boolean; status: string }> {
  return api.post<{ ok: boolean; status: string }>(`/plans/${planId}/request-join`, {});
}

export async function approveJoinRequest(planId: string, userId: string): Promise<DiningPlan> {
  return api.post<DiningPlan>(`/plans/${planId}/request-join/${userId}/approve`, {});
}

export async function denyJoinRequest(planId: string, userId: string): Promise<DiningPlan> {
  return api.post<DiningPlan>(`/plans/${planId}/request-join/${userId}/deny`, {});
}

export async function getDiscoverFeed(): Promise<DiningPlan[]> {
  return api.get<DiningPlan[]>('/plans/discover');
}
