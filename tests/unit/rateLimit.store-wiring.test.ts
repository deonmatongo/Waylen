import { describe, it, expect, vi, afterEach } from 'vitest';

/**
 * Proves the storage-backend wiring in src/middleware/rateLimit.ts itself —
 * that each limiter asks for an Upstash-backed store when configured, and
 * otherwise leaves `store` undefined so express-rate-limit falls back to its
 * default in-memory store (today's behavior, unchanged). The Upstash client
 * is mocked at the module boundary (upstashRateLimitStore.js) rather than
 * hitting a real Upstash endpoint — there isn't one configured in this
 * environment.
 */
describe('rate limiter store wiring', () => {
  afterEach(() => {
    vi.doUnmock('../../src/middleware/upstashRateLimitStore.js');
    vi.resetModules();
  });

  it('does not reach for an Upstash store when it is not configured (fallback path)', async () => {
    const createUpstashStore = vi.fn();
    vi.doMock('../../src/middleware/upstashRateLimitStore.js', () => ({
      isUpstashConfigured: false,
      createUpstashStore,
    }));
    vi.resetModules();

    const rateLimitModule = await import('../../src/middleware/rateLimit.js');

    expect(createUpstashStore).not.toHaveBeenCalled();
    // The limiters must still exist and be usable middleware functions —
    // i.e. the fallback path didn't just silently fail to construct them.
    expect(typeof rateLimitModule.globalRateLimiter).toBe('function');
    expect(typeof rateLimitModule.authRateLimiter).toBe('function');
    expect(typeof rateLimitModule.formRateLimiter).toBe('function');
    expect(typeof rateLimitModule.uploadRateLimiter).toBe('function');
  });

  it('wires every limiter to its own prefixed Upstash store when configured', async () => {
    // A minimal stand-in satisfying express-rate-limit's Store shape — it
    // validates `increment`/`decrement`/`resetKey` are functions at
    // construction time (parseOptions), before any request is made.
    const stores = new Map<string, { prefix: string }>();
    const createUpstashStore = vi.fn((prefix: string) => {
      const store = {
        prefix,
        increment: vi.fn().mockResolvedValue({ totalHits: 1, resetTime: new Date() }),
        decrement: vi.fn().mockResolvedValue(undefined),
        resetKey: vi.fn().mockResolvedValue(undefined),
      };
      stores.set(prefix, store);
      return store;
    });
    vi.doMock('../../src/middleware/upstashRateLimitStore.js', () => ({
      isUpstashConfigured: true,
      createUpstashStore,
    }));
    vi.resetModules();

    const rateLimitModule = await import('../../src/middleware/rateLimit.js');

    // One call per limiter, each with its own namespace prefix so the seven
    // limiters' keys never collide in the shared Redis database.
    expect(createUpstashStore).toHaveBeenCalledTimes(7);
    const prefixesUsed = createUpstashStore.mock.calls.map((call) => call[0]);
    expect(new Set(prefixesUsed).size).toBe(7);

    expect(typeof rateLimitModule.globalRateLimiter).toBe('function');
    expect(typeof rateLimitModule.authRateLimiter).toBe('function');
    expect(typeof rateLimitModule.formRateLimiter).toBe('function');
    expect(typeof rateLimitModule.uploadRateLimiter).toBe('function');
  });
});
