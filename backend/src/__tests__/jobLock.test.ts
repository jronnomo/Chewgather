import { connectTestDB, disconnectTestDB, clearDB } from './helpers/db';
import { acquireJobLease } from '../utils/jobLock';

beforeAll(async () => { await connectTestDB(); });
afterAll(async () => { await disconnectTestDB(); });
afterEach(async () => { await clearDB(); });

describe('acquireJobLease', () => {
  const t0 = new Date('2026-10-19T12:00:00Z');

  it('grants the first caller and rejects a second while the lease is live', async () => {
    expect(await acquireJobLease('job', 4 * 60_000, t0)).toBe(true);
    expect(await acquireJobLease('job', 4 * 60_000, new Date(t0.getTime() + 1000))).toBe(false);
  });

  it('lets exactly one of many concurrent callers win', async () => {
    const results = await Promise.all(Array.from({ length: 10 }, () => acquireJobLease('job', 4 * 60_000, t0)));
    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it('can be re-acquired once the lease has expired', async () => {
    expect(await acquireJobLease('job', 4 * 60_000, t0)).toBe(true);
    expect(await acquireJobLease('job', 4 * 60_000, new Date(t0.getTime() + 5 * 60_000))).toBe(true);
  });

  it('leases are independent per job name', async () => {
    expect(await acquireJobLease('a', 60_000, t0)).toBe(true);
    expect(await acquireJobLease('b', 60_000, t0)).toBe(true);
  });
});
