import request from 'supertest';
import app from '../app';
import { connectTestDB, disconnectTestDB, clearDB } from './helpers/db';
import { createTestUser, authHeader } from './helpers/auth';
import Friendship from '../models/Friendship';
import Plan from '../models/Plan';
import Report from '../models/Report';
import { findObjectionable, isClean } from '../utils/contentFilter';

beforeAll(async () => { await connectTestDB(); });
afterAll(async () => { await disconnectTestDB(); });
afterEach(async () => { await clearDB(); });

// #321 — UGC safety suite: blocking, reporting, content filtering.

describe('content filter', () => {
  it('flags plain profanity and slurs', () => {
    expect(isClean('shit happens')).toBe(false);
    expect(isClean('you are a Fucker')).toBe(false);
  });
  it('flags leetspeak and separator-disguised words', () => {
    expect(isClean('Sh1t')).toBe(false);
    expect(isClean('s h i t')).toBe(false);
  });
  it('passes legitimate text including substring lookalikes', () => {
    expect(isClean('Taco Tuesday with the crew')).toBe(true);
    expect(isClean('Scunthorpe dinner')).toBe(true);
    expect(isClean('My assistant Sam')).toBe(true);
    expect(findObjectionable('Classic brunch')).toBeNull();
  });
});

describe('profanity gates', () => {
  it('rejects registration with an objectionable display name', async () => {
    const res = await request(app)
      .post('/auth/register')
      .send({ name: 'Sh1t Lord', email: 'p1@example.com', password: 'password123' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/language/i);
  });

  it('rejects profile rename to an objectionable name', async () => {
    const u = await createTestUser();
    const res = await request(app).put('/users/me').set(authHeader(u.token)).send({ name: 'fucker' });
    expect(res.status).toBe(400);
  });

  it('rejects plan creation with an objectionable title', async () => {
    const owner = await createTestUser();
    const invitee = await createTestUser();
    const res = await request(app).post('/plans').set(authHeader(owner.token)).send({
      title: 'Big shit dinner',
      date: '2027-01-01',
      time: '7:00 PM',
      cuisine: 'Any',
      budget: '$$',
      inviteeIds: [invitee.userId],
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/language/i);
  });
});

describe('blocking', () => {
  it('block severs friendship and prevents new requests both ways', async () => {
    const alice = await createTestUser({ name: 'Alice' });
    const bob = await createTestUser({ name: 'Bob' });

    // Become friends first
    const reqRes = await request(app).post('/friends/request').set(authHeader(alice.token)).send({ userId: bob.userId });
    expect(reqRes.status).toBe(201);
    await request(app).put(`/friends/request/${reqRes.body._id ?? reqRes.body.id}`).set(authHeader(bob.token)).send({ action: 'accept' });

    // Alice blocks Bob
    const blockRes = await request(app).post(`/users/${bob.userId}/block`).set(authHeader(alice.token));
    expect(blockRes.status).toBe(200);

    // Friendship gone
    const remaining = await Friendship.countDocuments({});
    expect(remaining).toBe(0);

    // Neither direction can send a new request
    const fromBlocked = await request(app).post('/friends/request').set(authHeader(bob.token)).send({ userId: alice.userId });
    expect(fromBlocked.status).toBe(403);
    const fromBlocker = await request(app).post('/friends/request').set(authHeader(alice.token)).send({ userId: bob.userId });
    expect(fromBlocker.status).toBe(403);

    // Blocked list shows Bob; unblock clears it and requests work again
    const list = await request(app).get('/users/me/blocked').set(authHeader(alice.token));
    expect(list.status).toBe(200);
    expect(list.body).toHaveLength(1);

    await request(app).delete(`/users/${bob.userId}/block`).set(authHeader(alice.token));
    const retry = await request(app).post('/friends/request').set(authHeader(alice.token)).send({ userId: bob.userId });
    expect(retry.status).toBe(201);
  });

  it('cannot block yourself', async () => {
    const u = await createTestUser();
    const res = await request(app).post(`/users/${u.userId}/block`).set(authHeader(u.token));
    expect(res.status).toBe(400);
  });

  it('blocked user cannot request to join the blocker’s public plan', async () => {
    const owner = await createTestUser({ name: 'Owner' });
    const outsider = await createTestUser({ name: 'Outsider' });

    const plan = await Plan.create({
      type: 'planned',
      title: 'Open Dinner',
      date: '2027-01-01',
      time: '7:00 PM',
      ownerId: owner.userId,
      status: 'voting',
      cuisine: 'Any',
      budget: '$$',
      invites: [],
      visibility: 'public',
    });

    await request(app).post(`/users/${outsider.userId}/block`).set(authHeader(owner.token));

    const joinRes = await request(app).post(`/plans/${plan.id}/request-join`).set(authHeader(outsider.token));
    expect(joinRes.status).toBe(403);
  });
});

describe('reports', () => {
  it('creates a report against a user and dedupes open duplicates', async () => {
    const reporter = await createTestUser();
    const offender = await createTestUser();

    const res = await request(app).post('/reports').set(authHeader(reporter.token)).send({
      targetType: 'user',
      targetId: offender.userId,
      reason: 'harassment',
      detail: 'Sent abusive messages',
    });
    expect(res.status).toBe(201);
    expect(res.body.ok).toBe(true);

    const dup = await request(app).post('/reports').set(authHeader(reporter.token)).send({
      targetType: 'user',
      targetId: offender.userId,
      reason: 'harassment',
    });
    expect(dup.status).toBe(200);
    expect(dup.body.duplicate).toBe(true);

    expect(await Report.countDocuments({})).toBe(1);
  });

  it('rejects invalid reason and missing target', async () => {
    const reporter = await createTestUser();
    const offender = await createTestUser();

    const badReason = await request(app).post('/reports').set(authHeader(reporter.token)).send({
      targetType: 'user', targetId: offender.userId, reason: 'because',
    });
    expect(badReason.status).toBe(400);

    const badTarget = await request(app).post('/reports').set(authHeader(reporter.token)).send({
      targetType: 'plan', targetId: '64b000000000000000000000', reason: 'spam',
    });
    expect(badTarget.status).toBe(404);
  });
});
