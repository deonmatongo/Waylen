/**
 * Regression: payment webhooks must reach their controller untouched.
 *
 * They were once mounted after the global JSON parser and CSRF middleware, so
 * every provider callback was rejected with a CSRF 403 and the raw body needed
 * for signature checks was already consumed. Needs no database.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';

let app: Express;

beforeAll(async () => {
  const { createApp } = await import('../../src/app.js');
  app = createApp();
});

describe('webhook mounting', () => {
  it.each(['stripe', 'paystack', 'flutterwave'])(
    '%s webhook is not blocked by CSRF',
    async (provider) => {
      const res = await request(app)
        .post(`/webhooks/${provider}`)
        .set('Content-Type', 'application/json')
        .send(JSON.stringify({ event: 'test' }));
      // Reaches the controller, which rejects the missing/invalid signature.
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: 'Signature verification failed' });
    },
  );

  it('cron routes are not blocked by CSRF', async () => {
    const res = await request(app).get('/cron/overdue-invoices');
    expect(res.status).toBe(401);
  });
});
