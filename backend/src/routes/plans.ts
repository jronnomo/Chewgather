import { Router, Response } from 'express';
import mongoose from 'mongoose';
import { requireAuth, AuthRequest } from '../middleware/auth';
import Plan, { IOpeningPeriod } from '../models/Plan';
import User from '../models/User';
import Friendship from '../models/Friendship';
import { createNotification, createNotificationForMany } from '../utils/createNotification';
import { tallyWinner, tallyRanked } from '../utils/tallyVotes';
import { isAcceptedFriend } from '../utils/friendships';
import { isBlockedBetween, blockedIdSetFor } from '../utils/blocking';
import { isClean } from '../utils/contentFilter';

// ---------------------------------------------------------------------------
// Backend-local isOpenAt — mirrors lib/restaurantHours.ts but lives here so
// the backend (rootDir: ./src) does not depend on the root lib/ folder.
// Keep in sync if lib/restaurantHours.ts logic changes.
// ---------------------------------------------------------------------------
function isOpenAt(periods: IOpeningPeriod[] | undefined, eventDate: Date): boolean {
  if (periods === undefined) return true;
  if (periods.length === 0) return false;

  const eventDay = eventDate.getDay();
  const eventMinutes = eventDate.getHours() * 60 + eventDate.getMinutes();

  for (const period of periods) {
    if (!period.close) return true; // 24/7 venue

    const openDay = period.open.day;
    const openMin = period.open.hour * 60 + period.open.minute;
    const closeDay = period.close.day;
    const closeMin = period.close.hour * 60 + period.close.minute;

    if (openDay === closeDay) {
      if (eventDay === openDay && eventMinutes >= openMin && eventMinutes < closeMin) return true;
      continue;
    }

    // Period crosses midnight
    if (eventDay === openDay && eventMinutes >= openMin) return true;
    if (eventDay === closeDay && eventMinutes < closeMin) return true;
  }

  return false;
}

// ---------------------------------------------------------------------------
// Parse plan date+time string into wall-clock eventDate.
// Parse plan date/time as restaurant-local wall-clock. Use the plain local
// constructor (NOT Date.UTC): isOpenAt reads getDay()/getHours(), so building
// in host-local and reading in host-local cancels out — correct on ANY host
// (UTC on Railway, or local dev). Date.UTC would only be right on a UTC host.
// No offset arithmetic — plan time IS wall-clock. Matches client planDateTime.ts.
// Returns null on parse failure.
// ---------------------------------------------------------------------------
function parsePlanEventDate(date: string, time: string): Date | null {
  const parts = date.split('-').map(Number);
  if (parts.length !== 3) return null;
  const [year, month, day] = parts;
  const timeMatch = time.match(/^(\d+):(\d+)\s*(AM|PM)$/i);
  if (!timeMatch) return null;
  let h = parseInt(timeMatch[1], 10);
  const m = parseInt(timeMatch[2], 10);
  if (timeMatch[3].toUpperCase() === 'PM' && h !== 12) h += 12;
  if (timeMatch[3].toUpperCase() === 'AM' && h === 12) h = 0;
  return new Date(year, month - 1, day, h, m);
}

// ---------------------------------------------------------------------------
// detectClosedWinner — call after plan.save() on all confirm paths.
// Checks if the confirmed winner is closed at the plan time and sets
// plan.winnerClosedAt + emits plan_winner_closed to owner only.
// Caller must save plan again after this returns (helper modifies plan in place).
// ---------------------------------------------------------------------------
async function detectClosedWinner(plan: InstanceType<typeof Plan>): Promise<void> {
  // Guard: planned type only, must have date + time + confirmed restaurant
  if (plan.type !== 'planned') return;
  if (!plan.date || !plan.time || !plan.restaurant) return;
  // openingPeriods === undefined → treat as open; no alert (back-compat for old plans)
  if (plan.restaurant.openingPeriods === undefined) return;

  const eventDate = parsePlanEventDate(plan.date, plan.time);
  if (!eventDate) return;

  // Skip past events
  if (eventDate.getTime() <= Date.now()) return;

  const closed = !isOpenAt(plan.restaurant.openingPeriods, eventDate);
  if (!closed) return;

  plan.winnerClosedAt = new Date();
  // Reset member-notification dedup so re-closed plans still notify members
  plan.winnerClosedMembersNotified = false;

  await createNotification({
    userId: plan.ownerId.toString(),
    type: 'plan_winner_closed',
    title: 'Heads up',
    body: `${plan.restaurant.name} may be closed at your "${plan.title}" time. Tap to reschedule or switch.`,
    data: { planId: plan._id.toString() },
  });
}

const router = Router();

// Get all plans the current user owns or is invited to
router.get('/', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const plans = await Plan.find({
      $or: [
        { ownerId: req.userId },
        { 'invites.userId': req.userId },
      ],
    }).sort({ createdAt: -1 });

    // Collect all user IDs (owners + invitees) to fetch fresh avatars
    const allUserIds = new Set<string>();
    for (const p of plans) {
      allUserIds.add(p.ownerId.toString());
      for (const inv of p.invites) allUserIds.add(inv.userId.toString());
    }
    const users = await User.find({ _id: { $in: [...allUserIds] } }, 'name avatarUri').lean();
    const userMap = new Map(users.map(u => [u._id.toString(), { name: u.name, avatarUri: (u as any).avatarUri }]));

    const enriched = plans.map(p => {
      const ownerInfo = userMap.get(p.ownerId.toString());
      const planJson = p.toJSON();
      // Freshen invite avatars from current user data
      if (planJson.invites) {
        planJson.invites = planJson.invites.map((inv: any) => {
          const fresh = userMap.get(inv.userId.toString());
          return fresh ? { ...inv, avatarUri: fresh.avatarUri } : inv;
        });
      }
      return { ...planJson, ownerName: ownerInfo?.name, ownerAvatarUri: ownerInfo?.avatarUri };
    });

    res.json(enriched);
  } catch {
    res.status(500).json({ error: 'Server error' });
  }
});

