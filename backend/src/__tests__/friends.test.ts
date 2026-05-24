import request from 'supertest';
import mongoose from 'mongoose';
import app from '../app';
import { connectTestDB, disconnectTestDB, clearDB } from './helpers/db';
import { createTestUser, authHeader } from './helpers/auth';
import Plan from '../models/Plan';

beforeAll(async () => { await connectTestDB(); });
afterAll(async () => { await disconnectTestDB(); });
afterEach(async () => { await clearDB(); });

describe('Friend lifecycle', () => {
  it('full flow: send request → Bob sees it with correct requester id → accept → both see each other as friends → delete', async () => {
    const alice = await createTestUser({ name: 'Alice' });
    const bob = await createTestUser({ name: 'Bob' });

    // Alice sends request to Bob
    const sendRes = await request(app)
      .post('/friends/request')
      .set(authHeader(alice.token))
      .send({ userId: bob.userId });
    expect(sendRes.status).toBe(201);
    const friendshipId = sendRes.body._id ?? sendRes.body.id;
    expect(friendshipId).toBeTruthy();

    // Bob sees the request — requester.id must be Alice's id (not Bob's)
    // Regression: .toString() on a populated object returned '[object Object]'
    const requestsRes = await request(app)
      .get('/friends/requests')
      .set(authHeader(bob.token));
    expect(requestsRes.status).toBe(200);
    expect(requestsRes.body.length).toBe(1);
    const incomingRequest = requestsRes.body[0];
    expect(incomingRequest.from).toBeDefined();
    expect(incomingRequest.from.id).toBe(alice.userId);

    // Bob accepts
    const acceptRes = await request(app)
      .put(`/friends/request/${incomingRequest.id ?? incomingRequest._id}`)
      .set(authHeader(bob.token))
      .send({ action: 'accept' });
    expect(acceptRes.status).toBe(200);
    expect(acceptRes.body.status).toBe('accepted');

    // Alice's friend list: exactly 1 friend, id is Bob's id
    // Regression: Mongoose v8 id virtual not serialized → returned undefined
    const aliceFriends = await request(app)
      .get('/friends')
      .set(authHeader(alice.token));
    expect(aliceFriends.status).toBe(200);
    expect(aliceFriends.body.length).toBe(1);
    expect(aliceFriends.body[0].id).toBe(bob.userId);

    // Bob's friend list: exactly 1 friend, id is Alice's id
    const bobFriends = await request(app)
      .get('/friends')
      .set(authHeader(bob.token));
    expect(bobFriends.status).toBe(200);
    expect(bobFriends.body.length).toBe(1);
    expect(bobFriends.body[0].id).toBe(alice.userId);

    // Delete friendship
    const deleteRes = await request(app)
      .delete(`/friends/${friendshipId}`)
      .set(authHeader(alice.token));
    expect(deleteRes.status).toBe(200);
    expect(deleteRes.body.ok).toBe(true);

    // Both should have empty friend lists
    const aliceFriendsAfter = await request(app)
      .get('/friends')
      .set(authHeader(alice.token));
    expect(aliceFriendsAfter.body.length).toBe(0);
  });

  it('returns 409 on duplicate friend request', async () => {
    const alice = await createTestUser({ name: 'Alice' });
    const bob = await createTestUser({ name: 'Bob' });

    await request(app)
      .post('/friends/request')
      .set(authHeader(alice.token))
      .send({ userId: bob.userId });

    const res = await request(app)
      .post('/friends/request')
      .set(authHeader(alice.token))
      .send({ userId: bob.userId });
    expect(res.status).toBe(409);
  });

  it('returns 400 on self-friend request', async () => {
    const alice = await createTestUser({ name: 'Alice' });
    const res = await request(app)
      .post('/friends/request')
      .set(authHeader(alice.token))
      .send({ userId: alice.userId });
    expect(res.status).toBe(400);
  });

  it('includes mutualPlans count in friend list', async () => {
    const alice = await createTestUser({ name: 'Alice' });
    const bob = await createTestUser({ name: 'Bob' });

    // Make them friends: Alice sends request, Bob accepts
    const sendRes = await request(app)
      .post('/friends/request')
      .set(authHeader(alice.token))
      .send({ userId: bob.userId });
    const friendshipId = sendRes.body._id ?? sendRes.body.id;

    await request(app)
      .put(`/friends/request/${friendshipId}`)
      .set(authHeader(bob.token))
      .send({ action: 'accept' });

    // Initially mutualPlans should be 0
    const res0 = await request(app)
      .get('/friends')
      .set(authHeader(alice.token));
    expect(res0.status).toBe(200);
    expect(res0.body.length).toBe(1);
    expect(res0.body[0].mutualPlans).toBe(0);

    // Create plan where Alice is owner and Bob is invited
    const aliceOid = new mongoose.Types.ObjectId(alice.userId);
    const bobOid = new mongoose.Types.ObjectId(bob.userId);

    await Plan.create({
      title: 'Taco Night',
      ownerId: aliceOid,
      invites: [{ userId: bobOid, name: 'Bob', status: 'pending' }],
    });

    // Verify mutualPlans is now 1
    const res1 = await request(app)
      .get('/friends')
      .set(authHeader(alice.token));
    expect(res1.status).toBe(200);
    expect(res1.body[0].mutualPlans).toBe(1);

    // Create another plan where Bob is owner and Alice is invited
    await Plan.create({
      title: 'Sushi Outing',
      ownerId: bobOid,
      invites: [{ userId: aliceOid, name: 'Alice', status: 'accepted' }],
    });

    // Verify mutualPlans is now 2
    const res2 = await request(app)
      .get('/friends')
      .set(authHeader(alice.token));
    expect(res2.status).toBe(200);
    expect(res2.body[0].mutualPlans).toBe(2);

    // Verify from Bob's perspective too
    const res3 = await request(app)
      .get('/friends')
      .set(authHeader(bob.token));
    expect(res3.status).toBe(200);
    expect(res3.body[0].mutualPlans).toBe(2);
  });

  it('accumulates mutualPlans across all three cases: Case A (Alice owns+Bob invited), Case B (Bob owns+Alice invited), Case C (Carol owns+both invited)', async () => {
    const alice = await createTestUser({ name: 'Alice' });
    const bob = await createTestUser({ name: 'Bob' });
    const carol = await createTestUser({ name: 'Carol' });

    // Make Alice and Bob friends
    const sendRes = await request(app)
      .post('/friends/request')
      .set(authHeader(alice.token))
      .send({ userId: bob.userId });
    const friendshipId = sendRes.body._id ?? sendRes.body.id;
    await request(app)
      .put(`/friends/request/${friendshipId}`)
      .set(authHeader(bob.token))
      .send({ action: 'accept' });

    const aliceOid = new mongoose.Types.ObjectId(alice.userId);
    const bobOid = new mongoose.Types.ObjectId(bob.userId);
    const carolOid = new mongoose.Types.ObjectId(carol.userId);

    // Plan 1 (Case A): Alice owns, Bob invited
    await Plan.create({
      title: 'Case A Plan',
      ownerId: aliceOid,
      invites: [{ userId: bobOid, name: 'Bob', status: 'pending' }],
    });

    // Plan 2 (Case B): Bob owns, Alice invited
    await Plan.create({
      title: 'Case B Plan',
      ownerId: bobOid,
      invites: [{ userId: aliceOid, name: 'Alice', status: 'pending' }],
    });

    // Plan 3 (Case C): Carol owns, both Alice and Bob invited
    await Plan.create({
      title: 'Case C Plan',
      ownerId: carolOid,
      invites: [
        { userId: aliceOid, name: 'Alice', status: 'pending' },
        { userId: bobOid, name: 'Bob', status: 'pending' },
      ],
    });

    // From Alice's perspective: Bob should appear with mutualPlans = 3
    const aliceRes = await request(app)
      .get('/friends')
      .set(authHeader(alice.token));
    expect(aliceRes.status).toBe(200);
    expect(aliceRes.body.length).toBe(1);
    expect(aliceRes.body[0].id).toBe(bob.userId);
    expect(aliceRes.body[0].mutualPlans).toBe(3);

    // From Bob's perspective: Alice should appear with mutualPlans = 3
    const bobRes = await request(app)
      .get('/friends')
      .set(authHeader(bob.token));
    expect(bobRes.status).toBe(200);
    expect(bobRes.body.length).toBe(1);
    expect(bobRes.body[0].id).toBe(alice.userId);
    expect(bobRes.body[0].mutualPlans).toBe(3);
  });
});
