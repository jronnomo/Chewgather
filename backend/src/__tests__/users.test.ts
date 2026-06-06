import request from 'supertest';
import app from '../app';
import { connectTestDB, disconnectTestDB, clearDB } from './helpers/db';
import { createTestUser, authHeader } from './helpers/auth';
import mongoose from 'mongoose';
import User from '../models/User';
import Friendship from '../models/Friendship';
import Plan from '../models/Plan';
import Notification from '../models/Notification';

beforeAll(async () => { await connectTestDB(); });
afterAll(async () => { await disconnectTestDB(); });
afterEach(async () => { await clearDB(); });

describe('GET /users/me', () => {
  it('returns user with defined id and no passwordHash', async () => {
    const user = await createTestUser();
    const res = await request(app)
      .get('/users/me')
      .set(authHeader(user.token));
    expect(res.status).toBe(200);
    expect(typeof res.body.id).toBe('string');
    expect(res.body.id).toBeTruthy();
    expect(res.body.passwordHash).toBeUndefined();
  });

  it('returns 401 without token', async () => {
    const res = await request(app).get('/users/me');
    expect(res.status).toBe(401);
  });
});

describe('PUT /users/me', () => {
  it('updates name and phone', async () => {
    const user = await createTestUser();
    const res = await request(app)
      .put('/users/me')
      .set(authHeader(user.token))
      .send({ name: 'Updated Name', phone: '+15551234567' });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Updated Name');
    expect(res.body.phone).toBe('+15551234567');
  });

  it('persists preferences and favorites — regression for silent drop bug', async () => {
    const user = await createTestUser();
    const prefs = { cuisines: ['Italian', 'Thai'], budget: ['$$'], distance: '5' };
    const favs = ['place123', 'place456'];

    const putRes = await request(app)
      .put('/users/me')
      .set(authHeader(user.token))
      .send({ preferences: prefs, favorites: favs });
    expect(putRes.status).toBe(200);

    // Re-fetch to confirm persistence
    const getRes = await request(app)
      .get('/users/me')
      .set(authHeader(user.token));
    expect(getRes.status).toBe(200);
    expect(getRes.body.preferences).toMatchObject(prefs);
    expect(Array.isArray(getRes.body.favorites)).toBe(true);
    expect(getRes.body.favorites.length).toBe(2);
  });
});

describe('PUT /users/me — server-side field validation (#216 / #225)', () => {
  it('rejects a name longer than 80 chars', async () => {
    const user = await createTestUser();
    const res = await request(app)
      .put('/users/me')
      .set(authHeader(user.token))
      .send({ name: 'x'.repeat(81) });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/name/i);
  });

  it('rejects an empty/whitespace name', async () => {
    const user = await createTestUser();
    const res = await request(app)
      .put('/users/me')
      .set(authHeader(user.token))
      .send({ name: '   ' });
    expect(res.status).toBe(400);
  });

  it('rejects a phone longer than 32 chars', async () => {
    const user = await createTestUser();
    const res = await request(app)
      .put('/users/me')
      .set(authHeader(user.token))
      .send({ phone: '1'.repeat(33) });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/phone/i);
  });

  it('rejects a non-string name', async () => {
    const user = await createTestUser();
    const res = await request(app)
      .put('/users/me')
      .set(authHeader(user.token))
      .send({ name: { evil: true } });
    expect(res.status).toBe(400);
  });

  it('rejects favorites that is not an array of strings', async () => {
    const user = await createTestUser();
    const res = await request(app)
      .put('/users/me')
      .set(authHeader(user.token))
      .send({ favorites: [1, 2, 3] });
    expect(res.status).toBe(400);
  });

  it('accepts a valid name within limits and trims it', async () => {
    const user = await createTestUser();
    const res = await request(app)
      .put('/users/me')
      .set(authHeader(user.token))
      .send({ name: '  Valid Name  ' });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Valid Name');
  });
});

