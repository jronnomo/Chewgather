import request from 'supertest';
import mongoose from 'mongoose';
import app from '../app';
import { connectTestDB, disconnectTestDB, clearDB } from './helpers/db';
import { createTestUser, authHeader, TestUser } from './helpers/auth';
import Friendship from '../models/Friendship';
import User from '../models/User';
import Plan from '../models/Plan';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create an accepted friendship between two users (a→b or b→a, doesn't matter). */
async function makeFriends(a: TestUser, b: TestUser): Promise<void> {
  await Friendship.create({
    requester: new mongoose.Types.ObjectId(a.userId),
    recipient: new mongoose.Types.ObjectId(b.userId),
    status: 'accepted',
  });
}

/** Add a placeId to a user's favorites array and set updatedAt to a specific time. */
async function addFavorite(userId: string, placeId: string, updatedAt?: Date): Promise<void> {
  const update: Record<string, unknown> = { $addToSet: { favorites: placeId } };
  if (updatedAt) {
    await User.updateOne({ _id: userId }, update);
    // Force updatedAt via direct set (timestamps: true prevents normal updates from setting it)
    await User.collection.updateOne(
      { _id: new mongoose.Types.ObjectId(userId) },
      { $set: { updatedAt } }
    );
  } else {
    await User.updateOne({ _id: userId }, update);
  }
}

/** Create a confirmed plan with a restaurant. */
async function createPlan(
  ownerId: string,
  inviteeIds: string[],
  placeId: string,
  status: 'confirmed' | 'completed' | 'voting' | 'cancelled' = 'confirmed',
  updatedAt?: Date
): Promise<void> {
  const invites = inviteeIds.map(id => ({
    userId: new mongoose.Types.ObjectId(id),
    name: 'Invitee',
    status: 'accepted' as const,
  }));

  const doc = await Plan.create({
    title: 'Test Plan',
    ownerId: new mongoose.Types.ObjectId(ownerId),
    status,
    restaurant: {
      id: placeId,
      name: 'Test Restaurant',
      imageUrl: 'https://example.com/img.jpg',
      address: '123 Main St',
      cuisine: 'Italian',
      priceLevel: 2,
      rating: 4.5,
    },
    invites,
  });

  if (updatedAt) {
    await Plan.collection.updateOne(
      { _id: doc._id },
      { $set: { updatedAt } }
    );
  }
}

const ENDPOINT = '/restaurants/trending-with-friends';

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

beforeAll(async () => { await connectTestDB(); });
afterAll(async () => { await disconnectTestDB(); });
afterEach(async () => { await clearDB(); });

describe('GET /restaurants/trending-with-friends', () => {
  // -------------------------------------------------------------------------
  // Case 1 — Auth guard
  // -------------------------------------------------------------------------
  it('returns 401 without auth', async () => {
    const res = await request(app).get(ENDPOINT);
    expect(res.status).toBe(401);
  });

  // -------------------------------------------------------------------------
  // Case 2 — No friendships at all
  // -------------------------------------------------------------------------
  it('returns {friendCount: 0, items: []} for user with no friendships', async () => {
    const alice = await createTestUser({ name: 'Alice' });

    const res = await request(app).get(ENDPOINT).set(authHeader(alice.token));
    expect(res.status).toBe(200);
    expect(res.body.friendCount).toBe(0);
    expect(res.body.items).toEqual([]);
  });

  // -------------------------------------------------------------------------
  // Case 3 — Friends exist but have no activity
  // -------------------------------------------------------------------------
  it('returns {friendCount: N, items: []} when friends exist but have no activity', async () => {
    const alice = await createTestUser({ name: 'Alice' });
    const bob = await createTestUser({ name: 'Bob' });
    await makeFriends(alice, bob);

    const res = await request(app).get(ENDPOINT).set(authHeader(alice.token));
    expect(res.status).toBe(200);
    expect(res.body.friendCount).toBe(1);
    expect(res.body.items).toEqual([]);
  });

  // -------------------------------------------------------------------------
  // Case 4 — Restaurant from a friend's favorite (single friend, 1 item)
  // -------------------------------------------------------------------------
  it('includes a restaurant from a friend favorite', async () => {
    const alice = await createTestUser({ name: 'Alice' });
    const bob = await createTestUser({ name: 'Bob' });
    await makeFriends(alice, bob);

    await addFavorite(bob.userId, 'place_ABC');

    const res = await request(app).get(ENDPOINT).set(authHeader(alice.token));
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].placeId).toBe('place_ABC');
    expect(res.body.items[0].friendCount).toBe(1);
    expect(res.body.items[0].friends).toHaveLength(1);
    expect(res.body.items[0].friends[0].name).toBe('Bob');
  });

  // -------------------------------------------------------------------------
  // Case 5 — Restaurant from a confirmed plan with friend as owner
  // -------------------------------------------------------------------------
  it('includes a restaurant from a confirmed plan with friend as owner', async () => {
    const alice = await createTestUser({ name: 'Alice' });
    const bob = await createTestUser({ name: 'Bob' });
    await makeFriends(alice, bob);

    await createPlan(bob.userId, [], 'place_DEF', 'confirmed');

    const res = await request(app).get(ENDPOINT).set(authHeader(alice.token));
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].placeId).toBe('place_DEF');
    expect(res.body.items[0].friendCount).toBe(1);
  });

  // -------------------------------------------------------------------------
  // Case 6 — Restaurant from a completed plan with friend as invitee
  // -------------------------------------------------------------------------
  it('includes a restaurant from a completed plan with friend as invitee', async () => {
    const alice = await createTestUser({ name: 'Alice' });
    const bob = await createTestUser({ name: 'Bob' });
    const carol = await createTestUser({ name: 'Carol' }); // owns the plan, not a friend
    await makeFriends(alice, bob);

    // Carol owns a completed plan; Bob is invitee
    await createPlan(carol.userId, [bob.userId], 'place_GHI', 'completed');

    const res = await request(app).get(ENDPOINT).set(authHeader(alice.token));
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].placeId).toBe('place_GHI');
    expect(res.body.items[0].friendCount).toBe(1);
    expect(res.body.items[0].friends[0].name).toBe('Bob');
  });

  // -------------------------------------------------------------------------
  // Case 7 — Excludes voting/cancelled plans
  // -------------------------------------------------------------------------
  it('excludes voting and cancelled plans', async () => {
    const alice = await createTestUser({ name: 'Alice' });
    const bob = await createTestUser({ name: 'Bob' });
    await makeFriends(alice, bob);

    await createPlan(bob.userId, [], 'place_VOTING', 'voting');
    await createPlan(bob.userId, [], 'place_CANCELLED', 'cancelled');

    const res = await request(app).get(ENDPOINT).set(authHeader(alice.token));
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // Case 8 — Excludes plans older than 90 days
  // -------------------------------------------------------------------------
  it('excludes plans older than 90 days', async () => {
    const alice = await createTestUser({ name: 'Alice' });
    const bob = await createTestUser({ name: 'Bob' });
    await makeFriends(alice, bob);

    // Plan updated 91 days ago — outside the window
    const oldDate = new Date(Date.now() - 91 * 24 * 60 * 60 * 1000);
    await createPlan(bob.userId, [], 'place_OLD', 'confirmed', oldDate);

    const res = await request(app).get(ENDPOINT).set(authHeader(alice.token));
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // Case 9 — INCLUDES favorites with no time-window cutoff (delta D-9)
  // -------------------------------------------------------------------------
  it('includes favorites regardless of when the friend last updated their profile', async () => {
    const alice = await createTestUser({ name: 'Alice' });
    const bob = await createTestUser({ name: 'Bob' });
    await makeFriends(alice, bob);

    // Set Bob's updatedAt to 2 years ago — favorites still included (no 90-day window on favorites)
    const veryOld = new Date(Date.now() - 2 * 365 * 24 * 60 * 60 * 1000);
    await addFavorite(bob.userId, 'place_OLD_FAV', veryOld);

    const res = await request(app).get(ENDPOINT).set(authHeader(alice.token));
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].placeId).toBe('place_OLD_FAV');
  });

  // -------------------------------------------------------------------------
  // Case 10 — Excludes the requester's own favorites
  // -------------------------------------------------------------------------
  it("excludes the requester's own favorites", async () => {
    const alice = await createTestUser({ name: 'Alice' });
    const bob = await createTestUser({ name: 'Bob' });
    await makeFriends(alice, bob);

    // Alice saves a favorite — should NOT appear in her own trending
    await addFavorite(alice.userId, 'place_ALICE_OWN');

    const res = await request(app).get(ENDPOINT).set(authHeader(alice.token));
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // Case 11 — Excludes requester's plan contribution but counts friend's contribution
  //           in a shared plan (delta D-6)
  // -------------------------------------------------------------------------
  it("excludes requester's own plan contribution but counts friend's in a shared plan", async () => {
    const alice = await createTestUser({ name: 'Alice' });
    const bob = await createTestUser({ name: 'Bob' });
    await makeFriends(alice, bob);

    // Alice owns the plan; Bob is an invitee
    await createPlan(alice.userId, [bob.userId], 'place_SHARED', 'confirmed');

    const res = await request(app).get(ENDPOINT).set(authHeader(alice.token));
    expect(res.status).toBe(200);
    // Bob's contribution counts → 1 item, friendCount=1
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].placeId).toBe('place_SHARED');
    expect(res.body.items[0].friendCount).toBe(1);
    expect(res.body.items[0].friends[0].name).toBe('Bob');
  });

  // -------------------------------------------------------------------------
  // Case 12 — Excludes pending friendships (only accepted count)
  // -------------------------------------------------------------------------
  it('excludes pending friendships', async () => {
    const alice = await createTestUser({ name: 'Alice' });
    const bob = await createTestUser({ name: 'Bob' });

    // Pending friendship — NOT accepted
    await Friendship.create({
      requester: new mongoose.Types.ObjectId(alice.userId),
      recipient: new mongoose.Types.ObjectId(bob.userId),
      status: 'pending',
    });

    await addFavorite(bob.userId, 'place_BOB_FAV');

    const res = await request(app).get(ENDPOINT).set(authHeader(alice.token));
    expect(res.status).toBe(200);
    // Bob is not an accepted friend — short-circuit, friendCount=0, items=[]
    expect(res.body.friendCount).toBe(0);
    expect(res.body.items).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // Case 13 — Ranks by friendCount desc (2 friends > 1 friend)
  // -------------------------------------------------------------------------
  it('ranks by friendCount desc', async () => {
    const alice = await createTestUser({ name: 'Alice' });
    const bob = await createTestUser({ name: 'Bob' });
    const carol = await createTestUser({ name: 'Carol' });
    await makeFriends(alice, bob);
    await makeFriends(alice, carol);

    // place_POPULAR: both Bob and Carol favorited it
    await addFavorite(bob.userId, 'place_POPULAR');
    await addFavorite(carol.userId, 'place_POPULAR');

    // place_SOLO: only Bob favorited it
    await addFavorite(bob.userId, 'place_SOLO');

    const res = await request(app).get(ENDPOINT).set(authHeader(alice.token));
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(2);
    expect(res.body.items[0].placeId).toBe('place_POPULAR');
    expect(res.body.items[0].friendCount).toBe(2);
    expect(res.body.items[1].placeId).toBe('place_SOLO');
    expect(res.body.items[1].friendCount).toBe(1);
  });

  // -------------------------------------------------------------------------
  // Case 14 — Tiebreak by lastActivityAt desc when friendCounts are equal
  // -------------------------------------------------------------------------
  it('tiebreaks by lastActivityAt desc when friendCounts are equal', async () => {
    const alice = await createTestUser({ name: 'Alice' });
    const bob = await createTestUser({ name: 'Bob' });
    await makeFriends(alice, bob);

    // place_RECENT: Bob's favorite, Bob's profile updated more recently
    const recentDate = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000); // 1 day ago
    await addFavorite(bob.userId, 'place_RECENT', recentDate);

    // Now we need a second friend (carol) who favorited a different place earlier
    const carol = await createTestUser({ name: 'Carol' });
    await makeFriends(alice, carol);

    const olderDate = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000); // 10 days ago
    await addFavorite(carol.userId, 'place_OLDER', olderDate);

    // Both places have friendCount=1; place_RECENT should come first (more recent)
    const res = await request(app).get(ENDPOINT).set(authHeader(alice.token));
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(2);
    expect(res.body.items[0].placeId).toBe('place_RECENT');
    expect(res.body.items[1].placeId).toBe('place_OLDER');
  });

  // -------------------------------------------------------------------------
  // Case 15 — friends array capped at 3 entries
  // -------------------------------------------------------------------------
  it('caps the friends array at 3 entries per item', async () => {
    const alice = await createTestUser({ name: 'Alice' });
    const friends: TestUser[] = [];
    for (let i = 0; i < 5; i++) {
      const f = await createTestUser({ name: `Friend${i}` });
      friends.push(f);
      await makeFriends(alice, f);
      await addFavorite(f.userId, 'place_POPULAR');
    }

    const res = await request(app).get(ENDPOINT).set(authHeader(alice.token));
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].friendCount).toBe(5);
    expect(res.body.items[0].friends).toHaveLength(3);
  });

  // -------------------------------------------------------------------------
  // Case 16 — friends array sorted by per-friend lastActivityAt desc
  // -------------------------------------------------------------------------
  it('sorts the friends array by per-friend lastActivityAt desc', async () => {
    const alice = await createTestUser({ name: 'Alice' });
    const bob = await createTestUser({ name: 'Bob' });
    const carol = await createTestUser({ name: 'Carol' });
    await makeFriends(alice, bob);
    await makeFriends(alice, carol);

    const olderDate = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000);
    const newerDate = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000);

    // Bob has older activity, Carol has newer activity — Carol should come first in friends
    await addFavorite(bob.userId, 'place_SHARED', olderDate);
    await addFavorite(carol.userId, 'place_SHARED', newerDate);

    const res = await request(app).get(ENDPOINT).set(authHeader(alice.token));
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    const friendNames = res.body.items[0].friends.map((f: { name: string }) => f.name);
    expect(friendNames[0]).toBe('Carol');
    expect(friendNames[1]).toBe('Bob');
  });

  // -------------------------------------------------------------------------
  // Case 17 — Response shape includes top-level friendCount
  // -------------------------------------------------------------------------
  it('response shape includes top-level friendCount', async () => {
    const alice = await createTestUser({ name: 'Alice' });
    const bob = await createTestUser({ name: 'Bob' });
    const carol = await createTestUser({ name: 'Carol' });
    await makeFriends(alice, bob);
    await makeFriends(alice, carol);

    const res = await request(app).get(ENDPOINT).set(authHeader(alice.token));
    expect(res.status).toBe(200);
    expect(typeof res.body.friendCount).toBe('number');
    expect(res.body.friendCount).toBe(2);
    expect(Array.isArray(res.body.items)).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Case 18 — Friend with both favorite AND plan at same place collapses to 1 (delta D-10e)
  // -------------------------------------------------------------------------
  it('collapses favorite + plan from same friend at same place to 1 with max timestamp', async () => {
    const alice = await createTestUser({ name: 'Alice' });
    const bob = await createTestUser({ name: 'Bob' });
    await makeFriends(alice, bob);

    // Bob favorited the place (older timestamp)
    const olderDate = new Date(Date.now() - 15 * 24 * 60 * 60 * 1000);
    await addFavorite(bob.userId, 'place_BOTH', olderDate);

    // Bob also has a confirmed plan at the same place (newer timestamp)
    const newerDate = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    await createPlan(bob.userId, [], 'place_BOTH', 'confirmed', newerDate);

    const res = await request(app).get(ENDPOINT).set(authHeader(alice.token));
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    // Only 1 friend (Bob), not 2
    expect(res.body.items[0].friendCount).toBe(1);
    // lastActivityAt should be the newer timestamp (plan's updatedAt)
    const returnedTs = new Date(res.body.items[0].lastActivityAt).getTime();
    expect(returnedTs).toBeGreaterThanOrEqual(newerDate.getTime() - 1000);
    expect(returnedTs).toBeLessThanOrEqual(newerDate.getTime() + 1000);
  });

  // -------------------------------------------------------------------------
  // Case 19 — Cap of 30 items observed
  // -------------------------------------------------------------------------
  it('caps the response at 30 items', async () => {
    const alice = await createTestUser({ name: 'Alice' });
    const bob = await createTestUser({ name: 'Bob' });
    await makeFriends(alice, bob);

    // Bob favorites 35 distinct places
    const placeIds = Array.from({ length: 35 }, (_, i) => `place_${i.toString().padStart(3, '0')}`);
    for (const placeId of placeIds) {
      await addFavorite(bob.userId, placeId);
    }

    const res = await request(app).get(ENDPOINT).set(authHeader(alice.token));
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(30);
  });
});
