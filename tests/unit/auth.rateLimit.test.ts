import { describe, it, expect } from 'vitest';
import crypto from 'node:crypto';
import { emailRateLimitKey } from '../../src/middleware/rateLimit.js';

describe('emailRateLimitKey', () => {
  const digest = (v: string) => crypto.createHash('sha256').update(v).digest('hex');

  it('hashes the normalised email so case/whitespace variants share a bucket', () => {
    const a = emailRateLimitKey({ body: { email: ' Foo@Example.com ' }, ip: '1.1.1.1' });
    const b = emailRateLimitKey({ body: { email: 'foo@example.com' }, ip: '2.2.2.2' });
    expect(a).toBe(b);
    expect(a).toBe(`email:${digest('foo@example.com')}`);
    expect(a).not.toContain('foo@example.com');
  });

  it('falls back to the client IP when there is no usable email', () => {
    expect(emailRateLimitKey({ body: {}, ip: '9.9.9.9' })).toBe('ip:9.9.9.9');
    expect(emailRateLimitKey({ body: { email: 42 }, ip: '9.9.9.9' })).toBe('ip:9.9.9.9');
    expect(emailRateLimitKey({ body: undefined, ip: undefined })).toBe('ip:unknown');
  });
});
