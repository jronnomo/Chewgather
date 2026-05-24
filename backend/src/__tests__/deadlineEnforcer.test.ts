import { connectTestDB, disconnectTestDB, clearDB } from './helpers/db';
import { createTestUser } from './helpers/auth';
import Plan from '../models/Plan';
import Notification from '../models/Notification';
import { enforceRsvpDeadlines } from '../jobs/deadlineEnforcer';

beforeAll(async () => { await connectTestDB(); });
afterAll(async () => { await disconnectTestDB(); });
afterEach(async () => { await clearDB(); });

const mockRestaurantOptions = [
  { id: 'r1', name: 'Pizza Place', imageUrl: 'http://img/1', address: '1 Main St', cuisine: 'Italian', priceLevel: 2, rating: 4.5, distance: '0.5mi', tags: [], isOpenNow: true, phone: '', hours: '', description: '', photos: [], reviewCount: 10, hasReservation: false, noiseLevel: 'moderate', seating: [], busyLevel: 'moderate' },
];

async function createPlannedEvent(ownerId: string, inviteUsers: { userId: string; name: string }[], overrides: Record<string, unknown> = {}) {
  return Plan.create({
    type: 'planned',
    title: 'Test Dinner',
    date: '2026-04-01',
    time: '7:00 PM',
    ownerId,
    status: 'voting',
    cuisine: 'Italian',
    budget: '$$',
    invites: inviteUsers.map(u => ({ userId: u.userId, name: u.name, status: 'pending' })),
    rsvpDeadline: new Date('2026-03-01T12:00:00Z'),
    restaurantOptions: mockRestaurantOptions,
    ...overrides,
  });
}

describe('enforceRsvpDeadlines', () => {
  it('auto-declines pending invitees on past-deadline plans', async () => {
    const alice = await createTestUser({ name: 'Alice' });
    const bob = await createTestUser({ name: 'Bob' });

    await createPlannedEvent(alice.userId, [{ userId: bob.userId, name: 'Bob' }], {
      rsvpDeadline: new Date('2026-02-20T12:00:00Z'), // Past
    });

    // Run enforcer with a time after the deadline
    await enforceRsvpDeadlines(new Date('2026-02-25T12:00:00Z'));

    const plans = await Plan.find({});
    expect(plans[0].invites[0].status).toBe('declined');

    // Check notifications were created
    const notifs = await Notification.find({});
    const deadlineNotifs = notifs.filter(n =>
      n.type === 'rsvp_deadline_passed' || n.type === 'rsvp_deadline_missed_organizer'
    );
    expect(deadlineNotifs.length).toBe(2); // One for invitee, one for organizer
  });

  it('does NOT touch accepted or declined invitees', async () => {
    const alice = await createTestUser({ name: 'Alice' });
    const bob = await createTestUser({ name: 'Bob' });
    const carol = await createTestUser({ name: 'Carol' });

    const plan = await createPlannedEvent(alice.userId, [
      { userId: bob.userId, name: 'Bob' },
      { userId: carol.userId, name: 'Carol' },
    ], {
      rsvpDeadline: new Date('2026-02-20T12:00:00Z'),
    });

    // Manually accept Bob, decline Carol
    plan.invites[0].status = 'accepted';
    plan.invites[0].respondedAt = new Date();
    plan.invites[1].status = 'declined';
    plan.invites[1].respondedAt = new Date();
    await plan.save();

    await enforceRsvpDeadlines(new Date('2026-02-25T12:00:00Z'));

    const updated = await Plan.findById(plan._id);
    expect(updated!.invites[0].status).toBe('accepted'); // Unchanged
    expect(updated!.invites[1].status).toBe('declined'); // Unchanged
  });

  it('does NOT touch future-deadline plans', async () => {
    const alice = await createTestUser({ name: 'Alice' });
    const bob = await createTestUser({ name: 'Bob' });

    await createPlannedEvent(alice.userId, [{ userId: bob.userId, name: 'Bob' }], {
      rsvpDeadline: new Date('2026-12-01T12:00:00Z'), // Far future
    });

    await enforceRsvpDeadlines(new Date('2026-02-25T12:00:00Z'));

    const plans = await Plan.find({});
    expect(plans[0].invites[0].status).toBe('pending'); // Unchanged
  });

  it('sets votingOpenedAt and skips re-notification on second run', async () => {
    const alice = await createTestUser({ name: 'Alice' });
    const bob = await createTestUser({ name: 'Bob' });

    const plan = await createPlannedEvent(alice.userId, [{ userId: bob.userId, name: 'Bob' }], {
      rsvpDeadline: new Date('2026-02-20T12:00:00Z'),
    });

    // Manually accept Bob so plan has accepted invitees
    plan.invites[0].status = 'accepted';
    plan.invites[0].respondedAt = new Date();
    await plan.save();

    const asOf = new Date('2026-02-25T12:00:00Z');

    // First run: should set votingOpenedAt and create voting_open notifications
    await enforceRsvpDeadlines(asOf);
    const after1 = await Plan.findById(plan._id);
    expect(after1!.votingOpenedAt).toBeDefined();

    const notifCount1 = await Notification.countDocuments({ type: 'voting_open' });
    expect(notifCount1).toBeGreaterThan(0);

    // Second run: should NOT create duplicate voting_open notifications
    await enforceRsvpDeadlines(asOf);
    const notifCount2 = await Notification.countDocuments({ type: 'voting_open' });
    expect(notifCount2).toBe(notifCount1); // Same count — no duplicates
  });

  it('auto-confirms when event date+time has arrived', async () => {
    const alice = await createTestUser({ name: 'Alice' });
    const bob = await createTestUser({ name: 'Bob' });

    const plan = await createPlannedEvent(alice.userId, [{ userId: bob.userId, name: 'Bob' }], {
      rsvpDeadline: new Date('2026-02-20T12:00:00Z'),
      date: '2026-02-24',
      time: '7:00 PM',
    });

    // Accept Bob's invite so he's not auto-declined
    plan.invites[0].status = 'accepted';
    plan.invites[0].respondedAt = new Date();
    await plan.save();

    // Run enforcer 1 day past the event so the comparison is unambiguous in
    // any test-runner timezone (deadlineEnforcer parses date+time as LOCAL
    // via `new Date(y, m, d, h, m)`; using `2026-02-25T00Z` is past in UTC
    // but still future in UTC-7 since local Feb-24 7pm = Feb-25 2am UTC).
    await enforceRsvpDeadlines(new Date('2026-02-26T00:00:00Z'));

    const updated = await Plan.findById(plan._id);
    expect(updated!.status).toBe('confirmed');
    expect(updated!.restaurant).toBeDefined();
    expect(updated!.restaurant!.id).toBe('r1');
  });
});
