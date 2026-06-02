import Plan, { IOpeningPeriod } from '../models/Plan';
import { createNotification, createNotificationForMany } from '../utils/createNotification';
import { tallyWinner } from '../utils/tallyVotes';

// ---------------------------------------------------------------------------
// Backend-local isOpenAt — mirrors lib/restaurantHours.ts.
// Keep in sync if that file changes. Duplicated here because the backend
// tsconfig rootDir is ./src and cannot import from the root lib/ folder.
// ---------------------------------------------------------------------------
function isOpenAt(periods: IOpeningPeriod[] | undefined, eventDate: Date): boolean {
  if (periods === undefined) return true;
  if (periods.length === 0) return false;

  const eventDay = eventDate.getDay();
  const eventMinutes = eventDate.getHours() * 60 + eventDate.getMinutes();

  for (const period of periods) {
    if (!period.close) return true;
    const openDay = period.open.day;
    const openMin = period.open.hour * 60 + period.open.minute;
    const closeDay = period.close.day;
    const closeMin = period.close.hour * 60 + period.close.minute;
    if (openDay === closeDay) {
      if (eventDay === openDay && eventMinutes >= openMin && eventMinutes < closeMin) return true;
      continue;
    }
    if (eventDay === openDay && eventMinutes >= openMin) return true;
    if (eventDay === closeDay && eventMinutes < closeMin) return true;
  }
  return false;
}

/**
 * Enforce RSVP deadlines for planned events.
 * Called by cron every 5 minutes. Also callable in tests with a fake `asOf` date.
 */
export async function enforceRsvpDeadlines(asOf?: Date): Promise<void> {
  const now = asOf ?? new Date();

  // Step 1: Find planned events past their RSVP deadline that still have pending invites
  const plansWithPending = await Plan.find({
    type: 'planned',
    status: 'voting',
    rsvpDeadline: { $lte: now },
    'invites.status': 'pending',
  });

  for (const plan of plansWithPending) {
    const pendingInvites = plan.invites.filter(i => i.status === 'pending');

    // Auto-decline each pending invite
    for (const invite of pendingInvites) {
      invite.status = 'declined';
      invite.respondedAt = now;

      // Notify the invitee
      await createNotification({
        userId: invite.userId.toString(),
        type: 'rsvp_deadline_passed',
        title: 'RSVP Deadline Passed',
        body: `You didn't respond to "${plan.title}" in time. You've been removed from the plan.`,
        data: { planId: plan.id },
      });

      // Notify the organizer
      await createNotification({
        userId: plan.ownerId.toString(),
        type: 'rsvp_deadline_missed_organizer',
        title: 'RSVP Deadline Missed',
        body: `${invite.name} didn't respond to "${plan.title}" before the deadline.`,
        data: { planId: plan.id },
      });
    }

    await plan.save();
  }

  // Step 2: Open voting for plans past their deadline where votingOpenedAt is not yet set
  // Using $eq: null matches both missing fields and explicit null values
  const plansToOpenVoting = await Plan.find({
    type: 'planned',
    status: 'voting',
    rsvpDeadline: { $lte: now },
    votingOpenedAt: { $eq: null },
  });

  for (const plan of plansToOpenVoting) {
    plan.votingOpenedAt = now;
    await plan.save();

    // Notify accepted invitees that voting is now open
    const acceptedIds = plan.invites
      .filter(i => i.status === 'accepted')
      .map(i => i.userId.toString());

    // Include the owner
    const notifyIds = [plan.ownerId.toString(), ...acceptedIds];

    if (notifyIds.length > 0) {
      await createNotificationForMany(
        notifyIds,
        'voting_open',
        'Voting is Open!',
        `RSVP deadline passed for "${plan.title}". Time to vote on restaurants!`,
        { planId: plan.id },
      );
    }
  }

  // Step 3: Auto-confirm plans where the event date+time has arrived
  const plansToAutoConfirm = await Plan.find({
    type: 'planned',
    status: 'voting',
    rsvpDeadline: { $lte: now },
  });

  for (const plan of plansToAutoConfirm) {
    if (!plan.date) continue;

    let eventTime: Date;
    if (plan.time) {
      const timeMatch = plan.time.match(/^(\d+):(\d+)\s*(AM|PM)$/i);
      if (timeMatch) {
        let h = parseInt(timeMatch[1], 10);
        const m = parseInt(timeMatch[2], 10);
        const isPM = timeMatch[3].toUpperCase() === 'PM';
        if (isPM && h !== 12) h += 12;
        if (!isPM && h === 12) h = 0;
        const [year, month, day] = plan.date.split('-').map(Number);
        eventTime = new Date(year, month - 1, day, h, m);
      } else {
        eventTime = new Date(plan.date);
      }
    } else {
      eventTime = new Date(plan.date);
    }

    if (eventTime.getTime() <= now.getTime()) {
      const winner = tallyWinner(plan);
      if (winner) {
        plan.restaurant = {
          id: winner.id,
          name: winner.name,
          imageUrl: winner.imageUrl,
          address: winner.address,
          cuisine: winner.cuisine,
          priceLevel: winner.priceLevel,
          rating: winner.rating,
          openingPeriods: winner.openingPeriods,
        };
      }
      plan.status = 'confirmed';
      await plan.save();

      // Notify all participants
      const allIds = [
        plan.ownerId.toString(),
        ...plan.invites.filter(i => i.status === 'accepted').map(i => i.userId.toString()),
      ];
      if (allIds.length > 0 && winner) {
        await createNotificationForMany(
          allIds,
          'group_swipe_result',
          'Restaurant Picked!',
          `The group picked ${winner.name} for "${plan.title}"`,
          { planId: plan.id },
        );
      }

      // REQ-003: detect closed winner and notify owner
      if (plan.restaurant) {
        await detectClosedWinnerEnforcer(plan, now);
        if (plan.winnerClosedAt) await plan.save();
      }
    }
  }
}

