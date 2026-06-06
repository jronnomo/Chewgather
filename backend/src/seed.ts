/**
 * Seed script — populates the chewabl database with test users, friendships, and plans.
 * Run with:  npm run seed
 *
 * Idempotent: clears existing seed users (identified by @chewabl.dev emails) before inserting.
 *
 * Test credentials after seeding:
 *   alice@chewabl.dev   / seed1234
 *   bob@chewabl.dev     / seed1234
 *   carol@chewabl.dev   / seed1234
 *   dan@chewabl.dev     / seed1234
 *   eve@chewabl.dev     / seed1234
 */

import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';
import { nanoid } from 'nanoid';
import User from './models/User';
import Friendship from './models/Friendship';
import Plan from './models/Plan';
import Notification from './models/Notification';

dotenv.config();

const SEED_EMAILS = [
  'alice@chewabl.dev',
  'bob@chewabl.dev',
  'carol@chewabl.dev',
  'dan@chewabl.dev',
  'eve@chewabl.dev',
];

const SEED_PASSWORD = 'seed1234';

const SEED_USERS = [
  { name: 'Alice Chen',   email: 'alice@chewabl.dev', phone: '+14155550101', avatarUri: 'https://res.cloudinary.com/dxykko8em/image/upload/v1772418833/chewabl/seed-avatars/alice.png' },
  { name: 'Bob Nguyen',   email: 'bob@chewabl.dev',   phone: '+14155550102', avatarUri: 'https://res.cloudinary.com/dxykko8em/image/upload/v1772418835/chewabl/seed-avatars/bob.png' },
  { name: 'Carol Davis',  email: 'carol@chewabl.dev', phone: '+14155550103', avatarUri: 'https://res.cloudinary.com/dxykko8em/image/upload/v1772418836/chewabl/seed-avatars/carol.png' },
  { name: 'Dan Park',     email: 'dan@chewabl.dev',   phone: '+14155550104', avatarUri: 'https://res.cloudinary.com/dxykko8em/image/upload/v1772418838/chewabl/seed-avatars/dan.png' },
  { name: 'Eve Torres',   email: 'eve@chewabl.dev',   phone: '+14155550105', avatarUri: 'https://res.cloudinary.com/dxykko8em/image/upload/v1772418839/chewabl/seed-avatars/eve.png' },
];

