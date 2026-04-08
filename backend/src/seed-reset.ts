/**
 * Full database reset + comprehensive seed data for Chewabl.
 *
 * Run with:  cd backend && npx ts-node src/seed-reset.ts
 *
 * This script DROPS all users, friendships, and plans, then recreates
 * everything from scratch with comprehensive test data covering all
 * important edge cases.
 *
 * ─── Sign-in credentials ─────────────────────────────────────────
 *   alice@chewabl.dev / seed1234   ← primary test account
 *   (all users share password: seed1234)
 *
 * ─── Users (9) ───────────────────────────────────────────────────
 *   Alice Chen       → main user (sign in as this user)
 *   Jerry Ronnau     → secondary user, Alice's friend
 *   Maya Johnson     → accepted friend of Alice
 *   Liam Rodriguez   → accepted friend of Alice
 *   Sofia Kim        → pending incoming request (Sofia → Alice)
 *   Noah Williams    → pending outgoing request (Alice → Noah)
 *   Zara Patel       → findable via Scan Contacts (Anna Haro's phone)
 *   Marcus Lee       → findable via Scan Contacts (Daniel Higgins' phone), pending request to Jerry
 *   Olivia Brown     → no connection, not findable via contacts
 *
 * ─── Friendships (8) ────────────────────────────────────────────
 *   Alice ↔ Maya       (accepted)
 *   Alice ↔ Jerry      (accepted)
 *   Alice ↔ Liam       (accepted)
 *   Maya  ↔ Liam       (accepted)
 *   Jerry → Liam       (pending — Jerry sent)
 *   Marcus → Jerry     (pending — Jerry received)
 *   Sofia → Alice      (pending — Alice received)
 *   Alice → Noah       (pending — Alice sent)
 *
 * ─── Plans (21) ──────────────────────────────────────────────────
 *   1. Taco Tuesday       │ voting    │ upcoming │ Alice owns │ Maya+Jerry partial, Liam partial, Alice not yet
 *   2. Weekend Brunch      │ voting    │ upcoming │ Alice owns │ Maya+Liam voted, Alice not yet
 *   3. Friday Night Out    │ voting    │ upcoming │ Alice owns │ Alice voted, Maya+Liam not yet
 *   4. Team Lunch          │ voting    │ upcoming │ Maya owns  │ Alice accepted, Liam pending invite
 *   5. Sushi Saturday      │ confirmed │ upcoming │ Alice owns │ all voted, plan confirmed
 *   6. Birthday Dinner     │ completed │ past     │ Liam owns  │ all voted, completed (Jerry included)
 *   7. Cancelled Meetup    │ cancelled │ past     │ Alice owns │ Maya declined, Liam accepted
 *   8. Group Pick: Thai Garden  │ group-swipe │ confirmed │ Alice owns │ no date/time, Maya+Liam
 *   9. Group Pick: Burger Barn  │ group-swipe │ confirmed │ Liam owns  │ no date/time, Alice+Maya
 *  10. Chomp: Results Reveal│ group-swipe │ voting  │ Alice owns │ Jerry last to swipe → triggers results reveal chomp
 *  11. Jerry's Pizza Night │ voting    │ upcoming │ Jerry owns │ 3 accepted → test Cancel + Delegate
 *  12. Jerry's Quick Lunch │ voting    │ upcoming │ Jerry owns │ 1 invitee → Cancel, Delegate BLOCKED
 *  13. Maya's Game Night   │ voting    │ upcoming │ Maya owns  │ Jerry+Liam accepted → test Leave (no auto-cancel)
 *  14. Liam's Coffee Run   │ voting    │ upcoming │ Liam owns  │ Jerry only accepted → test Leave (auto-cancel)
 *  15. Group Pick: Ramen Run│ group-swipe│ voting  │ Jerry owns │ 3 invitees → test Cancel + Delegate on group-swipe
 *  16. Group Pick: Curveball Test│ group-swipe│ voting │ Liam owns │ Jerry+Maya, allowCurveball ON
 *  17. Vibe Test: Quiet    │ group-swipe │ voting │ Liam owns  │ atmosphere=Quiet, Japanese $$, live API deck
 *  18. Vibe Test: Moderate │ group-swipe │ voting │ Alice owns │ atmosphere=Moderate, Japanese $$, live API deck
 *  19. Vibe Test: Lively   │ group-swipe │ voting │ Jerry owns │ atmosphere=Lively, Japanese $$, live API deck
 *  20. Chomp: RSVP Accept  │ voting    │ upcoming │ Alice owns │ Jerry has PENDING invite → triggers RSVP accept chomp
 *  21. Chomp: RSVP Accept 2│ voting    │ upcoming │ Maya owns  │ Jerry has PENDING invite → second RSVP accept test
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

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Format a Date to "YYYY-MM-DD" */
const fmt = (d: Date) => d.toISOString().split('T')[0];

/** Return a date N days from today */
function daysFromNow(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d;
}

/** Return a date N days in the past */
function daysAgo(n: number): Date {
  return daysFromNow(-n);
}