/**
 * Deadline-enforcer variant of detectClosedWinner. Uses the enforcer's `asOf`
 * time rather than Date.now() so tests with a fake asOf date work correctly.
 */
async function detectClosedWinnerEnforcer(
  plan: InstanceType<typeof Plan>,
  asOf: Date,
): Promise<void> {
  if (plan.type !== 'planned') return;
  if (!plan.date || !plan.time || !plan.restaurant) return;
  if (plan.restaurant.openingPeriods === undefined) return;

  // Parse plan date/time as wall-clock. Construct via Date.UTC so that
  // getDay()/getHours() on a UTC host equal the wall-clock values.
  const parts = plan.date.split('-').map(Number);
  if (parts.length !== 3) return;
  const [year, month, day] = parts;
  const timeMatch = plan.time.match(/^(\d+):(\d+)\s*(AM|PM)$/i);
  if (!timeMatch) return;
  let h = parseInt(timeMatch[1], 10);
  const m = parseInt(timeMatch[2], 10);
  if (timeMatch[3].toUpperCase() === 'PM' && h !== 12) h += 12;
  if (timeMatch[3].toUpperCase() === 'AM' && h === 12) h = 0;
  const eventDate = new Date(Date.UTC(year, month - 1, day, h, m));

  // Skip past events
  if (eventDate.getTime() <= asOf.getTime()) return;

  const closed = !isOpenAt(plan.restaurant.openingPeriods, eventDate);
  if (!closed) return;

  plan.winnerClosedAt = new Date();
  plan.winnerClosedMembersNotified = false;

  await createNotification({
    userId: plan.ownerId.toString(),
    type: 'plan_winner_closed',
    title: 'Heads up',
    body: `${plan.restaurant.name} may be closed at your "${plan.title}" time. Tap to reschedule or switch.`,
    data: { planId: plan._id.toString() },
  });
}