// REQ-007: Discover feed — friend-owned public/friends_request plans
// IMPORTANT: This route MUST be registered BEFORE router.get('/:id', ...) so that
// Express does not match the string "discover" as an :id parameter.
router.get('/discover', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const requesterId = req.userId!;
    const requesterOid = new mongoose.Types.ObjectId(requesterId);

    // Load accepted-friend ObjectIds (mirrors restaurants.ts pattern)
    const friendships = await Friendship.find({
      $or: [{ requester: requesterOid }, { recipient: requesterOid }],
      status: 'accepted',
    });
    if (friendships.length === 0) {
      res.json([]);
      return;
    }
    const friendOidsAll = friendships.map(f =>
      f.requester.toString() === requesterId ? f.recipient : f.requester
    );
    // #321: block relationships (either direction) remove a user's plans from
    // the feed. Blocking also severs the friendship, so this mainly covers
    // pre-existing sessions and race windows — cheap belt-and-braces.
    const blockedSet = await blockedIdSetFor(requesterId);
    const friendOids = friendOidsAll.filter(oid => !blockedSet.has(oid.toString()));

    const now = new Date();
    const plans = await Plan.find({
      ownerId: { $in: friendOids },
      visibility: { $in: ['public', 'friends_request'] },
      status: 'voting',
      $or: [
        { rsvpDeadline: { $exists: false } },
        { rsvpDeadline: { $gt: now } },
      ],
    })
      .sort({ updatedAt: -1 })
      .limit(50);

    // Filter out plans where the requester is already an invitee
    const notParticipating = plans.filter(
      p => !p.invites.some(i => i.userId.toString() === requesterId)
    );

    // Collect owner IDs for enrichment
    const ownerIds = [...new Set(notParticipating.map(p => p.ownerId.toString()))];
    const owners = await User.find({ _id: { $in: ownerIds } }, 'name avatarUri').lean();
    const ownerMap = new Map(
      owners.map(u => [u._id.toString(), { name: u.name, avatarUri: (u as any).avatarUri }])
    );

    // Collect all invitee IDs for fresh avatar enrichment
    const allInviteeIds = new Set<string>();
    for (const p of notParticipating) {
      for (const inv of p.invites) allInviteeIds.add(inv.userId.toString());
    }
    const inviteeUsers = await User.find({ _id: { $in: [...allInviteeIds] } }, 'name avatarUri').lean();
    const inviteeMap = new Map(
      inviteeUsers.map(u => [u._id.toString(), { name: u.name, avatarUri: (u as any).avatarUri }])
    );

    const enriched = notParticipating.map(p => {
      const ownerInfo = ownerMap.get(p.ownerId.toString());
      const planJson = p.toJSON() as Record<string, unknown>;

      // Freshen invite avatars
      if (Array.isArray(planJson.invites)) {
        planJson.invites = (planJson.invites as Array<Record<string, unknown>>).map(inv => {
          const fresh = inviteeMap.get(String(inv.userId));
          return fresh ? { ...inv, avatarUri: fresh.avatarUri } : inv;
        });
      }

      // Per-plan myJoinRequestStatus
      const myRequest = p.joinRequests.find(r => r.userId.toString() === requesterId);
      const myJoinRequestStatus: string | null = myRequest ? myRequest.status : null;

      // Pre-join trim: non-participants do not see votes or swipesCompleted
      delete planJson.votes;
      delete planJson.swipesCompleted;

      return {
        ...planJson,
        ownerName: ownerInfo?.name,
        ownerAvatarUri: ownerInfo?.avatarUri,
        myJoinRequestStatus,
      };
    });

    res.json(enriched);
  } catch (err) {
    console.error('GET /plans/discover error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get single plan with check-on-access auto-decline
router.get('/:id', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const plan = await Plan.findById(req.params.id);
    if (!plan) { res.status(404).json({ error: 'Plan not found' }); return; }

    // REQ-004: Authorization guard
    const userId = req.userId!;
    const isOwner = plan.ownerId.toString() === userId;
    // isInvitee: only active (non-declined) invite entries count for participant privileges
    const isInvitee = plan.invites.some(
      i => i.userId.toString() === userId && i.status !== 'declined'
    );

    let allowed = isOwner || isInvitee;
    if (!allowed) {
      if (plan.visibility === 'public') {
        allowed = true;
      } else if (plan.visibility === 'friends_request') {
        allowed = await isAcceptedFriend(userId, plan.ownerId.toString());
      }
    }
    if (!allowed) {
      res.status(404).json({ error: 'Plan not found' });
      return;
    }

    // Check-on-access: auto-decline pending invites if RSVP deadline passed
    // v2 (CI-2): ONLY run for plan participants — non-participant public/friends_request
    // readers must never trigger mutations or notifications on a plan they don't own.
    if (isOwner || isInvitee) {
      if (plan.type === 'planned' && plan.status === 'voting' && plan.rsvpDeadline && plan.rsvpDeadline.getTime() <= Date.now()) {
        const pendingInvites = plan.invites.filter(i => i.status === 'pending');
        if (pendingInvites.length > 0) {
          for (const invite of pendingInvites) {
            invite.status = 'declined';
            invite.respondedAt = new Date();
          }
          await plan.save();

          // Fire notifications asynchronously (don't block the response)
          setImmediate(async () => {
            try {
              for (const invite of pendingInvites) {
                await createNotification({
                  userId: invite.userId.toString(),
                  type: 'rsvp_deadline_passed' as any,
                  title: 'RSVP Deadline Passed',
                  body: `You didn't respond to "${plan.title}" in time.`,
                  data: { planId: plan.id },
                });
                await createNotification({
                  userId: plan.ownerId.toString(),
                  type: 'rsvp_deadline_missed_organizer' as any,
                  title: 'RSVP Deadline Missed',
                  body: `${invite.name} didn't respond to "${plan.title}" before the deadline.`,
                  data: { planId: plan.id },
                });
              }
            } catch (err) {
              console.error('Check-on-access notification error:', err);
            }
          });
        }
      }
    } // end participant-only guard

    const owner = await User.findById(plan.ownerId, 'name avatarUri').lean();
    const planJson = { ...plan.toJSON(), ownerName: owner?.name, ownerAvatarUri: (owner as any)?.avatarUri } as Record<string, unknown>;

    // REQ-004: Pre-join trim — non-participants do not see votes or swipesCompleted
    if (!isOwner && !isInvitee) {
      delete planJson.votes;
      delete planJson.swipesCompleted;
    }

    res.json(planJson);
  } catch {
    res.status(500).json({ error: 'Server error' });
  }
});