// ── Real restaurant favorites (seeded into user profiles for Your Bites) ─────
const REAL_FAVORITES = {
  redSalt: {
    id: 'ChIJOw7Y4gtqsYkR259v59tjrCE', placeId: 'ChIJOw7Y4gtqsYkR259v59tjrCE',
    name: 'Red Salt Chophouse and Sushi', cuisine: 'Japanese', priceLevel: 3 as 1|2|3|4,
    rating: 4.5, reviewCount: 1630, distance: '0.5mi',
    address: '12221 W Broad St, Henrico, VA 23233, USA',
    imageUrl: 'https://images.unsplash.com/photo-1414235077428-338989a2e8c0?w=400',
    tags: ['Steakhouse', 'Sushi', 'Date Night'], isOpenNow: true, hasReservation: true,
    phone: '+1 804-360-8080', hours: '11:30am-10pm',
    description: 'Steaks & sushi pair with global wines & unique cocktails at this industrial-chic American chophouse.',
    photos: [] as string[], noiseLevel: 'moderate' as const, seating: ['indoor' as const, 'bar' as const], busyLevel: 'busy' as const,
  },
  fogo: {
    id: 'ChIJ3ys--w9rsYkRo3N9NMiSu8c', placeId: 'ChIJ3ys--w9rsYkRo3N9NMiSu8c',
    name: 'Fogo de Chão Brazilian Steakhouse', cuisine: 'American', priceLevel: 3 as 1|2|3|4,
    rating: 4.8, reviewCount: 6090, distance: '1.2mi',
    address: '11221 W Broad St, Glen Allen, VA 23060, USA',
    imageUrl: 'https://images.unsplash.com/photo-1544025162-d76694265947?w=400',
    tags: ['Brazilian', 'Steakhouse', 'All-You-Can-Eat'], isOpenNow: true, hasReservation: true,
    phone: '+1 804-214-7009', hours: '11am-10pm',
    description: 'Upscale Brazilian chain for all-you-can-eat meat carved tableside plus an extensive salad bar.',
    photos: [] as string[], noiseLevel: 'lively' as const, seating: ['indoor' as const], busyLevel: 'busy' as const,
  },
  zzq: {
    id: 'ChIJ_Vc4GAIUsYkRZf28U23mnMQ', placeId: 'ChIJ_Vc4GAIUsYkRZf28U23mnMQ',
    name: 'ZZQ Texas Craft Barbeque', cuisine: 'American', priceLevel: 2 as 1|2|3|4,
    rating: 4.7, reviewCount: 2923, distance: '5.8mi',
    address: '3201 W Moore St, Richmond, VA 23230, USA',
    imageUrl: 'https://images.unsplash.com/photo-1529193591184-b1d58069ecdd?w=400',
    tags: ['BBQ', 'Brisket', 'Patio'], isOpenNow: true, hasReservation: false,
    phone: '+1 804-528-5648', hours: '11am-8pm',
    description: 'Brisket, pulled pork & other BBQ staples in a chill, industrial setting with garage doors & a patio.',
    photos: [] as string[], noiseLevel: 'lively' as const, seating: ['indoor' as const, 'outdoor' as const], busyLevel: 'busy' as const,
  },
  boathouse: {
    id: 'ChIJLTq4A_kQsYkRkNtwQkp_ieo', placeId: 'ChIJLTq4A_kQsYkRkNtwQkp_ieo',
    name: 'The Boathouse at Rocketts Landing', cuisine: 'American', priceLevel: 3 as 1|2|3|4,
    rating: 4.6, reviewCount: 6668, distance: '8.2mi',
    address: '4708 E Old Main St, Richmond, VA 23231, USA',
    imageUrl: 'https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?w=400',
    tags: ['Seafood', 'Waterfront', 'Fine Dining'], isOpenNow: true, hasReservation: true,
    phone: '+1 804-622-2628', hours: '11am-10pm',
    description: 'Glass boxes perched atop the river contain this modern eatery serving seafood & American grill fare.',
    photos: [] as string[], noiseLevel: 'moderate' as const, seating: ['indoor' as const, 'outdoor' as const], busyLevel: 'moderate' as const,
  },
  passionfish: {
    id: 'ChIJqbHDsx5ItokRP9mMd6eMIGw', placeId: 'ChIJqbHDsx5ItokRP9mMd6eMIGw',
    name: 'PassionFish Reston', cuisine: 'Japanese', priceLevel: 3 as 1|2|3|4,
    rating: 4.4, reviewCount: 1328, distance: '2.1mi',
    address: '11960 Democracy Dr, Reston, VA 20190, USA',
    imageUrl: 'https://images.unsplash.com/photo-1579871494447-9811cf80d66c?w=400',
    tags: ['Seafood', 'Sushi', 'Date Night'], isOpenNow: true, hasReservation: true,
    phone: '+1 703-230-3474', hours: '11:30am-10pm',
    description: 'Seafood-focused eatery with sushi & Asian-influenced fish entrees in an airy, bi-level space.',
    photos: [] as string[], noiseLevel: 'moderate' as const, seating: ['indoor' as const], busyLevel: 'moderate' as const,
  },
};

// ── Restaurant mock IDs (used as plan options & vote targets) ────────────────
const RESTAURANT_OPTIONS = [
  'rest_tacos_supreme',
  'rest_sushi_heaven',
  'rest_pizza_palace',
  'rest_thai_garden',
  'rest_burger_barn',
];

// Full restaurant objects for restaurantOptions (SwipeCard needs tags, name, imageUrl, etc.)
const RESTAURANT_OPTION_OBJECTS = [
  { id: 'rest_tacos_supreme', name: 'Tacos Supreme', imageUrl: 'https://images.unsplash.com/photo-1565299585323-38d6b0865b47?w=400', address: '123 Main St', cuisine: 'Mexican', priceLevel: 2, rating: 4.5, distance: '0.3mi', tags: ['Tacos', 'Burritos', 'Outdoor Seating'], isOpenNow: true, phone: '(555) 123-4567', hours: '11am-10pm', description: 'Authentic Mexican street tacos', photos: [], reviewCount: 142, hasReservation: false, noiseLevel: 'moderate', seating: ['indoor', 'outdoor'], busyLevel: 'moderate' },
  { id: 'rest_sushi_heaven', name: 'Sushi Heaven', imageUrl: 'https://images.unsplash.com/photo-1579871494447-9811cf80d66c?w=400', address: '456 Oak Ave', cuisine: 'Japanese', priceLevel: 3, rating: 4.8, distance: '0.5mi', tags: ['Sushi', 'Sake Bar', 'Date Night'], isOpenNow: true, phone: '(555) 234-5678', hours: '12pm-11pm', description: 'Premium omakase and sushi rolls', photos: [], reviewCount: 238, hasReservation: true, noiseLevel: 'quiet', seating: ['indoor', 'bar'], busyLevel: 'busy' },
  { id: 'rest_pizza_palace', name: 'Pizza Palace', imageUrl: 'https://images.unsplash.com/photo-1513104890138-7c749659a591?w=400', address: '789 Elm Blvd', cuisine: 'Italian', priceLevel: 2, rating: 4.3, distance: '0.8mi', tags: ['Pizza', 'Pasta', 'Family Friendly'], isOpenNow: true, phone: '(555) 345-6789', hours: '11am-11pm', description: 'Wood-fired Neapolitan pizza', photos: [], reviewCount: 189, hasReservation: false, noiseLevel: 'loud', seating: ['indoor', 'patio'], busyLevel: 'moderate' },
  { id: 'rest_thai_garden', name: 'Thai Garden', imageUrl: 'https://images.unsplash.com/photo-1562565652-a0d8f0c59eb4?w=400', address: '321 Pine Dr', cuisine: 'Thai', priceLevel: 2, rating: 4.6, distance: '1.2mi', tags: ['Curry', 'Noodles', 'Vegetarian Options'], isOpenNow: true, phone: '(555) 456-7890', hours: '11am-9:30pm', description: 'Traditional Thai dishes with fresh ingredients', photos: [], reviewCount: 167, hasReservation: false, noiseLevel: 'moderate', seating: ['indoor'], busyLevel: 'quiet' },
  { id: 'rest_burger_barn', name: 'Burger Barn', imageUrl: 'https://images.unsplash.com/photo-1568901346375-23c9450c58cd?w=400', address: '654 Cedar Ln', cuisine: 'American', priceLevel: 1, rating: 4.2, distance: '0.2mi', tags: ['Burgers', 'Shakes', 'Quick Bite'], isOpenNow: true, phone: '(555) 567-8901', hours: '10am-10pm', description: 'Classic smash burgers and hand-spun milkshakes', photos: [], reviewCount: 95, hasReservation: false, noiseLevel: 'loud', seating: ['indoor', 'outdoor'], busyLevel: 'busy' },
];


// ── Main seed ────────────────────────────────────────────────────────────────

