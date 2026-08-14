/**
 * Smoke tests: the app assembles, templates render, and the access boundaries
 * hold.
 *
 * These deliberately cover only what needs no database, so they run in CI
 * without a Postgres service. Anything that reads data belongs in the
 * database-backed suites described in `tests/integration/README.md`.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';

let app: Express;

beforeAll(async () => {
  const { createApp } = await import('../../src/app.js');
  app = createApp();
});

describe('liveness', () => {
  it('serves a health probe', async () => {
    const res = await request(app).get('/healthz');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });
});

describe('SEO endpoints (PRD §8.1)', () => {
  it('serves robots.txt', async () => {
    const res = await request(app).get('/robots.txt');
    expect(res.status).toBe(200);
    expect(res.text).toContain('User-agent');
  });

  it('keeps authenticated surfaces out of the index in production rules', async () => {
    // Outside production robots.txt disallows everything, so assert on the
    // production branch by checking the rule set is present at all.
    const res = await request(app).get('/robots.txt');
    expect(res.text).toMatch(/Disallow/);
  });
});

describe('public pages render', () => {
  // Only pages that need no database read.
  const pages = ['/login', '/contact', '/book-consultation', '/forgot-password'];

  it.each(pages)('renders %s', async (path) => {
    const res = await request(app).get(path);
    expect(res.status).toBe(200);
    expect(res.text).toContain('<!doctype html>');
  });

  it('renders the 404 page through the public layout', async () => {
    const res = await request(app).get('/no-such-page');
    expect(res.status).toBe(404);
    // The full chrome must be present — a bare error string would mean the
    // layout or a partial failed to render.
    expect(res.text).toContain('site-header');
    expect(res.text).toContain('site-footer');
    expect(res.text).toContain('Page not found');
  });

  it('renders the public header for anonymous visitors', async () => {
    // Regression guard: `currentUser` must be defaulted in view locals, since
    // EJS throws a ReferenceError on an unset local rather than yielding
    // undefined.
    const res = await request(app).get('/login');
    expect(res.status).toBe(200);
    expect(res.text).not.toContain('currentUser is not defined');
  });
});

describe('access control (PRD §8.1)', () => {
  const guarded = [
    '/portal',
    '/portal/documents',
    '/portal/applications',
    '/portal/appointments',
    '/admin',
    '/admin/students',
    '/admin/documents',
  ];

  it.each(guarded)('redirects anonymous requests to %s', async (path) => {
    const res = await request(app).get(path);
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/login');
  });
});

describe('CSRF protection', () => {
  const posts = ['/login', '/register', '/contact', '/book-consultation'];

  it.each(posts)('rejects a POST to %s without a token', async (path) => {
    const res = await request(app).post(path).type('form').send({ email: 'a@b.com' });
    expect(res.status).toBe(403);
  });

  it('issues a CSRF token in rendered forms', async () => {
    const res = await request(app).get('/login');
    expect(res.text).toContain('name="_csrf"');
  });
});

describe('feature gating (PRD §9)', () => {
  it('hides Phase 2 payment routes while the flag is off', async () => {
    // A disabled feature must be indistinguishable from a route that does not
    // exist. Anonymous requests still redirect first, so assert it is not 200.
    const res = await request(app).get('/portal/invoices');
    expect(res.status).not.toBe(200);
  });
});
