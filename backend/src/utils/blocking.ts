import mongoose from 'mongoose';
import User from '../models/User';

/**
 * #321: true when either user has blocked the other. Blocks are stored
 * one-directionally on the blocker but enforced symmetrically everywhere
 * (friend requests, invites, discover, join requests).
 */
export async function isBlockedBetween(userIdA: string, userIdB: string): Promise<boolean> {
  const count = await User.countDocuments({
    $or: [
      { _id: userIdA, blockedUsers: new mongoose.Types.ObjectId(userIdB) },
      { _id: userIdB, blockedUsers: new mongoose.Types.ObjectId(userIdA) },
    ],
  });
  return count > 0;
}

/**
 * Returns the set of user ids that are block-related to `userId` in either
 * direction — users they blocked plus users who blocked them. Used to filter
 * feeds without an N+1 per candidate.
 */
export async function blockedIdSetFor(userId: string): Promise<Set<string>> {
  const me = await User.findById(userId).select('blockedUsers');
  const blockedMe = await User.find({ blockedUsers: userId }).select('_id');
  const set = new Set<string>();
  for (const id of me?.blockedUsers ?? []) set.add(id.toString());
  for (const u of blockedMe) set.add(u._id.toString());
  return set;
}
