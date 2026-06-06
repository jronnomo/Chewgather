import request from 'supertest';
import app from '../app';
import { connectTestDB, disconnectTestDB, clearDB } from './helpers/db';
import { createTestUser, authHeader } from './helpers/auth';
import Notification from '../models/Notification';
import Plan from '../models/Plan';

beforeAll(async () => { await connectTestDB(); });
afterAll(async () => { await disconnectTestDB(); });
afterEach(async () => { await clearDB(); });

function futureDate(daysAhead: number): string {
  const d = new Date(Date.now() + daysAhead * 24 * 60 * 60 * 1000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const basePlannedPlan = {
  title: 'Visibility Test Dinner',
  date: futureDate(7),
  time: '7:00 PM',
  cuisine: 'Italian',
  budget: '$$',
  rsvpDeadline: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
};

/** Helper to create an accepted friendship between two users */
async function makeFriends(userAToken: string, userBId: string, userBToken: string) {
  const sendRes = await request(app)
    .post('/friends/request')
    .set(authHeader(userAToken))
    .send({ userId: userBId });
  const friendshipId = sendRes.body._id ?? sendRes.body.id;
  await request(app)
    .put(`/friends/request/${friendshipId}`)
    .set(authHeader(userBToken))
    .send({ action: 'accept' });
}

// ---------------------------------------------------------------------------
// GET /:id — authorization guard matrix
// ---------------------------------------------------------------------------
describe('GET /:id — visibility guard matrix', () => {
  it('public plan: stranger (no friendship) gets 200', async () => {
    const alice = await createTestUser({ name: 'Alice' });
    const stranger = await createTestUser({ name: 'Stranger' });

    const createRes = await request(app)
      .post('/plans')
      .set(authHeader(alice.token))
      .send({ ...basePlannedPlan, visibility: 'public' });
    expect(createRes.status).toBe(201);
    const planId = createRes.body.id ?? createRes.body._id;

    const res = await request(app)
      .get(`/plans/${planId}`)
      .set(authHeader(stranger.token));
    expect(res.status).toBe(200);
    expect(res.body.id).toBeTruthy();
  });

  it('private plan: owner gets 200', async () => {
    const alice = await createTestUser({ name: 'Alice' });

    const createRes = await request(app)
      .post('/plans')
      .set(authHeader(alice.token))
      .send({ ...basePlannedPlan, visibility: 'private' });
    const planId = createRes.body.id ?? createRes.body._id;

    const res = await request(app)
      .get(`/plans/${planId}`)
      .set(authHeader(alice.token));
    expect(res.status).toBe(200);
  });

  it('private plan: invitee gets 200', async () => {
    const alice = await createTestUser({ name: 'Alice' });
    const bob = await createTestUser({ name: 'Bob' });

    const createRes = await request(app)
      .post('/plans')
      .set(authHeader(alice.token))
      .send({ ...basePlannedPlan, visibility: 'private', inviteeIds: [bob.userId] });
    const planId = createRes.body.id ?? createRes.body._id;

    const res = await request(app)
      .get(`/plans/${planId}`)
      .set(authHeader(bob.token));
    expect(res.status).toBe(200);
  });

  it('private plan: stranger gets 404', async () => {
    const alice = await createTestUser({ name: 'Alice' });
    const stranger = await createTestUser({ name: 'Stranger' });

    const createRes = await request(app)
      .post('/plans')
      .set(authHeader(alice.token))
      .send({ ...basePlannedPlan, visibility: 'private' });
    const planId = createRes.body.id ?? createRes.body._id;

    const res = await request(app)
      .get(`/plans/${planId}`)
      .set(authHeader(stranger.token));
    expect(res.status).toBe(404);
  });

  it('friends_request plan: owner gets 200', async () => {
    const alice = await createTestUser({ name: 'Alice' });

    const createRes = await request(app)
      .post('/plans')
      .set(authHeader(alice.token))
      .send({ ...basePlannedPlan, visibility: 'friends_request' });
    const planId = createRes.body.id ?? createRes.body._id;

    const res = await request(app)
      .get(`/plans/${planId}`)
      .set(authHeader(alice.token));
    expect(res.status).toBe(200);
  });

  it('friends_request plan: invitee gets 200', async () => {
    const alice = await createTestUser({ name: 'Alice' });
    const bob = await createTestUser({ name: 'Bob' });

    const createRes = await request(app)
      .post('/plans')
      .set(authHeader(alice.token))
      .send({ ...basePlannedPlan, visibility: 'friends_request', inviteeIds: [bob.userId] });
    const planId = createRes.body.id ?? createRes.body._id;

    const res = await request(app)
      .get(`/plans/${planId}`)
      .set(authHeader(bob.token));
    expect(res.status).toBe(200);
  });

  it('friends_request plan: accepted friend gets 200', async () => {
    const alice = await createTestUser({ name: 'Alice' });
    const bob = await createTestUser({ name: 'Bob' });
    await makeFriends(alice.token, bob.userId, bob.token);

    const createRes = await request(app)
      .post('/plans')
      .set(authHeader(alice.token))
      .send({ ...basePlannedPlan, visibility: 'friends_request' });
    const planId = createRes.body.id ?? createRes.body._id;

    const res = await request(app)
      .get(`/plans/${planId}`)
      .set(authHeader(bob.token));
    expect(res.status).toBe(200);
  });

  it('friends_request plan: stranger (non-friend) gets 404', async () => {
    const alice = await createTestUser({ name: 'Alice' });
    const stranger = await createTestUser({ name: 'Stranger' });

    const createRes = await request(app)
      .post('/plans')
      .set(authHeader(alice.token))
      .send({ ...basePlannedPlan, visibility: 'friends_request' });
    const planId = createRes.body.id ?? createRes.body._id;

    const res = await request(app)
      .get(`/plans/${planId}`)
      .set(authHeader(stranger.token));
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// GET /:id — pre-join trim
// ---------------------------------------------------------------------------
describe('GET /:id — non-participant response trimmed', () => {
  it('non-participant reading public plan does not see votes or swipesCompleted', async () => {
    const alice = await createTestUser({ name: 'Alice' });
    const stranger = await createTestUser({ name: 'Stranger' });

    const createRes = await request(app)
      .post('/plans')
      .set(authHeader(alice.token))
      .send({ ...basePlannedPlan, visibility: 'public' });
    const planId = createRes.body.id ?? createRes.body._id;

    const res = await request(app)
      .get(`/plans/${planId}`)
      .set(authHeader(stranger.token));
    expect(res.status).toBe(200);
    expect(res.body.votes).toBeUndefined();
    expect(res.body.swipesCompleted).toBeUndefined();
  });

  it('owner reading their plan sees votes and swipesCompleted', async () => {
    const alice = await createTestUser({ name: 'Alice' });

    const createRes = await request(app)
      .post('/plans')
      .set(authHeader(alice.token))
      .send({ ...basePlannedPlan, visibility: 'public' });
    const planId = createRes.body.id ?? createRes.body._id;

    const res = await request(app)
      .get(`/plans/${planId}`)
      .set(authHeader(alice.token));
    expect(res.status).toBe(200);
    // Owner should see votes (empty object) and swipesCompleted (empty array)
    expect(res.body.votes).toBeDefined();
    expect(res.body.swipesCompleted).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// CI-1: Declined invitee blocked from request-join (MR-1)
// ---------------------------------------------------------------------------
describe('POST /:id/request-join — CI-1: declined invitee blocked', () => {
  it('declined invitee cannot request-join (400 "You\'re already on the guest list")', async () => {
    const alice = await createTestUser({ name: 'Alice' });
    const bob = await createTestUser({ name: 'Bob' });

    const createRes = await request(app)
      .post('/plans')
      .set(authHeader(alice.token))
      .send({ ...basePlannedPlan, visibility: 'public', inviteeIds: [bob.userId] });
    const planId = createRes.body.id ?? createRes.body._id;

    // Bob declines the invite
    await request(app)
      .post(`/plans/${planId}/rsvp`)
      .set(authHeader(bob.token))
      .send({ action: 'decline' });

    // Now Bob tries to request-join — should be blocked by CI-1
    const joinRes = await request(app)
      .post(`/plans/${planId}/request-join`)
      .set(authHeader(bob.token))
      .send({});
    expect(joinRes.status).toBe(400);
    expect(joinRes.body.error).toBe("You're already on the guest list");

    // Plan joinRequests should be unchanged
    const plan = await Plan.findById(planId);
    expect(plan!.joinRequests.length).toBe(0);

    // No notifications for this blocked action
    const notifs = await Notification.find({
      userId: alice.userId,
      type: 'join_request_received',
    });
    expect(notifs.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// CI-2: Non-participant read does NOT trigger auto-decline (MR-2)
// ---------------------------------------------------------------------------
describe('GET /:id — CI-2: non-participant does not trigger auto-decline', () => {
  it('stranger reading a public plan with passed rsvpDeadline does not auto-decline pending invites', async () => {
    const alice = await createTestUser({ name: 'Alice' });
    const bob = await createTestUser({ name: 'Bob' });
    const carol = await createTestUser({ name: 'Carol' });
    const stranger = await createTestUser({ name: 'Stranger' });

    // Create plan with past rsvpDeadline
    const pastDeadline = new Date(Date.now() - 1000).toISOString();
    const plan = await Plan.create({
      type: 'planned',
      title: 'Past Deadline Plan',
      date: futureDate(7),
      time: '7:00 PM',
      ownerId: alice.userId,
      status: 'voting',
      cuisine: 'Any',
      budget: '$$',
      rsvpDeadline: new Date(pastDeadline),
      visibility: 'public',
      invites: [
        { userId: bob.userId, name: 'Bob', status: 'pending', requestedAt: new Date() },
        { userId: carol.userId, name: 'Carol', status: 'pending', requestedAt: new Date() },
      ],
    });
    const planId = plan._id.toString();
    const updatedAtBefore = plan.updatedAt;

    // Stranger reads the plan
    const res = await request(app)
      .get(`/plans/${planId}`)
      .set(authHeader(stranger.token));
    expect(res.status).toBe(200);

    // Wait a brief moment to let any setImmediate fire
    await new Promise(resolve => setTimeout(resolve, 50));

    // Bob and Carol's invites should STILL be pending
    const updatedPlan = await Plan.findById(planId);
    expect(updatedPlan!.invites[0].status).toBe('pending');
    expect(updatedPlan!.invites[1].status).toBe('pending');

    // updatedAt should not have changed (no save occurred)
    expect(updatedPlan!.updatedAt.getTime()).toBe(updatedAtBefore.getTime());

    // No notifications should have been created
    const bobNotifs = await Notification.countDocuments({
      userId: bob.userId,
      type: 'rsvp_deadline_passed',
    });
    const carolNotifs = await Notification.countDocuments({
      userId: carol.userId,
      type: 'rsvp_deadline_passed',
    });
    expect(bobNotifs).toBe(0);
    expect(carolNotifs).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// POST /:id/request-join
// ---------------------------------------------------------------------------
describe('POST /:id/request-join', () => {
  it('public plan: stranger can request-join successfully', async () => {
    const alice = await createTestUser({ name: 'Alice' });
    const stranger = await createTestUser({ name: 'Stranger' });

    const createRes = await request(app)
      .post('/plans')
      .set(authHeader(alice.token))
      .send({ ...basePlannedPlan, visibility: 'public' });
    const planId = createRes.body.id ?? createRes.body._id;

    const res = await request(app)
      .post(`/plans/${planId}/request-join`)
      .set(authHeader(stranger.token))
      .send({});
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.status).toBe('pending');

    // Owner notification created
    const notifs = await Notification.find({
      userId: alice.userId,
      type: 'join_request_received',
    });
    expect(notifs.length).toBe(1);
  });

  it('friends_request plan: friend can request-join', async () => {
    const alice = await createTestUser({ name: 'Alice' });
    const bob = await createTestUser({ name: 'Bob' });
    await makeFriends(alice.token, bob.userId, bob.token);

    const createRes = await request(app)
      .post('/plans')
      .set(authHeader(alice.token))
      .send({ ...basePlannedPlan, visibility: 'friends_request' });
    const planId = createRes.body.id ?? createRes.body._id;

    const res = await request(app)
      .post(`/plans/${planId}/request-join`)
      .set(authHeader(bob.token))
      .send({});
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('pending');
  });

  it('private plan: 403 with "This plan is invite-only"', async () => {
    const alice = await createTestUser({ name: 'Alice' });
    const stranger = await createTestUser({ name: 'Stranger' });

    const createRes = await request(app)
      .post('/plans')
      .set(authHeader(alice.token))
      .send({ ...basePlannedPlan, visibility: 'private' });
    const planId = createRes.body.id ?? createRes.body._id;

    const res = await request(app)
      .post(`/plans/${planId}/request-join`)
      .set(authHeader(stranger.token))
      .send({});
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('This plan is invite-only');
  });

  it('friends_request plan: non-friend gets 403', async () => {
    const alice = await createTestUser({ name: 'Alice' });
    const stranger = await createTestUser({ name: 'Stranger' });

    const createRes = await request(app)
      .post('/plans')
      .set(authHeader(alice.token))
      .send({ ...basePlannedPlan, visibility: 'friends_request' });
    const planId = createRes.body.id ?? createRes.body._id;

    const res = await request(app)
      .post(`/plans/${planId}/request-join`)
      .set(authHeader(stranger.token))
      .send({});
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('Only friends can request to join');
  });

  it('owner cannot request-join their own plan (400)', async () => {
    const alice = await createTestUser({ name: 'Alice' });

    const createRes = await request(app)
      .post('/plans')
      .set(authHeader(alice.token))
      .send({ ...basePlannedPlan, visibility: 'public' });
    const planId = createRes.body.id ?? createRes.body._id;

    const res = await request(app)
      .post(`/plans/${planId}/request-join`)
      .set(authHeader(alice.token))
      .send({});
    expect(res.status).toBe(400);
  });

  it('already-invitee (accepted) gets 400', async () => {
    const alice = await createTestUser({ name: 'Alice' });
    const bob = await createTestUser({ name: 'Bob' });

    const createRes = await request(app)
      .post('/plans')
      .set(authHeader(alice.token))
      .send({ ...basePlannedPlan, visibility: 'public', inviteeIds: [bob.userId] });
    const planId = createRes.body.id ?? createRes.body._id;

    const res = await request(app)
      .post(`/plans/${planId}/request-join`)
      .set(authHeader(bob.token))
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("You're already on the guest list");
  });

  it('past rsvpDeadline: 400 "Requests are closed"', async () => {
    const alice = await createTestUser({ name: 'Alice' });
    const stranger = await createTestUser({ name: 'Stranger' });

    // Create plan directly with past deadline
    const plan = await Plan.create({
      type: 'planned',
      title: 'Past Deadline Plan',
      date: futureDate(7),
      time: '7:00 PM',
      ownerId: alice.userId,
      status: 'voting',
      cuisine: 'Any',
      budget: '$$',
      rsvpDeadline: new Date(Date.now() - 1000),
      visibility: 'public',
      invites: [],
    });
    const planId = plan._id.toString();

    const res = await request(app)
      .post(`/plans/${planId}/request-join`)
      .set(authHeader(stranger.token))
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Requests are closed/i);
  });

  it('duplicate pending request returns 409', async () => {
    const alice = await createTestUser({ name: 'Alice' });
    const stranger = await createTestUser({ name: 'Stranger' });

    const createRes = await request(app)
      .post('/plans')
      .set(authHeader(alice.token))
      .send({ ...basePlannedPlan, visibility: 'public' });
    const planId = createRes.body.id ?? createRes.body._id;

    await request(app)
      .post(`/plans/${planId}/request-join`)
      .set(authHeader(stranger.token))
      .send({});

    const res = await request(app)
      .post(`/plans/${planId}/request-join`)
      .set(authHeader(stranger.token))
      .send({});
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('Request already pending');
  });

  it('re-request after denial flips to pending', async () => {
    const alice = await createTestUser({ name: 'Alice' });
    const stranger = await createTestUser({ name: 'Stranger' });

    const createRes = await request(app)
      .post('/plans')
      .set(authHeader(alice.token))
      .send({ ...basePlannedPlan, visibility: 'public' });
    const planId = createRes.body.id ?? createRes.body._id;

    // First request
    await request(app)
      .post(`/plans/${planId}/request-join`)
      .set(authHeader(stranger.token))
      .send({});

    // Owner denies
    await request(app)
      .post(`/plans/${planId}/request-join/${stranger.userId}/deny`)
      .set(authHeader(alice.token))
      .send({});

    // Re-request
    const reRes = await request(app)
      .post(`/plans/${planId}/request-join`)
      .set(authHeader(stranger.token))
      .send({});
    expect(reRes.status).toBe(200);
    expect(reRes.body.status).toBe('pending');

    // Verify entry was flipped (not duplicated)
    const plan = await Plan.findById(planId);
    const entries = plan!.joinRequests.filter(r => r.userId.toString() === stranger.userId);
    expect(entries.length).toBe(1);
    expect(entries[0].status).toBe('pending');
  });
});

// ---------------------------------------------------------------------------
// POST /:id/request-join/:userId/approve
// ---------------------------------------------------------------------------
describe('POST /:id/request-join/:userId/approve', () => {
  it('owner approves request: adds accepted invitee, marks approved, notifies requester', async () => {
    const alice = await createTestUser({ name: 'Alice' });
    const stranger = await createTestUser({ name: 'Stranger' });

    const createRes = await request(app)
      .post('/plans')
      .set(authHeader(alice.token))
      .send({ ...basePlannedPlan, visibility: 'public' });
    const planId = createRes.body.id ?? createRes.body._id;

    await request(app)
      .post(`/plans/${planId}/request-join`)
      .set(authHeader(stranger.token))
      .send({});

    const approveRes = await request(app)
      .post(`/plans/${planId}/request-join/${stranger.userId}/approve`)
      .set(authHeader(alice.token))
      .send({});
    expect(approveRes.status).toBe(200);

    // Plan now has stranger in invites as accepted
    const plan = await Plan.findById(planId);
    const invite = plan!.invites.find(i => i.userId.toString() === stranger.userId);
    expect(invite).toBeDefined();
    expect(invite!.status).toBe('accepted');

    // JoinRequest entry is marked approved
    const jr = plan!.joinRequests.find(r => r.userId.toString() === stranger.userId);
    expect(jr!.status).toBe('approved');

    // Notification sent to requester
    const notifs = await Notification.find({
      userId: stranger.userId,
      type: 'join_request_approved',
    });
    expect(notifs.length).toBe(1);
  });

  it('non-owner cannot approve (403)', async () => {
    const alice = await createTestUser({ name: 'Alice' });
    const bob = await createTestUser({ name: 'Bob' });
    const stranger = await createTestUser({ name: 'Stranger' });

    const createRes = await request(app)
      .post('/plans')
      .set(authHeader(alice.token))
      .send({ ...basePlannedPlan, visibility: 'public', inviteeIds: [bob.userId] });
    const planId = createRes.body.id ?? createRes.body._id;

    await request(app)
      .post(`/plans/${planId}/request-join`)
      .set(authHeader(stranger.token))
      .send({});

    const res = await request(app)
      .post(`/plans/${planId}/request-join/${stranger.userId}/approve`)
      .set(authHeader(bob.token))
      .send({});
    expect(res.status).toBe(403);
  });

  it('approving non-voting plan returns 400 "This table\'s already set"', async () => {
    const alice = await createTestUser({ name: 'Alice' });
    const stranger = await createTestUser({ name: 'Stranger' });

    // Create plan with confirmed status directly in DB
    const plan = await Plan.create({
      type: 'planned',
      title: 'Confirmed Plan',
      date: futureDate(7),
      time: '7:00 PM',
      ownerId: alice.userId,
      status: 'confirmed',
      cuisine: 'Any',
      budget: '$$',
      visibility: 'public',
      invites: [],
      joinRequests: [
        {
          userId: stranger.userId,
          name: 'Stranger',
          status: 'pending',
          requestedAt: new Date(),
        },
      ],
    });
    const planId = plan._id.toString();

    const res = await request(app)
      .post(`/plans/${planId}/request-join/${stranger.userId}/approve`)
      .set(authHeader(alice.token))
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/already set/i);
  });

  it('group-swipe late-joiner: approve while still voting adds member, tally not yet complete', async () => {
    const alice = await createTestUser({ name: 'Alice' });
    const bob = await createTestUser({ name: 'Bob' });
    const carol = await createTestUser({ name: 'Carol' });

    // Create group-swipe plan with Bob as invitee
    const groupSwipePlan = {
      title: 'Group Swipe',
      cuisine: 'Any',
      budget: '$$',
      type: 'group-swipe',
    };
    const createRes = await request(app)
      .post('/plans')
      .set(authHeader(alice.token))
      .send({ ...groupSwipePlan, visibility: 'public', inviteeIds: [bob.userId] });
    expect(createRes.status).toBe(201);
    const planId = createRes.body.id ?? createRes.body._id;

    // Populate restaurant options
    const mockOptions = Array.from({ length: 5 }, (_, i) => ({
      id: `rest-${i}`,
      name: `Restaurant ${i}`,
      imageUrl: `http://img/${i}`,
      address: `${i} Main St`,
      cuisine: 'Any',
      priceLevel: 2,
      rating: 4.0,
      distance: '1 mi',
      tags: [],
      isOpenNow: true,
      phone: '',
      hours: '',
      description: '',
      photos: [],
      reviewCount: 0,
      hasReservation: false,
      noiseLevel: 'moderate',
      seating: [],
      busyLevel: 'moderate',
    }));
    await request(app)
      .put(`/plans/${planId}`)
      .set(authHeader(alice.token))
      .send({ restaurantOptions: mockOptions });

    // Carol submits a join request
    await request(app)
      .post(`/plans/${planId}/request-join`)
      .set(authHeader(carol.token))
      .send({});

    // Owner approves Carol while plan is still voting
    const approveRes = await request(app)
      .post(`/plans/${planId}/request-join/${carol.userId}/approve`)
      .set(authHeader(alice.token))
      .send({});
    expect(approveRes.status).toBe(200);

    // Carol is now an accepted invitee
    const planAfter = await Plan.findById(planId);
    const carolInvite = planAfter!.invites.find(i => i.userId.toString() === carol.userId);
    expect(carolInvite).toBeDefined();
    expect(carolInvite!.status).toBe('accepted');

    // Plan is still in voting (not auto-confirmed) since no one has swiped
    expect(planAfter!.status).toBe('voting');
  });
});

// ---------------------------------------------------------------------------
// POST /:id/request-join/:userId/deny
// ---------------------------------------------------------------------------
describe('POST /:id/request-join/:userId/deny', () => {
  it('owner denies request: marks denied, notifies requester, allows re-request', async () => {
    const alice = await createTestUser({ name: 'Alice' });
    const stranger = await createTestUser({ name: 'Stranger' });

    const createRes = await request(app)
      .post('/plans')
      .set(authHeader(alice.token))
      .send({ ...basePlannedPlan, visibility: 'public' });
    const planId = createRes.body.id ?? createRes.body._id;

    await request(app)
      .post(`/plans/${planId}/request-join`)
      .set(authHeader(stranger.token))
      .send({});

    const denyRes = await request(app)
      .post(`/plans/${planId}/request-join/${stranger.userId}/deny`)
      .set(authHeader(alice.token))
      .send({});
    expect(denyRes.status).toBe(200);

    const plan = await Plan.findById(planId);
    const jr = plan!.joinRequests.find(r => r.userId.toString() === stranger.userId);
    expect(jr!.status).toBe('denied');
    expect(jr!.respondedAt).toBeDefined();

    // Notification to requester
    const notifs = await Notification.find({
      userId: stranger.userId,
      type: 'join_request_denied',
    });
    expect(notifs.length).toBe(1);

    // Re-request is possible after denial
    const reRes = await request(app)
      .post(`/plans/${planId}/request-join`)
      .set(authHeader(stranger.token))
      .send({});
    expect(reRes.status).toBe(200);
    expect(reRes.body.status).toBe('pending');
  });

  it('non-owner cannot deny (403)', async () => {
    const alice = await createTestUser({ name: 'Alice' });
    const bob = await createTestUser({ name: 'Bob' });
    const stranger = await createTestUser({ name: 'Stranger' });

    const createRes = await request(app)
      .post('/plans')
      .set(authHeader(alice.token))
      .send({ ...basePlannedPlan, visibility: 'public', inviteeIds: [bob.userId] });
    const planId = createRes.body.id ?? createRes.body._id;

    await request(app)
      .post(`/plans/${planId}/request-join`)
      .set(authHeader(stranger.token))
      .send({});

    const res = await request(app)
      .post(`/plans/${planId}/request-join/${stranger.userId}/deny`)
      .set(authHeader(bob.token))
      .send({});
    expect(res.status).toBe(403);
  });

  it('deny on non-existent pending request returns 404', async () => {
    const alice = await createTestUser({ name: 'Alice' });
    const stranger = await createTestUser({ name: 'Stranger' });

    const createRes = await request(app)
      .post('/plans')
      .set(authHeader(alice.token))
      .send({ ...basePlannedPlan, visibility: 'public' });
    const planId = createRes.body.id ?? createRes.body._id;

    const res = await request(app)
      .post(`/plans/${planId}/request-join/${stranger.userId}/deny`)
      .set(authHeader(alice.token))
      .send({});
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// GET /discover
// ---------------------------------------------------------------------------
describe('GET /discover', () => {
  it('returns [] when user has no friends', async () => {
    const alice = await createTestUser({ name: 'Alice' });

    const res = await request(app)
      .get('/plans/discover')
      .set(authHeader(alice.token));
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('returns friend-owned public/friends_request voting plans', async () => {
    const alice = await createTestUser({ name: 'Alice' });
    const bob = await createTestUser({ name: 'Bob' });
    await makeFriends(alice.token, bob.userId, bob.token);

    // Bob creates a public plan
    const createRes = await request(app)
      .post('/plans')
      .set(authHeader(bob.token))
      .send({ ...basePlannedPlan, visibility: 'public' });
    const planId = createRes.body.id ?? createRes.body._id;

    const res = await request(app)
      .get('/plans/discover')
      .set(authHeader(alice.token));
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(1);
    expect(res.body[0].id).toBe(planId);
  });

  it('excludes plans where the user is already an invitee', async () => {
    const alice = await createTestUser({ name: 'Alice' });
    const bob = await createTestUser({ name: 'Bob' });
    await makeFriends(alice.token, bob.userId, bob.token);

    // Bob invites Alice
    await request(app)
      .post('/plans')
      .set(authHeader(bob.token))
      .send({ ...basePlannedPlan, visibility: 'public', inviteeIds: [alice.userId] });

    const res = await request(app)
      .get('/plans/discover')
      .set(authHeader(alice.token));
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(0);
  });

  it('does not return private plans', async () => {
    const alice = await createTestUser({ name: 'Alice' });
    const bob = await createTestUser({ name: 'Bob' });
    await makeFriends(alice.token, bob.userId, bob.token);

    await request(app)
      .post('/plans')
      .set(authHeader(bob.token))
      .send({ ...basePlannedPlan, visibility: 'private' });

    const res = await request(app)
      .get('/plans/discover')
      .set(authHeader(alice.token));
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(0);
  });

  it('includes myJoinRequestStatus = null when no request made', async () => {
    const alice = await createTestUser({ name: 'Alice' });
    const bob = await createTestUser({ name: 'Bob' });
    await makeFriends(alice.token, bob.userId, bob.token);

    await request(app)
      .post('/plans')
      .set(authHeader(bob.token))
      .send({ ...basePlannedPlan, visibility: 'public' });

    const res = await request(app)
      .get('/plans/discover')
      .set(authHeader(alice.token));
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(1);
    expect(res.body[0].myJoinRequestStatus).toBe(null);
  });

  it('includes myJoinRequestStatus = "pending" after submitting request', async () => {
    const alice = await createTestUser({ name: 'Alice' });
    const bob = await createTestUser({ name: 'Bob' });
    await makeFriends(alice.token, bob.userId, bob.token);

    const createRes = await request(app)
      .post('/plans')
      .set(authHeader(bob.token))
      .send({ ...basePlannedPlan, visibility: 'public' });
    const planId = createRes.body.id ?? createRes.body._id;

    // Alice requests to join
    await request(app)
      .post(`/plans/${planId}/request-join`)
      .set(authHeader(alice.token))
      .send({});

    const res = await request(app)
      .get('/plans/discover')
      .set(authHeader(alice.token));
    expect(res.status).toBe(200);
    // Alice is not an invitee, so plan still shows in discover
    expect(res.body.length).toBe(1);
    expect(res.body[0].myJoinRequestStatus).toBe('pending');
  });

  it('trimmed response: votes and swipesCompleted are absent', async () => {
    const alice = await createTestUser({ name: 'Alice' });
    const bob = await createTestUser({ name: 'Bob' });
    await makeFriends(alice.token, bob.userId, bob.token);

    await request(app)
      .post('/plans')
      .set(authHeader(bob.token))
      .send({ ...basePlannedPlan, visibility: 'public' });

    const res = await request(app)
      .get('/plans/discover')
      .set(authHeader(alice.token));
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(1);
    expect(res.body[0].votes).toBeUndefined();
    expect(res.body[0].swipesCompleted).toBeUndefined();
  });

  it('does not return plans with passed rsvpDeadline', async () => {
    const alice = await createTestUser({ name: 'Alice' });
    const bob = await createTestUser({ name: 'Bob' });
    await makeFriends(alice.token, bob.userId, bob.token);

    // Create plan with past deadline directly
    await Plan.create({
      type: 'planned',
      title: 'Past Plan',
      date: futureDate(7),
      time: '7:00 PM',
      ownerId: bob.userId,
      status: 'voting',
      cuisine: 'Any',
      budget: '$$',
      rsvpDeadline: new Date(Date.now() - 1000),
      visibility: 'public',
      invites: [],
    });

    const res = await request(app)
      .get('/plans/discover')
      .set(authHeader(alice.token));
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// PUT /:id — visibility update (MR-3 / MR-4)
// ---------------------------------------------------------------------------
describe('PUT /:id — visibility update', () => {
  it('owner can update visibility to public', async () => {
    const alice = await createTestUser({ name: 'Alice' });

    const createRes = await request(app)
      .post('/plans')
      .set(authHeader(alice.token))
      .send({ ...basePlannedPlan, visibility: 'private' });
    const planId = createRes.body.id ?? createRes.body._id;

    const updateRes = await request(app)
      .put(`/plans/${planId}`)
      .set(authHeader(alice.token))
      .send({ visibility: 'public' });
    expect(updateRes.status).toBe(200);
    expect(updateRes.body.visibility).toBe('public');

    const plan = await Plan.findById(planId);
    expect(plan!.visibility).toBe('public');
  });

  it('invalid visibility value returns 400', async () => {
    const alice = await createTestUser({ name: 'Alice' });

    const createRes = await request(app)
      .post('/plans')
      .set(authHeader(alice.token))
      .send({ ...basePlannedPlan, visibility: 'private' });
    const planId = createRes.body.id ?? createRes.body._id;

    const res = await request(app)
      .put(`/plans/${planId}`)
      .set(authHeader(alice.token))
      .send({ visibility: 'invalid_value' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Invalid visibility value');
  });

  it('PUT without visibility field leaves existing visibility unchanged', async () => {
    const alice = await createTestUser({ name: 'Alice' });

    const createRes = await request(app)
      .post('/plans')
      .set(authHeader(alice.token))
      .send({ ...basePlannedPlan, visibility: 'friends_request' });
    const planId = createRes.body.id ?? createRes.body._id;

    const updateRes = await request(app)
      .put(`/plans/${planId}`)
      .set(authHeader(alice.token))
      .send({ title: 'New Title' });
    expect(updateRes.status).toBe(200);
    expect(updateRes.body.visibility).toBe('friends_request');
  });

  it('non-owner cannot update visibility (403)', async () => {
    const alice = await createTestUser({ name: 'Alice' });
    const bob = await createTestUser({ name: 'Bob' });

    const createRes = await request(app)
      .post('/plans')
      .set(authHeader(alice.token))
      .send({ ...basePlannedPlan, inviteeIds: [bob.userId] });
    const planId = createRes.body.id ?? createRes.body._id;

    const res = await request(app)
      .put(`/plans/${planId}`)
      .set(authHeader(bob.token))
      .send({ visibility: 'public' });
    expect(res.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// Existing visibility default (REQ-001 regression)
// ---------------------------------------------------------------------------
describe('Plan model default visibility', () => {
  it('new plan without explicit visibility defaults to private', async () => {
    const alice = await createTestUser({ name: 'Alice' });

    const createRes = await request(app)
      .post('/plans')
      .set(authHeader(alice.token))
      .send(basePlannedPlan); // no visibility field
    expect(createRes.status).toBe(201);
    expect(createRes.body.visibility).toBe('private');
  });
});
