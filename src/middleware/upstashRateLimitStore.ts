/**
 * Optional Upstash Redis-backed store for express-rate-limit.
 *
 * Only used when `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` are
 * configured (see src/config/env.ts) — otherwise rateLimit.ts falls back to
 * express-rate-limit's per-process in-memory store, as it does today.
 *
 * Why a hand-rolled adapter instead of an off-the-shelf store:
 *
 *   - `rate-limit-redis` expects a `sendCommand` function that issues raw
 *     RESP commands (`SCRIPT LOAD`, `EVALSHA`, ...) over a stateful
 *     connection — the shape `ioredis`/`node-redis` expose. `@upstash/redis`
 *     is a REST client (plain HTTPS fetch, no pooled TCP connection, which is
 *     exactly why it works from Vercel's serverless functions) and has no
 *     such method. `rate-limit-redis@6` also pins a peer dependency on
 *     `express-rate-limit@>=8.6.0`; this project is on v7, so it doesn't even
 *     install cleanly alongside the existing limiters.
 *   - `@upstash/ratelimit` is purpose-built for Upstash but is a standalone
 *     rate limiter with its own `limit()` call and its own algorithms — not a
 *     `Store` implementation express-rate-limit can plug in. Adopting it
 *     would mean replacing express-rate-limit's request handling entirely
 *     (including its header handling, skip/handler hooks already in use
 *     here), not just swapping the storage backend, which is more than this
 *     task calls for.
 *
 * `@upstash/redis` does support a direct `EVAL` over REST, so this store runs
 * the same atomic "increment, and set expiry only on the first hit in the
 * window" Lua script `rate-limit-redis` uses internally — just invoked
 * through Upstash's REST `eval()` instead of a raw `sendCommand`.
 */
import { Redis } from '@upstash/redis';
import type { IncrementResponse, Options, Store } from 'express-rate-limit';
import { env } from '../config/env.js';

export const isUpstashConfigured = Boolean(
  env.UPSTASH_REDIS_REST_URL && env.UPSTASH_REDIS_REST_TOKEN,
);

/**
 * KEYS[1] - the rate-limit key
 * ARGV[1] - windowMs
 *
 * Increments the counter; the first hit in a window also sets its PEXPIRE,
 * so later hits in the same window don't keep pushing the reset time back.
 * Returns [totalHits, remainingTtlMs].
 */
const INCREMENT_SCRIPT = `
local current = redis.call("INCR", KEYS[1])
if current == 1 then
  redis.call("PEXPIRE", KEYS[1], ARGV[1])
end
local ttl = redis.call("PTTL", KEYS[1])
return { current, ttl }
`;

/**
 * A minimal subset of the `@upstash/redis` client surface this store uses —
 * narrow enough that tests can supply a plain mock without constructing a
 * real `Redis` instance.
 */
export interface UpstashLikeClient {
  eval<TArgs extends unknown[], TData = unknown>(
    script: string,
    keys: string[],
    args: TArgs,
  ): Promise<TData>;
  decr(key: string): Promise<number>;
  del(...keys: string[]): Promise<number>;
}

export class UpstashRedisStore implements Store {
  prefix: string;
  windowMs = 0;
  private readonly client: UpstashLikeClient;

  constructor(prefix: string, client: UpstashLikeClient) {
    this.prefix = prefix;
    this.client = client;
  }

  init(options: Options): void {
    this.windowMs = options.windowMs;
  }

  private key(key: string): string {
    return `${this.prefix}${key}`;
  }

  async increment(key: string): Promise<IncrementResponse> {
    const [totalHits, ttl] = await this.client.eval<[number], [number, number]>(
      INCREMENT_SCRIPT,
      [this.key(key)],
      [this.windowMs],
    );
    const resetTime = new Date(Date.now() + (ttl > 0 ? ttl : this.windowMs));
    return { totalHits, resetTime };
  }

  async decrement(key: string): Promise<void> {
    await this.client.decr(this.key(key));
  }

  async resetKey(key: string): Promise<void> {
    await this.client.del(this.key(key));
  }
}

let sharedClient: Redis | undefined;

function getSharedClient(): Redis {
  sharedClient ??= new Redis({
    url: env.UPSTASH_REDIS_REST_URL,
    token: env.UPSTASH_REDIS_REST_TOKEN,
  });
  return sharedClient;
}

/**
 * Builds a store for a single limiter. `prefix` keeps each limiter's keys
 * (global/auth/form/upload) in their own namespace within the same Redis
 * database.
 */
export function createUpstashStore(prefix: string): UpstashRedisStore {
  return new UpstashRedisStore(prefix, getSharedClient());
}
