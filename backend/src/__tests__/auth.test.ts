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
    expect(notif?.title).toBe('New User joined Chewgather!');
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

describe('POST /auth/forgot-password', () => {
  beforeEach(async () => {
    await request(app).post('/auth/register').send({
      name: 'Alice', email: 'alice@example.com', password: 'password123',
    });
  });

  it('known email → 200 + ok=true + code is 6-digit string (test env)', async () => {
    const res = await request(app).post('/auth/forgot-password').send({ email: 'alice@example.com' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(typeof res.body.code).toBe('string');
    expect(res.body.code).toMatch(/^\d{6}$/);
  });

  it('unknown email → 404 No account found', async () => {
    const res = await request(app).post('/auth/forgot-password').send({ email: 'ghost@example.com' });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('No account found');
  });

  it('missing email → 400', async () => {
    const res = await request(app).post('/auth/forgot-password').send({});
    expect(res.status).toBe(400);
  });

  it('invalid email format → 400 Invalid email format', async () => {
    const res = await request(app).post('/auth/forgot-password').send({ email: 'notanemail' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Invalid email format');
  });

  it('re-issue resets resetCodeAttempts to 0 (second call overwrites first code)', async () => {
    await request(app).post('/auth/forgot-password').send({ email: 'alice@example.com' });
    const UserModel = require('../models/User').default;
    await UserModel.findOneAndUpdate(
      { email: 'alice@example.com' },
      { resetCodeAttempts: 3 },
    );
    // Second forgot-password call should reset attempts to 0
    await request(app).post('/auth/forgot-password').send({ email: 'alice@example.com' });
    const user = await UserModel.findOne({ email: 'alice@example.com' });
    expect(user.resetCodeAttempts).toBe(0);
  });
});

describe('POST /auth/reset-password', () => {
  let code: string;

  beforeEach(async () => {
    await request(app).post('/auth/register').send({
      name: 'Alice', email: 'alice@example.com', password: 'password123',
    });
    const r = await request(app).post('/auth/forgot-password').send({ email: 'alice@example.com' });
    code = r.body.code;
  });

  it('valid code + strong password → 200 ok=true', async () => {
    const res = await request(app).post('/auth/reset-password').send({
      email: 'alice@example.com', code, newPassword: 'newpassword1',
    });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('wrong code → 400 Invalid code', async () => {
    const res = await request(app).post('/auth/reset-password').send({
      email: 'alice@example.com', code: '000000', newPassword: 'newpassword1',
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Invalid code');
  });

  it('expired code → 400 Code expired', async () => {
    // Backdate expiry directly via model
    const UserModel = require('../models/User').default;
    await UserModel.findOneAndUpdate(
      { email: 'alice@example.com' },
      { resetCodeExpiresAt: new Date(Date.now() - 1000) },
    );
    const res = await request(app).post('/auth/reset-password').send({
      email: 'alice@example.com', code, newPassword: 'newpassword1',
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Code expired');
  });

  it('weak password (< 8 chars) → 400 Password must be at least 8 characters', async () => {
    const res = await request(app).post('/auth/reset-password').send({
      email: 'alice@example.com', code, newPassword: 'short',
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Password must be at least 8 characters');
  });

  // CONCERN-9 fix: assert old password fails login, new password succeeds
  it('after success: old password → 401, new password → 200', async () => {
    await request(app).post('/auth/reset-password').send({
      email: 'alice@example.com', code, newPassword: 'newpassword1',
    });
    const oldLogin = await request(app).post('/auth/login').send({
      email: 'alice@example.com', password: 'password123',
    });
    expect(oldLogin.status).toBe(401);

    const newLogin = await request(app).post('/auth/login').send({
      email: 'alice@example.com', password: 'newpassword1',
    });
    expect(newLogin.status).toBe(200);
    expect(newLogin.body.token).toBeTruthy();
  });

  // CONCERN-8 fix: assert all three reset fields cleared after success
  it('after success: resetCodeHash, resetCodeExpiresAt, resetCodeAttempts all undefined', async () => {
    await request(app).post('/auth/reset-password').send({
      email: 'alice@example.com', code, newPassword: 'newpassword1',
    });
    const UserModel = require('../models/User').default;
    const user = await UserModel.findOne({ email: 'alice@example.com' });
    expect(user.resetCodeHash).toBeUndefined();
    expect(user.resetCodeExpiresAt).toBeUndefined();
    expect(user.resetCodeAttempts).toBeUndefined();
  });

  // CONCERN-9 fix: attempt-cap asserts old password still works (password not changed)
  it('over 5 wrong attempts → 400 (correct code on 6th attempt also fails; old password unchanged)', async () => {
    for (let i = 0; i < 5; i++) {
      await request(app).post('/auth/reset-password').send({
        email: 'alice@example.com', code: '000000', newPassword: 'newpassword1',
      });
    }
    // 6th attempt with the CORRECT code — still 400 because attempt cap fires first
    const res = await request(app).post('/auth/reset-password').send({
      email: 'alice@example.com', code, newPassword: 'newpassword1',
    });
    expect(res.status).toBe(400);

    // Old password must still work — password was NOT changed
    const loginRes = await request(app).post('/auth/login').send({
      email: 'alice@example.com', password: 'password123',
    });
    expect(loginRes.status).toBe(200);
  });

  it('code reuse after success → 400 (reset fields cleared)', async () => {
    await request(app).post('/auth/reset-password').send({
      email: 'alice@example.com', code, newPassword: 'newpassword1',
    });
    // Second attempt with the same code
    const res = await request(app).post('/auth/reset-password').send({
      email: 'alice@example.com', code, newPassword: 'anotherpassword1',
    });
    expect(res.status).toBe(400);
  });

  it('missing fields → 400 email, code, and newPassword are required', async () => {
    const res = await request(app).post('/auth/reset-password').send({ email: 'alice@example.com' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('email, code, and newPassword are required');
  });

  // Missing Requirement fix: resend resets attempt counter to 5 fresh tries
  it('resend after 3 wrong attempts → new code issued → 5 fresh attempts available', async () => {
    // Use 3 wrong codes
    for (let i = 0; i < 3; i++) {
      await request(app).post('/auth/reset-password').send({
        email: 'alice@example.com', code: '000000', newPassword: 'newpassword1',
      });
    }
    // Resend (re-issue code)
    const r2 = await request(app).post('/auth/forgot-password').send({ email: 'alice@example.com' });
    expect(r2.status).toBe(200);
    const newCode: string = r2.body.code;

    // 4 wrong attempts should now be allowed (attempt counter reset to 0)
    for (let i = 0; i < 4; i++) {
      const res = await request(app).post('/auth/reset-password').send({
        email: 'alice@example.com', code: '000000', newPassword: 'newpassword1',
      });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Invalid code'); // not locked out
    }
    // 5th attempt with correct new code → success
    const res = await request(app).post('/auth/reset-password').send({
      email: 'alice@example.com', code: newCode, newPassword: 'newpassword1',
    });
    expect(res.status).toBe(200);
  });
});
