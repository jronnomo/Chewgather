import request from 'supertest';
import app from '../app';
import { connectTestDB, disconnectTestDB, clearDB } from './helpers/db';
import { createTestUser, authHeader } from './helpers/auth';

beforeAll(async () => { await connectTestDB(); });
afterAll(async () => { await disconnectTestDB(); });
afterEach(async () => { await clearDB(); });

// Always pick a future date so RSVP/delegate/leave routes (which reject past
// plans per F-005-015) accept the test ops regardless of when the suite runs.
function futureDate(daysAhead: number): string {
  const d = new Date(Date.now() + daysAhead * 24 * 60 * 60 * 1000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const basePlan = {
  title: 'Friday Dinner',
  date: futureDate(7),
  time: '7:00 PM', // matches the AM/PM regex parser in plans.ts:225 and deadlineEnforcer.ts:94
  cuisine: 'Italian',
  budget: '$$',
  rsvpDeadline: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(), // 24h from now
};

describe('POST /plans', () => {
  it('creates plan with no invitees — regression: plan.id defined + saved without friends', async () => {
    const alice = await createTestUser({ name: 'Alice' });
    const res = await request(app)
      .post('/plans')
      .set(authHeader(alice.token))
      .send(basePlan);
    expect(res.status).toBe(201);
    // Regression: Mongoose v8 id virtual not serialized
    expect(typeof res.body.id).toBe('string');
    expect(res.body.id).toBeTruthy();
    expect(res.body.title).toBe('Friday Dinner');
    expect(Array.isArray(res.body.invites)).toBe(true);
    expect(res.body.invites.length).toBe(0);
  });

  it('creates plan with invitees — invites array has pending entry', async () => {
    const alice = await createTestUser({ name: 'Alice' });
    const bob = await createTestUser({ name: 'Bob' });

    const res = await request(app)
      .post('/plans')
      .set(authHeader(alice.token))
      .send({ ...basePlan, inviteeIds: [bob.userId] });
    expect(res.status).toBe(201);
    expect(res.body.invites.length).toBe(1);
    expect(res.body.invites[0].status).toBe('pending');
    expect(res.body.invites[0].userId).toBe(bob.userId);
  });

  it('rejects planned event without rsvpDeadline', async () => {
    const alice = await createTestUser({ name: 'Alice' });
    const res = await request(app)
      .post('/plans')
      .set(authHeader(alice.token))
      .send({
        title: 'No Deadline',
        date: futureDate(7),
        time: '7:00 PM',
        cuisine: 'Italian',
        budget: '$$',
        // No rsvpDeadline
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/RSVP deadline/i);
  });
});

describe('PUT /plans/:id — invitee management (#39 / F-006-002)', () => {
  async function createPlanWith(ownerToken: string, inviteeIds: string[] = []) {
    const res = await request(app)
      .post('/plans')
      .set(authHeader(ownerToken))
      .send({ ...basePlan, inviteeIds });
    return res.body;
  }

  it('owner can ADD an invitee via PUT', async () => {
    const alice = await createTestUser({ name: 'Alice' });
    const bob = await createTestUser({ name: 'Bob' });
    const plan = await createPlanWith(alice.token, []);
    expect(plan.invites.length).toBe(0);

    const res = await request(app)
      .put(`/plans/${plan.id}`)
      .set(authHeader(alice.token))
      .send({ inviteeIds: [bob.userId] });

    expect(res.status).toBe(200);
    expect(res.body.invites.length).toBe(1);
    expect(res.body.invites[0].userId).toBe(bob.userId);
    expect(res.body.invites[0].status).toBe('pending');
  });

  it('owner can REMOVE an invitee via PUT — including one who already accepted', async () => {
    const alice = await createTestUser({ name: 'Alice' });
    const bob = await createTestUser({ name: 'Bob' });
    const plan = await createPlanWith(alice.token, [bob.userId]);
    // Bob accepts
    await request(app).post(`/plans/${plan.id}/rsvp`).set(authHeader(bob.token)).send({ action: 'accept' });

    const res = await request(app)
      .put(`/plans/${plan.id}`)
      .set(authHeader(alice.token))
      .send({ inviteeIds: [] });

    expect(res.status).toBe(200);
    expect(res.body.invites.length).toBe(0);
  });

  it('PRESERVES an existing invitee\'s accepted status while adding a new invitee', async () => {
    const alice = await createTestUser({ name: 'Alice' });
    const bob = await createTestUser({ name: 'Bob' });
    const carol = await createTestUser({ name: 'Carol' });
    const plan = await createPlanWith(alice.token, [bob.userId]);
    await request(app).post(`/plans/${plan.id}/rsvp`).set(authHeader(bob.token)).send({ action: 'accept' });

    const res = await request(app)
      .put(`/plans/${plan.id}`)
      .set(authHeader(alice.token))
      .send({ inviteeIds: [bob.userId, carol.userId] });

    expect(res.status).toBe(200);
    expect(res.body.invites.length).toBe(2);
    const bobInvite = res.body.invites.find((i: { userId: string }) => i.userId === bob.userId);
    const carolInvite = res.body.invites.find((i: { userId: string }) => i.userId === carol.userId);
    expect(bobInvite.status).toBe('accepted'); // not reset to pending
    expect(carolInvite.status).toBe('pending');
  });

  it('rejects invitee edits from a non-owner', async () => {
    const alice = await createTestUser({ name: 'Alice' });
    const bob = await createTestUser({ name: 'Bob' });
    const carol = await createTestUser({ name: 'Carol' });
    const plan = await createPlanWith(alice.token, [bob.userId]);

    const res = await request(app)
      .put(`/plans/${plan.id}`)
      .set(authHeader(bob.token))
      .send({ inviteeIds: [bob.userId, carol.userId] });

    expect(res.status).toBe(403);
  });
});

describe('GET /plans', () => {
  it('user only sees plans they own or are invited to', async () => {
    const alice = await createTestUser({ name: 'Alice' });
    const bob = await createTestUser({ name: 'Bob' });
    const carol = await createTestUser({ name: 'Carol' });

    // Alice creates plan and invites Bob
    await request(app)
      .post('/plans')
      .set(authHeader(alice.token))
      .send({ ...basePlan, inviteeIds: [bob.userId] });

    // Carol creates a private plan (no invites)
    await request(app)
      .post('/plans')
      .set(authHeader(carol.token))
      .send({ ...basePlan, title: 'Carol Private Plan' });

    // Alice sees 1 plan (hers)
    const alicePlans = await request(app)
      .get('/plans')
      .set(authHeader(alice.token));
    expect(alicePlans.status).toBe(200);
    expect(alicePlans.body.length).toBe(1);

    // Bob sees 1 plan (invited to Alice's)
    const bobPlans = await request(app)
      .get('/plans')
      .set(authHeader(bob.token));
    expect(bobPlans.status).toBe(200);
    expect(bobPlans.body.length).toBe(1);

    // Carol sees 1 plan (her own)
    const carolPlans = await request(app)
      .get('/plans')
      .set(authHeader(carol.token));
    expect(carolPlans.status).toBe(200);
    expect(carolPlans.body.length).toBe(1);
    expect(carolPlans.body[0].title).toBe('Carol Private Plan');
  });
});

describe('POST /plans/:id/rsvp', () => {
  it('accept RSVP updates invite status to accepted', async () => {
    const alice = await createTestUser({ name: 'Alice' });
    const bob = await createTestUser({ name: 'Bob' });

    const createRes = await request(app)
      .post('/plans')
      .set(authHeader(alice.token))
      .send({ ...basePlan, inviteeIds: [bob.userId] });
    const planId = createRes.body.id ?? createRes.body._id;

    const rsvpRes = await request(app)
      .post(`/plans/${planId}/rsvp`)
      .set(authHeader(bob.token))
      .send({ action: 'accept' });
    expect(rsvpRes.status).toBe(200);
    expect(rsvpRes.body.status).toBe('accepted');

    // Verify via GET /:id
    const getRes = await request(app)
      .get(`/plans/${planId}`)
      .set(authHeader(alice.token));
    expect(getRes.status).toBe(200);
    const bobInvite = getRes.body.invites.find((i: { userId: string }) => i.userId === bob.userId);
    expect(bobInvite).toBeDefined();
    expect(bobInvite.status).toBe('accepted');
  });

  it('returns 403 when non-invitee tries to RSVP', async () => {
    const alice = await createTestUser({ name: 'Alice' });
    const bob = await createTestUser({ name: 'Bob' });
    const carol = await createTestUser({ name: 'Carol' });

    const createRes = await request(app)
      .post('/plans')
      .set(authHeader(alice.token))
      .send({ ...basePlan, inviteeIds: [bob.userId] });
    const planId = createRes.body.id ?? createRes.body._id;

    const res = await request(app)
      .post(`/plans/${planId}/rsvp`)
      .set(authHeader(carol.token))
      .send({ action: 'accept' });
    expect(res.status).toBe(403);
  });
});

// ─── Group Swipe Tests ──────────────────────────────────────────────────────

const mockRestaurantOptions = [
  { id: 'r1', name: 'Pizza Place', imageUrl: 'http://img/1', address: '1 Main St', cuisine: 'Italian', priceLevel: 2, rating: 4.5, distance: '0.5mi', tags: [], isOpenNow: true, phone: '', hours: '', description: '', photos: [], reviewCount: 10, hasReservation: false, noiseLevel: 'moderate', seating: [], busyLevel: 'moderate' },
  { id: 'r2', name: 'Sushi Bar', imageUrl: 'http://img/2', address: '2 Main St', cuisine: 'Japanese', priceLevel: 3, rating: 4.8, distance: '1mi', tags: [], isOpenNow: true, phone: '', hours: '', description: '', photos: [], reviewCount: 20, hasReservation: false, noiseLevel: 'moderate', seating: [], busyLevel: 'moderate' },
  { id: 'r3', name: 'Taco Shop', imageUrl: 'http://img/3', address: '3 Main St', cuisine: 'Mexican', priceLevel: 1, rating: 4.2, distance: '0.3mi', tags: [], isOpenNow: true, phone: '', hours: '', description: '', photos: [], reviewCount: 5, hasReservation: false, noiseLevel: 'moderate', seating: [], busyLevel: 'moderate' },
];

const groupSwipePlan = {
  type: 'group-swipe' as const,
  title: 'Group Pick',
  cuisine: 'Any',
  budget: '$$',
  status: 'voting',
  restaurantOptions: mockRestaurantOptions,
};

describe('POST /plans/:id/swipe', () => {
  it('group-swipe invitees start as pending, swiping auto-accepts', async () => {
    const alice = await createTestUser({ name: 'Alice' });
    const bob = await createTestUser({ name: 'Bob' });

    const createRes = await request(app)
      .post('/plans')
      .set(authHeader(alice.token))
      .send({ ...groupSwipePlan, inviteeIds: [bob.userId] });
    expect(createRes.status).toBe(201);
    expect(createRes.body.restaurantOptions.length).toBe(3);
    expect(createRes.body.invites[0].status).toBe('pending');

    // Bob swipes — auto-accepts his invite
    const bobSwipe = await request(app)
      .post(`/plans/${createRes.body.id}/swipe`)
      .set(authHeader(bob.token))
      .send({ votes: ['r1'] });
    expect(bobSwipe.status).toBe(200);
    const bobInvite = bobSwipe.body.invites.find((i: { userId: string }) => i.userId === bob.userId);
    expect(bobInvite.status).toBe('accepted');
  });

  it('group swipe — both members submit → plan confirmed with winner', async () => {
    const alice = await createTestUser({ name: 'Alice' });
    const bob = await createTestUser({ name: 'Bob' });

    const createRes = await request(app)
      .post('/plans')
      .set(authHeader(alice.token))
      .send({ ...groupSwipePlan, inviteeIds: [bob.userId] });
    const planId = createRes.body.id ?? createRes.body._id;

    // Bob is pending — swiping will auto-accept him

    // Alice swipes — plan stays voting (Bob hasn't swiped)
    const aliceSwipe = await request(app)
      .post(`/plans/${planId}/swipe`)
      .set(authHeader(alice.token))
      .send({ votes: ['r1', 'r2'] });
    expect(aliceSwipe.status).toBe(200);
    expect(aliceSwipe.body.status).toBe('voting');
    expect(aliceSwipe.body.swipesCompleted).toContain(alice.userId);

    // Bob swipes — plan confirmed
    const bobSwipe = await request(app)
      .post(`/plans/${planId}/swipe`)
      .set(authHeader(bob.token))
      .send({ votes: ['r1', 'r3'] });
    expect(bobSwipe.status).toBe(200);
    expect(bobSwipe.body.status).toBe('confirmed');
    // r1 got 2 votes (both), r2 got 1 (alice), r3 got 1 (bob) → r1 wins
    expect(bobSwipe.body.restaurant.id).toBe('r1');
  });

  it('rejects duplicate swipe submission', async () => {
    const alice = await createTestUser({ name: 'Alice' });
    const bob = await createTestUser({ name: 'Bob' });

    // Create group plan with Bob (pending) so Alice's first swipe doesn't auto-confirm
    const createRes = await request(app)
      .post('/plans')
      .set(authHeader(alice.token))
      .send({ ...groupSwipePlan, inviteeIds: [bob.userId] });
    const planId = createRes.body.id ?? createRes.body._id;

    // First swipe succeeds (plan stays voting because Bob hasn't swiped)
    await request(app)
      .post(`/plans/${planId}/swipe`)
      .set(authHeader(alice.token))
      .send({ votes: ['r1'] });

    // Second swipe rejected
    const res = await request(app)
      .post(`/plans/${planId}/swipe`)
      .set(authHeader(alice.token))
      .send({ votes: ['r2'] });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/already submitted/i);
  });

  it('rejects non-participant', async () => {
    const alice = await createTestUser({ name: 'Alice' });
    const carol = await createTestUser({ name: 'Carol' });

    const createRes = await request(app)
      .post('/plans')
      .set(authHeader(alice.token))
      .send(groupSwipePlan);
    const planId = createRes.body.id ?? createRes.body._id;

    const res = await request(app)
      .post(`/plans/${planId}/swipe`)
      .set(authHeader(carol.token))
      .send({ votes: ['r1'] });
    expect(res.status).toBe(403);
  });

  it('rejects invalid restaurant IDs in votes', async () => {
    const alice = await createTestUser({ name: 'Alice' });

    const createRes = await request(app)
      .post('/plans')
      .set(authHeader(alice.token))
      .send(groupSwipePlan);
    const planId = createRes.body.id ?? createRes.body._id;

    const res = await request(app)
      .post(`/plans/${planId}/swipe`)
      .set(authHeader(alice.token))
      .send({ votes: ['r1', 'nonexistent'] });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/not in restaurantOptions/i);
  });

  it('3-person group — stays voting until all swipe', async () => {
    const alice = await createTestUser({ name: 'Alice' });
    const bob = await createTestUser({ name: 'Bob' });
    const carol = await createTestUser({ name: 'Carol' });

    const createRes = await request(app)
      .post('/plans')
      .set(authHeader(alice.token))
      .send({ ...groupSwipePlan, inviteeIds: [bob.userId, carol.userId] });
    const planId = createRes.body.id ?? createRes.body._id;

    // Both invitees start pending — swiping auto-accepts
    expect(createRes.body.invites[0].status).toBe('pending');
    expect(createRes.body.invites[1].status).toBe('pending');

    // Alice and Bob swipe — plan stays voting (Carol hasn't swiped)
    await request(app).post(`/plans/${planId}/swipe`).set(authHeader(alice.token)).send({ votes: ['r1'] });
    const bobSwipe = await request(app).post(`/plans/${planId}/swipe`).set(authHeader(bob.token)).send({ votes: ['r2'] });
    expect(bobSwipe.body.status).toBe('voting');
    expect(bobSwipe.body.swipesCompleted.length).toBe(2);

    // Carol swipes → all done → confirmed
    const carolSwipe = await request(app).post(`/plans/${planId}/swipe`).set(authHeader(carol.token)).send({ votes: ['r1', 'r3'] });
    expect(carolSwipe.body.status).toBe('confirmed');
    // r1 got 2 votes (Alice + Carol), r2 got 1 (Bob), r3 got 1 (Carol) → r1 wins
    expect(carolSwipe.body.restaurant.id).toBe('r1');
  });
});

// ─── Cancel Plan Tests ─────────────────────────────────────────────────────

describe('PUT /plans/:id/status (cancel)', () => {
  it('owner can cancel a voting plan — sets cancelledAt', async () => {
    const alice = await createTestUser({ name: 'Alice' });
    const bob = await createTestUser({ name: 'Bob' });
    const createRes = await request(app)
      .post('/plans')
      .set(authHeader(alice.token))
      .send({ ...basePlan, inviteeIds: [bob.userId] });
    const planId = createRes.body.id;

    const res = await request(app)
      .put(`/plans/${planId}/status`)
      .set(authHeader(alice.token))
      .send({ status: 'cancelled' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('cancelled');
    expect(res.body.cancelledAt).toBeTruthy();
  });

  it('non-owner cannot cancel', async () => {
    const alice = await createTestUser({ name: 'Alice' });
    const bob = await createTestUser({ name: 'Bob' });
    const createRes = await request(app)
      .post('/plans')
      .set(authHeader(alice.token))
      .send({ ...basePlan, inviteeIds: [bob.userId] });
    const planId = createRes.body.id;

    const res = await request(app)
      .put(`/plans/${planId}/status`)
      .set(authHeader(bob.token))
      .send({ status: 'cancelled' });
    expect(res.status).toBe(403);
  });
});

// ─── Delegate Tests ─────────────────────────────────────────────────────

describe('POST /plans/:id/delegate', () => {
  it('owner can delegate to an accepted invitee on 3+ person plan', async () => {
    const alice = await createTestUser({ name: 'Alice' });
    const bob = await createTestUser({ name: 'Bob' });
    const carol = await createTestUser({ name: 'Carol' });

    const createRes = await request(app)
      .post('/plans')
      .set(authHeader(alice.token))
      .send({ ...basePlan, inviteeIds: [bob.userId, carol.userId] });
    const planId = createRes.body.id;

    // Bob accepts
    await request(app)
      .post(`/plans/${planId}/rsvp`)
      .set(authHeader(bob.token))
      .send({ action: 'accept' });

    const res = await request(app)
      .post(`/plans/${planId}/delegate`)
      .set(authHeader(alice.token))
      .send({ newOwnerId: bob.userId });
    expect(res.status).toBe(200);
    expect(res.body.ownerId).toBe(bob.userId);
    // Bob removed from invites (now owner), Carol still there
    expect(res.body.invites.find((i: any) => i.userId === bob.userId)).toBeUndefined();
    expect(res.body.invites.find((i: any) => i.userId === carol.userId)).toBeDefined();
  });

  it('blocks delegation on 2-person plan', async () => {
    const alice = await createTestUser({ name: 'Alice' });
    const bob = await createTestUser({ name: 'Bob' });

    const createRes = await request(app)
      .post('/plans')
      .set(authHeader(alice.token))
      .send({ ...basePlan, inviteeIds: [bob.userId] });
    const planId = createRes.body.id;

    await request(app)
      .post(`/plans/${planId}/rsvp`)
      .set(authHeader(bob.token))
      .send({ action: 'accept' });

    const res = await request(app)
      .post(`/plans/${planId}/delegate`)
      .set(authHeader(alice.token))
      .send({ newOwnerId: bob.userId });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/2-person/i);
  });

  it('rejects delegation to pending invitee', async () => {
    const alice = await createTestUser({ name: 'Alice' });
    const bob = await createTestUser({ name: 'Bob' });
    const carol = await createTestUser({ name: 'Carol' });

    const createRes = await request(app)
      .post('/plans')
      .set(authHeader(alice.token))
      .send({ ...basePlan, inviteeIds: [bob.userId, carol.userId] });
    const planId = createRes.body.id;

    // Bob is still pending
    const res = await request(app)
      .post(`/plans/${planId}/delegate`)
      .set(authHeader(alice.token))
      .send({ newOwnerId: bob.userId });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/accepted/i);
  });

  it('non-owner cannot delegate', async () => {
    const alice = await createTestUser({ name: 'Alice' });
    const bob = await createTestUser({ name: 'Bob' });
    const carol = await createTestUser({ name: 'Carol' });

    const createRes = await request(app)
      .post('/plans')
      .set(authHeader(alice.token))
      .send({ ...basePlan, inviteeIds: [bob.userId, carol.userId] });
    const planId = createRes.body.id;

    const res = await request(app)
      .post(`/plans/${planId}/delegate`)
      .set(authHeader(bob.token))
      .send({ newOwnerId: carol.userId });
    expect(res.status).toBe(403);
  });
});

// ─── Leave Plan Tests ─────────────────────────────────────────────────────

describe('POST /plans/:id/leave', () => {
  it('accepted invitee can leave — removed from invites and votes', async () => {
    const alice = await createTestUser({ name: 'Alice' });
    const bob = await createTestUser({ name: 'Bob' });

    const createRes = await request(app)
      .post('/plans')
      .set(authHeader(alice.token))
      .send({ ...basePlan, inviteeIds: [bob.userId] });
    const planId = createRes.body.id;

    await request(app)
      .post(`/plans/${planId}/rsvp`)
      .set(authHeader(bob.token))
      .send({ action: 'accept' });

    const res = await request(app)
      .post(`/plans/${planId}/leave`)
      .set(authHeader(bob.token));
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    // Since Bob was the only accepted invitee, auto-cancel
    expect(res.body.autoCancelled).toBe(true);
  });

  it('leaving with other accepted invitees does not auto-cancel', async () => {
    const alice = await createTestUser({ name: 'Alice' });
    const bob = await createTestUser({ name: 'Bob' });
    const carol = await createTestUser({ name: 'Carol' });

    const createRes = await request(app)
      .post('/plans')
      .set(authHeader(alice.token))
      .send({ ...basePlan, inviteeIds: [bob.userId, carol.userId] });
    const planId = createRes.body.id;

    // Both accept
    await request(app).post(`/plans/${planId}/rsvp`).set(authHeader(bob.token)).send({ action: 'accept' });
    await request(app).post(`/plans/${planId}/rsvp`).set(authHeader(carol.token)).send({ action: 'accept' });

    const res = await request(app)
      .post(`/plans/${planId}/leave`)
      .set(authHeader(bob.token));
    expect(res.status).toBe(200);
    expect(res.body.autoCancelled).toBe(false);

    // Verify Bob removed
    const getRes = await request(app).get(`/plans/${planId}`).set(authHeader(alice.token));
    expect(getRes.body.invites.find((i: any) => i.userId === bob.userId)).toBeUndefined();
    expect(getRes.body.invites.find((i: any) => i.userId === carol.userId)).toBeDefined();
  });

  it('owner cannot leave', async () => {
    const alice = await createTestUser({ name: 'Alice' });
    const bob = await createTestUser({ name: 'Bob' });

    const createRes = await request(app)
      .post('/plans')
      .set(authHeader(alice.token))
      .send({ ...basePlan, inviteeIds: [bob.userId] });
    const planId = createRes.body.id;

    const res = await request(app)
      .post(`/plans/${planId}/leave`)
      .set(authHeader(alice.token));
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/owner/i);
  });

  it('cannot leave completed plan', async () => {
    const alice = await createTestUser({ name: 'Alice' });
    const bob = await createTestUser({ name: 'Bob' });

    const createRes = await request(app)
      .post('/plans')
      .set(authHeader(alice.token))
      .send({ ...basePlan, inviteeIds: [bob.userId] });
    const planId = createRes.body.id;

    // Accept + confirm + complete
    await request(app).post(`/plans/${planId}/rsvp`).set(authHeader(bob.token)).send({ action: 'accept' });
    await request(app).put(`/plans/${planId}/status`).set(authHeader(alice.token)).send({ status: 'confirmed' });
    await request(app).put(`/plans/${planId}/status`).set(authHeader(alice.token)).send({ status: 'completed' });

    const res = await request(app)
      .post(`/plans/${planId}/leave`)
      .set(authHeader(bob.token));
    expect(res.status).toBe(400);
  });

  it('pending invitee leaving does not auto-cancel', async () => {
    const alice = await createTestUser({ name: 'Alice' });
    const bob = await createTestUser({ name: 'Bob' });

    const createRes = await request(app)
      .post('/plans')
      .set(authHeader(alice.token))
      .send({ ...basePlan, inviteeIds: [bob.userId] });
    const planId = createRes.body.id;

    // Bob leaves while still pending
    const res = await request(app)
      .post(`/plans/${planId}/leave`)
      .set(authHeader(bob.token));
    expect(res.status).toBe(200);
    expect(res.body.autoCancelled).toBe(false);
  });
});
