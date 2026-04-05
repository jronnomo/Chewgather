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
