import request from 'supertest';
import app from '../app';
import { connectTestDB, disconnectTestDB, clearDB } from './helpers/db';
import { createTestUser, authHeader } from './helpers/auth';

beforeAll(async () => { await connectTestDB(); });
afterAll(async () => { await disconnectTestDB(); });
afterEach(async () => { await clearDB(); });

describe('GET /users/me', () => {
  it('returns user with defined id and no passwordHash', async () => {
    const user = await createTestUser();
    const res = await request(app)
      .get('/users/me')
      .set(authHeader(user.token));
    expect(res.status).toBe(200);
    expect(typeof res.body.id).toBe('string');
    expect(res.body.id).toBeTruthy();
    expect(res.body.passwordHash).toBeUndefined();
  });

  it('returns 401 without token', async () => {
    const res = await request(app).get('/users/me');
    expect(res.status).toBe(401);
  });
});

describe('PUT /users/me', () => {
  it('updates name and phone', async () => {
    const user = await createTestUser();
    const res = await request(app)
      .put('/users/me')
      .set(authHeader(user.token))
      .send({ name: 'Updated Name', phone: '+15551234567' });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Updated Name');
    expect(res.body.phone).toBe('+15551234567');
  });

  it('persists preferences and favorites — regression for silent drop bug', async () => {
    const user = await createTestUser();
    const prefs = { cuisines: ['Italian', 'Thai'], budget: ['$$'], distance: '5' };
    const favs = ['place123', 'place456'];

    const putRes = await request(app)
      .put('/users/me')
      .set(authHeader(user.token))
      .send({ preferences: prefs, favorites: favs });
    expect(putRes.status).toBe(200);

    // Re-fetch to confirm persistence
    const getRes = await request(app)
      .get('/users/me')
      .set(authHeader(user.token));
    expect(getRes.status).toBe(200);
    expect(getRes.body.preferences).toMatchObject(prefs);
    expect(Array.isArray(getRes.body.favorites)).toBe(true);
    expect(getRes.body.favorites.length).toBe(2);
  });
});

describe('PUT /users/me — server-side field validation (#216 / #225)', () => {
  it('rejects a name longer than 80 chars', async () => {
    const user = await createTestUser();
    const res = await request(app)
      .put('/users/me')
      .set(authHeader(user.token))
      .send({ name: 'x'.repeat(81) });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/name/i);
  });

  it('rejects an empty/whitespace name', async () => {
    const user = await createTestUser();
    const res = await request(app)
      .put('/users/me')
      .set(authHeader(user.token))
      .send({ name: '   ' });
    expect(res.status).toBe(400);
  });

  it('rejects a phone longer than 32 chars', async () => {
    const user = await createTestUser();
    const res = await request(app)
      .put('/users/me')
      .set(authHeader(user.token))
      .send({ phone: '1'.repeat(33) });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/phone/i);
  });

  it('rejects a non-string name', async () => {
    const user = await createTestUser();
    const res = await request(app)
      .put('/users/me')
      .set(authHeader(user.token))
      .send({ name: { evil: true } });
    expect(res.status).toBe(400);
  });

  it('rejects favorites that is not an array of strings', async () => {
    const user = await createTestUser();
    const res = await request(app)
      .put('/users/me')
      .set(authHeader(user.token))
      .send({ favorites: [1, 2, 3] });
    expect(res.status).toBe(400);
  });

  it('accepts a valid name within limits and trims it', async () => {
    const user = await createTestUser();
    const res = await request(app)
      .put('/users/me')
      .set(authHeader(user.token))
      .send({ name: '  Valid Name  ' });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Valid Name');
  });
});

describe('PUT /users/me — email change (F-007-017)', () => {
  it('updates email and normalizes to lowercase', async () => {
    const user = await createTestUser();
    const res = await request(app)
      .put('/users/me')
      .set(authHeader(user.token))
      .send({ email: 'NewAddress@Example.com' });
    expect(res.status).toBe(200);
    expect(res.body.email).toBe('newaddress@example.com');
  });

  it('rejects an invalid email format', async () => {
    const user = await createTestUser();
    const res = await request(app)
      .put('/users/me')
      .set(authHeader(user.token))
      .send({ email: 'not-an-email' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/email/i);
  });

  it('rejects an email already used by another account', async () => {
    const taken = await createTestUser({ email: 'taken@example.com' });
    const user = await createTestUser();
    const res = await request(app)
      .put('/users/me')
      .set(authHeader(user.token))
      .send({ email: 'taken@example.com' });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/already/i);
    // sanity: the taken account is untouched
    expect(taken.email).toBe('taken@example.com');
  });

  it('allows re-saving the same email (no false self-conflict)', async () => {
    const user = await createTestUser({ email: 'self@example.com' });
    const res = await request(app)
      .put('/users/me')
      .set(authHeader(user.token))
      .send({ email: 'self@example.com' });
    expect(res.status).toBe(200);
    expect(res.body.email).toBe('self@example.com');
  });
});

describe('GET /users/invite/:code', () => {
  it('finds user by invite code', async () => {
    const user = await createTestUser();
    // Get the invite code from /users/me
    const meRes = await request(app)
      .get('/users/me')
      .set(authHeader(user.token));
    const inviteCode = meRes.body.inviteCode;
    expect(inviteCode).toBeTruthy();

    const res = await request(app)
      .get(`/users/invite/${inviteCode}`)
      .set(authHeader(user.token));
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(user.userId);
  });

  it('returns 404 for unknown invite code', async () => {
    const user = await createTestUser();
    const res = await request(app)
      .get('/users/invite/ZZZZZZ')
      .set(authHeader(user.token));
    expect(res.status).toBe(404);
  });
});
