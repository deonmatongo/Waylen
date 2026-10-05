import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  UpstashRedisStore,
  type UpstashLikeClient,
} from '../../src/middleware/upstashRateLimitStore.js';

/**
 * Builds a mock `UpstashLikeClient` plus standalone references to its three
 * spies. Assertions below use those standalone references rather than
 * `client.eval`/`client.decr`/`client.del` member access, which
 * `@typescript-eslint/unbound-method` flags as an unsafe detached method
 * reference.
 */
function mockClient(evalResolvedValue: [number, number] = [1, 60_000]) {
  const evalFn = vi.fn().mockResolvedValue(evalResolvedValue);
  const decrFn = vi.fn().mockResolvedValue(0);
  const delFn = vi.fn().mockResolvedValue(1);
  const client: UpstashLikeClient = { eval: evalFn, decr: decrFn, del: delFn };
  return { client, evalFn, decrFn, delFn };
}

describe('UpstashRedisStore (adapter over the Upstash REST client)', () => {
  it('prefixes keys and sends windowMs through to the atomic increment script', async () => {
    const { client, evalFn } = mockClient([5, 42_000]);
    const store = new UpstashRedisStore('rl:auth:', client);
    store.init({ windowMs: 15 * 60_000 } as never);

    const result = await store.increment('203.0.113.1');

    expect(evalFn).toHaveBeenCalledTimes(1);
    const call = evalFn.mock.calls[0]!;
    const [script, keys, args] = call as [string, string[], number[]];
    expect(script).toContain('INCR');
    expect(keys).toEqual(['rl:auth:203.0.113.1']);
    expect(args).toEqual([15 * 60_000]);

    expect(result.totalHits).toBe(5);
    // resetTime should be ~42s out from now (within a couple seconds of slop).
    expect(result.resetTime!.getTime()).toBeGreaterThan(Date.now() + 40_000);
    expect(result.resetTime!.getTime()).toBeLessThan(Date.now() + 45_000);
  });

  it('falls back to windowMs for the reset time when Redis reports no TTL', async () => {
    // PTTL returns a non-positive number for a key with no expiry (shouldn't
    // happen given the script always PEXPIREs on the first hit, but the
    // store should not produce a bogus reset time if it ever does).
    const { client } = mockClient([1, -1]);
    const store = new UpstashRedisStore('rl:global:', client);
    store.init({ windowMs: 60_000 } as never);

    const result = await store.increment('203.0.113.2');

    expect(result.resetTime!.getTime()).toBeGreaterThan(Date.now() + 55_000);
  });

  it('decrement() calls decr with the prefixed key', async () => {
    const { client, decrFn } = mockClient();
    const store = new UpstashRedisStore('rl:form:', client);

    await store.decrement('203.0.113.3');

    expect(decrFn).toHaveBeenCalledWith('rl:form:203.0.113.3');
  });

  it('resetKey() calls del with the prefixed key', async () => {
    const { client, delFn } = mockClient();
    const store = new UpstashRedisStore('rl:upload:', client);

    await store.resetKey('203.0.113.4');

    expect(delFn).toHaveBeenCalledWith('rl:upload:203.0.113.4');
  });
});

describe('isUpstashConfigured', () => {
  const ORIGINAL_URL = process.env.UPSTASH_REDIS_REST_URL;
  const ORIGINAL_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    if (ORIGINAL_URL === undefined) delete process.env.UPSTASH_REDIS_REST_URL;
    else process.env.UPSTASH_REDIS_REST_URL = ORIGINAL_URL;
    if (ORIGINAL_TOKEN === undefined) delete process.env.UPSTASH_REDIS_REST_TOKEN;
    else process.env.UPSTASH_REDIS_REST_TOKEN = ORIGINAL_TOKEN;
    vi.resetModules();
  });

  it('is false when the env vars are unset — today\'s behavior, unchanged', async () => {
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;

    const { isUpstashConfigured } = await import('../../src/middleware/upstashRateLimitStore.js');

    expect(isUpstashConfigured).toBe(false);
  });

  it('is true when both env vars are set', async () => {
    process.env.UPSTASH_REDIS_REST_URL = 'https://example-upstash.upstash.io';
    process.env.UPSTASH_REDIS_REST_TOKEN = 'test-token';

    const { isUpstashConfigured } = await import('../../src/middleware/upstashRateLimitStore.js');

    expect(isUpstashConfigured).toBe(true);
  });
});
