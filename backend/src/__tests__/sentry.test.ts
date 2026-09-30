import request from 'supertest';
import express from 'express';
import * as Sentry from '@sentry/node';
import type { ErrorEvent } from '@sentry/node';
import { scrubEvent, scrubString } from '../utils/sentryScrub';
import { captureServerErrors, captureServerErrorResponses } from '../middleware/sentry';

jest.mock('@sentry/node', () => ({
  captureException: jest.fn(),
  captureMessage: jest.fn(),
}));

describe('sentry scrubbing', () => {
  it('redacts emails and phone numbers in strings', () => {
    expect(scrubString('user jane.doe+x@example.com called +1 (415) 555-0134 ok')).toBe(
      'user [email] called [phone] ok',
    );
    expect(scrubString('order 12345 failed')).toBe('order 12345 failed');
  });

  it('strips auth headers, cookies, bodies and PII from events', () => {
    const event = {
      request: {
        url: 'https://api.test/users/search?q=a@b.co',
        headers: { Authorization: 'Bearer secret', cookie: 'a=b', 'content-type': 'application/json' },
        data: { email: 'a@b.co', password: 'hunter2' },
        cookies: { a: 'b' },
      },
      user: { id: '1', email: 'a@b.co', username: 'jane', ip_address: '1.2.3.4' },
      exception: { values: [{ type: 'Error', value: 'dup key a@b.co' }] },
      breadcrumbs: [{ message: 'call 415-555-0134', data: { to: 'a@b.co' } }],
      extra: { phone: '+14155550134' },
    } as unknown as ErrorEvent;

    const out = scrubEvent(event);
    expect(out.request?.data).toBeUndefined();
    expect(out.request?.cookies).toBeUndefined();
    expect(out.request?.headers).toEqual({ 'content-type': 'application/json' });
    expect(out.request?.url).not.toContain('a@b.co');
    expect(out.user).toEqual({ id: '1' });
    expect(out.exception?.values?.[0].value).toBe('dup key [email]');
    expect(out.breadcrumbs?.[0].message).toBe('call [phone]');
    expect(out.breadcrumbs?.[0].data).toEqual({ to: '[email]' });
    expect(JSON.stringify(out.extra)).not.toContain('4155550134');
  });
});

describe('5xx capture middleware', () => {
  const exSpy = Sentry.captureException as unknown as jest.Mock;
  const msgSpy = Sentry.captureMessage as unknown as jest.Mock;

  beforeEach(() => jest.clearAllMocks());

  function makeApp() {
    const app = express();
    app.use(captureServerErrorResponses);
    app.get('/boom', () => { throw new Error('boom'); });
    app.get('/teapot', (_req, _res, next) => next(Object.assign(new Error('nope'), { status: 418 })));
    app.get('/handled-500', (_req, res) => { res.status(500).json({ error: 'x' }); });
    app.get('/ok', (_req, res) => { res.json({ ok: true }); });
    app.use(captureServerErrors);
    return app;
  }

  it('captures thrown errors once (no duplicate message)', async () => {
    const res = await request(makeApp()).get('/boom');
    expect(res.status).toBe(500);
    expect(exSpy).toHaveBeenCalledTimes(1);
    expect(msgSpy).not.toHaveBeenCalled();
  });

  it('captures self-handled 5xx responses as a message', async () => {
    await request(makeApp()).get('/handled-500');
    expect(exSpy).not.toHaveBeenCalled();
    expect(msgSpy).toHaveBeenCalledWith('HTTP 500 GET /handled-500', expect.anything());
  });

  it('ignores 4xx and 2xx', async () => {
    await request(makeApp()).get('/teapot');
    await request(makeApp()).get('/ok');
    expect(exSpy).not.toHaveBeenCalled();
    expect(msgSpy).not.toHaveBeenCalled();
  });
});