async function seed() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI not set in .env');

  await mongoose.connect(uri);
  console.log('Connected to MongoDB');

  // ── 1. Clear previous seed data ─────────────────────────────────────────
  const oldUsers = await User.find({ email: { $in: SEED_EMAILS } }).select('_id');
  const oldIds = oldUsers.map(u => u._id);

  await User.deleteMany({ email: { $in: SEED_EMAILS } });
  await Friendship.deleteMany({
    $or: [{ requester: { $in: oldIds } }, { recipient: { $in: oldIds } }],
  });
  await Plan.deleteMany({ ownerId: { $in: oldIds } });
  // Clear seed users' notifications too — otherwise stale notifications from a
  // previous run point at plans that this reseed has deleted (dead deep-links).
  await Notification.deleteMany({ userId: { $in: oldIds } });

  console.log('Cleared previous seed data');

  // ── 2. Create users ──────────────────────────────────────────────────────
  const passwordHash = await bcrypt.hash(SEED_PASSWORD, 10);

  const createdUsers = await User.insertMany(
    SEED_USERS.map(u => ({
      ...u,
      passwordHash,
      inviteCode: nanoid(8).toUpperCase(),
      favorites: [],
    }))
  );

  const [alice, bob, carol, dan, eve] = createdUsers;
  console.log('Created users:', createdUsers.map(u => u.email).join(', '));

  // ── 3. Create friendships (all accepted) ─────────────────────────────────
  const pairs: [mongoose.Document, mongoose.Document][] = [
    [alice, bob],
    [alice, carol],
    [alice, dan],
    [alice, eve],
    [bob, carol],
    [bob, dan],
    [carol, eve],
    [dan, eve],
  ];

  await Friendship.insertMany(
    pairs.map(([a, b]) => ({
      requester: a._id,
      recipient: b._id,
      status: 'accepted',
    }))
  );

  console.log(`Created ${pairs.length} friendships`);

  // ── 4. Create plans ──────────────────────────────────────────────────────
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const nextWeek = new Date();
  nextWeek.setDate(nextWeek.getDate() + 7);
  const lastWeek = new Date();
  lastWeek.setDate(lastWeek.getDate() - 7);

  const fmt = (d: Date) => d.toISOString().split('T')[0];

  // RSVP deadlines for request-to-join window testing.
  const inDays = (n: number) => { const d = new Date(); d.setDate(d.getDate() + n); return d; };
  const deadlineFuture = inDays(3);  // window OPEN — requests/approvals allowed
  const deadlinePast = inDays(-1);   // window CLOSED — new requests rejected (approve still ok while voting)

  await Plan.insertMany([
    // ── Original plans (explicit visibility: 'private' — invite-only, default) ──
    {
      title: 'Friday Night Dinner',
      date: fmt(tomorrow),
      time: '7:30 PM',
      ownerId: alice._id,
      status: 'voting',
      cuisine: 'Italian',
      budget: '$$$',
      visibility: 'private',
      invites: [
        { userId: bob._id,   name: bob.name,   status: 'accepted' },
        { userId: carol._id, name: carol.name, status: 'pending' },
        { userId: dan._id,   name: dan.name,   status: 'declined' },
      ],
      options: [],
      votes: {},
    },
    {
      title: 'Team Lunch',
      date: fmt(nextWeek),
      time: '12:00 PM',
      ownerId: bob._id,
      status: 'voting',
      cuisine: 'Korean',
      budget: '$$',
      visibility: 'private',
      invites: [
        { userId: alice._id, name: alice.name, status: 'accepted' },
        { userId: eve._id,   name: eve.name,   status: 'pending' },
      ],
      options: [],
      votes: {},
    },
    {
      title: 'Birthday Dinner',
      date: fmt(lastWeek),
      time: '8:00 PM',
      ownerId: carol._id,
      status: 'completed',
      cuisine: 'French',
      budget: '$$$$',
      visibility: 'private',
      invites: [
        { userId: alice._id, name: alice.name, status: 'accepted' },
        { userId: bob._id,   name: bob.name,   status: 'accepted' },
        { userId: dan._id,   name: dan.name,   status: 'accepted' },
        { userId: eve._id,   name: eve.name,   status: 'accepted' },
      ],
      options: [],
      votes: {},
    },

    // ── #309 fixtures: visibility + request-to-join (all owned so you can test from many angles) ──

    // PUBLIC + a pending request already waiting. Owner Alice sees the Requests
    // section immediately (Dan pending); Dan sees "Seat requested". Bob & Eve
    // (Alice's friends, not invited) see it in their Discover feed and can "Ask for a seat".
    {
      title: 'Sushi Saturday 🍣',
      date: fmt(nextWeek),
      time: '6:30 PM',
      ownerId: alice._id,
      status: 'voting',
      cuisine: 'Japanese',
      budget: '$$',
      visibility: 'public',
      rsvpDeadline: deadlineFuture,
      invites: [
        { userId: carol._id, name: carol.name, status: 'accepted' },
      ],
      joinRequests: [
        { userId: dan._id, name: dan.name, avatarUri: dan.get('avatarUri'), status: 'pending' },
      ],
      options: [],
      votes: {},
    },

    // FRIENDS_REQUEST. Alice (Bob's friend) can view + request; Eve (NOT Bob's
    // friend) gets 404 on view and 403 on request. Appears in Alice/Carol/Dan's Discover.
    {
      title: 'Taco Tuesday 🌮',
      date: fmt(nextWeek),
      time: '7:00 PM',
      ownerId: bob._id,
      status: 'voting',
      cuisine: 'Mexican',
      budget: '$',
      visibility: 'friends_request',
      rsvpDeadline: deadlineFuture,
      invites: [],
      joinRequests: [],
      options: [],
      votes: {},
    },

    // PRIVATE (explicit). Alice is Carol's friend but NOT invited → GET returns 404.
    // Never appears in any Discover feed (private excluded).
    {
      title: 'Secret Supper 🤫',
      date: fmt(nextWeek),
      time: '8:00 PM',
      ownerId: carol._id,
      status: 'voting',
      cuisine: 'Omakase',
      budget: '$$$$',
      visibility: 'private',
      rsvpDeadline: deadlineFuture,
      invites: [
        { userId: bob._id, name: bob.name, status: 'accepted' },
      ],
      options: [],
      votes: {},
    },

    // PUBLIC with a DENIED request. Alice was denied by Dan → she sees "Ask again"
    // (re-request allowed). Eve (Dan's friend) sees it fresh in Discover.
    {
      title: 'Rooftop Drinks 🍸',
      date: fmt(nextWeek),
      time: '9:00 PM',
      ownerId: dan._id,
      status: 'voting',
      cuisine: 'Tapas',
      budget: '$$$',
      visibility: 'public',
      rsvpDeadline: deadlineFuture,
      invites: [],
      joinRequests: [
        { userId: alice._id, name: alice.name, avatarUri: alice.get('avatarUri'), status: 'denied', respondedAt: new Date() },
      ],
      options: [],
      votes: {},
    },

    // PUBLIC but RSVP window CLOSED (deadline passed). New requests are rejected
    // (400 "Requests are closed"); does NOT appear in Discover (deadline filter).
    {
      title: 'Brunch Club 🥞 (closed window)',
      date: fmt(nextWeek),
      time: '11:00 AM',
      ownerId: eve._id,
      status: 'voting',
      cuisine: 'Brunch',
      budget: '$$',
      visibility: 'public',
      rsvpDeadline: deadlinePast,
      invites: [],
      joinRequests: [],
      options: [],
      votes: {},
    },
  ]);

  console.log('Created 8 plans (3 original + 5 visibility/request-to-join fixtures)');

  // ── Summary ──────────────────────────────────────────────────────────────
  console.log('\n✓ Seed complete\n');
  console.log('Test credentials (all use password: seed1234)');
  console.log('─'.repeat(40));
  createdUsers.forEach(u => console.log(`  ${u.email}`));
  console.log('─'.repeat(40));
  console.log('Sign in as alice@chewabl.dev to see friends Bob, Carol, Dan, Eve');
  console.log('and plans: Friday Night Dinner, Team Lunch (invited), Birthday Dinner (invited)\n');

  console.log('#309 request-to-join test angles:');
  console.log('─'.repeat(40));
  console.log('  Sushi Saturday  (Alice, PUBLIC)         → Dan has a PENDING request; Alice sees Requests section');
  console.log('  Taco Tuesday    (Bob, FRIENDS_REQUEST)  → Alice can request; Eve (not Bob\'s friend) gets 404/403');
  console.log('  Secret Supper   (Carol, PRIVATE)        → Alice (friend, not invited) gets 404');
  console.log('  Rooftop Drinks  (Dan, PUBLIC)           → Alice was DENIED → "Ask again"');
  console.log('  Brunch Club     (Eve, PUBLIC, deadline passed) → new requests rejected; hidden from Discover');
  console.log('─'.repeat(40));
  console.log('Discover feed: sign in as Bob or Eve → Sushi Saturday & Rooftop Drinks appear under "Tables you could join".\n');

  await mongoose.disconnect();
}

seed().catch(err => {
  console.error('Seed failed:', err);
  process.exit(1);
});
