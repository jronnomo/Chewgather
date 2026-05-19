import { Router, Response } from 'express';
import mongoose from 'mongoose';
import { requireAuth, AuthRequest } from '../middleware/auth';
import Friendship from '../models/Friendship';
import User from '../models/User';
import Plan from '../models/Plan';

const router = Router();

// GET /restaurants/trending-with-friends
// Returns up to 30 restaurants ranked by friend engagement (favorites + confirmed/completed plans).
// Self-exclusion: the requesting user's own favorites and plan contributions are never counted.
// Only accepted friendships contribute. Plans must be confirmed/completed and updated within 90 days.
// Favorites have no 90-day window (delta D-9): included with friend.updatedAt as proxy timestamp.
router.get(
  '/trending-with-friends',
  requireAuth,
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const requesterId = req.userId!;
      const requesterOid = new mongoose.Types.ObjectId(requesterId);

      // Step 1: Load accepted friendships involving the requester
      const friendships = await Friendship.find({
        $or: [{ requester: requesterOid }, { recipient: requesterOid }],
        status: 'accepted',
      });

      // Derive the friend ObjectIds (the other side of each friendship)
      const friendOids = friendships.map(f =>
        f.requester.toString() === requesterId ? f.recipient : f.requester
      );

      // Step 2: Short-circuit if no friends (delta D-4: include top-level friendCount)
      if (friendOids.length === 0) {
        res.json({ friendCount: 0, items: [] });
        return;
      }

      // Step 3: Load friend user documents
      const friendUsers = await User.find(
        { _id: { $in: friendOids } },
        'name avatarUri favorites updatedAt'
      );

      // Step 4: Load relevant plans (confirmed/completed, updated within 90 days, friend involved)
      const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
      const plans = await Plan.find({
        status: { $in: ['confirmed', 'completed'] },
        updatedAt: { $gte: ninetyDaysAgo },
        $or: [
          { ownerId: { $in: friendOids } },
          { 'invites.userId': { $in: friendOids } },
        ],
      });

      // Step 5: Build Map<placeId, Map<friendId, lastActivityAt>>
      // Each friend's activity per place is collapsed to a single max timestamp (delta D-10e).
      const placeMap = new Map<string, Map<string, Date>>();

      const upsertActivity = (placeId: string, friendId: string, timestamp: Date): void => {
        if (!placeMap.has(placeId)) {
          placeMap.set(placeId, new Map());
        }
        const friendMap = placeMap.get(placeId)!;
        const existing = friendMap.get(friendId);
        if (!existing || timestamp > existing) {
          friendMap.set(friendId, timestamp);
        }
      };

      // Favorites: no 90-day window (delta D-9). Proxy timestamp = friend.updatedAt.
      for (const friendUser of friendUsers) {
        const friendId = (friendUser._id as mongoose.Types.ObjectId).toString();
        const friendUpdatedAt = friendUser.updatedAt;
        for (const placeId of friendUser.favorites) {
          if (placeId) {
            upsertActivity(placeId, friendId, friendUpdatedAt);
          }
        }
      }

      // Plans: iterate participants; skip requester's own contribution (delta D-6).
      const friendIdSet = new Set(friendOids.map(oid => oid.toString()));

      for (const plan of plans) {
        const planUpdatedAt = (plan as unknown as { updatedAt: Date }).updatedAt;
        const placeId = plan.restaurant?.id;
        if (!placeId) continue; // skip plans without a resolved restaurant

        // Check ownerId
        const ownerStr = plan.ownerId.toString();
        if (ownerStr !== requesterId && friendIdSet.has(ownerStr)) {
          upsertActivity(placeId, ownerStr, planUpdatedAt);
        }

        // Check each invitee
        for (const invite of plan.invites) {
          const inviteeStr = invite.userId.toString();
          if (inviteeStr !== requesterId && friendIdSet.has(inviteeStr)) {
            upsertActivity(placeId, inviteeStr, planUpdatedAt);
          }
        }
      }

      // Step 6: Compute friendCount and lastActivityAt per placeId
      type PlaceEntry = {
        placeId: string;
        friendCount: number;
        lastActivityAt: Date;
        friendActivity: Map<string, Date>;
      };

      const entries: PlaceEntry[] = [];
      for (const [placeId, friendActivity] of placeMap.entries()) {
        let lastActivityAt = new Date(0);
        for (const ts of friendActivity.values()) {
          if (ts > lastActivityAt) lastActivityAt = ts;
        }
        entries.push({
          placeId,
          friendCount: friendActivity.size,
          lastActivityAt,
          friendActivity,
        });
      }

      // Step 7: Sort — friendCount desc, lastActivityAt desc, placeId asc
      entries.sort((a, b) => {
        if (b.friendCount !== a.friendCount) return b.friendCount - a.friendCount;
        if (b.lastActivityAt.getTime() !== a.lastActivityAt.getTime()) {
          return b.lastActivityAt.getTime() - a.lastActivityAt.getTime();
        }
        return a.placeId < b.placeId ? -1 : a.placeId > b.placeId ? 1 : 0;
      });

      // Step 8: Cap at 30
      const top30 = entries.slice(0, 30);

      // Build a lookup map from friendId → user doc for efficient O(1) access
      const friendUserMap = new Map(
        friendUsers.map(u => [(u._id as mongoose.Types.ObjectId).toString(), u])
      );

      // Step 9: Attach top 3 friends per place, sorted by per-friend lastActivityAt desc
      const items = top30.map(entry => {
        // Sort friends by their activity timestamp desc
        const sortedFriends = Array.from(entry.friendActivity.entries())
          .sort(([, aTs], [, bTs]) => bTs.getTime() - aTs.getTime())
          .slice(0, 3)
          .map(([friendId, lastActivityAt]) => {
            const user = friendUserMap.get(friendId);
            return {
              id: friendId,
              name: user?.name ?? '',
              avatarUri: user?.avatarUri,
              lastActivityAt: lastActivityAt.toISOString(),
            };
          });

        return {
          placeId: entry.placeId,
          friendCount: entry.friendCount,
          lastActivityAt: entry.lastActivityAt.toISOString(),
          friends: sortedFriends,
        };
      });

      res.json({ friendCount: friendOids.length, items });
    } catch (err) {
      console.error('[trending-with-friends]', err);
      res.status(500).json({ error: 'Server error' });
    }
  }
);

export default router;