describe('PUT /users/me — email change (F-007-017)', () => {
  it('updates email and normalizes to lowercase', async () => {
    const user = await createTestUser();
    const res = await request(app)
      .put('/users/me')
      .set(authHeader(user.token))
      .send({ email: 'NewAddress@Example.com' });
    expect(res.status).toBe(200);
    expect(res.body.email).toBe('newaddress@example.com');
  });

  it('rejects an invalid email format', async () => {
    const user = await createTestUser();
    const res = await request(app)
      .put('/users/me')
      .set(authHeader(user.token))
      .send({ email: 'not-an-email' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/email/i);
  });

  it('rejects an email already used by another account', async () => {
    const taken = await createTestUser({ email: 'taken@example.com' });
    const user = await createTestUser();
    const res = await request(app)
      .put('/users/me')
      .set(authHeader(user.token))
      .send({ email: 'taken@example.com' });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/already/i);
    // sanity: the taken account is untouched
    expect(taken.email).toBe('taken@example.com');
  });

  it('allows re-saving the same email (no false self-conflict)', async () => {
    const user = await createTestUser({ email: 'self@example.com' });
    const res = await request(app)
      .put('/users/me')
      .set(authHeader(user.token))
      .send({ email: 'self@example.com' });
    expect(res.status).toBe(200);
    expect(res.body.email).toBe('self@example.com');
  });
});

describe('GET /users/invite/:code', () => {
  it('finds user by invite code', async () => {
    const user = await createTestUser();
    // Get the invite code from /users/me
    const meRes = await request(app)
      .get('/users/me')
      .set(authHeader(user.token));
    const inviteCode = meRes.body.inviteCode;
    expect(inviteCode).toBeTruthy();

    const res = await request(app)
      .get(`/users/invite/${inviteCode}`)
      .set(authHeader(user.token));
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(user.userId);
  });

  it('returns 404 for unknown invite code', async () => {
    const user = await createTestUser();
    const res = await request(app)
      .get('/users/invite/ZZZZZZ')
      .set(authHeader(user.token));
    expect(res.status).toBe(404);
  });
});

