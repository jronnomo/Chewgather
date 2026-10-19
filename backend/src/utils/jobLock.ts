import { randomUUID } from 'crypto';
import mongoose from 'mongoose';

const INSTANCE_ID = randomUUID();

// Time-boxed lease so a scheduled job runs on exactly one machine per tick when
// the API runs on several. The lease is deliberately NOT released after the job:
// releasing would let a second machine whose cron fires a moment later re-run it.
// It simply expires, and a surviving machine takes over if the holder dies.
export async function acquireJobLease(name: string, ttlMs: number, now: Date = new Date()): Promise<boolean> {
  const locks = mongoose.connection.collection('joblocks');
  try {
    const res = await locks.updateOne(
      { _id: name as unknown as never, lockedUntil: { $lte: now } },
      { $set: { lockedUntil: new Date(now.getTime() + ttlMs), owner: INSTANCE_ID } },
      { upsert: true },
    );
    return res.modifiedCount === 1 || res.upsertedCount === 1;
  } catch (err) {
    // Duplicate key on the upsert means a live lease exists (held by someone else).
    if ((err as { code?: number }).code === 11000) return false;
    throw err;
  }
}
