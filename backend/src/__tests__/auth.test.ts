import request from 'supertest';
import app from '../app';
import { connectTestDB, disconnectTestDB, clearDB } from './helpers/db';
import Friendship from '../models/Friendship';
import Notification from '../models/Notification';
import mongoose from 'mongoose';

beforeAll(async () => { await connectTestDB(); });
afterAll(async () => { await disconnectTestDB(); });
afterEach(async () => { await clearDB(); });

describe('POST /auth/register', () => {
  it('creates a user and returns token + user with defined id', async () => {
    const res = await request(app).post('/auth/register').send({
      name: 'Alice',
      email: 'alice@example.com',
      password: 'password123',
    });
    expect(res.status).toBe(201);
    expect(typeof res.body.token).toBe('string');
    expect(typeof res.body.user.id).toBe('string');
    expect(res.body.user.id).toBeTruthy();
    expect(res.body.user.email).toBe('alice@example.com');
  });

  it('never exposes passwordHash', async () => {
    const res = await request(app).post('/auth/register').send({
      name: 'Alice',
      email: 'alice@example.com',
      password: 'password123',
    });
    expect(res.body.user.passwordHash).toBeUndefined();
  });

  it('new user has empty favorites', async () => {
    const res = await request(app).post('/auth/register').send({
      name: 'Bob',
      email: 'bob@example.com',
      password: 'password123',
    });
    expect(res.status).toBe(201);
    expect(res.body.user.favorites).toEqual([]);
  });

  it('returns 400 when name is missing', async () => {
    const res = await request(app).post('/auth/register').send({
      email: 'alice@example.com',
      password: 'password123',
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 when password is missing', async () => {
    const res = await request(app).post('/auth/register').send({
      name: 'Alice',
      email: 'alice@example.com',
    });
    expect(res.status).toBe(400);
  });

  it('returns 409 on duplicate email', async () => {
    const payload = { name: 'Alice', email: 'alice@example.com', password: 'password123' };
    await request(app).post('/auth/register').send(payload);
    const res = await request(app).post('/auth/register').send(payload);
    expect(res.status).toBe(409);
  });
});

describe('POST /auth/login', () => {
  beforeEach(async () => {
    await request(app).post('/auth/register').send({
      name: 'Alice',
      email: 'alice@example.com',
      password: 'password123',
    });
  });

  it('returns 200 with token and defined user.id on valid credentials', async () => {
    const res = await request(app).post('/auth/login').send({
      email: 'alice@example.com',
      password: 'password123',
    });
    expect(res.status).toBe(200);
    expect(typeof res.body.token).toBe('string');
    expect(typeof res.body.user.id).toBe('string');
    expect(res.body.user.id).toBeTruthy();
  });

  it('never exposes passwordHash', async () => {
    const res = await request(app).post('/auth/login').send({
      email: 'alice@example.com',
      password: 'password123',
    });
    expect(res.body.user.passwordHash).toBeUndefined();
  });

  it('returns 401 on wrong password', async () => {
    const res = await request(app).post('/auth/login').send({
      email: 'alice@example.com',
      password: 'wrongpassword',
    });
    expect(res.status).toBe(401);
  });

  it('returns 401 on unknown email', async () => {
    const res = await request(app).post('/auth/login').send({
      email: 'nobody@example.com',
      password: 'password123',
    });
    expect(res.status).toBe(401);
  });
});

describe('POST /auth/register — invite code resolution', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('valid inviteCode creates ONE Friendship doc and fires notification for inviter', async () => {
    // Register the inviter first so we have their inviteCode
    const inviterRes = await request(app).post('/auth/register').send({
      name: 'Inviter User',
      email: 'inviter@example.com',
      password: 'password123',
    });
    expect(inviterRes.status).toBe(201);
    const inviterInviteCode: string = inviterRes.body.user.inviteCode;
    const inviterId: string = inviterRes.body.user.id;

    // Register the new user with the inviter's code
    const newUserRes = await request(app).post('/auth/register').send({
      name: 'New User',
      email: 'newuser@example.com',
      password: 'password123',
      inviteCode: inviterInviteCode,
    });
    expect(newUserRes.status).toBe(201);
    const newUserId: string = newUserRes.body.user.id;

    // Response includes invitedBy payload
    expect(newUserRes.body.invitedBy).not.toBeNull();
    expect(newUserRes.body.invitedBy.id).toBe(inviterId);
    expect(newUserRes.body.invitedBy.name).toBe('Inviter User');

    // Exactly ONE Friendship doc exists with the correct shape
    const newUserOid = new mongoose.Types.ObjectId(newUserId);
    const inviterOid = new mongoose.Types.ObjectId(inviterId);
    const friendshipCount = await Friendship.countDocuments({
      requester: newUserOid,
      recipient: inviterOid,
      status: 'accepted',
    });
    expect(friendshipCount).toBe(1);

    // No reverse doc (single-doc model)
    const reverseFriendshipCount = await Friendship.countDocuments({
      requester: inviterOid,
      recipient: newUserOid,
    });
    expect(reverseFriendshipCount).toBe(0);

    // Exactly ONE notification fired for the inviter
    const notifCount = await Notification.countDocuments({
      userId: inviterOid,
      type: 'friend_joined_via_invite',
    });
    expect(notifCount).toBe(1);

    const notif = await Notification.findOne({ userId: inviterOid, type: 'friend_joined_via_invite' });
    expect(notif?.title).toBe('New User joined Chewabl!');
    expect(notif?.body).toBe('New User joined via your invite — you\'re now friends');
  });

  it('invalid/nonexistent inviteCode: user created, no Friendship, no notification, invitedBy null, status 201', async () => {
    const res = await request(app).post('/auth/register').send({
      name: 'Solo User',
      email: 'solo@example.com',
      password: 'password123',
      inviteCode: 'DOESNTEXIST',
    });
    expect(res.status).toBe(201);
    expect(res.body.invitedBy).toBeNull();
    expect(res.body.user.id).toBeTruthy();

    const friendshipCount = await Friendship.countDocuments({});
    expect(friendshipCount).toBe(0);

    const notifCount = await Notification.countDocuments({});
    expect(notifCount).toBe(0);
  });

  it('empty string inviteCode behaves identically to no inviteCode', async () => {
    const res = await request(app).post('/auth/register').send({
      name: 'Empty Code User',
      email: 'emptycode@example.com',
      password: 'password123',
      inviteCode: '',
    });
    expect(res.status).toBe(201);
    expect(res.body.invitedBy).toBeNull();

    const friendshipCount = await Friendship.countDocuments({});
    expect(friendshipCount).toBe(0);
  });

  it('lowercase / whitespace inviteCode is normalized before lookup and resolves correctly', async () => {
    // Register inviter
    const inviterRes = await request(app).post('/auth/register').send({
      name: 'Inviter Norm',
      email: 'inviter.norm@example.com',
      password: 'password123',
    });
    const inviterInviteCode: string = inviterRes.body.user.inviteCode;
    const inviterId: string = inviterRes.body.user.id;

    // Send lowercase + surrounding whitespace
    const newUserRes = await request(app).post('/auth/register').send({
      name: 'Norm New User',
      email: 'normnew@example.com',
      password: 'password123',
      inviteCode: `  ${inviterInviteCode.toLowerCase()}  `,
    });
    expect(newUserRes.status).toBe(201);
    expect(newUserRes.body.invitedBy).not.toBeNull();
    expect(newUserRes.body.invitedBy.id).toBe(inviterId);

    const friendshipCount = await Friendship.countDocuments({ status: 'accepted' });
    expect(friendshipCount).toBe(1);
  });

  it('Friendship.create failure: 201 still returned, no friendship in DB, invitedBy null', async () => {
    // Register the inviter
    const inviterRes = await request(app).post('/auth/register').send({
      name: 'Inviter Fail',
      email: 'inviter.fail@example.com',
      password: 'password123',
    });
    const inviterInviteCode: string = inviterRes.body.user.inviteCode;

    // Induce Friendship.create failure by inserting a duplicate doc that violates the unique index
    // We'll use Jest spying to simulate the failure instead, which is cleaner
    const originalCreate = Friendship.create.bind(Friendship);
    jest.spyOn(Friendship, 'create').mockImplementationOnce(() => {
      throw new Error('Simulated Friendship.create failure');
    });

    const newUserRes = await request(app).post('/auth/register').send({
      name: 'New Fail User',
      email: 'newfail@example.com',
      password: 'password123',
      inviteCode: inviterInviteCode,
    });

    // Restore the original implementation
    (Friendship.create as jest.Mock).mockRestore?.();
    // Re-bind to ensure it's back to normal for subsequent tests
    void originalCreate; // used to satisfy no-unused-vars

    expect(newUserRes.status).toBe(201);
    expect(newUserRes.body.invitedBy).toBeNull();
    expect(newUserRes.body.user.id).toBeTruthy();

    // No friendship doc in DB
    const friendshipCount = await Friendship.countDocuments({});
    expect(friendshipCount).toBe(0);
  });
});
