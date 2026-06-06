import Friendship from '../models/Friendship';

/**
 * Returns true if aId and bId share an accepted friendship (in either direction).
 * Returns false if aId === bId (self-check) or no accepted friendship exists.
 */
export async function isAcceptedFriend(aId: string, bId: string): Promise<boolean> {
  if (aId === bId) return false;
  return !!(await Friendship.findOne({
    status: 'accepted',
    $or: [
      { requester: aId, recipient: bId },
      { requester: bId, recipient: aId },
    ],
  }));
}
