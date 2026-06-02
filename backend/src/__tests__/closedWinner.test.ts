/**
 * AC-15 — Closed-Winner Resolution Test Suite
 *
 * Covers:
 *   (a) detectClosedWinner timezone-correctness (unit-level, via POST /:id/confirm-status)
 *   (b) tallyRanked — full vote-ranked order
 *   (c) POST /plans/:id/resolve-winner — all 4 actions + guard conditions
 */

import request from 'supertest';
import app from '../app';
import Plan from '../models/Plan';
import { connectTestDB, disconnectTestDB, clearDB } from './helpers/db';
import { createTestUser, authHeader } from './helpers/auth';
import { tallyRanked } from '../utils/tallyVotes';
import { IPlan } from '../models/Plan';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

beforeAll(async () => { await connectTestDB(); });
afterAll(async () => { await disconnectTestDB(); });
afterEach(async () => { await clearDB(); });

/** A future date string far enough ahead to avoid past-event guards. */
function futureDateStr(daysAhead = 30): string {
  const d = new Date(Date.now() + daysAhead * 24 * 60 * 60 * 1000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** A past date string to test past-event guard. */
function pastDateStr(daysBack = 2): string {
  const d = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Minimal restaurant option shape matching IPlanRestaurantOption
// imageUrl must be non-empty (Mongoose required validator)
const minOption = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  name: `Restaurant ${id}`,
  imageUrl: `https://img.test/${id}.jpg`,
  address: '1 Main St',
  cuisine: 'Italian',
  priceLevel: 2,
  rating: 4.0,
  distance: '',
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
  ...overrides,
});

// Opening periods: open Mon–Sun 10am–10pm (day 0 = Sun … day 6 = Sat, hour 22 = 10pm)
function openAllWeek10to22(): Array<{ open: { day: number; hour: number; minute: number }; close: { day: number; hour: number; minute: number } }> {
  return [0, 1, 2, 3, 4, 5, 6].map(day => ({
    open: { day, hour: 10, minute: 0 },
    close: { day, hour: 22, minute: 0 },
  }));
}

// Opening periods: 24/7 open (no close field — represents a venue that never closes)
function open24x7(): Array<{ open: { day: number; hour: number; minute: number } }> {
  return [{ open: { day: 0, hour: 0, minute: 0 } }]; // no close → 24/7 per isOpenAt
}

// ---------------------------------------------------------------------------
// (a) detectClosedWinner — timezone-correctness
//
// detectClosedWinner is an internal function called after plan confirm.
// We test it indirectly by creating a plan with a confirmed restaurant and
// calling the confirm-status route (PUT /:id/status) which triggers detection.
// We then check the plan document for winnerClosedAt.
// ---------------------------------------------------------------------------

describe('detectClosedWinner — timezone correctness', () => {
  /**
   * Build a confirmed plan with a specific restaurant opening period and event time,
   * then call PUT /:id/status to simulate the backend detection path.
   * Returns the plan document after the route runs.
   */
  async function buildAndConfirmPlan(opts: {
    date: string;
    time: string;
    openingPeriods: Array<{ open: { day: number; hour: number; minute: number }; close?: { day: number; hour: number; minute: number } }> | undefined;
  }) {
    const alice = await createTestUser({ name: 'Alice' });

    // Create a planned plan
    const createRes = await request(app)
      .post('/plans')
      .set(authHeader(alice.token))
      .send({
        title: 'Test Plan',
        date: opts.date,
        time: opts.time,
        cuisine: 'Italian',
        budget: '$$',
        rsvpDeadline: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      });
    expect(createRes.status).toBe(201);
    const planId = createRes.body.id ?? createRes.body._id;

    // Set restaurantOptions + votes using the Mongoose document API.
    // Leave restaurant UNSET so the status route's tallyWinner picks r1 and
    // copies its openingPeriods into plan.restaurant — the real production path
    // that detectClosedWinner then reads.
    const planDoc = await Plan.findById(planId);
    if (!planDoc) throw new Error('Plan not found after create');

    const restaurantOption = minOption('r1', { openingPeriods: opts.openingPeriods });
    planDoc.restaurantOptions = [restaurantOption] as any;
    planDoc.votes = { [alice.userId]: ['r1'] } as any;
    planDoc.restaurant = undefined; // let tallyWinner set it with the real openingPeriods
    planDoc.markModified('restaurantOptions');
    planDoc.markModified('votes');
    await planDoc.save();

    // Trigger the confirm path via PUT /:id/status → confirmed.
    // tallyWinner picks r1 (only option), copies openingPeriods into plan.restaurant,
    // then detectClosedWinner fires and checks plan.restaurant.openingPeriods.
    const confirmRes = await request(app)
      .put(`/plans/${planId}/status`)
      .set(authHeader(alice.token))
      .send({ status: 'confirmed' });
    expect(confirmRes.status).toBe(200);

    return Plan.findById(planId).lean();
  }

  it('sets winnerClosedAt when restaurant openingPeriods is empty (permanently closed)', async () => {
    // openingPeriods: [] → isOpenAt returns false unconditionally → always "closed" → detected.
    // This is timezone-invariant: no UTC offset can make an empty periods array open.
    // It validates the detection pipeline end-to-end (plan confirm → tallyWinner → detectClosedWinner).
    const plan = await buildAndConfirmPlan({
      date: futureDateStr(30),
      time: '8:00 PM',
      openingPeriods: [],
    });
    expect(plan?.winnerClosedAt).toBeTruthy();
  });

  it('sets winnerClosedAt when plan time is outside restaurant open hours (10pm close, 11pm plan)', async () => {
    // Restaurant closes at 10pm (hour 22). Plan at 11pm (hour 23) → closed.
    // parsePlanEventDate now uses the plain local constructor, so getHours()
    // reads back the wall-clock hour (23) on ANY host (UTC or local) — this
    // assertion is host-independent and would catch the prior Date.UTC bug.
    const plan = await buildAndConfirmPlan({
      date: futureDateStr(30),
      time: '11:00 PM',
      openingPeriods: openAllWeek10to22(),
    });
    expect(plan?.winnerClosedAt).toBeTruthy();
  });

  it('does NOT set winnerClosedAt when restaurant is open 24/7 (no close field)', async () => {
    // 24/7 venue (no close field) → isOpenAt always returns true → never detected.
    // Timezone-invariant: the "no close" path returns true regardless of time.
    const plan = await buildAndConfirmPlan({
      date: futureDateStr(30),
      time: '11:00 PM',
      openingPeriods: open24x7() as any,
    });
    expect(plan?.winnerClosedAt).toBeFalsy();
  });

  it('does NOT set winnerClosedAt when plan is at 8pm and restaurant closes at 10pm (open case)', async () => {
    // Same open-hours window (10am–10pm). Plan at 8pm (inside window) → open.
    // Host-independent now that parsePlanEventDate uses the local constructor.
    const plan = await buildAndConfirmPlan({
      date: futureDateStr(30),
      time: '8:00 PM',
      openingPeriods: openAllWeek10to22(),
    });
    expect(plan?.winnerClosedAt).toBeFalsy();
  });

  it('does NOT set winnerClosedAt when openingPeriods is undefined', async () => {
    // undefined → treat as open (back-compat guard)
    const plan = await buildAndConfirmPlan({
      date: futureDateStr(30),
      time: '11:00 PM',
      openingPeriods: undefined,
    });
    expect(plan?.winnerClosedAt).toBeFalsy();
  });

  it('does NOT set winnerClosedAt for past events', async () => {
    // Past events are skipped by the past-event guard in detectClosedWinner.
    // The confirm route itself may reject past events — we handle either way.
    const alice = await createTestUser({ name: 'Alice' });
    const createRes = await request(app)
      .post('/plans')
      .set(authHeader(alice.token))
      .send({
        title: 'Past Plan',
        date: pastDateStr(2),
        time: '11:00 PM',
        cuisine: 'Italian',
        budget: '$$',
        rsvpDeadline: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      });
    // If creation succeeds, verify no detection for past events
    if (createRes.status === 201) {
      const planId = createRes.body.id ?? createRes.body._id;
      await Plan.findByIdAndUpdate(planId, {
        restaurant: {
          id: 'r1', name: 'Pizza Palace', imageUrl: 'https://img.test/r1.jpg', address: '1 Main St', cuisine: 'Italian',
          priceLevel: 2, rating: 4.5, openingPeriods: openAllWeek10to22(),
        },
        restaurantOptions: [minOption('r1', { openingPeriods: openAllWeek10to22() })],
        votes: { [alice.userId]: ['r1'] },
        status: 'voting',
      });
      const confirmRes = await request(app)
        .put(`/plans/${planId}/status`)
        .set(authHeader(alice.token))
        .send({ status: 'confirmed', restaurantId: 'r1' });
      if (confirmRes.status === 200) {
        const plan = await Plan.findById(planId).lean();
        expect(plan?.winnerClosedAt).toBeFalsy();
      }
      // If route rejects past event with 4xx, that's also correct — no detection needed
    }
  });

  it('does NOT set winnerClosedAt for group-swipe plans (non-planned type)', async () => {
    const alice = await createTestUser({ name: 'Alice' });
    const bob = await createTestUser({ name: 'Bob' });

    const createRes = await request(app)
      .post('/plans')
      .set(authHeader(alice.token))
      .send({
        type: 'group-swipe',
        title: 'Group Pick',
        cuisine: 'Any',
        budget: '$$',
        restaurantOptions: [minOption('r1', { openingPeriods: openAllWeek10to22() })],
        inviteeIds: [bob.userId],
      });
    expect(createRes.status).toBe(201);
    const planId = createRes.body.id ?? createRes.body._id;

    // Both members swipe to confirm
    await request(app)
      .post(`/plans/${planId}/swipe`)
      .set(authHeader(alice.token))
      .send({ votes: ['r1'] });
    await request(app)
      .post(`/plans/${planId}/swipe`)
      .set(authHeader(bob.token))
      .send({ votes: ['r1'] });

    const plan = await Plan.findById(planId).lean();
    // group-swipe type → detectClosedWinner should skip (type !== 'planned')
    expect(plan?.winnerClosedAt).toBeFalsy();
  });

  it('does NOT set winnerClosedAt for dateless plans', async () => {
    const alice = await createTestUser({ name: 'Alice' });

    // Create group-swipe (no date/time by nature)
    const createRes = await request(app)
      .post('/plans')
      .set(authHeader(alice.token))
      .send({
        type: 'group-swipe',
        title: 'Dateless Group Swipe',
        cuisine: 'Any',
        budget: '$$',
        restaurantOptions: [minOption('r1', { openingPeriods: openAllWeek10to22() })],
      });
    expect(createRes.status).toBe(201);
    const planId = createRes.body.id ?? createRes.body._id;

    // Owner swipes alone — plan confirms immediately (only member)
    await request(app)
      .post(`/plans/${planId}/swipe`)
      .set(authHeader(alice.token))
      .send({ votes: ['r1'] });

    const plan = await Plan.findById(planId).lean();
    expect(plan?.winnerClosedAt).toBeFalsy();
  });
});

// ---------------------------------------------------------------------------
// (b) tallyRanked — unit tests
// ---------------------------------------------------------------------------

describe('tallyRanked', () => {
  function mockPlan(overrides: Partial<IPlan> = {}): IPlan {
    return {
      restaurantOptions: [],
      votes: {},
      curveballIds: [],
      ...overrides,
    } as unknown as IPlan;
  }

  it('returns [] when restaurantOptions is empty', () => {
    expect(tallyRanked(mockPlan())).toEqual([]);
  });

  it('returns full ranked order, highest votes first', () => {
    const r1 = minOption('r1', { rating: 4.0 }) as any;
    const r2 = minOption('r2', { rating: 4.5 }) as any;
    const r3 = minOption('r3', { rating: 4.2 }) as any;
    const plan = mockPlan({
      restaurantOptions: [r1, r2, r3],
      votes: { u1: ['r2', 'r3'], u2: ['r2'] } as any,
    });
    const ranked = tallyRanked(plan);
    expect(ranked.length).toBe(3);
    expect(ranked[0].id).toBe('r2'); // 2 votes
    expect(ranked[1].id).toBe('r3'); // 1 vote
    expect(ranked[2].id).toBe('r1'); // 0 votes
  });

  it('tie-breaks by rating when vote counts are equal', () => {
    const r1 = minOption('r1', { rating: 4.0 }) as any;
    const r2 = minOption('r2', { rating: 4.8 }) as any;
    const plan = mockPlan({
      restaurantOptions: [r1, r2],
      votes: { u1: ['r1'], u2: ['r2'] } as any,
    });
    const ranked = tallyRanked(plan);
    expect(ranked[0].id).toBe('r2'); // same votes, higher rating wins
  });

  it('excludes curveball IDs from the ranked list', () => {
    const r1 = minOption('r1') as any;
    const r2 = minOption('r2') as any; // curveball
    const plan = mockPlan({
      restaurantOptions: [r1, r2],
      curveballIds: ['r2'],
      votes: { u1: ['r1', 'r2'] } as any,
    });
    const ranked = tallyRanked(plan);
    expect(ranked.length).toBe(1);
    expect(ranked[0].id).toBe('r1');
  });

  it('winner is ranked[0], matching tallyWinner', () => {
    const { tallyWinner } = require('../utils/tallyVotes');
    const r1 = minOption('r1', { rating: 4.9 }) as any;
    const r2 = minOption('r2', { rating: 4.0 }) as any;
    const plan = mockPlan({
      restaurantOptions: [r1, r2],
      votes: { u1: ['r1'], u2: ['r1'] } as any,
    });
    const ranked = tallyRanked(plan);
    const winner = tallyWinner(plan);
    expect(ranked[0].id).toBe(winner!.id);
  });
});

// ---------------------------------------------------------------------------
// (c) POST /plans/:id/resolve-winner — integration tests
// ---------------------------------------------------------------------------

describe('POST /plans/:id/resolve-winner', () => {
  /**
   * Creates a fully wired confirmed plan with winnerClosedAt set.
   * Returns { planId, alice (owner), bob (invited+accepted member) }.
   */
  async function setupClosedWinnerPlan(opts: {
    withMember?: boolean;
    openingPeriodsForOption?: Array<{ open: { day: number; hour: number; minute: number }; close: { day: number; hour: number; minute: number } }> | undefined;
  } = {}) {
    const alice = await createTestUser({ name: 'Alice' });
    const bob = opts.withMember ? await createTestUser({ name: 'Bob' }) : null;

    const createRes = await request(app)
      .post('/plans')
      .set(authHeader(alice.token))
      .send({
        title: 'Dinner Plan',
        date: futureDateStr(30),
        time: '8:00 PM',
        cuisine: 'Italian',
        budget: '$$',
        rsvpDeadline: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        ...(bob ? { inviteeIds: [bob.userId] } : {}),
      });
    expect(createRes.status).toBe(201);
    const planId = createRes.body.id ?? createRes.body._id;

    // Bob accepts if present
    if (bob) {
      await request(app)
        .post(`/plans/${planId}/rsvp`)
        .set(authHeader(bob.token))
        .send({ action: 'accept' });
    }

    // Set up confirmed plan with winnerClosedAt using Mongoose doc API
    // (findByIdAndUpdate is unreliable for Mixed-typed subdocument arrays)
    const planDoc = await Plan.findById(planId);
    if (!planDoc) throw new Error('Plan not found after create');

    const r2openingPeriods = opts.openingPeriodsForOption !== undefined
      ? opts.openingPeriodsForOption
      : openAllWeek10to22(); // r2 is open at 8pm by default

    planDoc.status = 'confirmed';
    planDoc.restaurant = {
      id: 'r1',
      name: 'Closed Spot',
      imageUrl: 'https://img.test/r1.jpg',
      address: '1 Main St',
      cuisine: 'Italian',
      priceLevel: 2,
      rating: 4.0,
      // openingPeriods intentionally undefined → reschedule validation skips hours check (per PRD §6)
      // winnerClosedAt is set directly below to simulate already-detected closed winner
    };
    planDoc.restaurantOptions = [
      minOption('r1', { rating: 4.0 }),
      minOption('r2', { name: 'Open Spot', rating: 4.5, openingPeriods: r2openingPeriods }),
    ] as any;
    planDoc.votes = { [alice.userId]: ['r1', 'r2'] } as any;
    planDoc.winnerClosedAt = new Date();
    planDoc.winnerClosedDismissed = false;
    planDoc.winnerClosedMembersNotified = false;
    planDoc.markModified('restaurant');
    planDoc.markModified('restaurantOptions');
    planDoc.markModified('votes');
    await planDoc.save();

    return { planId, alice, bob };
  }

  // ── reschedule ──────────────────────────────────────────────────────────

  describe('action: reschedule', () => {
    it('clears winnerClosedAt, updates time/date, returns 200', async () => {
      const { planId, alice } = await setupClosedWinnerPlan();
      const newDate = futureDateStr(31);

      const res = await request(app)
        .post(`/plans/${planId}/resolve-winner`)
        .set(authHeader(alice.token))
        .send({ action: 'reschedule', date: newDate, time: '11:00 AM' });

      expect(res.status).toBe(200);
      expect(res.body.winnerClosedAt).toBeFalsy();
      expect(res.body.date).toBe(newDate);
      expect(res.body.time).toBe('11:00 AM');
    });

    it('emits plan_rescheduled notification to members (not owner)', async () => {
      const { planId, alice, bob } = await setupClosedWinnerPlan({ withMember: true });
      const newDate = futureDateStr(31);

      const res = await request(app)
        .post(`/plans/${planId}/resolve-winner`)
        .set(authHeader(alice.token))
        .send({ action: 'reschedule', date: newDate, time: '11:00 AM' });

      expect(res.status).toBe(200);
      // Bob (member) should have a plan_rescheduled notification
      const notifRes = await request(app)
        .get('/notifications')
        .set(authHeader(bob!.token));
      expect(notifRes.status).toBe(200);
      const notif = notifRes.body.notifications.find((n: { type: string }) => n.type === 'plan_rescheduled');
      expect(notif).toBeDefined();
    });

    it('returns 400 when time/date missing', async () => {
      const { planId, alice } = await setupClosedWinnerPlan();
      const res = await request(app)
        .post(`/plans/${planId}/resolve-winner`)
        .set(authHeader(alice.token))
        .send({ action: 'reschedule' });
      expect(res.status).toBe(400);
    });
  });

  // ── switch ──────────────────────────────────────────────────────────────

  describe('action: switch', () => {
    it('clears winnerClosedAt, switches restaurant to ranked open option', async () => {
      const { planId, alice } = await setupClosedWinnerPlan();

      const res = await request(app)
        .post(`/plans/${planId}/resolve-winner`)
        .set(authHeader(alice.token))
        .send({ action: 'switch', restaurantId: 'r2' });

      expect(res.status).toBe(200);
      expect(res.body.winnerClosedAt).toBeFalsy();
      expect(res.body.restaurant.id).toBe('r2');
    });

    it('emits plan_restaurant_changed notification to members', async () => {
      const { planId, alice, bob } = await setupClosedWinnerPlan({ withMember: true });

      await request(app)
        .post(`/plans/${planId}/resolve-winner`)
        .set(authHeader(alice.token))
        .send({ action: 'switch', restaurantId: 'r2' });

      const notifRes = await request(app)
        .get('/notifications')
        .set(authHeader(bob!.token));
      expect(notifRes.status).toBe(200);
      const notif = notifRes.body.notifications.find((n: { type: string }) => n.type === 'plan_restaurant_changed');
      expect(notif).toBeDefined();
    });

    it('returns 400 when switching to a non-ranked option (not in restaurantOptions votes)', async () => {
      const { planId, alice } = await setupClosedWinnerPlan();

      const res = await request(app)
        .post(`/plans/${planId}/resolve-winner`)
        .set(authHeader(alice.token))
        .send({ action: 'switch', restaurantId: 'r-nonexistent' });

      expect(res.status).toBe(400);
    });

    it('returns 400 when switch target is closed at plan time', async () => {
      // r2 is also closed (only open Mon 10-11am)
      const closedPeriods = [{ open: { day: 1, hour: 10, minute: 0 }, close: { day: 1, hour: 11, minute: 0 } }];
      const { planId, alice } = await setupClosedWinnerPlan({
        openingPeriodsForOption: closedPeriods,
      });

      const res = await request(app)
        .post(`/plans/${planId}/resolve-winner`)
        .set(authHeader(alice.token))
        .send({ action: 'switch', restaurantId: 'r2' });

      expect(res.status).toBe(400);
    });
  });

  // ── keep ────────────────────────────────────────────────────────────────

  describe('action: keep', () => {
    it('keeps winnerClosedAt, sets winnerClosedMembersNotified, returns plan', async () => {
      const { planId, alice } = await setupClosedWinnerPlan({ withMember: true });

      const res = await request(app)
        .post(`/plans/${planId}/resolve-winner`)
        .set(authHeader(alice.token))
        .send({ action: 'keep' });

      expect(res.status).toBe(200);
      expect(res.body.winnerClosedAt).toBeTruthy(); // flag persists
      expect(res.body.winnerClosedMembersNotified).toBe(true);
    });

    it('emits plan_kept_despite_hours to members once only on first keep', async () => {
      const { planId, alice, bob } = await setupClosedWinnerPlan({ withMember: true });

      // First keep
      await request(app)
        .post(`/plans/${planId}/resolve-winner`)
        .set(authHeader(alice.token))
        .send({ action: 'keep' });

      const notifRes1 = await request(app)
        .get('/notifications')
        .set(authHeader(bob!.token));
      expect(notifRes1.status).toBe(200);
      const keptNotifs1 = notifRes1.body.notifications.filter((n: { type: string }) => n.type === 'plan_kept_despite_hours');
      expect(keptNotifs1.length).toBe(1);

      // Second keep — no additional notification
      await request(app)
        .post(`/plans/${planId}/resolve-winner`)
        .set(authHeader(alice.token))
        .send({ action: 'keep' });

      const notifRes2 = await request(app)
        .get('/notifications')
        .set(authHeader(bob!.token));
      expect(notifRes2.status).toBe(200);
      const keptNotifs2 = notifRes2.body.notifications.filter((n: { type: string }) => n.type === 'plan_kept_despite_hours');
      expect(keptNotifs2.length).toBe(1); // still only one
    });
  });

  // ── dismiss ─────────────────────────────────────────────────────────────

  describe('action: dismiss', () => {
    it('sets winnerClosedDismissed = true, winnerClosedAt remains', async () => {
      const { planId, alice } = await setupClosedWinnerPlan();

      const res = await request(app)
        .post(`/plans/${planId}/resolve-winner`)
        .set(authHeader(alice.token))
        .send({ action: 'dismiss' });

      expect(res.status).toBe(200);
      expect(res.body.winnerClosedDismissed).toBe(true);
      expect(res.body.winnerClosedAt).toBeTruthy(); // passive flag persists
    });

    it('second dismiss is idempotent and does NOT re-notify members', async () => {
      const { planId, alice, bob } = await setupClosedWinnerPlan({ withMember: true });

      // First dismiss
      await request(app)
        .post(`/plans/${planId}/resolve-winner`)
        .set(authHeader(alice.token))
        .send({ action: 'dismiss' });

      const notifRes1 = await request(app)
        .get('/notifications')
        .set(authHeader(bob!.token));
      expect(notifRes1.status).toBe(200);
      const keptNotifs1 = notifRes1.body.notifications.filter((n: { type: string }) => n.type === 'plan_kept_despite_hours');
      expect(keptNotifs1.length).toBe(1);

      // Second dismiss — winnerClosedMembersNotified is already true, no new notification
      await request(app)
        .post(`/plans/${planId}/resolve-winner`)
        .set(authHeader(alice.token))
        .send({ action: 'dismiss' });

      const notifRes2 = await request(app)
        .get('/notifications')
        .set(authHeader(bob!.token));
      expect(notifRes2.status).toBe(200);
      const keptNotifs2 = notifRes2.body.notifications.filter((n: { type: string }) => n.type === 'plan_kept_despite_hours');
      expect(keptNotifs2.length).toBe(1); // no duplicate
    });
  });

  // ── auth / guard ─────────────────────────────────────────────────────────

  describe('auth and guards', () => {
    it('returns 403 when non-owner calls resolve-winner', async () => {
      const { planId, bob } = await setupClosedWinnerPlan({ withMember: true });

      const res = await request(app)
        .post(`/plans/${planId}/resolve-winner`)
        .set(authHeader(bob!.token))
        .send({ action: 'keep' });

      expect(res.status).toBe(403);
    });

    it('returns 401 when unauthenticated', async () => {
      const { planId } = await setupClosedWinnerPlan();
      const res = await request(app)
        .post(`/plans/${planId}/resolve-winner`)
        .send({ action: 'keep' });
      expect(res.status).toBe(401);
    });

    it('returns 400 for unknown action', async () => {
      const { planId, alice } = await setupClosedWinnerPlan();
      const res = await request(app)
        .post(`/plans/${planId}/resolve-winner`)
        .set(authHeader(alice.token))
        .send({ action: 'fly-away' });
      expect(res.status).toBe(400);
    });

    it('returns 404 for non-existent plan', async () => {
      const alice = await createTestUser({ name: 'Alice' });
      const res = await request(app)
        .post('/plans/000000000000000000000000/resolve-winner')
        .set(authHeader(alice.token))
        .send({ action: 'keep' });
      expect(res.status).toBe(404);
    });
  });
});