async function seedReset() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI not set in .env');

  await mongoose.connect(uri);
  console.log('Connected to MongoDB\n');

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 1. FULL WIPE — drop every document in users, friendships, plans
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  const userCount = await User.countDocuments();
  const friendCount = await Friendship.countDocuments();
  const planCount = await Plan.countDocuments();
  const notifCount = await Notification.countDocuments();

  await User.deleteMany({});
  await Friendship.deleteMany({});
  await Plan.deleteMany({});
  await Notification.deleteMany({});

  console.log(`Cleared: ${userCount} users, ${friendCount} friendships, ${planCount} plans, ${notifCount} notifications\n`);

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 2. CREATE USERS
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  const passwordHash = await bcrypt.hash('seed1234', 10);

  const users = await User.insertMany([
    {
      name: 'Alice Chen',
      email: 'alice@chewabl.dev',
      phone: '+14155550101',
      passwordHash,
      inviteCode: nanoid(8).toUpperCase(),
      avatarUri: 'https://res.cloudinary.com/dxykko8em/image/upload/v1772418833/chewabl/seed-avatars/alice.png',
      favorites: [REAL_FAVORITES.redSalt.id, REAL_FAVORITES.fogo.id],
      favoritedRestaurants: [REAL_FAVORITES.redSalt, REAL_FAVORITES.fogo],
      preferences: {
        name: 'Alice',
        cuisines: ['Japanese', 'Mexican', 'Italian'],
        budget: ['$$$'],
        dietary: [],
        atmosphere: ['Moderate'],
        groupSize: ['2-4'],
        distance: '10',
        isDarkMode: true,
        notificationsEnabled: true,
      },
    },
    {
      name: 'Jerry Ronnau',
      email: 'jerry@chewabl.dev',
      phone: '+14155550102',
      passwordHash,
      inviteCode: 'Chewabl',
      avatarUri: 'https://res.cloudinary.com/dxykko8em/image/upload/v1772418921/chewabl/seed-avatars/jerry.png',
      favorites: [REAL_FAVORITES.passionfish.id],
      favoritedRestaurants: [REAL_FAVORITES.passionfish],
      preferences: {
        name: 'Jerry',
        cuisines: ['American', 'Japanese', 'Mediterranean'],
        budget: ['$$$'],
        dietary: [],
        atmosphere: ['Lively'],
        groupSize: ['2-4'],
        distance: '10',
        isDarkMode: true,
        notificationsEnabled: false,
      },
    },
    {
      name: 'Maya Johnson',
      email: 'maya@chewabl.dev',
      phone: '+15551234567',
      passwordHash,
      inviteCode: nanoid(8).toUpperCase(),
      avatarUri: 'https://res.cloudinary.com/dxykko8em/image/upload/v1772418923/chewabl/seed-avatars/maya.png',
      favorites: [],
    },
    {
      name: 'Liam Rodriguez',
      email: 'liam@chewabl.dev',
      phone: '+15559876543',
      passwordHash,
      inviteCode: nanoid(8).toUpperCase(),
      avatarUri: 'https://res.cloudinary.com/dxykko8em/image/upload/v1772418924/chewabl/seed-avatars/liam.png',
      favorites: [],
      preferences: {
        name: 'Liam',
        cuisines: ['Japanese', 'Mexican', 'Italian'],
        budget: ['$$$'],
        dietary: [],
        atmosphere: ['Quiet'],
        groupSize: ['2-4'],
        distance: '10',
        isDarkMode: false,
        notificationsEnabled: true,
      },
    },
    {
      // Pending incoming request to Alice
      name: 'Sofia Kim',
      email: 'sofia@chewabl.dev',
      phone: '+15555648583', // iOS Sim: Kate Bell (555) 564-8583
      passwordHash,
      inviteCode: nanoid(8).toUpperCase(),
      avatarUri: 'https://res.cloudinary.com/dxykko8em/image/upload/v1772418925/chewabl/seed-avatars/sofia.png',
      favorites: [],
    },
    {
      // Alice will send outgoing request to Noah
      name: 'Noah Williams',
      email: 'noah@chewabl.dev',
      phone: '+18885555512', // iOS Sim: John Appleseed (888) 555-5512
      passwordHash,
      inviteCode: nanoid(8).toUpperCase(),
      avatarUri: 'https://res.cloudinary.com/dxykko8em/image/upload/v1772418926/chewabl/seed-avatars/noah.png',
      favorites: [],
    },
    {
      // Findable via Scan Contacts, no friendship
      name: 'Zara Patel',
      email: 'zara@chewabl.dev',
      phone: '+15555228243', // iOS Sim: Anna Haro (555) 522-8243
      passwordHash,
      inviteCode: nanoid(8).toUpperCase(),
      avatarUri: 'https://res.cloudinary.com/dxykko8em/image/upload/v1772418928/chewabl/seed-avatars/zara.png',
      favorites: [],
    },
    {
      // Findable via Scan Contacts, no friendship
      name: 'Marcus Lee',
      email: 'marcus@chewabl.dev',
      phone: '+14085555270', // iOS Sim: Daniel Higgins Jr. (408) 555-5270
      passwordHash,
      inviteCode: nanoid(8).toUpperCase(),
      avatarUri: 'https://res.cloudinary.com/dxykko8em/image/upload/v1772418929/chewabl/seed-avatars/marcus.png',
      favorites: [],
    },
    {
      // No connection at all, not findable via contacts
      name: 'Olivia Brown',
      email: 'olivia@chewabl.dev',
      phone: '+15550000000',
      passwordHash,
      inviteCode: nanoid(8).toUpperCase(),
      avatarUri: 'https://res.cloudinary.com/dxykko8em/image/upload/v1772418930/chewabl/seed-avatars/olivia.png',
      favorites: [],
    },
  ]);

  const [alice, jerry, maya, liam, sofia, noah, zara, marcus, olivia] = users;
  console.log('Created 9 users:');
  users.forEach(u => console.log(`  ${u.name.padEnd(18)} ${u.email}`));
  console.log();

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 3. CREATE FRIENDSHIPS
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  await Friendship.insertMany([
    // Alice's accepted friends
    { requester: alice._id, recipient: maya._id, status: 'accepted' },
    { requester: alice._id, recipient: jerry._id, status: 'accepted' },
    { requester: jerry._id, recipient: liam._id, status: 'pending' },
    { requester: liam._id, recipient: alice._id, status: 'accepted' },
    // Maya and Liam are also friends with each other
    { requester: maya._id, recipient: liam._id, status: 'accepted' },
    // Pending incoming: Sofia sent request to Alice (Alice sees this in Requests)
    { requester: sofia._id, recipient: alice._id, status: 'pending' },
    // Pending outgoing: Alice sent request to Noah (Alice sees "Pending" in Requests)
    { requester: alice._id, recipient: noah._id, status: 'pending' },
    // Pending incoming to Jerry: Marcus sent request to Jerry
    { requester: marcus._id, recipient: jerry._id, status: 'pending' },
  ]);

  console.log('Created 8 friendships:');
  console.log('  Alice ↔ Maya       (accepted)');
  console.log('  Alice ↔ Jerry      (accepted)');
  console.log('  Alice ↔ Liam       (accepted)');
  console.log('  Maya  ↔ Liam       (accepted)');
  console.log('  Jerry → Liam       (pending — Jerry sent)');
  console.log('  Marcus → Jerry     (pending — Jerry received)');
  console.log('  Sofia → Alice      (pending incoming)');
  console.log('  Alice → Noah       (pending outgoing)');
  console.log();

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 4. CREATE PLANS — covering all statuses and edge cases
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  const aliceId = alice._id.toString();
  const jerryId = jerry._id.toString();
  const mayaId = maya._id.toString();
  const liamId = liam._id.toString();

  // ── Plan 1: Taco Tuesday ──────────────────────────────────────────────────
  // Status: voting │ Upcoming │ Alice owns
  // Maya: completed voting (3/5 yes) │ Liam: partial (1/5 yes) │ Alice: hasn't voted
  // Has RSVP deadline (future)
  const plan1Votes = new Map<string, string[]>();
  plan1Votes.set(mayaId, ['rest_tacos_supreme', 'rest_sushi_heaven', 'rest_thai_garden']);
  plan1Votes.set(jerryId, ['rest_sushi_heaven', 'rest_thai_garden']);
  plan1Votes.set(liamId, ['rest_pizza_palace']);

  // ── Plan 2: Weekend Brunch ────────────────────────────────────────────────
  // Status: voting │ Upcoming │ Alice owns
  // Maya + Liam: both finished voting │ Alice: hasn't voted
  const plan2Votes = new Map<string, string[]>();
  plan2Votes.set(mayaId, ['rest_sushi_heaven', 'rest_thai_garden', 'rest_pizza_palace']);
  plan2Votes.set(liamId, ['rest_tacos_supreme', 'rest_thai_garden', 'rest_burger_barn']);

  // ── Plan 3: Friday Night Out ──────────────────────────────────────────────
  // Status: voting │ Upcoming │ Alice owns
  // Alice: finished voting │ Maya + Liam: haven't voted
  const plan3Votes = new Map<string, string[]>();
  plan3Votes.set(aliceId, ['rest_sushi_heaven', 'rest_thai_garden']);

  // ── Plan 5: Sushi Saturday ────────────────────────────────────────────────
  // Status: confirmed │ Upcoming │ Alice owns │ All voted, plan confirmed
  const plan5Votes = new Map<string, string[]>();
  plan5Votes.set(aliceId, ['rest_sushi_heaven', 'rest_thai_garden']);
  plan5Votes.set(mayaId, ['rest_sushi_heaven', 'rest_pizza_palace']);
  plan5Votes.set(liamId, ['rest_sushi_heaven', 'rest_burger_barn']);
  // Jerry not invited to this plan — no vote for him

  // ── Plan 6: Birthday Dinner ───────────────────────────────────────────────
  // Status: completed │ Past │ Liam owns │ All voted
  const plan6Votes = new Map<string, string[]>();
  plan6Votes.set(aliceId, ['rest_tacos_supreme', 'rest_sushi_heaven']);
  plan6Votes.set(mayaId, ['rest_sushi_heaven', 'rest_thai_garden']);
  plan6Votes.set(liamId, ['rest_sushi_heaven', 'rest_pizza_palace']);
  plan6Votes.set(jerryId, ['rest_sushi_heaven', 'rest_thai_garden']);

  // ── Plan 10: Last Call Sushi ─────────────────────────────────────────────
  // Status: voting │ group-swipe │ Alice owns
  // Alice, Maya, Liam: finished swiping │ Jerry: hasn't swiped (he's last!)
  // Sushi Heaven is the common vote — will be confirmed when Jerry swipes
  const plan10Votes = new Map<string, string[]>();
  plan10Votes.set(aliceId, ['rest_sushi_heaven', 'rest_thai_garden']);
  plan10Votes.set(mayaId, ['rest_sushi_heaven', 'rest_pizza_palace']);
  plan10Votes.set(liamId, ['rest_sushi_heaven', 'rest_burger_barn']);

  const seededPlans = await Plan.insertMany([
    // 1. Taco Tuesday — voting, upcoming, Alice owns, mixed votes
    {
      title: 'Taco Tuesday',
      date: fmt(daysFromNow(5)),
      time: '7:00 PM',
      ownerId: alice._id,
      status: 'voting',
      cuisine: 'Mexican',
      budget: '$$',
      invites: [
        { userId: maya._id, name: maya.name, status: 'accepted', respondedAt: daysAgo(2) },
        { userId: jerry._id, name: jerry.name, status: 'accepted', respondedAt: daysAgo(2) },
        { userId: liam._id, name: liam.name, status: 'accepted', respondedAt: daysAgo(1) },
      ],
      rsvpDeadline: daysFromNow(3),
      options: RESTAURANT_OPTIONS,
      restaurantOptions: RESTAURANT_OPTION_OBJECTS,
      votes: plan1Votes,
    },
    // 2. Weekend Brunch — voting, upcoming, Alice owns, friends voted, Alice hasn't
    //    RSVP deadline already passed → voting phase active
    {
      title: 'Weekend Brunch',
      date: fmt(daysFromNow(10)),
      time: '11:00 AM',
      ownerId: alice._id,
      status: 'voting',
      cuisine: 'American',
      budget: '$$$',
      invites: [
        { userId: maya._id, name: maya.name, status: 'accepted', respondedAt: daysAgo(3) },
        { userId: liam._id, name: liam.name, status: 'accepted', respondedAt: daysAgo(2) },
      ],
      rsvpDeadline: daysAgo(1),
      votingOpenedAt: daysAgo(1),
      options: RESTAURANT_OPTIONS,
      restaurantOptions: RESTAURANT_OPTION_OBJECTS,
      votes: plan2Votes,
    },
    // 3. Friday Night Out — voting, upcoming, Alice owns, Alice voted, friends haven't
    //    RSVP deadline still open → RSVP phase
    {
      title: 'Friday Night Out',
      date: fmt(daysFromNow(15)),
      time: '8:00 PM',
      ownerId: alice._id,
      status: 'voting',
      cuisine: 'Japanese',
      budget: '$$$',
      invites: [
        { userId: maya._id, name: maya.name, status: 'accepted', respondedAt: daysAgo(1) },
        { userId: liam._id, name: liam.name, status: 'accepted', respondedAt: daysAgo(1) },
      ],
      rsvpDeadline: daysFromNow(10),
      options: RESTAURANT_OPTIONS,
      restaurantOptions: RESTAURANT_OPTION_OBJECTS,
      votes: plan3Votes,
    },
    // 4. Team Lunch — voting, upcoming, Maya owns (Alice is a guest), Liam pending invite
    {
      title: 'Team Lunch',
      date: fmt(daysFromNow(8)),
      time: '12:30 PM',
      ownerId: maya._id,
      status: 'voting',
      cuisine: 'Korean',
      budget: '$$',
      invites: [
        { userId: alice._id, name: alice.name, status: 'accepted', respondedAt: daysAgo(1) },
        { userId: liam._id, name: liam.name, status: 'pending' },
      ],
      rsvpDeadline: daysFromNow(6),
      options: RESTAURANT_OPTIONS,
      restaurantOptions: RESTAURANT_OPTION_OBJECTS,
      votes: new Map(),
    },
    // 5. Sushi Saturday — confirmed, upcoming, Alice owns, all voted
    {
      title: 'Sushi Saturday',
      date: fmt(daysFromNow(12)),
      time: '6:30 PM',
      ownerId: alice._id,
      status: 'confirmed',
      cuisine: 'Japanese',
      budget: '$$$$',
      invites: [
        { userId: maya._id, name: maya.name, status: 'accepted', respondedAt: daysAgo(5) },
        { userId: liam._id, name: liam.name, status: 'accepted', respondedAt: daysAgo(4) },
      ],
      rsvpDeadline: daysAgo(7),
      votingOpenedAt: daysAgo(7),
      options: RESTAURANT_OPTIONS,
      restaurantOptions: RESTAURANT_OPTION_OBJECTS,
      votes: plan5Votes,
    },
    // 6. Birthday Dinner — completed, past, Liam owns (Alice invited)
    {
      title: 'Birthday Dinner',
      date: fmt(daysAgo(14)),
      time: '7:00 PM',
      ownerId: liam._id,
      status: 'completed',
      cuisine: 'French',
      budget: '$$$$',
      invites: [
        { userId: alice._id, name: alice.name, status: 'accepted', respondedAt: daysAgo(20) },
        { userId: maya._id, name: maya.name, status: 'accepted', respondedAt: daysAgo(18) },
        { userId: jerry._id, name: jerry.name, status: 'accepted', respondedAt: daysAgo(17) },
      ],
      rsvpDeadline: daysAgo(21),
      votingOpenedAt: daysAgo(21),
      options: RESTAURANT_OPTIONS,
      restaurantOptions: RESTAURANT_OPTION_OBJECTS,
      votes: plan6Votes,
    },
    // 7. Cancelled Meetup — cancelled, past, Alice owns, mixed invite responses
    {
      title: 'Cancelled Meetup',
      date: fmt(daysAgo(7)),
      time: '5:00 PM',
      ownerId: alice._id,
      status: 'cancelled',
      cuisine: 'Thai',
      budget: '$$',
      invites: [
        { userId: maya._id, name: maya.name, status: 'declined', respondedAt: daysAgo(10) },
        { userId: liam._id, name: liam.name, status: 'accepted', respondedAt: daysAgo(9) },
      ],
      rsvpDeadline: daysAgo(12),
      options: [],
      votes: new Map(),
    },
    // 8. Group Pick: Thai Garden — group-swipe, confirmed, Alice owns, group result with friends
    {
      type: 'group-swipe',
      title: 'Group Pick: Thai Garden',
      ownerId: alice._id,
      status: 'confirmed',
      cuisine: 'Thai',
      budget: '$$',
      invites: [
        { userId: maya._id, name: maya.name, status: 'accepted', respondedAt: daysAgo(1) },
        { userId: liam._id, name: liam.name, status: 'accepted', respondedAt: daysAgo(1) },
      ],
      options: [],
      votes: new Map(),
    },
    // 9. Group Pick: Burger Barn — group-swipe, confirmed, Liam owns (Alice is invited)
    {
      type: 'group-swipe',
      title: 'Group Pick: Burger Barn',
      ownerId: liam._id,
      status: 'confirmed',
      cuisine: 'American',
      budget: '$',
      invites: [
        { userId: alice._id, name: alice.name, status: 'accepted', respondedAt: daysAgo(1) },
        { userId: maya._id, name: maya.name, status: 'accepted', respondedAt: daysAgo(1) },
      ],
      options: [],
      votes: new Map(),
    },
    // 10. Chomp: Results Reveal — group-swipe, voting, Alice owns, Jerry is last to swipe
    //     Jerry finishes swiping → triggers results reveal chomp (spiral, 5 bites, bounce easing)
    {
      type: 'group-swipe',
      title: 'Chomp: Results Reveal',
      ownerId: alice._id,
      status: 'voting',
      cuisine: 'Japanese',
      budget: '$$$',
      invites: [
        { userId: maya._id, name: maya.name, status: 'accepted', respondedAt: daysAgo(1) },
        { userId: liam._id, name: liam.name, status: 'accepted', respondedAt: daysAgo(1) },
        { userId: jerry._id, name: jerry.name, status: 'accepted', respondedAt: daysAgo(1) },
      ],
      swipesCompleted: [aliceId, mayaId, liamId],
      options: RESTAURANT_OPTIONS,
      restaurantOptions: RESTAURANT_OPTION_OBJECTS,
      votes: plan10Votes,
    },

    // ── Plans 11-15: Plan Management test plans (Jerry-focused) ────────────

    // 11. Jerry's Pizza Night — voting, Jerry owns, 3 accepted invitees
    //     Tests: Cancel Plan, Delegate Organizer (3+ person, multiple accepted)
    {
      title: "Jerry's Pizza Night",
      date: fmt(daysFromNow(4)),
      time: '7:00 PM',
      ownerId: jerry._id,
      status: 'voting',
      cuisine: 'Italian',
      budget: '$$',
      invites: [
        { userId: alice._id, name: alice.name, status: 'accepted', respondedAt: daysAgo(1) },
        { userId: maya._id, name: maya.name, status: 'accepted', respondedAt: daysAgo(1) },
        { userId: liam._id, name: liam.name, status: 'accepted', respondedAt: daysAgo(1) },
      ],
      rsvpDeadline: daysFromNow(2),
      options: RESTAURANT_OPTIONS,
      restaurantOptions: RESTAURANT_OPTION_OBJECTS,
      votes: new Map(),
    },
    // 12. Jerry's Quick Lunch — voting, Jerry owns, only 1 invitee (2-person plan)
    //     Tests: Cancel Plan works, Delegate BLOCKED (2-person)
    {
      title: "Jerry's Quick Lunch",
      date: fmt(daysFromNow(3)),
      time: '12:00 PM',
      ownerId: jerry._id,
      status: 'voting',
      cuisine: 'American',
      budget: '$',
      invites: [
        { userId: alice._id, name: alice.name, status: 'accepted', respondedAt: daysAgo(1) },
      ],
      rsvpDeadline: daysFromNow(1),
      options: RESTAURANT_OPTIONS,
      restaurantOptions: RESTAURANT_OPTION_OBJECTS,
      votes: new Map(),
    },
    // 13. Maya's Game Night — voting, Maya owns, Jerry + Liam accepted
    //     Tests: Leave Plan (Jerry leaves, Liam still accepted → no auto-cancel)
    {
      title: "Maya's Game Night",
      date: fmt(daysFromNow(6)),
      time: '6:00 PM',
      ownerId: maya._id,
      status: 'voting',
      cuisine: 'Korean',
      budget: '$$',
      invites: [
        { userId: jerry._id, name: jerry.name, status: 'accepted', respondedAt: daysAgo(1) },
        { userId: liam._id, name: liam.name, status: 'accepted', respondedAt: daysAgo(1) },
      ],
      rsvpDeadline: daysFromNow(4),
      options: RESTAURANT_OPTIONS,
      restaurantOptions: RESTAURANT_OPTION_OBJECTS,
      votes: new Map(),
    },
    // 14. Liam's Coffee Run — voting, Liam owns, Jerry is ONLY accepted invitee
    //     Tests: Leave Plan → auto-cancel (Jerry leaving = 0 accepted = auto-cancel)
    {
      title: "Liam's Coffee Run",
      date: fmt(daysFromNow(2)),
      time: '10:00 AM',
      ownerId: liam._id,
      status: 'voting',
      cuisine: 'American',
      budget: '$',
      invites: [
        { userId: jerry._id, name: jerry.name, status: 'accepted', respondedAt: daysAgo(1) },
        { userId: alice._id, name: alice.name, status: 'pending' },
      ],
      rsvpDeadline: daysFromNow(1),
      options: [],
      restaurantOptions: [],
      votes: new Map(),
    },
    // 15. Jerry's Group Swipe: Ramen — group-swipe, voting, Jerry owns, 3 accepted
    //     Tests: Cancel + Delegate on group-swipe type
    {
      type: 'group-swipe',
      title: 'Group Pick: Ramen Run',
      ownerId: jerry._id,
      status: 'voting',
      cuisine: 'Japanese',
      budget: '$$',
      invites: [
        { userId: alice._id, name: alice.name, status: 'accepted', respondedAt: daysAgo(1) },
        { userId: maya._id, name: maya.name, status: 'accepted', respondedAt: daysAgo(1) },
        { userId: liam._id, name: liam.name, status: 'pending' },
      ],
      options: RESTAURANT_OPTIONS,
      restaurantOptions: RESTAURANT_OPTION_OBJECTS,
      votes: new Map(),
    },
    // 16. Liam's Curveball Swipe — group-swipe, voting, Liam owns, allowCurveball ON
    //     Tests: curveball injection + sparkle animation + vote submission with curveball filter
    {
      type: 'group-swipe',
      title: 'Group Pick: Curveball Test',
      ownerId: liam._id,
      status: 'voting',
      cuisine: 'Italian',
      budget: '$$',
      allowCurveball: true,
      invites: [
        { userId: jerry._id, name: jerry.name, status: 'accepted', respondedAt: daysAgo(1) },
        { userId: maya._id, name: maya.name, status: 'accepted', respondedAt: daysAgo(1) },
      ],
      options: RESTAURANT_OPTIONS,
      restaurantOptions: RESTAURANT_OPTION_OBJECTS,
      votes: new Map(),
    },

    // ── Plans 17-19: Vibe Filter test plans ─────────────────────────────
    // All identical (Japanese, $$, group-swipe, no restaurantOptions)
    // except each owner has a different atmosphere preference.
    // Sign in as each user → start swiping → compare deck order.

    // 17. Vibe Test: Quiet — Liam owns (atmosphere: Quiet)
    {
      type: 'group-swipe',
      title: 'Vibe Test: Quiet',
      ownerId: liam._id,
      status: 'voting',
      cuisine: 'Japanese',
      budget: '$$',
      invites: [
        { userId: alice._id, name: alice.name, status: 'accepted', respondedAt: daysAgo(1) },
        { userId: maya._id, name: maya.name, status: 'accepted', respondedAt: daysAgo(1) },
      ],
      options: [],
      restaurantOptions: [],
      votes: new Map(),
    },
    // 18. Vibe Test: Moderate — Alice owns (atmosphere: Moderate)
    {
      type: 'group-swipe',
      title: 'Vibe Test: Moderate',
      ownerId: alice._id,
      status: 'voting',
      cuisine: 'Japanese',
      budget: '$$',
      invites: [
        { userId: liam._id, name: liam.name, status: 'accepted', respondedAt: daysAgo(1) },
        { userId: maya._id, name: maya.name, status: 'accepted', respondedAt: daysAgo(1) },
      ],
      options: [],
      restaurantOptions: [],
      votes: new Map(),
    },
    // 19. Vibe Test: Lively — Jerry owns (atmosphere: Lively)
    {
      type: 'group-swipe',
      title: 'Vibe Test: Lively',
      ownerId: jerry._id,
      status: 'voting',
      cuisine: 'Japanese',
      budget: '$$',
      invites: [
        { userId: alice._id, name: alice.name, status: 'accepted', respondedAt: daysAgo(1) },
        { userId: maya._id, name: maya.name, status: 'accepted', respondedAt: daysAgo(1) },
      ],
      options: [],
      restaurantOptions: [],
      votes: new Map(),
    },

    // ── Plans 20-21: Chomp Animation test plans (Jerry RSVP testing) ─────

    // 20. Chomp: RSVP Accept — Alice owns, Jerry has PENDING invite
    //     Jerry accepts → triggers RSVP accept chomp (3 bites, moderate celebration)
    {
      title: 'Chomp: RSVP Accept',
      date: fmt(daysFromNow(7)),
      time: '7:30 PM',
      ownerId: alice._id,
      status: 'voting',
      cuisine: 'Italian',
      budget: '$$$',
      invites: [
        { userId: jerry._id, name: jerry.name, status: 'pending' },
        { userId: maya._id, name: maya.name, status: 'accepted', respondedAt: daysAgo(1) },
      ],
      rsvpDeadline: daysFromNow(5),
      options: RESTAURANT_OPTIONS,
      restaurantOptions: RESTAURANT_OPTION_OBJECTS,
      votes: new Map(),
    },
    // 21. Chomp: RSVP Accept 2 — Maya owns, Jerry has PENDING invite
    //     Second RSVP test so Jerry can test it again without re-seeding
    {
      title: 'Chomp: RSVP Accept 2',
      date: fmt(daysFromNow(9)),
      time: '6:00 PM',
      ownerId: maya._id,
      status: 'voting',
      cuisine: 'Mexican',
      budget: '$$',
      invites: [
        { userId: jerry._id, name: jerry.name, status: 'pending' },
        { userId: liam._id, name: liam.name, status: 'accepted', respondedAt: daysAgo(1) },
      ],
      rsvpDeadline: daysFromNow(7),
      options: RESTAURANT_OPTIONS,
      restaurantOptions: RESTAURANT_OPTION_OBJECTS,
      votes: new Map(),
    },
  ]);

  const [planTaco, planBrunch, planFriday, planTeamLunch, planSushi, planBirthday, planCancelled, planThaiGroup, planBurgerGroup, _planResultsReveal, planPizzaNight, planQuickLunch, planGameNight, planCoffeeRun, planRamenGroup, planCurveballTest, _planVibeQuiet, _planVibeMod, _planVibeLively, planChompRsvp, planChompRsvp2] = seededPlans;

  console.log('Created 21 plans:');
  console.log('  UPCOMING (voting):');
  console.log('    1. Taco Tuesday       — Maya+Jerry partial, Liam partial, Alice not yet');
  console.log('    2. Weekend Brunch     — Maya+Liam voted, Alice not yet');
  console.log('    3. Friday Night Out   — Alice voted, Maya+Liam not yet');
  console.log('    4. Team Lunch         — Maya owns, Alice guest, Liam pending RSVP');
  console.log('  UPCOMING (confirmed):');
  console.log('    5. Sushi Saturday     — All voted, plan confirmed');
  console.log('  PAST:');
  console.log('    6. Birthday Dinner    — Completed, Liam owns, Jerry included');
  console.log('    7. Cancelled Meetup   — Cancelled, Alice owns');
  console.log('  GROUP SWIPE (confirmed, no date/time):');
  console.log('    8. Group Pick: Thai Garden — group swipe, Alice owns, Maya+Liam');
  console.log('    9. Group Pick: Burger Barn — group swipe, Liam owns, Alice+Maya');
  console.log('  CHOMP ANIMATION TESTS (Jerry-focused):');
  console.log('   10. Chomp: Results Reveal — Jerry swipes last → results reveal chomp');
  console.log('   20. Chomp: RSVP Accept    — Jerry has pending invite → RSVP accept chomp');
  console.log('   21. Chomp: RSVP Accept 2  — Jerry has pending invite → second RSVP accept test');
  console.log('       (Friend accept chomp: Marcus → Jerry pending friendship)');
  console.log('  PLAN MANAGEMENT (Jerry-focused):');
  console.log('   11. Jerry\'s Pizza Night  — Jerry owns, 3 accepted → test Cancel + Delegate');
  console.log('   12. Jerry\'s Quick Lunch  — Jerry owns, 1 invitee → test Cancel, Delegate BLOCKED');
  console.log('   13. Maya\'s Game Night    — Jerry is accepted invitee → test Leave (no auto-cancel)');
  console.log('   14. Liam\'s Coffee Run    — Jerry is ONLY accepted → test Leave (auto-cancel)');
  console.log('   15. Group Pick: Ramen Run — Jerry owns group-swipe → test Cancel + Delegate');
  console.log('  CURVEBALL TEST (Liam-focused):');
  console.log('   16. Group Pick: Curveball Test — Liam owns, Jerry+Maya, allowCurveball ON');
  console.log('  VIBE FILTER TEST (same cuisine/budget, different atmosphere):');
  console.log('   17. Vibe Test: Quiet    — Liam owns (Quiet),   Japanese $$, live API deck');
  console.log('   18. Vibe Test: Moderate — Alice owns (Moderate), Japanese $$, live API deck');
  console.log('   19. Vibe Test: Lively   — Jerry owns (Lively),  Japanese $$, live API deck');
  console.log();

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 5. CREATE NOTIFICATIONS — realistic history for Alice and Jerry
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  /** Return a Date that is `hoursAgo` hours in the past */
  function hoursAgo(h: number): Date {
    return new Date(Date.now() - h * 60 * 60 * 1000);
  }

  await Notification.insertMany([
    // ── Alice's notifications (mix of read + unread, newest first) ───────

    // Unread — recent
    {
      userId: alice._id,
      type: 'friend_request',
      title: 'New Friend Request',
      body: 'Sofia Kim wants to be your friend on Chewabl',
      data: {},
      read: false,
      createdAt: hoursAgo(1),
    },
    {
      userId: alice._id,
      type: 'swipe_completed',
      title: 'Swipe Update',
      body: 'Maya Johnson finished swiping for "Weekend Brunch"',
      data: { planId: planBrunch._id.toString() },
      read: false,
      createdAt: hoursAgo(3),
    },
    {
      userId: alice._id,
      type: 'swipe_completed',
      title: 'Swipe Update',
      body: 'Liam Rodriguez finished swiping for "Weekend Brunch"',
      data: { planId: planBrunch._id.toString() },
      read: false,
      createdAt: hoursAgo(4),
    },
    {
      userId: alice._id,
      type: 'plan_invite',
      title: 'Dining Plan Invite',
      body: 'Maya Johnson invited you to "Team Lunch"',
      data: { planId: planTeamLunch._id.toString() },
      read: false,
      createdAt: hoursAgo(6),
    },

    // Read — older
    {
      userId: alice._id,
      type: 'rsvp_response',
      title: 'RSVP Accepted',
      body: 'Maya Johnson accepted your invite to "Taco Tuesday"',
      data: { planId: planTaco._id.toString() },
      read: true,
      createdAt: hoursAgo(48),
    },
    {
      userId: alice._id,
      type: 'rsvp_response',
      title: 'RSVP Accepted',
      body: 'Jerry Ronnau accepted your invite to "Taco Tuesday"',
      data: { planId: planTaco._id.toString() },
      read: true,
      createdAt: hoursAgo(50),
    },
    {
      userId: alice._id,
      type: 'rsvp_response',
      title: 'RSVP Accepted',
      body: 'Liam Rodriguez accepted your invite to "Taco Tuesday"',
      data: { planId: planTaco._id.toString() },
      read: true,
      createdAt: hoursAgo(52),
    },
    {
      userId: alice._id,
      type: 'friend_accepted',
      title: 'Friend Request Accepted',
      body: 'Maya Johnson accepted your friend request',
      data: {},
      read: true,
      createdAt: hoursAgo(168), // 1 week ago
    },
    {
      userId: alice._id,
      type: 'group_swipe_result',
      title: 'Group Pick Decided!',
      body: 'The group picked Burger Barn for "Group Pick: Burger Barn"',
      data: { planId: planBurgerGroup._id.toString() },
      read: true,
      createdAt: hoursAgo(72),
    },
    {
      userId: alice._id,
      type: 'plan_invite',
      title: 'Dining Plan Invite',
      body: 'Liam Rodriguez invited you to "Birthday Dinner"',
      data: { planId: planBirthday._id.toString() },
      read: true,
      createdAt: hoursAgo(480), // 20 days ago
    },
    {
      userId: alice._id,
      type: 'rsvp_response',
      title: 'RSVP Declined',
      body: 'Maya Johnson declined your invite to "Cancelled Meetup"',
      data: { planId: planCancelled._id.toString() },
      read: true,
      createdAt: hoursAgo(240), // 10 days ago
    },

    // ── Jerry's notifications (mix of read + unread) ─────────────────────

    // Unread — recent
    {
      userId: jerry._id,
      type: 'friend_request',
      title: 'New Friend Request',
      body: 'Marcus Lee wants to be your friend on Chewabl',
      data: {},
      read: false,
      createdAt: hoursAgo(2),
    },
    {
      userId: jerry._id,
      type: 'plan_invite',
      title: 'Dining Plan Invite',
      body: 'Alice Chen invited you to "Taco Tuesday"',
      data: { planId: planTaco._id.toString() },
      read: false,
      createdAt: hoursAgo(5),
    },

    // Read — older
    {
      userId: jerry._id,
      type: 'friend_accepted',
      title: 'Friend Request Accepted',
      body: 'Alice Chen accepted your friend request',
      data: {},
      read: true,
      createdAt: hoursAgo(192), // 8 days ago
    },
    {
      userId: jerry._id,
      type: 'plan_invite',
      title: 'Dining Plan Invite',
      body: 'Liam Rodriguez invited you to "Birthday Dinner"',
      data: { planId: planBirthday._id.toString() },
      read: true,
      createdAt: hoursAgo(408), // 17 days ago
    },
    {
      userId: jerry._id,
      type: 'group_swipe_invite',
      title: 'Group Swipe Started!',
      body: 'Liam Rodriguez started a group swipe — tap to vote!',
      data: { planId: planBurgerGroup._id.toString() },
      read: true,
      createdAt: hoursAgo(96), // 4 days ago
    },

    // ── Jerry's plan management notifications ─────────────────────────────

    // RSVPs for Jerry's Pizza Night (unread — recent)
    {
      userId: jerry._id,
      type: 'rsvp_response',
      title: 'RSVP Accepted',
      body: 'Alice Chen accepted your invite to "Jerry\'s Pizza Night"',
      data: { planId: planPizzaNight._id.toString() },
      read: false,
      createdAt: hoursAgo(8),
    },
    {
      userId: jerry._id,
      type: 'rsvp_response',
      title: 'RSVP Accepted',
      body: 'Maya Johnson accepted your invite to "Jerry\'s Pizza Night"',
      data: { planId: planPizzaNight._id.toString() },
      read: false,
      createdAt: hoursAgo(9),
    },
    {
      userId: jerry._id,
      type: 'rsvp_response',
      title: 'RSVP Accepted',
      body: 'Liam Rodriguez accepted your invite to "Jerry\'s Pizza Night"',
      data: { planId: planPizzaNight._id.toString() },
      read: false,
      createdAt: hoursAgo(10),
    },
    // RSVP for Jerry's Quick Lunch
    {
      userId: jerry._id,
      type: 'rsvp_response',
      title: 'RSVP Accepted',
      body: 'Alice Chen accepted your invite to "Jerry\'s Quick Lunch"',
      data: { planId: planQuickLunch._id.toString() },
      read: false,
      createdAt: hoursAgo(7),
    },
    // Invite notifications for plans Jerry is invited to
    {
      userId: jerry._id,
      type: 'plan_invite',
      title: 'Dining Plan Invite',
      body: 'Maya Johnson invited you to "Maya\'s Game Night"',
      data: { planId: planGameNight._id.toString() },
      read: false,
      createdAt: hoursAgo(6),
    },
    {
      userId: jerry._id,
      type: 'plan_invite',
      title: 'Dining Plan Invite',
      body: 'Liam Rodriguez invited you to "Liam\'s Coffee Run"',
      data: { planId: planCoffeeRun._id.toString() },
      read: false,
      createdAt: hoursAgo(5),
    },

    // ── Alice's notifications for plan management plans ───────────────────
    {
      userId: alice._id,
      type: 'plan_invite',
      title: 'Dining Plan Invite',
      body: 'Jerry Ronnau invited you to "Jerry\'s Pizza Night"',
      data: { planId: planPizzaNight._id.toString() },
      read: false,
      createdAt: hoursAgo(10),
    },
    {
      userId: alice._id,
      type: 'plan_invite',
      title: 'Dining Plan Invite',
      body: 'Jerry Ronnau invited you to "Jerry\'s Quick Lunch"',
      data: { planId: planQuickLunch._id.toString() },
      read: false,
      createdAt: hoursAgo(8),
    },
    {
      userId: alice._id,
      type: 'plan_invite',
      title: 'Dining Plan Invite',
      body: 'Liam Rodriguez invited you to "Liam\'s Coffee Run"',
      data: { planId: planCoffeeRun._id.toString() },
      read: false,
      createdAt: hoursAgo(6),
    },

    // ── Chomp: RSVP Accept plan notifications ──────────────────────────
    {
      userId: jerry._id,
      type: 'plan_invite',
      title: 'Dining Plan Invite',
      body: 'Alice Chen invited you to "Chomp: RSVP Accept"',
      data: { planId: planChompRsvp._id.toString() },
      read: false,
      createdAt: hoursAgo(3),
    },
    {
      userId: jerry._id,
      type: 'plan_invite',
      title: 'Dining Plan Invite',
      body: 'Maya Johnson invited you to "Chomp: RSVP Accept 2"',
      data: { planId: planChompRsvp2._id.toString() },
      read: false,
      createdAt: hoursAgo(2),
    },

    // ── Curveball Test plan notifications ──────────────────────────────
    {
      userId: jerry._id,
      type: 'group_swipe_invite',
      title: 'Group Swipe Started!',
      body: 'Liam Rodriguez started a group swipe — tap to vote!',
      data: { planId: planCurveballTest._id.toString() },
      read: false,
      createdAt: hoursAgo(1),
    },
    {
      userId: maya._id,
      type: 'group_swipe_invite',
      title: 'Group Swipe Started!',
      body: 'Liam Rodriguez started a group swipe — tap to vote!',
      data: { planId: planCurveballTest._id.toString() },
      read: false,
      createdAt: hoursAgo(1),
    },
  ]);

  console.log('Created 29 notifications:');
  console.log('  Alice: 14 (7 unread, 7 read)');
  console.log('  Jerry: 14 (11 unread, 3 read)');
  console.log('  Maya: 1 (1 unread)');
  console.log();

  // ── Summary ──────────────────────────────────────────────────────────────
  console.log('━'.repeat(50));
  console.log('  SEED RESET COMPLETE');
  console.log('━'.repeat(50));
  console.log();
  console.log('  Sign in: alice@chewabl.dev / seed1234');
  console.log();
  console.log('  Friends tab (Alice):');
  console.log('    Friends:  Jerry Ronnau, Maya Johnson, Liam Rodriguez');
  console.log('    Requests: Sofia Kim (incoming), Noah Williams (sent)');
  console.log('    Add:      Zara Patel, Marcus Lee (via Scan Contacts)');
  console.log();
  console.log('  Friends tab (Jerry):');
  console.log('    Friends:  Alice Chen');
  console.log('    Requests: Marcus Lee (incoming), Liam Rodriguez (sent)');
  console.log();
  console.log('  Plans tab (Alice):');
  console.log('    Upcoming: Taco Tuesday, Weekend Brunch, Friday Night Out,');
  console.log('              Team Lunch (guest), Sushi Saturday (confirmed),');
  console.log('              Group Pick: Thai Garden (group-swipe),');
  console.log('              Group Pick: Burger Barn (group-swipe, Liam owns),');
  console.log('              Chomp: Results Reveal (group-swipe, Jerry last to swipe)');
  console.log('    Past:     Birthday Dinner (completed), Cancelled Meetup');
  console.log();
  console.log('  Plans tab (Jerry) — Chomp Animation tests:');
  console.log('    10. Chomp: Results Reveal — swipe to finish → results reveal chomp');
  console.log('    20. Chomp: RSVP Accept    — accept invite → RSVP accept chomp');
  console.log('    21. Chomp: RSVP Accept 2  — accept invite → second RSVP test');
  console.log('        Friend accept chomp: accept Marcus Lee in Friends tab');
  console.log();
  console.log('  Plans tab (Jerry) — Plan Management test plans:');
  console.log('    11. Jerry\'s Pizza Night  — OWNER, 3 accepted → Cancel + Delegate');
  console.log('    12. Jerry\'s Quick Lunch  — OWNER, 1 invitee → Cancel, Delegate BLOCKED');
  console.log('    13. Maya\'s Game Night    — INVITEE accepted → Leave (no auto-cancel)');
  console.log('    14. Liam\'s Coffee Run    — ONLY accepted    → Leave (triggers auto-cancel)');
  console.log('    15. Group Pick: Ramen Run — OWNER group-swipe → Cancel + Delegate');
  console.log();
  console.log('  Scan Contacts matches (iOS Simulator):');
  console.log('    Sofia Kim    → Kate Bell\'s phone');
  console.log('    Noah Williams → John Appleseed\'s phone');
  console.log('    Zara Patel   → Anna Haro\'s phone');
  console.log('    Marcus Lee   → Daniel Higgins\' phone');
  console.log();

  await mongoose.disconnect();
}

seedReset().catch(err => {
  console.error('Seed failed:', err);
  process.exit(1);
});