describe('DELETE /users/me — account deletion', () => {
  // Test 1: 401 without auth token
  it('returns 401 without auth token', async () => {
    const res = await request(app).delete('/users/me').send({ password: 'password123' });
    expect(res.status).toBe(401);
  });

  // Test 2: 400 when password missing or not a string
  it('returns 400 when password is missing', async () => {
    const user = await createTestUser();
    const res = await request(app)
      .delete('/users/me')
      .set(authHeader(user.token))
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/password/i);
  });

  it('returns 400 when password is not a string', async () => {
    const user = await createTestUser();
    const res = await request(app)
      .delete('/users/me')
      .set(authHeader(user.token))
      .send({ password: 12345 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/password/i);
  });

  // Test 3: Wrong password — 401, user/friendship/plan all survive
  it('returns 401 on wrong password and does not delete anything', async () => {
    const alice = await createTestUser({ name: 'Alice' });
    const bob = await createTestUser({ name: 'Bob' });
    const aliceOid = new mongoose.Types.ObjectId(alice.userId);
    const bobOid = new mongoose.Types.ObjectId(bob.userId);

    await Friendship.create({ requester: aliceOid, recipient: bobOid, status: 'accepted' });
    await Plan.create({ type: 'planned', title: 'Alices Plan', ownerId: aliceOid });

    const res = await request(app)
      .delete('/users/me')
      .set(authHeader(alice.token))
      .send({ password: 'wrongpassword' });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Incorrect password');

    // User doc, friendship, and owned plan must all survive
    const stillExists = await User.findById(alice.userId);
    expect(stillExists).not.toBeNull();

    const friendshipCount = await Friendship.countDocuments({
      $or: [{ requester: aliceOid }, { recipient: aliceOid }],
    });
    expect(friendshipCount).toBe(1);

    const planCount = await Plan.countDocuments({ ownerId: aliceOid });
    expect(planCount).toBe(1);
  });

  // Test 4: Correct password — 200, user doc gone
  it('returns 200 and deletes the user doc on correct password', async () => {
    const user = await createTestUser();
    const res = await request(app)
      .delete('/users/me')
      .set(authHeader(user.token))
      .send({ password: 'password123' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });
    expect(await User.findById(user.userId)).toBeNull();
  });

  // Test 5: Cascade friendships — seeded friendship deleted; other user survives
  it('cascades friendships: deletes friendships for user, other user doc survives', async () => {
    const alice = await createTestUser({ name: 'Alice' });
    const bob = await createTestUser({ name: 'Bob' });
    const aliceOid = new mongoose.Types.ObjectId(alice.userId);
    const bobOid = new mongoose.Types.ObjectId(bob.userId);

    await Friendship.create({ requester: aliceOid, recipient: bobOid, status: 'accepted' });

    const res = await request(app)
      .delete('/users/me')
      .set(authHeader(alice.token))
      .send({ password: 'password123' });

    expect(res.status).toBe(200);

    const remaining = await Friendship.find({
      $or: [{ requester: aliceOid }, { recipient: aliceOid }],
    });
    expect(remaining.length).toBe(0);

    // Bob's doc must survive
    expect(await User.findById(bob.userId)).not.toBeNull();
  });

  // Test 6a: Cascade owned plans
  it('cascades owned plans: deletes plans owned by the deleted user', async () => {
    const alice = await createTestUser({ name: 'Alice' });
    const aliceOid = new mongoose.Types.ObjectId(alice.userId);

    await Plan.create({ type: 'planned', title: 'Alices Pizza Night', ownerId: aliceOid });

    const res = await request(app)
      .delete('/users/me')
      .set(authHeader(alice.token))
      .send({ password: 'password123' });

    expect(res.status).toBe(200);
    expect(await Plan.countDocuments({ ownerId: aliceOid })).toBe(0);
  });

  // Test 6b: Cascade invites — alice's invite pulled, plan still exists
  it('cascades invites: pulls user invite from other plans, plan still exists', async () => {
    const alice = await createTestUser({ name: 'Alice' });
    const bob = await createTestUser({ name: 'Bob' });
    const aliceOid = new mongoose.Types.ObjectId(alice.userId);
    const bobOid = new mongoose.Types.ObjectId(bob.userId);

    const plan = await Plan.create({
      type: 'planned',
      title: 'Bobs Plan',
      ownerId: bobOid,
      invites: [{ userId: aliceOid, name: 'Alice', status: 'pending' }],
    });

    const res = await request(app)
      .delete('/users/me')
      .set(authHeader(alice.token))
      .send({ password: 'password123' });

    expect(res.status).toBe(200);

    const updatedPlan = await Plan.findById(plan._id);
    expect(updatedPlan).not.toBeNull();
    const aliceInvite = updatedPlan!.invites.find(
      (inv) => inv.userId.toString() === alice.userId,
    );
    expect(aliceInvite).toBeUndefined();
  });

  // Test 6c: Cascade votes + swipesCompleted
  it('cascades votes and swipesCompleted from other plans, plan still exists', async () => {
    const alice = await createTestUser({ name: 'Alice' });
    const bob = await createTestUser({ name: 'Bob' });
    const aliceOid = new mongoose.Types.ObjectId(alice.userId);
    const bobOid = new mongoose.Types.ObjectId(bob.userId);

    const plan = await Plan.create({
      type: 'group-swipe',
      title: 'Bobs Swipe Night',
      ownerId: bobOid,
      votes: new Map([[alice.userId, ['rest_001', 'rest_002']]]),
      swipesCompleted: [alice.userId],
    });

    const res = await request(app)
      .delete('/users/me')
      .set(authHeader(alice.token))
      .send({ password: 'password123' });

    expect(res.status).toBe(200);

    const updatedPlan = await Plan.findById(plan._id);
    expect(updatedPlan).not.toBeNull();

    // votes map should no longer have alice's key
    const votesMap = updatedPlan!.votes as unknown as Map<string, string[]>;
    expect(votesMap.has(alice.userId)).toBe(false);

    // swipesCompleted should not include alice
    expect(updatedPlan!.swipesCompleted).not.toContain(alice.userId);

    // Plan still exists
    expect(updatedPlan!.title).toBe('Bobs Swipe Night');
  });

  // Test 7: Cascade notifications
  it('cascades notifications: deletes user notifications', async () => {
    const alice = await createTestUser({ name: 'Alice' });
    const aliceOid = new mongoose.Types.ObjectId(alice.userId);

    await Notification.create({
      userId: aliceOid,
      type: 'friend_request',
      title: 'T',
      body: 'B',
    });

    const res = await request(app)
      .delete('/users/me')
      .set(authHeader(alice.token))
      .send({ password: 'password123' });

    expect(res.status).toBe(200);
    expect(await Notification.countDocuments({ userId: aliceOid })).toBe(0);
  });

  // Test 8: Double-delete — second attempt returns 404
  it('returns 404 on a second delete attempt with the same token', async () => {
    const user = await createTestUser();

    const first = await request(app)
      .delete('/users/me')
      .set(authHeader(user.token))
      .send({ password: 'password123' });
    expect(first.status).toBe(200);

    const second = await request(app)
      .delete('/users/me')
      .set(authHeader(user.token))
      .send({ password: 'password123' });
    expect(second.status).toBe(404);
  });

  // Test 9: Full belt-and-suspenders cascade
  it('full cascade: friendship + owned plan + invite/votes/swipes on other plan + notification all cleaned; 2nd user survives', async () => {
    const alice = await createTestUser({ name: 'Alice' });
    const bob = await createTestUser({ name: 'Bob' });
    const aliceOid = new mongoose.Types.ObjectId(alice.userId);
    const bobOid = new mongoose.Types.ObjectId(bob.userId);

    // Friendship
    await Friendship.create({ requester: aliceOid, recipient: bobOid, status: 'accepted' });

    // Plan owned by alice
    await Plan.create({ type: 'planned', title: 'Alices Plan', ownerId: aliceOid });

    // Plan owned by bob — alice has invite, vote, and swipe entry
    const bobPlan = await Plan.create({
      type: 'group-swipe',
      title: 'Bobs Plan',
      ownerId: bobOid,
      invites: [{ userId: aliceOid, name: 'Alice', status: 'pending' }],
      votes: new Map([[alice.userId, ['rest_A', 'rest_B']]]),
      swipesCompleted: [alice.userId],
    });

    // Notification for alice
    await Notification.create({
      userId: aliceOid,
      type: 'friend_request',
      title: 'Hey',
      body: 'You have a friend request',
    });

    const res = await request(app)
      .delete('/users/me')
      .set(authHeader(alice.token))
      .send({ password: 'password123' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });

    // Alice's user doc is gone
    expect(await User.findById(alice.userId)).toBeNull();

    // Friendship gone
    expect(
      await Friendship.countDocuments({
        $or: [{ requester: aliceOid }, { recipient: aliceOid }],
      }),
    ).toBe(0);

    // Alice's plan gone
    expect(await Plan.countDocuments({ ownerId: aliceOid })).toBe(0);

    // Bob's plan still exists; alice scrubbed from it
    const updatedBobPlan = await Plan.findById(bobPlan._id);
    expect(updatedBobPlan).not.toBeNull();
    expect(
      updatedBobPlan!.invites.find((inv) => inv.userId.toString() === alice.userId),
    ).toBeUndefined();
    const votesMap = updatedBobPlan!.votes as unknown as Map<string, string[]>;
    expect(votesMap.has(alice.userId)).toBe(false);
    expect(updatedBobPlan!.swipesCompleted).not.toContain(alice.userId);

    // Notification gone
    expect(await Notification.countDocuments({ userId: aliceOid })).toBe(0);

    // Bob survives
    expect(await User.findById(bob.userId)).not.toBeNull();
  });
});