// Request-to-join: submit request
router.post('/:id/request-join', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const plan = await Plan.findById(req.params.id);
    if (!plan) { res.status(404).json({ error: 'Plan not found' }); return; }

    const userId = req.userId!;

    // Block: private plans are invite-only
    if (plan.visibility === 'private') {
      res.status(403).json({ error: 'This plan is invite-only' });
      return;
    }

    // Block: requester is the owner
    if (plan.ownerId.toString() === userId) {
      res.status(400).json({ error: "You own this plan" });
      return;
    }

    // #321: block relationship with the owner (either direction) — same
    // message as the private-plan case so nothing is revealed.
    if (await isBlockedBetween(userId, plan.ownerId.toString())) {
      res.status(403).json({ error: 'This plan is invite-only' });
      return;
    }

    // Block: requester already has ANY invites[] entry (CI-1: no status filter)
    if (plan.invites.some(i => i.userId.toString() === userId)) {
      res.status(400).json({ error: "You're already on the guest list" });
      return;
    }

    // Eligibility check
    if (plan.visibility === 'friends_request') {
      const friend = await isAcceptedFriend(userId, plan.ownerId.toString());
      if (!friend) {
        res.status(403).json({ error: 'Only friends can request to join' });
        return;
      }
    }
    // public: any authenticated user can request

    // Window check: must be voting and within rsvpDeadline
    const now = new Date();
    if (plan.status !== 'voting' || (plan.rsvpDeadline && plan.rsvpDeadline.getTime() <= now.getTime())) {
      res.status(400).json({ error: 'Requests are closed for this plan' });
      return;
    }

    // Find existing join request entry
    const jr = plan.joinRequests.find(r => r.userId.toString() === userId);

    if (jr && jr.status === 'pending') {
      // Duplicate pending request
      res.status(409).json({ error: 'Request already pending' });
      return;
    }

    // Fetch requester user info for name/avatar
    let requesterName: string;
    let requesterAvatar: string | undefined;

    if (jr && jr.status === 'denied') {
      // Re-request after denial (DC-5: refresh name/avatar)
      const requester = await User.findById(userId).select('name avatarUri');
      if (!requester) { res.status(404).json({ error: 'User not found' }); return; }
      requesterName = requester.name;
      requesterAvatar = (requester as any).avatarUri;

      jr.status = 'pending';
      jr.requestedAt = new Date();
      jr.respondedAt = undefined;
      jr.name = requesterName;
      jr.avatarUri = requesterAvatar;
    } else {
      // New request — defensive cap on pending count
      const pendingCount = plan.joinRequests.filter(r => r.status === 'pending').length;
      if (pendingCount >= 50) {
        res.status(429).json({ error: 'Too many pending requests for this plan' });
        return;
      }

      const requester = await User.findById(userId).select('name avatarUri');
      if (!requester) { res.status(404).json({ error: 'User not found' }); return; }
      requesterName = requester.name;
      requesterAvatar = (requester as any).avatarUri;

      plan.joinRequests.push({
        userId: new mongoose.Types.ObjectId(userId),
        name: requesterName,
        avatarUri: requesterAvatar,
        status: 'pending',
        requestedAt: new Date(),
      });
    }

    await plan.save();

    // Notify owner
    await createNotification({
      userId: plan.ownerId.toString(),
      type: 'join_request_received',
      title: 'New Join Request',
      body: `${requesterName} wants to join "${plan.title}"`,
      data: { planId: plan.id, userId },
    });

    res.json({ ok: true, status: 'pending' });
  } catch (err) {
    console.error('POST /plans/:id/request-join error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Request-to-join: approve
router.post('/:id/request-join/:userId/approve', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const plan = await Plan.findById(req.params.id);
    if (!plan) { res.status(404).json({ error: 'Plan not found' }); return; }

    // Owner-only
    if (plan.ownerId.toString() !== req.userId) {
      res.status(403).json({ error: 'Only the plan owner can approve requests' });
      return;
    }

    const targetUserId = req.params.userId;

    // Find pending request
    const jr = plan.joinRequests.find(
      r => r.userId.toString() === targetUserId && r.status === 'pending'
    );
    if (!jr) {
      res.status(404).json({ error: 'No pending request' });
      return;
    }

    // Block if plan is no longer voting
    if (plan.status !== 'voting') {
      res.status(400).json({ error: "This table's already set" });
      return;
    }

    // For friends_request plans: re-check friendship still exists
    if (plan.visibility === 'friends_request') {
      const stillFriends = await isAcceptedFriend(targetUserId, plan.ownerId.toString());
      if (!stillFriends) {
        res.status(400).json({ error: "Looks like you're no longer connected" });
        return;
      }
    }

    // Mark request approved
    jr.status = 'approved';
    jr.respondedAt = new Date();

    // Add to invites[] as accepted — fetch fresh name/avatar, skip if already an invitee (defensive)
    if (!plan.invites.some(i => i.userId.toString() === targetUserId)) {
      const targetUser = await User.findById(targetUserId).select('name avatarUri');
      if (!targetUser) { res.status(404).json({ error: 'User not found' }); return; }
      plan.invites.push({
        userId: new mongoose.Types.ObjectId(targetUserId),
        name: targetUser.name,
        avatarUri: (targetUser as any).avatarUri,
        status: 'accepted',
        respondedAt: new Date(),
      });
    }

    await plan.save();

    // Notify requester
    await createNotification({
      userId: targetUserId,
      type: 'join_request_approved',
      title: 'Request Approved!',
      body: `You've been added to "${plan.title}"`,
      data: { planId: plan.id },
    });

    // Return enriched plan
    const approveOwner = await User.findById(plan.ownerId, 'name avatarUri').lean();
    res.json({ ...plan.toJSON(), ownerName: approveOwner?.name, ownerAvatarUri: (approveOwner as any)?.avatarUri });
  } catch (err) {
    console.error('POST /plans/:id/request-join/:userId/approve error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Request-to-join: deny
router.post('/:id/request-join/:userId/deny', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const plan = await Plan.findById(req.params.id);
    if (!plan) { res.status(404).json({ error: 'Plan not found' }); return; }

    // Owner-only
    if (plan.ownerId.toString() !== req.userId) {
      res.status(403).json({ error: 'Only the plan owner can deny requests' });
      return;
    }

    const targetUserId = req.params.userId;

    // Find pending request
    const jr = plan.joinRequests.find(
      r => r.userId.toString() === targetUserId && r.status === 'pending'
    );
    if (!jr) {
      res.status(404).json({ error: 'No pending request' });
      return;
    }

    // Mark denied + keep entry (so re-request after denial path works in request-join)
    jr.status = 'denied';
    jr.respondedAt = new Date();

    await plan.save();

    // Notify requester
    await createNotification({
      userId: targetUserId,
      type: 'join_request_denied',
      title: 'Request Declined',
      body: `Your request to join "${plan.title}" was not approved.`,
      data: { planId: plan.id },
    });

    // Return enriched plan
    const denyOwner = await User.findById(plan.ownerId, 'name avatarUri').lean();
    res.json({ ...plan.toJSON(), ownerName: denyOwner?.name, ownerAvatarUri: (denyOwner as any)?.avatarUri });
  } catch (err) {
    console.error('POST /plans/:id/request-join/:userId/deny error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Create plan
router.post('/', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { title, date, time, cuisine, budget, inviteeIds, rsvpDeadline, options, type, status: reqStatus, restaurant, restaurantOptions, restaurantCount, allowCurveball, curveballIds, visibility } = req.body as {
      title: string;
      date?: string;
      time?: string;
      cuisine: string;
      budget: string;
      inviteeIds?: string[];
      rsvpDeadline?: string;
      options?: string[];
      type?: 'planned' | 'group-swipe';
      status?: 'voting' | 'confirmed';
      restaurant?: { id: string; name: string; imageUrl: string; address: string; cuisine: string; priceLevel: number; rating: number };
      restaurantOptions?: Array<Record<string, unknown>>;
      restaurantCount?: number;
      allowCurveball?: boolean;
      curveballIds?: string[];
      visibility?: 'public' | 'private' | 'friends_request';
    };

    // Input length validation
    if (!title || typeof title !== 'string' || title.length > 100) {
      res.status(400).json({ error: 'Title is required and must be 100 characters or less' }); return;
    }
    // #321: plan titles are visible to invitees and (for public plans) the
    // discover feed — filter objectionable language.
    if (!isClean(title)) {
      res.status(400).json({ error: 'That title contains language we don’t allow — please rephrase it.' }); return;
    }
    if (type !== 'group-swipe' && (!date || !time)) {
      res.status(400).json({ error: 'Date and time are required' }); return;
    }
    if (cuisine && cuisine.length > 50) {
      res.status(400).json({ error: 'Cuisine must be 50 characters or less' }); return;
    }
    if (inviteeIds && inviteeIds.length > 50) {
      res.status(400).json({ error: 'Cannot invite more than 50 people' }); return;
    }
    if (options && options.length > 20) {
      res.status(400).json({ error: 'Cannot have more than 20 options' }); return;
    }

    // Validate restaurantCount if provided
    if (restaurantCount !== undefined) {
      if (!Number.isInteger(restaurantCount) || restaurantCount < 5 || restaurantCount > 20) {
        res.status(400).json({ error: 'restaurantCount must be an integer between 5 and 20' }); return;
      }
    }

    // Require RSVP deadline for planned events
    if (type !== 'group-swipe' && !rsvpDeadline) {
      res.status(400).json({ error: 'RSVP deadline is required for planned events' }); return;
    }

    const owner = await User.findById(req.userId).select('name avatarUri');
    if (!owner) { res.status(404).json({ error: 'User not found' }); return; }

    const isGroupSwipe = type === 'group-swipe';
    const invites: { userId: string; name: string; avatarUri?: string; status: 'pending' }[] = [];

    if (inviteeIds && inviteeIds.length > 0) {
      const invitees = await User.find({ _id: { $in: inviteeIds } }).select('name avatarUri');
      invitees.forEach(u => {
        invites.push({ userId: u.id, name: u.name, avatarUri: u.avatarUri, status: 'pending' });
      });
    }

    const plan = await Plan.create({
      type: type || 'planned',
      title,
      ...(date ? { date } : {}),
      ...(time ? { time } : {}),
      ownerId: req.userId,
      status: (type === 'group-swipe' && reqStatus) ? reqStatus : 'voting',
      cuisine: cuisine || 'Any',
      budget: budget || '$$',
      ...(restaurant ? { restaurant } : {}),
      ...(restaurantCount !== undefined ? { restaurantCount } : {}),
      ...(allowCurveball !== undefined ? { allowCurveball } : {}),
      ...(curveballIds ? { curveballIds } : {}),
      ...(visibility ? { visibility } : {}),
      invites,
      rsvpDeadline: rsvpDeadline ? new Date(rsvpDeadline) : undefined,
      options: options || [],
      votes: {},
      restaurantOptions: restaurantOptions || [],
      swipesCompleted: [],
    });

    // Notify invitees
    if (invites.length > 0) {
      const inviteeUserIds = invites.map(i => i.userId);
      const notifType = isGroupSwipe ? 'group_swipe_invite' : 'plan_invite';
      await createNotificationForMany(
        inviteeUserIds,
        notifType as any,
        isGroupSwipe ? 'Group Swipe Started!' : 'Dining Plan Invite',
        isGroupSwipe
          ? `${owner.name} started a group swipe — tap to vote!`
          : `${owner.name} invited you to "${title}"`,
        { planId: plan.id }
      );
    }

    // F-005-004: RSVP reminders need a proper job scheduler (e.g. Bull, Agenda).
    // The previous setTimeout-based approach is unreliable (lost on restart).
    // TODO: Implement with a job scheduler when infrastructure supports it.

    res.status(201).json({ ...plan.toJSON(), ownerName: owner.name, ownerAvatarUri: owner.avatarUri });
  } catch (err) {
    console.error('POST /plans error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// RSVP to a plan
router.post('/:id/rsvp', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { action } = req.body as { action: 'accept' | 'decline' };
    const plan = await Plan.findById(req.params.id);
    if (!plan) { res.status(404).json({ error: 'Plan not found' }); return; }

    // Reject RSVP if deadline has passed for planned events
    if (plan.type === 'planned' && plan.rsvpDeadline && plan.rsvpDeadline.getTime() <= Date.now()) {
      res.status(400).json({ error: 'RSVP deadline has passed' });
      return;
    }

    // F-005-015: Reject RSVP if plan date+time has passed
    // Group-swipe plans have no date — skip the past-plan check
    if (plan.date) {
      let planDateTime: Date;
      if (plan.time) {
        const timeMatch = plan.time.match(/^(\d+):(\d+)\s*(AM|PM)$/i);
        if (timeMatch) {
          let h = parseInt(timeMatch[1], 10);
          const m = parseInt(timeMatch[2], 10);
          const isPM = timeMatch[3].toUpperCase() === 'PM';
          if (isPM && h !== 12) h += 12;
          if (!isPM && h === 12) h = 0;
          const [year, month, day] = plan.date.split('-').map(Number);
          planDateTime = new Date(year, month - 1, day, h, m);
        } else {
          planDateTime = new Date(plan.date);
        }
      } else {
        planDateTime = new Date(plan.date);
      }
      if (planDateTime.getTime() < Date.now()) {
        res.status(400).json({ error: 'Cannot RSVP to a past plan' });
        return;
      }
    }

    const invite = plan.invites.find(i => i.userId.toString() === req.userId);
    if (!invite) { res.status(403).json({ error: 'You are not invited to this plan' }); return; }

    // F-005-019: Prevent re-RSVP if already responded
    if (invite.status !== 'pending') {
      res.status(400).json({ error: 'You have already responded to this invite' });
      return;
    }

    invite.status = action === 'accept' ? 'accepted' : 'declined';
    invite.respondedAt = new Date();
    await plan.save();

    const responder = await User.findById(req.userId).select('name');
    if (responder) {
      await createNotification({
        userId: plan.ownerId.toString(),
        type: 'rsvp_response',
        title: action === 'accept' ? 'RSVP Accepted' : 'RSVP Declined',
        body: `${responder.name} ${action === 'accept' ? 'accepted' : 'declined'} your invite to "${plan.title}"`,
        data: { planId: plan.id, action },
      });
    }

    // When an invitee declines a voting group-swipe plan, check if remaining participants are all done
    if (action === 'decline' && plan.type === 'group-swipe' && plan.status === 'voting') {
      const allParticipantIds = [
        plan.ownerId.toString(),
        ...plan.invites.filter(i => i.status !== 'declined').map(i => i.userId.toString()),
      ];
      const allDone = allParticipantIds.length > 0 && allParticipantIds.every(pid => plan.swipesCompleted.includes(pid));
      if (allDone) {
        const winner = tallyWinner(plan);
        if (winner) {
          plan.restaurant = {
            id: winner.id,
            name: winner.name,
            imageUrl: winner.imageUrl,
            address: winner.address,
            cuisine: winner.cuisine,
            priceLevel: winner.priceLevel,
            rating: winner.rating,
            openingPeriods: winner.openingPeriods,
          };
          plan.status = 'confirmed';
          await plan.save();
          // REQ-003: detect closed winner and notify owner if applicable
          await detectClosedWinner(plan);
          if (plan.winnerClosedAt) await plan.save();
        }
      }
    }

    res.json({ ok: true, status: invite.status });
  } catch {
    res.status(500).json({ error: 'Server error' });
  }
});

// Submit swipe votes for a group-swipe plan
router.post('/:id/swipe', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { votes } = req.body as { votes: string[] };
    if (!Array.isArray(votes)) {
      res.status(400).json({ error: 'votes must be an array of restaurant IDs' }); return;
    }

    const plan = await Plan.findById(req.params.id);
    if (!plan) { res.status(404).json({ error: 'Plan not found' }); return; }
    if (plan.status !== 'voting') {
      res.status(400).json({ error: 'Plan is not in voting status' }); return;
    }

    // For planned events, reject swipe if RSVP deadline hasn't passed AND invites are still pending
    const hasPendingInvites = plan.invites.some(i => i.status === 'pending');
    if (plan.type === 'planned' && plan.rsvpDeadline && plan.rsvpDeadline.getTime() > Date.now() && hasPendingInvites) {
      res.status(400).json({ error: 'Voting is not yet open. RSVP deadline has not passed.' }); return;
    }

    // Check user is owner or invitee (pending or accepted — swiping auto-accepts)
    const userId = req.userId!;
    const isOwner = plan.ownerId.toString() === userId;
    const invite = plan.invites.find(i => i.userId.toString() === userId);
    const isInvitee = !!invite && invite.status !== 'declined';
    if (!isOwner && !isInvitee) {
      res.status(403).json({ error: 'You are not a participant in this plan' }); return;
    }

    // Check user hasn't already swiped
    if (plan.swipesCompleted.includes(userId)) {
      res.status(400).json({ error: 'You have already submitted swipes for this plan' }); return;
    }

    // Filter curveball IDs from votes server-side (defense-in-depth)
    const curveballSet = new Set(plan.curveballIds ?? []);
    const cleanVotes = votes.filter(v => !curveballSet.has(v));

    // Validate vote IDs exist in restaurantOptions
    const validIds = new Set(plan.restaurantOptions.map(r => r.id));
    const invalidVotes = cleanVotes.filter(v => !validIds.has(v));
    if (invalidVotes.length > 0) {
      res.status(400).json({ error: 'Some vote IDs are not in restaurantOptions' }); return;
    }

    // Auto-accept pending invitee on swipe (swiping = accepting)
    if (invite && invite.status === 'pending') {
      invite.status = 'accepted';
      invite.respondedAt = new Date();
    }

    // Store votes using Map set method
    if (plan.votes instanceof Map) {
      plan.votes.set(userId, cleanVotes);
    } else {
      (plan.votes as unknown as Map<string, string[]>).set(userId, cleanVotes);
    }
    plan.swipesCompleted.push(userId);

    // Notify other participants that this user finished swiping
    const swiper = await User.findById(userId).select('name');
    if (swiper) {
      const otherIds = [
        plan.ownerId.toString(),
        ...plan.invites.filter(i => i.status !== 'declined').map(i => i.userId.toString()),
      ].filter(pid => pid !== userId);
      if (otherIds.length > 0) {
        await createNotificationForMany(
          otherIds,
          'swipe_completed',
          'Swipe Update',
          `${swiper.name} finished swiping for "${plan.title}"`,
          { planId: plan.id }
        );
      }
    }

    // Check if all participants have swiped (owner + non-declined invitees)
    const allParticipantIds = [
      plan.ownerId.toString(),
      ...plan.invites.filter(i => i.status !== 'declined').map(i => i.userId.toString()),
    ];
    const allDone = allParticipantIds.every(pid => plan.swipesCompleted.includes(pid));

    if (allDone) {
      const winner = tallyWinner(plan);
      if (winner) {
        plan.restaurant = {
          id: winner.id,
          name: winner.name,
          imageUrl: winner.imageUrl,
          address: winner.address,
          cuisine: winner.cuisine,
          priceLevel: winner.priceLevel,
          rating: winner.rating,
          openingPeriods: winner.openingPeriods,
        };
        plan.status = 'confirmed';

        // Notify other participants about the result
        const otherParticipantIds = allParticipantIds.filter(pid => pid !== userId);
        if (otherParticipantIds.length > 0) {
          await createNotificationForMany(
            otherParticipantIds,
            'group_swipe_result',
            'Group Pick Decided!',
            `The group picked ${winner.name} for "${plan.title}"`,
            { planId: plan.id }
          );
        }
      }
    }

    await plan.save();
    // REQ-003: detect closed winner and notify owner if this swipe confirmed the plan
    if (plan.status === 'confirmed') {
      await detectClosedWinner(plan);
      if (plan.winnerClosedAt) await plan.save();
    }
    const swipeOwner = await User.findById(plan.ownerId, 'name avatarUri').lean();
    res.json({ ...plan.toJSON(), ownerName: swipeOwner?.name, ownerAvatarUri: (swipeOwner as any)?.avatarUri });
  } catch (err) {
    console.error('POST /plans/:id/swipe error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Update plan (owner only, except participants can populate empty restaurantOptions)
router.put('/:id', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const plan = await Plan.findById(req.params.id);
    if (!plan) { res.status(404).json({ error: 'Plan not found' }); return; }

    const userId = req.userId!;
    const isOwner = plan.ownerId.toString() === userId;
    const isParticipant = isOwner || plan.invites.some(i => i.userId.toString() === userId && i.status !== 'declined');

    const { title, date, time, cuisine, budget, options, rsvpDeadline, restaurant, allowCurveball, restaurantOptions, curveballIds, inviteeIds, visibility } = req.body;

    // Allow any participant to populate restaurantOptions when currently empty
    const isOnlyPopulatingOptions = restaurantOptions !== undefined
      && Array.isArray(restaurantOptions)
      && plan.restaurantOptions.length === 0
      && title === undefined && date === undefined && time === undefined
      && cuisine === undefined && budget === undefined && options === undefined
      && rsvpDeadline === undefined && restaurant === undefined && allowCurveball === undefined;

    if (!isOwner && !(isParticipant && isOnlyPopulatingOptions)) {
      res.status(403).json({ error: 'Only the plan owner can update this plan' });
      return;
    }
    if (title !== undefined && (typeof title !== 'string' || title.length > 100)) {
      res.status(400).json({ error: 'Title must be 100 characters or less' }); return;
    }
    if (title !== undefined && !isClean(title)) {
      res.status(400).json({ error: 'That title contains language we don’t allow — please rephrase it.' }); return;
    }
    if (cuisine !== undefined && typeof cuisine === 'string' && cuisine.length > 50) {
      res.status(400).json({ error: 'Cuisine must be 50 characters or less' }); return;
    }
    if (options !== undefined && Array.isArray(options) && options.length > 20) {
      res.status(400).json({ error: 'Cannot have more than 20 options' }); return;
    }
    // Capture whether date/time/restaurant are changing on a confirmed plan (for CI-3 re-eval)
    const wasConfirmedWithWinner = plan.status === 'confirmed' && !!plan.restaurant;
    const planTimeChanged = (date !== undefined || time !== undefined || restaurant !== undefined);

    if (title !== undefined) plan.title = title;
    if (date !== undefined) plan.date = date;
    if (time !== undefined) plan.time = time;
    if (cuisine !== undefined) plan.cuisine = cuisine;
    if (budget !== undefined) plan.budget = budget;
    if (options !== undefined) plan.options = options;
    if (rsvpDeadline !== undefined) plan.rsvpDeadline = rsvpDeadline ? new Date(rsvpDeadline) : undefined;
    if (restaurant !== undefined) plan.restaurant = restaurant || undefined;
    if (allowCurveball !== undefined) plan.allowCurveball = allowCurveball;
    if (curveballIds !== undefined) plan.curveballIds = curveballIds;
    if (restaurantOptions !== undefined) plan.restaurantOptions = restaurantOptions;

    // F-006-002 / #39: the plan owner can add or remove invitees in edit mode.
    // Preserve existing RSVP statuses for retained invitees, add new ones as
    // pending, and drop removed ones (including any who had already accepted).
    let newlyInvitedIds: string[] = [];
    if (isOwner && inviteeIds !== undefined) {
      if (!Array.isArray(inviteeIds) || inviteeIds.length > 50) {
        res.status(400).json({ error: 'Cannot invite more than 50 people' }); return;
      }
      const desired = new Set(inviteeIds.map((id: unknown) => String(id)));
      desired.delete(plan.ownerId.toString()); // owner is never an invitee
      const existingIds = new Set(plan.invites.map(i => i.userId.toString()));
      const retained = plan.invites
        .filter(i => desired.has(i.userId.toString()))
        .map(i => ({ userId: i.userId.toString(), name: i.name, avatarUri: i.avatarUri, status: i.status }));
      const addIds = [...desired].filter(id => !existingIds.has(id));
      let added: { userId: string; name: string; avatarUri?: string; status: 'pending' }[] = [];
      if (addIds.length > 0) {
        const users = await User.find({ _id: { $in: addIds } }).select('name avatarUri');
        added = users.map(u => ({ userId: u.id, name: u.name, avatarUri: u.avatarUri, status: 'pending' as const }));
        newlyInvitedIds = added.map(a => a.userId);
      }
      const removedIds = plan.invites
        .filter(i => !desired.has(i.userId.toString()))
        .map(i => i.userId.toString());
      plan.set('invites', [...retained, ...added]);
      // Removed members shouldn't linger in group-swipe progress. (votes Map is left
      // as-is — its key semantics differ by flow; cleanup is a follow-up if needed.)
      if (removedIds.length > 0) {
        plan.swipesCompleted = plan.swipesCompleted.filter(uid => !removedIds.includes(uid));
      }
    }

    // MR-3: visibility update (owner-only; invalid values rejected)
    if (visibility !== undefined) {
      const validVisibilities = ['public', 'private', 'friends_request'];
      if (!validVisibilities.includes(visibility)) {
        res.status(400).json({ error: 'Invalid visibility value' }); return;
      }
      plan.visibility = visibility;
    }

    // CI-3: Re-evaluate closed-winner flag when date/time/restaurant changes on confirmed plan
    if (wasConfirmedWithWinner && planTimeChanged && plan.restaurant && plan.date && plan.time) {
      if (plan.restaurant.openingPeriods !== undefined) {
        const ed = parsePlanEventDate(plan.date, plan.time);
        if (ed) {
          const isNowClosed = ed.getTime() > Date.now() && !isOpenAt(plan.restaurant.openingPeriods, ed);
          if (!isNowClosed) {
            // New time/restaurant is valid — clear the closed flag
            plan.winnerClosedAt = undefined;
            plan.winnerClosedMembersNotified = false;
            plan.winnerClosedDismissed = false;
          } else {
            // Still (or newly) closed — set/refresh the flag
            plan.winnerClosedAt = plan.winnerClosedAt ?? new Date();
            plan.winnerClosedMembersNotified = false;
          }
        }
      } else {
        // No openingPeriods — treat as open; clear any stale flag
        if (plan.winnerClosedAt) {
          plan.winnerClosedAt = undefined;
          plan.winnerClosedMembersNotified = false;
          plan.winnerClosedDismissed = false;
        }
      }
    }

    await plan.save();
    const putOwner = await User.findById(plan.ownerId, 'name avatarUri').lean();
    // Notify anyone newly invited via this edit (mirrors the create-plan flow).
    if (newlyInvitedIds.length > 0) {
      const isGroupSwipe = plan.type === 'group-swipe';
      await createNotificationForMany(
        newlyInvitedIds,
        (isGroupSwipe ? 'group_swipe_invite' : 'plan_invite') as any,
        isGroupSwipe ? 'Group Swipe Started!' : 'Dining Plan Invite',
        isGroupSwipe
          ? `${putOwner?.name ?? 'A friend'} started a group swipe — tap to vote!`
          : `${putOwner?.name ?? 'A friend'} invited you to "${plan.title}"`,
        { planId: plan.id }
      );
    }
    res.json({ ...plan.toJSON(), ownerName: putOwner?.name, ownerAvatarUri: (putOwner as any)?.avatarUri });
  } catch {
    res.status(500).json({ error: 'Server error' });
  }
});

// F-005-020: Update plan status (owner only)
router.put('/:id/status', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { status } = req.body as { status: 'confirmed' | 'completed' | 'cancelled' };
    if (!['confirmed', 'completed', 'cancelled'].includes(status)) {
      res.status(400).json({ error: 'Invalid status. Must be confirmed, completed, or cancelled' });
      return;
    }

    const plan = await Plan.findById(req.params.id);
    if (!plan) { res.status(404).json({ error: 'Plan not found' }); return; }
    if (plan.ownerId.toString() !== req.userId) {
      res.status(403).json({ error: 'Only the plan owner can update status' });
      return;
    }

    // State machine: only allow valid transitions
    const validTransitions: Record<string, string[]> = {
      voting: ['confirmed', 'cancelled'],
      confirmed: ['completed', 'cancelled'],
    };
    const allowed = validTransitions[plan.status ?? 'voting'] ?? [];
    if (!allowed.includes(status)) {
      res.status(400).json({ error: `Cannot transition from ${plan.status ?? 'voting'} to ${status}` });
      return;
    }

    plan.status = status;

    // When cancelling, set cancelledAt and notify invitees
    if (status === 'cancelled') {
      plan.cancelledAt = new Date();
      const inviteeIds = plan.invites.map(i => i.userId.toString());
      if (inviteeIds.length > 0) {
        const owner = await User.findById(req.userId).select('name');
        await createNotificationForMany(
          inviteeIds,
          'plan_cancelled',
          'Plan Cancelled',
          `"${plan.title}" has been cancelled by ${owner?.name ?? 'the organizer'}`,
          { planId: plan.id }
        );
      }
    }

    // When confirming a voting plan, tally votes and pick winner
    let confirmedByTally = false;
    if (status === 'confirmed' && !plan.restaurant) {
      const winner = tallyWinner(plan);
      if (winner) {
        plan.restaurant = {
          id: winner.id,
          name: winner.name,
          imageUrl: winner.imageUrl,
          address: winner.address,
          cuisine: winner.cuisine,
          priceLevel: winner.priceLevel,
          rating: winner.rating,
          openingPeriods: winner.openingPeriods,
        };
        confirmedByTally = true;
      }
    }

    await plan.save();

    // #323: an owner "End Voting" confirm previously notified nobody — the
    // group_swipe_result push only fired on the everyone-swiped path. Mirror
    // it here so participants learn the pick was decided.
    if (confirmedByTally && plan.restaurant) {
      const participantIds = plan.invites
        .filter(i => i.status !== 'declined')
        .map(i => i.userId.toString());
      if (participantIds.length > 0) {
        await createNotificationForMany(
          participantIds,
          'group_swipe_result',
          'Voting Ended!',
          `${plan.restaurant.name} won the vote for "${plan.title}"`,
          { planId: plan.id }
        );
      }
    }

    // REQ-003: detect closed winner when plan transitions to confirmed
    if (status === 'confirmed') {
      await detectClosedWinner(plan);
      if (plan.winnerClosedAt) await plan.save();
    }
    const statusOwner = await User.findById(plan.ownerId, 'name avatarUri').lean();
    res.json({ ...plan.toJSON(), ownerName: statusOwner?.name, ownerAvatarUri: (statusOwner as any)?.avatarUri });
  } catch {
    res.status(500).json({ error: 'Server error' });
  }
});

// Delegate organizer role to an accepted invitee
router.post('/:id/delegate', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { newOwnerId } = req.body as { newOwnerId: string };
    if (!newOwnerId) { res.status(400).json({ error: 'newOwnerId is required' }); return; }

    const plan = await Plan.findById(req.params.id);
    if (!plan) { res.status(404).json({ error: 'Plan not found' }); return; }
    if (plan.ownerId.toString() !== req.userId) {
      res.status(403).json({ error: 'Only the plan owner can delegate' }); return;
    }
    if (plan.status === 'completed' || plan.status === 'cancelled') {
      res.status(400).json({ error: 'Cannot delegate on a completed or cancelled plan' }); return;
    }

    const newOwnerInvite = plan.invites.find(
      i => i.userId.toString() === newOwnerId && i.status === 'accepted'
    );
    if (!newOwnerInvite) {
      res.status(400).json({ error: 'New owner must be an accepted invitee' }); return;
    }

    // Block on 2-person plans (owner + 1 invitee) — old owner leaving would leave 1 person
    if (plan.invites.length < 2) {
      res.status(400).json({ error: 'Cannot delegate on a 2-person plan. Cancel instead.' }); return;
    }

    const oldOwnerId = plan.ownerId.toString();
    const oldOwner = await User.findById(oldOwnerId).select('name');
    const newOwner = await User.findById(newOwnerId).select('name');

    // Transfer ownership
    plan.ownerId = newOwnerId as any;
    // Remove new owner from invites (they're now the owner)
    plan.invites = plan.invites.filter(i => i.userId.toString() !== newOwnerId);
    // Old owner leaves entirely — don't add them back to invites

    // Clean up old owner's votes and swipes
    if (plan.votes instanceof Map) {
      plan.votes.delete(oldOwnerId);
    }
    plan.swipesCompleted = plan.swipesCompleted.filter(id => id !== oldOwnerId);

    await plan.save();

    // Notify new organizer
    await createNotification({
      userId: newOwnerId,
      type: 'organizer_delegated',
      title: "You're Now the Organizer",
      body: `${oldOwner?.name ?? 'Someone'} made you the organizer of "${plan.title}"`,
      data: { planId: plan.id },
    });

    // Notify other participants
    const otherInviteeIds = plan.invites
      .map(i => i.userId.toString())
      .filter(id => id !== newOwnerId);
    if (otherInviteeIds.length > 0) {
      await createNotificationForMany(
        otherInviteeIds,
        'organizer_changed',
        'New Organizer',
        `${newOwner?.name ?? 'Someone'} is now the organizer of "${plan.title}"`,
        { planId: plan.id }
      );
    }

    const enrichedOwner = await User.findById(plan.ownerId, 'name avatarUri').lean();
    res.json({ ...plan.toJSON(), ownerName: enrichedOwner?.name, ownerAvatarUri: (enrichedOwner as any)?.avatarUri });
  } catch (err) {
    console.error('POST /plans/:id/delegate error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Leave plan (non-owner participant)
router.post('/:id/leave', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const plan = await Plan.findById(req.params.id);
    if (!plan) { res.status(404).json({ error: 'Plan not found' }); return; }
    if (plan.ownerId.toString() === req.userId) {
      res.status(403).json({ error: 'Owner cannot leave. Cancel or delegate instead.' }); return;
    }

    const inviteIndex = plan.invites.findIndex(i => i.userId.toString() === req.userId);
    if (inviteIndex === -1) {
      res.status(403).json({ error: 'You are not a participant in this plan' }); return;
    }
    if (plan.status === 'completed' || plan.status === 'cancelled') {
      res.status(400).json({ error: 'Cannot leave a completed or cancelled plan' }); return;
    }

    const leavingInvite = plan.invites[inviteIndex];
    const wasAccepted = leavingInvite.status === 'accepted';
    const leaver = await User.findById(req.userId).select('name');

    // Remove from invites
    plan.invites.splice(inviteIndex, 1);

    // Clean up votes and swipes
    if (plan.votes instanceof Map) {
      plan.votes.delete(req.userId!);
    }
    plan.swipesCompleted = plan.swipesCompleted.filter(id => id !== req.userId);

    // Check if auto-cancel needed: if leaver was accepted and no accepted invitees remain
    let autoCancelled = false;
    if (wasAccepted) {
      const acceptedRemaining = plan.invites.filter(i => i.status === 'accepted').length;
      if (acceptedRemaining === 0) {
        plan.status = 'cancelled';
        plan.cancelledAt = new Date();
        autoCancelled = true;
      }
    }

    await plan.save();

    if (autoCancelled) {
      // Notify owner about auto-cancellation
      await createNotification({
        userId: plan.ownerId.toString(),
        type: 'plan_auto_cancelled',
        title: 'Plan Auto-Cancelled',
        body: `"${plan.title}" was cancelled — not enough participants`,
        data: { planId: plan.id },
      });
    } else {
      // Notify remaining participants
      const remainingIds = [
        plan.ownerId.toString(),
        ...plan.invites.map(i => i.userId.toString()),
      ];
      if (remainingIds.length > 0) {
        await createNotificationForMany(
          remainingIds,
          'participant_left',
          'Participant Left',
          `${leaver?.name ?? 'Someone'} has left "${plan.title}"`,
          { planId: plan.id }
        );
      }
    }

    res.json({ ok: true, autoCancelled });
  } catch (err) {
    console.error('POST /plans/:id/leave error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// REQ-004: Resolve closed winner (owner only)
router.post('/:id/resolve-winner', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { action, time, date, restaurantId } = req.body as {
      action?: string;
      time?: string;
      date?: string;
      restaurantId?: string;
    };

    // 1. Validate action
    const validActions = ['reschedule', 'switch', 'keep', 'dismiss'];
    if (!action || !validActions.includes(action)) {
      res.status(400).json({ error: 'action is required' }); return;
    }

    // 2. Find plan
    const plan = await Plan.findById(req.params.id);
    if (!plan) { res.status(404).json({ error: 'Plan not found' }); return; }

    // 3. Owner check
    if (plan.ownerId.toString() !== req.userId) {
      res.status(403).json({ error: 'Only the plan owner can resolve winner' }); return;
    }

    // 4. winnerClosedAt gate
    if (action === 'reschedule' || action === 'switch') {
      if (!plan.winnerClosedAt) {
        res.status(409).json({ error: 'Plan has no closed winner to resolve' }); return;
      }
    } else {
      // keep / dismiss — idempotent: if already resolved, return 200 silently
      if (!plan.winnerClosedAt) {
        const rOwner = await User.findById(plan.ownerId, 'name avatarUri').lean();
        res.json({ ...plan.toJSON(), ownerName: rOwner?.name, ownerAvatarUri: (rOwner as any)?.avatarUri }); return;
      }
    }

    // Build invitee list for fan-out (owner excluded from their own action's notification)
    const inviteeIds = plan.invites
      .filter(i => i.status === 'accepted')
      .map(i => i.userId.toString());

    if (action === 'reschedule') {
      // 5a. Validate time + date
      if (!time || !date) {
        res.status(400).json({ error: 'time and date are required for reschedule' }); return;
      }
      // Validate new time is within winner's open hours
      if (plan.restaurant?.openingPeriods !== undefined) {
        const newEventDate = parsePlanEventDate(date, time);
        if (newEventDate && !isOpenAt(plan.restaurant.openingPeriods, newEventDate)) {
          res.status(400).json({ error: 'Reschedule time is not within open hours' }); return;
        }
      }
      // Apply reschedule
      plan.time = time;
      plan.date = date;
      plan.winnerClosedAt = undefined;
      await plan.save();
      // Fan-out to members
      if (inviteeIds.length > 0) {
        await createNotificationForMany(
          inviteeIds,
          'plan_rescheduled',
          `New time for ${plan.title}`,
          `New time for ${plan.title}: now ${time}. Same spot, ${plan.restaurant?.name ?? 'your pick'}.`,
          { planId: plan.id }
        );
      }
    } else if (action === 'switch') {
      // 5b. Validate restaurantId
      if (!restaurantId) {
        res.status(400).json({ error: 'restaurantId is required for switch' }); return;
      }
      // Validate target is a ranked (non-curveball) option
      const ranked = tallyRanked(plan);
      const matchedOption = ranked.find(r => r.id === restaurantId);
      if (!matchedOption) {
        res.status(400).json({ error: 'Switch target is not a ranked option for this plan' }); return;
      }
      // Validate target is open at the original plan time
      if (matchedOption.openingPeriods !== undefined && plan.date && plan.time) {
        const originalEventDate = parsePlanEventDate(plan.date, plan.time);
        if (originalEventDate && !isOpenAt(matchedOption.openingPeriods, originalEventDate)) {
          res.status(400).json({ error: 'Switch target is not open at the plan time' }); return;
        }
      }
      // Apply switch
      plan.restaurant = {
        id: matchedOption.id,
        name: matchedOption.name,
        imageUrl: matchedOption.imageUrl,
        address: matchedOption.address,
        cuisine: matchedOption.cuisine,
        priceLevel: matchedOption.priceLevel,
        rating: matchedOption.rating,
        openingPeriods: matchedOption.openingPeriods,
      };
      plan.winnerClosedAt = undefined;
      plan.winnerClosedMembersNotified = false; // reset so new-cycle notifications work (DC-2)
      await plan.save();
      // Fan-out to members
      if (inviteeIds.length > 0) {
        await createNotificationForMany(
          inviteeIds,
          'plan_restaurant_changed',
          'Change of Plans',
          `Change of plans for ${plan.title}: we're now going to ${matchedOption.name} (it's open at our time).`,
          { planId: plan.id }
        );
      }
    } else if (action === 'keep') {
      // One-time member notification only
      if (!plan.winnerClosedMembersNotified) {
        plan.winnerClosedMembersNotified = true;
        await plan.save();
        if (inviteeIds.length > 0) {
          const owner = await User.findById(req.userId).select('name');
          await createNotificationForMany(
            inviteeIds,
            'plan_kept_despite_hours',
            'Plan Update',
            `${owner?.name ?? 'Your organizer'} double-checked ${plan.title} — we're sticking with ${plan.restaurant?.name ?? 'the pick'} at ${plan.time ?? 'our time'}.`,
            { planId: plan.id }
          );
        }
      }
    } else if (action === 'dismiss') {
      plan.winnerClosedDismissed = true;
      if (!plan.winnerClosedMembersNotified) {
        plan.winnerClosedMembersNotified = true;
        await plan.save();
        if (inviteeIds.length > 0) {
          const owner = await User.findById(req.userId).select('name');
          await createNotificationForMany(
            inviteeIds,
            'plan_kept_despite_hours',
            'Plan Update',
            `${owner?.name ?? 'Your organizer'} double-checked ${plan.title} — we're sticking with ${plan.restaurant?.name ?? 'the pick'} at ${plan.time ?? 'our time'}.`,
            { planId: plan.id }
          );
        }
      } else {
        await plan.save();
      }
    }

    const resolveOwner = await User.findById(plan.ownerId, 'name avatarUri').lean();
    res.json({ ...plan.toJSON(), ownerName: resolveOwner?.name, ownerAvatarUri: (resolveOwner as any)?.avatarUri });
  } catch (err) {
    console.error('POST /plans/:id/resolve-winner error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// F-005-021: Delete plan (owner only)
router.delete('/:id', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const plan = await Plan.findById(req.params.id);
    if (!plan) { res.status(404).json({ error: 'Plan not found' }); return; }
    if (plan.ownerId.toString() !== req.userId) {
      res.status(403).json({ error: 'Only the plan owner can delete this plan' });
      return;
    }

    await Plan.deleteOne({ _id: plan._id });
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: 'Server error' });
  }
});

export default router;
