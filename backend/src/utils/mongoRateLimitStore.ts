import mongoose from 'mongoose';
import type { ClientRateLimitInfo, Options, Store } from 'express-rate-limit';

// Shared express-rate-limit store backed by the existing Mongo connection, so
// every Fly machine counts against the same per-client bucket. One document per
// (prefix, key); a TTL index on `expiresAt` reaps spent windows.

const COLLECTION = 'ratelimits';

interface RateLimitDoc {
  _id: string;
  count: number;
  resetTime: Date;
  expiresAt: Date;
}

const isDuplicateKey = (err: unknown) => (err as { code?: number })?.code === 11000;

export class MongoRateLimitStore implements Store {
  readonly localKeys = false;
  readonly prefix: string;
  private windowMs = 60_000;
  private indexReady?: Promise<unknown>;

  constructor(prefix: string) {
    this.prefix = `${prefix}:`;
  }

  init(options: Options): void {
    this.windowMs = options.windowMs;
  }

  private collection() {
    const col = mongoose.connection.collection<RateLimitDoc>(COLLECTION);
    this.indexReady ??= col.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }).catch((err) => {
      this.indexReady = undefined;
      throw err;
    });
    return { col, ready: this.indexReady };
  }

  private id(key: string) {
    return this.prefix + key;
  }

  async increment(key: string): Promise<ClientRateLimitInfo> {
    const { col, ready } = this.collection();
    await ready;
    const now = new Date();
    const freshReset = new Date(now.getTime() + this.windowMs);
    const expired = { $lte: [{ $ifNull: ['$resetTime', new Date(0)] }, now] };

    // A single aggregation-pipeline upsert resets an expired window and
    // increments atomically, so concurrent machines cannot lose hits.
    const run = () =>
      col.findOneAndUpdate(
        { _id: this.id(key) },
        [
          {
            $set: {
              count: { $cond: [expired, 1, { $add: [{ $ifNull: ['$count', 0] }, 1] }] },
              resetTime: { $cond: [expired, freshReset, '$resetTime'] },
            },
          },
          { $set: { expiresAt: '$resetTime' } },
        ],
        { upsert: true, returnDocument: 'after' }
      );

    let doc;
    try {
      doc = await run();
    } catch (err) {
      // Two machines upserting the same brand-new key can collide once.
      if (!isDuplicateKey(err)) throw err;
      doc = await run();
    }
    if (!doc) throw new Error('rate limit store: increment returned no document');
    return { totalHits: doc.count, resetTime: doc.resetTime };
  }

  async decrement(key: string): Promise<void> {
    const { col, ready } = this.collection();
    await ready;
    await col.updateOne({ _id: this.id(key), count: { $gt: 0 } }, { $inc: { count: -1 } });
  }

  async resetKey(key: string): Promise<void> {
    const { col, ready } = this.collection();
    await ready;
    await col.deleteOne({ _id: this.id(key) });
  }

  async resetAll(): Promise<void> {
    const { col, ready } = this.collection();
    await ready;
    await col.deleteMany({ _id: { $regex: `^${this.prefix}` } });
  }
}
