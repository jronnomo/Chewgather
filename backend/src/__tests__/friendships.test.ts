import request from 'supertest';
import app from '../app';
import { connectTestDB, disconnectTestDB, clearDB } from './helpers/db';
import { createTestUser, authHeader } from './helpers/auth';
import { isAcceptedFriend } from '../utils/friendships';

beforeAll(async () => { await connectTestDB(); });
afterAll(async () => { await disconnectTestDB(); });
afterEach(async () => { await clearDB(); });

/**
 * Helper: create an accepted friendship between two users via the API.
 * Returns the friendship id.
 */
async function makeFriends(requesterToken: string, recipientUserId: string, recipientToken: string): Promise<string> {
  const sendRes = await request(app)
    .post('/friends/request')
    .set(authHeader(requesterToken))
    .send({ userId: recipientUserId });
  expect(sendRes.status).toBe(201);
  const friendshipId = sendRes.body._id ?? sendRes.body.id;

  const acceptRes = await request(app)
    .put(`/friends/request/${friendshipId}`)
    .set(authHeader(recipientToken))
    .send({ action: 'accept' });
  expect(acceptRes.status).toBe(200);
  expect(acceptRes.body.status).toBe('accepted');

  return friendshipId;
}

describe('isAcceptedFriend', () => {
  it('returns true for an accepted friendship (requester → recipient direction)', async () => {
    const alice = await createTestUser({ name: 'Alice' });
    const bob = await createTestUser({ name: 'Bob' });
    await makeFriends(alice.token, bob.userId, bob.token);

    const result = await isAcceptedFriend(alice.userId, bob.userId);
    expect(result).toBe(true);
  });

  it('returns true for an accepted friendship (recipient → requester direction, bidirectional check)', async () => {
    const alice = await createTestUser({ name: 'Alice' });
    const bob = await createTestUser({ name: 'Bob' });
    // Alice requests Bob; Bob accepts — Alice is requester, Bob is recipient
    await makeFriends(alice.token, bob.userId, bob.token);

    // Query from Bob's perspective (Bob is recipient, not requester)
    const result = await isAcceptedFriend(bob.userId, alice.userId);
    expect(result).toBe(true);
  });

  it('returns false when checking self (aId === bId)', async () => {
    const alice = await createTestUser({ name: 'Alice' });
    const result = await isAcceptedFriend(alice.userId, alice.userId);
    expect(result).toBe(false);
  });

  it('returns false when no friendship record exists', async () => {
    const alice = await createTestUser({ name: 'Alice' });
    const bob = await createTestUser({ name: 'Bob' });
    // No friend request sent at all
    const result = await isAcceptedFriend(alice.userId, bob.userId);
    expect(result).toBe(false);
  });

  it('returns false for a pending (not yet accepted) friendship', async () => {
    const alice = await createTestUser({ name: 'Alice' });
    const bob = await createTestUser({ name: 'Bob' });

    // Send request but do NOT accept
    const sendRes = await request(app)
      .post('/friends/request')
      .set(authHeader(alice.token))
      .send({ userId: bob.userId });
    expect(sendRes.status).toBe(201);

    const result = await isAcceptedFriend(alice.userId, bob.userId);
    expect(result).toBe(false);
  });

  it('returns false for a declined friendship', async () => {
    const alice = await createTestUser({ name: 'Alice' });
    const bob = await createTestUser({ name: 'Bob' });

    // Alice sends, Bob declines
    const sendRes = await request(app)
      .post('/friends/request')
      .set(authHeader(alice.token))
      .send({ userId: bob.userId });
    expect(sendRes.status).toBe(201);
    const friendshipId = sendRes.body._id ?? sendRes.body.id;

    const declineRes = await request(app)
      .put(`/friends/request/${friendshipId}`)
      .set(authHeader(bob.token))
      .send({ action: 'decline' });
    expect(declineRes.status).toBe(200);

    const result = await isAcceptedFriend(alice.userId, bob.userId);
    expect(result).toBe(false);
  });
});
